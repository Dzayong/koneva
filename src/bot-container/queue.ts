import { Queue, Worker, UnrecoverableError, type Job } from 'bullmq';
import type Redis from 'ioredis';
import {
  delay as baileysDelay,
  WAMessageStatus,
  type WASocket,
  type AnyMessageContent,
  type WAMessageUpdate,
} from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import { query } from '../shared/database/connection';
import { getDeviceByKey, type QueryFn } from './health-score';
import { canSendMessage, type AntiBanDenialReason } from './anti-ban';
import { dispatchWebhook, type WebhookEventType } from './webhook';
import {
  antiBanDenialsTotal,
  messagesFailedTotal,
  messagesSentTotal,
  queueJobDurationSeconds,
} from './metrics';
import { withSpan } from './tracing';
import type { EnqueueMessageInput, QueueJobData, MessageRecord, MessageStatus } from './types';

const defaultQueryFn: QueryFn = (text, params) => query(text, params);

const JOB_NAME = 'send';
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 5_000;
const RETRY_LATER_DELAY_MS = 5 * 60_000;

const TRANSIENT_DENIAL_REASONS = new Set<AntiBanDenialReason>([
  'device_paused',
  'health_score_too_low',
  'daily_cap_reached',
  'rate_limit_per_minute',
  'outside_sending_window',
  'proactive_not_allowed_in_warmup',
  'media_not_allowed_in_warmup',
]);

function isTransientDenial(reason: AntiBanDenialReason | undefined): boolean {
  return reason !== undefined && TRANSIENT_DENIAL_REASONS.has(reason);
}

// BullMQ queue names cannot contain ':', so the "queue:messages:{device_key}"
// convention from the spec is expressed via the Redis key prefix instead.
const QUEUE_PREFIX = 'queue:messages';

export function queueName(deviceKey: string): string {
  return deviceKey;
}

export function deadLetterQueueName(deviceKey: string): string {
  return `${deviceKey}-dead`;
}

const queueCache = new Map<string, Queue<QueueJobData>>();

function getQueueByName(name: string, connection: Redis): Queue<QueueJobData> {
  const cacheKey = `${QUEUE_PREFIX}:${name}`;
  let existing = queueCache.get(cacheKey);
  if (!existing) {
    existing = new Queue<QueueJobData>(name, { connection, prefix: QUEUE_PREFIX });
    queueCache.set(cacheKey, existing);
  }
  return existing;
}

export async function closeQueueResources(): Promise<void> {
  await Promise.all([...queueCache.values()].map((q) => q.close()));
  queueCache.clear();
}

function toWaJid(to: string): string {
  return to.includes('@') ? to : `${to}@s.whatsapp.net`;
}

function toMessageContent(message: Pick<MessageRecord, 'type' | 'content'>): AnyMessageContent {
  switch (message.type) {
    case 'image':
      return { image: { url: message.content } };
    case 'video':
      return { video: { url: message.content } };
    case 'audio':
      return { audio: { url: message.content }, mimetype: 'audio/mp4' };
    case 'document':
      return { document: { url: message.content }, mimetype: 'application/octet-stream' };
    case 'text':
    default:
      return { text: message.content };
  }
}

interface MessageRow {
  id: string;
  tenant_id: string;
  device_id: string;
  device_key: string;
  to_number: string;
  content: string;
  type: MessageRecord['type'];
  status: MessageStatus;
  whatsapp_message_id: string | null;
  error_message: string | null;
  created_at: Date;
}

function mapMessageRow(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    deviceId: row.device_id,
    deviceKey: row.device_key,
    to: row.to_number,
    content: row.content,
    type: row.type,
    status: row.status,
    whatsappMessageId: row.whatsapp_message_id,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

async function getMessageById(id: string, queryFn: QueryFn): Promise<MessageRecord | undefined> {
  const { rows } = await queryFn(
    `SELECT id, tenant_id, device_id, device_key, to_number, content, type, status,
            whatsapp_message_id, error_message, created_at
     FROM messages WHERE id = $1`,
    [id],
  );
  const row = rows[0] as unknown as MessageRow | undefined;
  return row ? mapMessageRow(row) : undefined;
}

interface UpdateMessageStatusFields {
  status: MessageStatus;
  whatsappMessageId?: string;
  errorMessage?: string;
  timestampColumn?: 'sent_at' | 'delivered_at' | 'read_at';
}

async function updateMessageStatus(
  id: string,
  fields: UpdateMessageStatusFields,
  queryFn: QueryFn,
): Promise<void> {
  const sets: string[] = ['status = $2'];
  const params: unknown[] = [id, fields.status];
  let idx = 3;

  if (fields.whatsappMessageId !== undefined) {
    sets.push(`whatsapp_message_id = $${idx}`);
    params.push(fields.whatsappMessageId);
    idx += 1;
  }
  if (fields.errorMessage !== undefined) {
    sets.push(`error_message = $${idx}`);
    params.push(fields.errorMessage);
    idx += 1;
  }
  if (fields.timestampColumn) {
    sets.push(`${fields.timestampColumn} = now()`);
  }

  await queryFn(`UPDATE messages SET ${sets.join(', ')} WHERE id = $1`, params);
}

export async function enqueueMessage(
  deviceKey: string,
  input: EnqueueMessageInput,
  connection: Redis,
  queryFn: QueryFn = defaultQueryFn,
): Promise<string> {
  const device = await getDeviceByKey(deviceKey, queryFn);
  if (!device) {
    throw new Error(`Device not found: ${deviceKey}`);
  }

  const { rows } = await queryFn(
    `INSERT INTO messages (tenant_id, device_id, device_key, to_number, content, type, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued')
     RETURNING id`,
    [device.tenantId, device.id, device.deviceKey, input.to, input.content, input.type],
  );
  const row = rows[0] as { id: string } | undefined;
  if (!row) {
    throw new Error('Failed to insert queued message');
  }

  const jobData: QueueJobData = { messageId: row.id };
  await getQueueByName(queueName(deviceKey), connection).add(JOB_NAME, jobData, {
    attempts: MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: BACKOFF_BASE_MS },
    removeOnComplete: { age: 24 * 3_600, count: 1_000 },
    removeOnFail: false,
  });

  return row.id;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function moveToDeadLetter(
  deviceKey: string,
  data: QueueJobData,
  connection: Redis,
  log: Logger,
): Promise<void> {
  await getQueueByName(deadLetterQueueName(deviceKey), connection).add('dead', data, {
    removeOnComplete: false,
  });
  log.error('Message moved to dead-letter queue', { deviceKey, messageId: data.messageId });
}

export interface QueueProcessorDeps {
  getSocket: () => WASocket | undefined;
  isConnected: () => boolean;
}

async function failAttempt(
  job: Job<QueueJobData>,
  message: MessageRecord,
  deviceKey: string,
  connection: Redis,
  queryFn: QueryFn,
  log: Logger,
  errorMessage: string,
  reasonLabel: 'not_connected' | 'send_error',
): Promise<never> {
  log.error('Message send attempt failed', {
    messageId: message.id,
    attempt: job.attemptsMade + 1,
    error: errorMessage,
  });

  if (job.attemptsMade + 1 >= MAX_ATTEMPTS) {
    await updateMessageStatus(message.id, { status: 'failed', errorMessage }, queryFn);
    await moveToDeadLetter(deviceKey, job.data, connection, log);
    messagesFailedTotal.inc({ device_key: deviceKey, reason: reasonLabel });
    await dispatchWebhook(
      message.tenantId,
      {
        event: 'message.failed',
        device_key: message.deviceKey,
        message_id: message.id,
        to: message.to,
        status: 'failed',
        timestamp: nowIso(),
      },
      { queryFn },
    );
  }

  throw new Error(errorMessage);
}

async function processJob(
  job: Job<QueueJobData>,
  deviceKey: string,
  deps: QueueProcessorDeps,
  connection: Redis,
  queryFn: QueryFn,
  log: Logger,
): Promise<void> {
  const startedAt = Date.now();
  try {
    await processJobBody(job, deviceKey, deps, connection, queryFn, log);
  } finally {
    queueJobDurationSeconds.observe({ device_key: deviceKey }, (Date.now() - startedAt) / 1000);
  }
}

async function processJobBody(
  job: Job<QueueJobData>,
  deviceKey: string,
  deps: QueueProcessorDeps,
  connection: Redis,
  queryFn: QueryFn,
  log: Logger,
): Promise<void> {
  const message = await getMessageById(job.data.messageId, queryFn);
  if (!message) {
    throw new UnrecoverableError(`Message not found: ${job.data.messageId}`);
  }

  if (message.status === 'sent' || message.status === 'delivered' || message.status === 'read') {
    log.info('Message already handled, skipping', { messageId: message.id, status: message.status });
    return;
  }

  if (!deps.isConnected() || !deps.getSocket()) {
    await failAttempt(
      job,
      message,
      deviceKey,
      connection,
      queryFn,
      log,
      'WhatsApp socket is not connected',
      'not_connected',
    );
    return;
  }

  const decision = await canSendMessage(message.deviceKey, {
    queryFn,
    content: message.content,
    recipient: message.to,
    hasMedia: message.type !== 'text',
    isProactive: true,
  });

  if (!decision.allowed) {
    const reasonLabel = decision.reason ?? 'content_rejected';
    antiBanDenialsTotal.inc({ device_key: deviceKey, reason: reasonLabel });

    if (isTransientDenial(decision.reason)) {
      log.warn('Anti-ban deferred message, re-queueing later', {
        messageId: message.id,
        reason: decision.reason,
      });
      await getQueueByName(queueName(deviceKey), connection).add(
        JOB_NAME,
        { messageId: message.id } satisfies QueueJobData,
        { delay: RETRY_LATER_DELAY_MS },
      );
      return;
    }

    await updateMessageStatus(message.id, { status: 'failed', errorMessage: reasonLabel }, queryFn);
    messagesFailedTotal.inc({ device_key: deviceKey, reason: reasonLabel });
    await dispatchWebhook(
      message.tenantId,
      {
        event: 'message.failed',
        device_key: message.deviceKey,
        message_id: message.id,
        to: message.to,
        status: 'failed',
        timestamp: nowIso(),
      },
      { queryFn },
    );
    throw new UnrecoverableError(`Anti-ban rejected message: ${reasonLabel}`);
  }

  if (decision.delayMs > 0) {
    await baileysDelay(decision.delayMs);
  }

  const sock = deps.getSocket();
  if (!deps.isConnected() || !sock) {
    await failAttempt(
      job,
      message,
      deviceKey,
      connection,
      queryFn,
      log,
      'WhatsApp socket disconnected while waiting to send',
      'not_connected',
    );
    return;
  }

  const jid = toWaJid(message.to);
  if (decision.typing.shouldSimulate) {
    try {
      await sock.sendPresenceUpdate('composing', jid);
      await baileysDelay(decision.typing.durationMs);
      await sock.sendPresenceUpdate('paused', jid);
    } catch (err) {
      log.debug('Typing simulation failed, continuing', {
        messageId: message.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let sendResult;
  try {
    sendResult = await withSpan(
      'message.send',
      { device_key: deviceKey, message_id: message.id, 'message.type': message.type },
      () => sock.sendMessage(jid, toMessageContent(message)),
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await failAttempt(job, message, deviceKey, connection, queryFn, log, errorMessage, 'send_error');
    return;
  }

  const whatsappMessageId = sendResult?.key.id ?? undefined;
  await updateMessageStatus(
    message.id,
    { status: 'sent', timestampColumn: 'sent_at', ...(whatsappMessageId ? { whatsappMessageId } : {}) },
    queryFn,
  );
  messagesSentTotal.inc({ device_key: deviceKey, type: message.type });

  await dispatchWebhook(
    message.tenantId,
    {
      event: 'message.sent',
      device_key: message.deviceKey,
      message_id: message.id,
      ...(whatsappMessageId ? { whatsapp_message_id: whatsappMessageId } : {}),
      to: message.to,
      status: 'sent',
      timestamp: nowIso(),
    },
    { queryFn },
  );

  log.info('Message sent', { messageId: message.id, to: message.to });
}

export interface QueueProcessor {
  stop: () => Promise<void>;
}

export function startQueueProcessor(
  deviceKey: string,
  connection: Redis,
  deps: QueueProcessorDeps,
  log: Logger,
  queryFn: QueryFn = defaultQueryFn,
): QueueProcessor {
  const worker = new Worker<QueueJobData>(
    queueName(deviceKey),
    (job) => processJob(job, deviceKey, deps, connection, queryFn, log),
    { connection, prefix: QUEUE_PREFIX, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    log.error('Queue job failed', {
      messageId: job?.data.messageId,
      attemptsMade: job?.attemptsMade,
      error: err.message,
    });
  });

  worker.on('error', (err) => {
    log.error('Queue worker error', { error: err.message });
  });

  return {
    stop: async () => {
      await worker.close();
    },
  };
}

async function handleReceiptUpdate(
  { key, update }: WAMessageUpdate,
  queryFn: QueryFn,
  log: Logger,
): Promise<void> {
  if (!key.id || update.status === undefined) {
    return;
  }

  let newStatus: 'delivered' | 'read' | undefined;
  let timestampColumn: 'delivered_at' | 'read_at' | undefined;
  let event: WebhookEventType | undefined;

  if (update.status === WAMessageStatus.DELIVERY_ACK) {
    newStatus = 'delivered';
    timestampColumn = 'delivered_at';
    event = 'message.delivered';
  } else if (update.status === WAMessageStatus.READ || update.status === WAMessageStatus.PLAYED) {
    newStatus = 'read';
    timestampColumn = 'read_at';
    event = 'message.read';
  } else {
    return;
  }

  const { rows } = await queryFn(
    `SELECT id, tenant_id, device_key, to_number FROM messages WHERE whatsapp_message_id = $1`,
    [key.id],
  );
  const row = rows[0] as
    | { id: string; tenant_id: string; device_key: string; to_number: string }
    | undefined;
  if (!row) {
    return;
  }

  await queryFn(`UPDATE messages SET status = $1, ${timestampColumn} = now() WHERE id = $2`, [
    newStatus,
    row.id,
  ]);

  await dispatchWebhook(
    row.tenant_id,
    {
      event,
      device_key: row.device_key,
      message_id: row.id,
      whatsapp_message_id: key.id,
      to: row.to_number,
      status: newStatus,
      timestamp: nowIso(),
    },
    { queryFn },
  );

  log.info('Message receipt updated', { messageId: row.id, status: newStatus });
}

export function registerReceiptListener(
  sock: WASocket,
  log: Logger,
  queryFn: QueryFn = defaultQueryFn,
): void {
  sock.ev.on('messages.update', (updates) => {
    for (const update of updates) {
      handleReceiptUpdate(update, queryFn, log).catch((err: unknown) => {
        log.error('Failed to process message receipt update', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  });
}

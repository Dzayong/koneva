import type { PresenceRoutine } from './presence';
import { recordStatusView, type ReceiptUpdate } from './status-views';
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
import { calculateHealthScore, getDeviceByKey, type QueryFn } from './health-score';
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
  'resting',
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

export function urgentQueueName(deviceKey: string): string {
  return `${deviceKey}-urgent`;
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

export function toMessageContent(message: Pick<MessageRecord, 'type' | 'content'> & { mediaUrl?: string | null }): AnyMessageContent {
  // Messages queued through the gateway keep the file address in media_url and the caption in content.
  // Older rows (bot API) hold the address in content itself.
  const url = message.mediaUrl ?? message.content;
  const caption = message.mediaUrl && message.content.trim() ? { caption: message.content } : {};
  switch (message.type) {
    case 'image':
      return { image: { url }, ...caption };
    case 'video':
      return { video: { url }, ...caption };
    case 'audio':
      return { audio: { url }, mimetype: 'audio/mp4' };
    case 'document':
      return { document: { url }, mimetype: 'application/octet-stream', ...caption };
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
  media_url: string | null;
  type: MessageRecord['type'];
  status: MessageStatus;
  whatsapp_message_id: string | null;
  error_message: string | null;
  priority: MessageRecord['priority'];
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
    mediaUrl: row.media_url,
    type: row.type,
    status: row.status,
    whatsappMessageId: row.whatsapp_message_id,
    errorMessage: row.error_message,
    priority: row.priority,
    createdAt: row.created_at,
  };
}

async function getMessageById(id: string, queryFn: QueryFn): Promise<MessageRecord | undefined> {
  const { rows } = await queryFn(
    `SELECT id, tenant_id, device_id, device_key, to_number, content, media_url, type, status,
            whatsapp_message_id, error_message, priority, created_at
     FROM messages WHERE id = $1`,
    [id],
  );
  const row = rows[0] as unknown as MessageRow | undefined;
  return row ? mapMessageRow(row) : undefined;
}

interface UpdateMessageStatusFields {
  status: MessageStatus;
  whatsappMessageId?: string;
  errorMessage?: string | null;
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
    `INSERT INTO messages (tenant_id, device_id, device_key, to_number, content, type, status, priority)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7)
     RETURNING id`,
    [device.tenantId, device.id, device.deviceKey, input.to, input.content, input.type, input.priority ?? 'normal'],
  );
  const row = rows[0] as { id: string } | undefined;
  if (!row) {
    throw new Error('Failed to insert queued message');
  }

  const jobData: QueueJobData = { messageId: row.id };
  const urgent = input.priority === 'urgent';
  await getQueueByName(urgent ? urgentQueueName(deviceKey) : queueName(deviceKey), connection).add(JOB_NAME, jobData, {
    // An OTP that arrives late is useless, so urgent jobs get one quick retry only.
    attempts: urgent ? 2 : MAX_ATTEMPTS,
    backoff: urgent ? { type: 'fixed', delay: 1_500 } : { type: 'exponential', delay: BACKOFF_BASE_MS },
    removeOnComplete: { age: 24 * 3_600, count: 1_000 },
    removeOnFail: false,
  });

  return row.id;
}

/**
 * A message to someone who wrote to us in the last 24 hours is a reply, not outreach (WhatsApp's own
 * customer-service window). Replies stay allowed during warm-up; unsolicited messages do not.
 */
export async function hasRecentInbound(deviceId: string, to: string, queryFn: QueryFn): Promise<boolean> {
  const digits = to.replace(/\D/g, '');
  if (!digits) return false;
  const { rows } = await queryFn(
    `SELECT 1 FROM messages
     WHERE device_id = $1::uuid AND direction = 'inbound' AND from_number = $2::varchar
       AND created_at > now() - interval '24 hours' LIMIT 1`,
    [deviceId, digits],
  );
  return rows.length > 0;
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
  /** Injectable clock for deterministic integration tests. */
  now?: () => Date;
  /** Injectable delay; production uses Baileys' real delay implementation. */
  delay?: (ms: number) => Promise<void>;
  /** Puts the number online before it types and sends, and lets it drift offline afterwards. */
  presence?: Pick<PresenceRoutine, 'ensureOnline' | 'afterSend'>;
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

  if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
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
    isProactive: !(await hasRecentInbound(message.deviceId, message.to, queryFn)),
    priority: message.priority,
    ...(deps.now ? { now: deps.now() } : {}),
  });

  if (!decision.allowed) {
    const reasonLabel = decision.reason ?? 'content_rejected';
    antiBanDenialsTotal.inc({ device_key: deviceKey, reason: reasonLabel });

    if (isTransientDenial(decision.reason) && message.priority !== 'urgent') {
      log.warn('Anti-ban deferred message, re-queueing later', {
        messageId: message.id,
        reason: decision.reason,
      });
      // The status stays 'queued'; the reason lets the tenant see why it is waiting.
      await updateMessageStatus(message.id, { status: 'queued', errorMessage: decision.reason ?? 'deferred' }, queryFn);
      await getQueueByName(queueName(deviceKey), connection).add(
        JOB_NAME,
        { messageId: message.id } satisfies QueueJobData,
        {
          delay: decision.retryAfterMs ?? RETRY_LATER_DELAY_MS,
          attempts: MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: BACKOFF_BASE_MS },
          removeOnComplete: { age: 24 * 3_600, count: 1_000 },
          removeOnFail: false,
        },
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

  // The configured delay is the total time to send, typing included, so a flat
  // 5 s setting really means about 5 s instead of 5 s plus typing.
  const typingMs = decision.typing.shouldSimulate
    ? Math.min(decision.typing.durationMs, Math.floor(decision.delayMs * 0.6))
    : 0;
  const waitMs = Math.max(0, decision.delayMs - typingMs);
  if (waitMs > 0) {
    await (deps.delay ?? baileysDelay)(waitMs);
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
  await deps.presence?.ensureOnline();
  if (typingMs > 0) {
    try {
      await sock.sendPresenceUpdate('composing', jid);
      await (deps.delay ?? baileysDelay)(typingMs);
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

  void deps.presence?.afterSend();
  const whatsappMessageId = sendResult?.key.id ?? undefined;
  await updateMessageStatus(
    message.id,
    { status: 'sent', timestampColumn: 'sent_at', errorMessage: null, ...(whatsappMessageId ? { whatsappMessageId } : {}) },
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

/**
 * A message can be 'queued' in the database while its job is gone (Redis wiped, a job
 * that failed without a retry policy). Such a message would hang forever with no
 * notice, so it is failed loudly and the tenant is told. It is never re-sent: a message
 * delivered hours late (an OTP, a reminder) does more harm than a clear failure.
 */
export async function failStuckMessages(
  deviceKey: string,
  liveMessageIds: ReadonlySet<string>,
  queryFn: QueryFn,
  log: Logger,
  dispatch: typeof dispatchWebhook = dispatchWebhook,
): Promise<number> {
  const { rows } = await queryFn(
    `SELECT id, tenant_id, device_key, to_number FROM messages
     WHERE device_key = $1 AND direction = 'outbound' AND status = 'queued'
       AND created_at < now() - CASE WHEN priority = 'urgent' THEN interval '2 minutes' ELSE interval '15 minutes' END`,
    [deviceKey],
  );
  let failed = 0;
  for (const row of rows as { id: string; tenant_id: string; device_key: string; to_number: string }[]) {
    if (liveMessageIds.has(row.id)) continue;
    const updated = await queryFn(
      `UPDATE messages SET status = 'failed', error_message = 'lost_in_queue' WHERE id = $1 AND status = 'queued' RETURNING id`,
      [row.id],
    );
    if (updated.rows.length === 0) continue;
    failed += 1;
    log.error('Queued message had no live job; marked failed', { messageId: row.id, deviceKey });
    await dispatch(row.tenant_id, {
      event: 'message.failed', device_key: row.device_key, message_id: row.id,
      to: row.to_number, status: 'failed', reason: 'lost_in_queue', timestamp: nowIso(),
    }, { queryFn }).catch((error: unknown) => {
      log.error('Failed to dispatch lost-message webhook', { error: error instanceof Error ? error.message : String(error) });
    });
  }
  return failed;
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
  const makeWorker = (name: string, concurrency: number): Worker<QueueJobData> => {
    const worker = new Worker<QueueJobData>(
      name,
      (job) => processJob(job, deviceKey, deps, connection, queryFn, log),
      { connection, prefix: QUEUE_PREFIX, concurrency },
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
    return worker;
  };

  // Normal traffic is paced one message at a time; urgent traffic (OTP) has its own
  // queue and workers so it never waits behind a paced broadcast.
  const workers = [makeWorker(queueName(deviceKey), 1), makeWorker(urgentQueueName(deviceKey), 4)];

  const sweep = async (): Promise<void> => {
    try {
      const queues = [getQueueByName(queueName(deviceKey), connection), getQueueByName(urgentQueueName(deviceKey), connection)];
      const jobs = (await Promise.all(queues.map((queue) =>
        queue.getJobs(['waiting', 'delayed', 'active', 'prioritized', 'waiting-children']),
      ))).flat();
      const live = new Set(jobs.map((job) => job.data.messageId));
      await failStuckMessages(deviceKey, live, queryFn, log);
      // Keeps the score shown in the dashboard current; it used to change only when a send was attempted.
      await calculateHealthScore(deviceKey, queryFn);
    } catch (error) {
      log.error('Stuck-message sweep failed', { error: error instanceof Error ? error.message : String(error) });
    }
  };
  // First sweep waits so the workers can pick up any backlog after a restart.
  const firstSweep = setTimeout(() => void sweep(), 60_000);
  const sweepTimer = setInterval(() => void sweep(), 5 * 60_000);

  return {
    stop: async () => {
      clearTimeout(firstSweep);
      clearInterval(sweepTimer);
      await Promise.all(workers.map((w) => w.close()));
    },
  };
}

export async function handleReceiptUpdate(
  { key, update }: WAMessageUpdate,
  queryFn: QueryFn,
  log: Logger,
  webhookDispatcher: typeof dispatchWebhook = dispatchWebhook,
): Promise<void> {
  if (!key.id || update.status == null) {
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
    log.debug('Ignoring non-terminal WhatsApp message update', {
      whatsappMessageId: key.id,
      receiptStatus: update.status,
      receiptStatusName: WAMessageStatus[update.status] ?? 'UNKNOWN',
    });
    return;
  }

  log.info('WhatsApp message receipt received', {
    whatsappMessageId: key.id,
    receiptStatus: update.status,
    receiptStatusName: WAMessageStatus[update.status] ?? 'UNKNOWN',
    mappedStatus: newStatus,
    remoteJid: key.remoteJid,
    fromMe: key.fromMe,
  });

  const allowedStatuses = newStatus === 'read'
    ? ['queued', 'sending', 'sent', 'delivered']
    : ['queued', 'sending', 'sent'];
  const { rows } = await queryFn(
    `UPDATE messages
     SET status = $1, ${timestampColumn} = COALESCE(${timestampColumn}, now())
     WHERE whatsapp_message_id = $2 AND status = ANY($3::varchar[])
     RETURNING id, tenant_id, device_key, to_number`,
    [newStatus, key.id, allowedStatuses],
  );
  const row = rows[0] as
    | { id: string; tenant_id: string; device_key: string; to_number: string }
    | undefined;
  if (!row) {
    log.warn('WhatsApp receipt did not match an updatable message', {
      whatsappMessageId: key.id,
      mappedStatus: newStatus,
    });
    return;
  }

  await webhookDispatcher(
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
  deviceKey?: string,
): void {
  if (deviceKey) {
    sock.ev.on('message-receipt.update', (updates) => {
      for (const update of updates) {
        recordStatusView(update as unknown as ReceiptUpdate, deviceKey, queryFn, log).catch((err: unknown) => {
          log.error('Failed to record status view', { error: err instanceof Error ? err.message : String(err) });
        });
      }
    });
  }
  sock.ev.on('messages.update', (updates) => {
    log.debug('WhatsApp messages.update batch received', { updateCount: updates.length });
    for (const update of updates) {
      handleReceiptUpdate(update, queryFn, log).catch((err: unknown) => {
        log.error('Failed to process message receipt update', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  });
}

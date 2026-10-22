import type { PresenceRoutine } from './presence';
import { recordStatusView, type ReceiptUpdate } from './status-views';
import { Queue, Worker, UnrecoverableError, type Job } from 'bullmq';
import type Redis from 'ioredis';
import {
  delay as baileysDelay,
  generateMessageIDV2,
  WAMessageStatus,
  type WASocket,
  type AnyMessageContent,
  type WAMessageUpdate,
  type WAMessage,
} from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import { query } from '../shared/database/connection';
import { calculateHealthScore, getDeviceByKey, type QueryFn } from './health-score';
import { canSendMessage, type AntiBanDecision, type AntiBanDenialReason, type CanSendMessageOptions } from './anti-ban';
import { checkTransmission, isDefinitelyNotSent, type TransmitDecision } from './send-guard';
import { dispatchWebhook, type WebhookEventType } from './webhook';
import {
  antiBanDenialsTotal,
  messagesFailedTotal,
  messagesSentTotal,
  queueJobDurationSeconds,
} from './metrics';
import { withSpan } from './tracing';
import type { EnqueueMessageInput, QueueJobData, MessageRecord, MessageStatus } from './types';
import { getStoredRecipientConsent, withRecipientConsentLock } from '../shared/recipient-consent';
import { ApiError } from './errors';
import { withDeviceSendLock } from '../shared/device-send-lock';

const defaultQueryFn: QueryFn = (text, params) => query(text, params);

const JOB_NAME = 'send';
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 5_000;
const RETRY_LATER_DELAY_MS = 5 * 60_000;
const MAX_NORMAL_QUEUE_AGE_MS = 15 * 60_000;
const MAX_URGENT_QUEUE_AGE_MS = 2 * 60_000;

class RecipientConsentDenied extends Error {
  constructor(readonly code: 'RECIPIENT_CONSENT_REQUIRED' | 'RECIPIENT_OPTED_OUT') { super(code); }
}

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
  quota_exempt: boolean;
  system_otp: boolean;
  system_notification: boolean;
  reply_to_message_id: string | null;
  allow_warmup_override: boolean;
  created_at: Date;
  queue_started_at: Date;
  send_started_at: Date | null;
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
    // Only the server-owned exemption makes a message urgent. A persisted
    // request priority by itself is never authority for a privileged route.
    priority: row.quota_exempt ? 'urgent' : 'normal',
    quotaExempt: row.quota_exempt,
    ...(row.system_otp ? { systemOtp: true } : {}),
    ...(row.system_notification ? { systemNotification: true } : {}),
    ...(row.reply_to_message_id ? { replyToMessageId: row.reply_to_message_id } : {}),
    ...(row.allow_warmup_override ? { allowWarmupOverride: true } : {}),
    createdAt: row.created_at,
    queueStartedAt: row.queue_started_at,
  };
}

async function getMessageById(id: string, queryFn: QueryFn): Promise<MessageRecord | undefined> {
  const { rows } = await queryFn(
    `SELECT id, tenant_id, device_id, device_key, to_number, content, media_url, type, status,
            whatsapp_message_id, error_message, priority, COALESCE(quota_exempt, false) AS quota_exempt,
            COALESCE(system_otp, false) AS system_otp, COALESCE(system_notification, false) AS system_notification,
            reply_to_message_id, allow_warmup_override, created_at, queue_started_at, send_started_at
     FROM messages WHERE id = $1`,
    [id],
  );
  const row = rows[0] as unknown as MessageRow | undefined;
  return row ? mapMessageRow(row) : undefined;
}

interface ReplyContext { fromNumber: string | null; whatsappMessageId: string | null; content: string }

async function getReplyContext(message: MessageRecord, queryFn: QueryFn, now = new Date()): Promise<ReplyContext | null> {
  if (!message.replyToMessageId) return null;
  const groupReply = message.to.endsWith('@g.us');
  const result = await queryFn(
    groupReply
      ? `SELECT from_number, whatsapp_message_id, content FROM messages
         WHERE id = $1 AND tenant_id = $2 AND device_id = $3 AND direction = 'inbound'
           AND chat_jid = $4 AND created_at >= $5 AND created_at <= $6`
      : `SELECT from_number, whatsapp_message_id, content FROM messages
         WHERE id = $1 AND tenant_id = $2 AND device_id = $3 AND direction = 'inbound'
           AND regexp_replace(COALESCE(from_number, ''), '[^0-9]', '', 'g') = $4
           AND created_at >= $5 AND created_at <= $6`,
    [message.replyToMessageId, message.tenantId, message.deviceId,
      groupReply ? message.to : message.to.replace(/\D/g, ''), new Date(now.getTime() - 24 * 60 * 60_000), now],
  );
  return (result.rows[0] as ReplyContext | undefined) ?? null;
}

async function hasValidReplyContext(message: MessageRecord, queryFn: QueryFn, now = new Date()): Promise<boolean> {
  return Boolean(await getReplyContext(message, queryFn, now));
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
  if (['sent', 'failed', 'blocked'].includes(fields.status)
    && !(fields.status === 'failed' && fields.errorMessage === 'delivery_uncertain')) {
    sets.push('send_started_at = NULL');
  }
  if (['sent', 'failed', 'blocked'].includes(fields.status)) {
    sets.push("content = CASE WHEN system_otp OR system_notification THEN '[redacted]' ELSE content END");
    sets.push("to_number = CASE WHEN system_otp OR system_notification THEN '[redacted]' ELSE to_number END");
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
  return withRecipientConsentLock(device.tenantId, input.to, async () => {
  const consent = await getStoredRecipientConsent(queryFn, device.tenantId, input.to);
  if (consent !== 'opted_in') {
    const code = consent === 'opted_out' ? 'RECIPIENT_OPTED_OUT' : 'RECIPIENT_CONSENT_REQUIRED';
    throw new ApiError(409, code.toLocaleLowerCase(),
      consent === 'opted_out' ? 'Recipient has opted out of promotional messages' : 'Record recipient consent before sending promotional messages');
  }

  const { rows } = await queryFn(
    `INSERT INTO messages (tenant_id, device_id, device_key, to_number, content, type, status, priority)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7)
     RETURNING id`,
    [device.tenantId, device.id, device.deviceKey, input.to, input.content, input.type, 'normal'],
  );
  const row = rows[0] as { id: string } | undefined;
  if (!row) {
    throw new Error('Failed to insert queued message');
  }

  const jobData: QueueJobData = { messageId: row.id };
  // This internal endpoint has no server-verified transactional classifier. A caller's `priority` is never authority.
  const urgent = false;
  await getQueueByName(urgent ? urgentQueueName(deviceKey) : queueName(deviceKey), connection).add(JOB_NAME, jobData, {
    // An OTP that arrives late is useless, so urgent jobs get one quick retry only.
    attempts: urgent ? 2 : MAX_ATTEMPTS,
    backoff: urgent ? { type: 'fixed', delay: 1_500 } : { type: 'exponential', delay: BACKOFF_BASE_MS },
    removeOnComplete: { age: 24 * 3_600, count: 1_000 },
    removeOnFail: false,
  });

    return row.id;
  });
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
  /** Test hook: replaces the anti-ban pacing decision. The administrative guard below is never replaced. */
  canSend?: (deviceKey: string, options: CanSendMessageOptions) => Promise<AntiBanDecision>;
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
    const failed = await queryFn(
      `UPDATE messages SET status = 'failed', send_started_at = NULL, error_message = $2,
         content = CASE WHEN system_otp OR system_notification THEN '[redacted]' ELSE content END,
         to_number = CASE WHEN system_otp OR system_notification THEN '[redacted]' ELSE to_number END
       WHERE id = $1 AND status = 'sending' RETURNING id`,
      [message.id, errorMessage],
    );
    if (failed.rows.length === 0) {
      log.info('Transport failure arrived after a WhatsApp receipt; preserving confirmed message status', { messageId: message.id });
      throw new UnrecoverableError('Message already confirmed by WhatsApp');
    }
    await moveToDeadLetter(deviceKey, job.data, connection, log);
    messagesFailedTotal.inc({ device_key: deviceKey, reason: reasonLabel });
    if (!message.systemOtp) await dispatchWebhook(
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
  } else {
    // A transport error classified as definitely-not-sent is safe to retry.
    // Release the claim before BullMQ retries this job.
    await queryFn(
      `UPDATE messages SET status = 'queued', send_started_at = NULL, error_message = $2
       WHERE id = $1 AND status = 'sending'`,
      [message.id, errorMessage],
    );
  }

  throw new Error(errorMessage);
}

/**
 * What happens when the administrative guard says no (the message is NOT handed to WhatsApp in any of these cases):
 *  - workspace_suspended / device_banned / device_not_found: the message is CANCELLED: status failed with that reason, tenant told by webhook,
 *    no automatic retry and nothing sent after a later recovery (a late OTP or campaign does more harm than a clear failure; the tenant can
 *    retry it by hand once the workspace is active again).
 *  - device_paused, normal priority: DEFERRED. The message stays queued and is tried again later; it goes out once, after the device resumes.
 *  - device_paused, urgent (OTP): CANCELLED like the first group, never held for later.
 */
async function applyTransmitBlock(
  decision: TransmitDecision, job: Job<QueueJobData>, message: MessageRecord, deviceKey: string,
  connection: Redis, queryFn: QueryFn, log: Logger,
): Promise<never> {
  const reason = decision.reason ?? 'blocked';
  antiBanDenialsTotal.inc({ device_key: deviceKey, reason });
  if (reason === 'device_paused' && message.priority !== 'urgent') {
    const now = Date.now();
    const age = now - message.queueStartedAt.getTime();
    if (age >= MAX_NORMAL_QUEUE_AGE_MS || RETRY_LATER_DELAY_MS >= MAX_NORMAL_QUEUE_AGE_MS - age) {
      await expireQueuedMessage(message, deviceKey, queryFn, log, now);
    }
    log.warn('Device paused, deferring message', { messageId: message.id });
    await updateMessageStatus(message.id, { status: 'queued', errorMessage: 'device_paused' }, queryFn);
    await getQueueByName(queueName(deviceKey), connection).add(
      JOB_NAME, { messageId: message.id } satisfies QueueJobData,
      { delay: RETRY_LATER_DELAY_MS, attempts: MAX_ATTEMPTS, backoff: { type: 'exponential', delay: BACKOFF_BASE_MS }, removeOnComplete: { age: 24 * 3_600, count: 1_000 }, removeOnFail: false },
    );
    // The current job ends normally; the new delayed job is the only live one for this message.
    throw new DeferredForLater(reason);
  }
  await updateMessageStatus(message.id, { status: 'failed', errorMessage: reason }, queryFn);
  messagesFailedTotal.inc({ device_key: deviceKey, reason });
  if (!message.systemOtp) await dispatchWebhook(message.tenantId, {
    event: 'message.failed', device_key: message.deviceKey, message_id: message.id, to: message.to,
    status: 'failed', reason, timestamp: nowIso(),
  }, { queryFn });
  log.warn('Message cancelled by administrative state', { messageId: message.id, reason, detail: decision.detail, jobId: job.id });
  throw new UnrecoverableError(`Not sent: ${reason}`);
}

/** Internal signal: the job is finished for now because a fresh delayed job carries the message. */
class DeferredForLater extends Error {
  constructor(readonly reason: string) { super(`deferred: ${reason}`); }
}

async function expireQueuedMessage(
  message: MessageRecord,
  deviceKey: string,
  queryFn: QueryFn,
  log: Logger,
  now = Date.now(),
): Promise<never> {
  const reason = 'queue_expired';
  await updateMessageStatus(message.id, { status: 'failed', errorMessage: reason }, queryFn);
  messagesFailedTotal.inc({ device_key: deviceKey, reason });
  if (!message.systemOtp && !message.systemNotification) await dispatchWebhook(message.tenantId, {
    event: 'message.failed', device_key: message.deviceKey, message_id: message.id, to: message.to,
    status: 'failed', reason, timestamp: new Date(now).toISOString(),
  }, { queryFn });
  log.warn('Queued message expired before delivery', {
    messageId: message.id, deviceKey, ageMs: Math.max(0, now - message.queueStartedAt.getTime()), reason,
  });
  throw new UnrecoverableError('Message expired while waiting in the queue');
}

export async function processJob(
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
  } catch (error) {
    if (error instanceof DeferredForLater) return; // postponed on purpose: this job is done, the delayed one continues
    throw error;
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

  if (message.status !== 'queued') {
    log.info('Message already handled, skipping', { messageId: message.id, status: message.status });
    return;
  }
  const now = deps.now?.() ?? new Date();
  const queueAgeMs = now.getTime() - message.queueStartedAt.getTime();
  const maxQueueAgeMs = message.priority === 'urgent' ? MAX_URGENT_QUEUE_AGE_MS : MAX_NORMAL_QUEUE_AGE_MS;
  if (queueAgeMs >= maxQueueAgeMs) {
    await expireQueuedMessage(message, deviceKey, queryFn, log, now.getTime());
  }
  if (message.systemOtp && Date.now() - message.createdAt.getTime() >= 10 * 60_000) {
    await updateMessageStatus(message.id, { status: 'failed', errorMessage: 'otp_expired' }, queryFn);
    throw new UnrecoverableError('Signup OTP expired before delivery');
  }

  const replyContext = await getReplyContext(message, queryFn, deps.now?.() ?? new Date());
  const groupReply = message.to.endsWith('@g.us');
  const consentRecipient = groupReply ? (replyContext?.fromNumber ?? message.to) : message.to;
  const initialConsent = await getStoredRecipientConsent(queryFn, message.tenantId, consentRecipient);
  const initialReplyContext = Boolean(replyContext);
  const isProactive = groupReply ? !initialReplyContext : !(await hasRecentInbound(message.deviceId, message.to, queryFn));
  if (!message.quotaExempt && (initialConsent === 'opted_out' || (initialConsent !== 'opted_in' && !initialReplyContext))) {
    const code = initialConsent === 'opted_out' ? 'RECIPIENT_OPTED_OUT' : 'RECIPIENT_CONSENT_REQUIRED';
    await updateMessageStatus(message.id, { status: 'blocked', errorMessage: code.toLocaleLowerCase() }, queryFn);
    log.warn('Queued message blocked by recipient consent', {
      tenantId: message.tenantId, recipientLast4: message.to.replace(/\D/g, '').slice(-4),
      messageId: message.id, errorCode: code,
    });
    messagesFailedTotal.inc({ device_key: deviceKey, reason: code.toLocaleLowerCase() });
    if (!message.systemOtp) await dispatchWebhook(message.tenantId, {
      event: 'message.failed', device_key: message.deviceKey, message_id: message.id,
      to: message.to, status: 'failed', reason: code, timestamp: nowIso(),
    }, { queryFn });
    throw new UnrecoverableError(code);
  }

  // First administrative check: a message whose workspace was suspended (or number banned/paused) after it was queued stops here,
  // urgent queue included. The last check is repeated right before the transport call below.
  const early = await checkTransmission(message.deviceKey, queryFn, deps.now?.());
  if (!early.allowed) await applyTransmitBlock(early, job, message, deviceKey, connection, queryFn, log);

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

  const decision = await (deps.canSend ?? canSendMessage)(message.deviceKey, {
    queryFn,
    content: message.content,
    recipient: consentRecipient,
    hasMedia: message.type !== 'text',
    isProactive,
    allowWarmupOverride: message.allowWarmupOverride,
    priority: message.priority,
    ...(deps.now ? { now: deps.now() } : {}),
  });

  if (!decision.allowed) {
    const reasonLabel = decision.reason ?? 'content_rejected';
    antiBanDenialsTotal.inc({ device_key: deviceKey, reason: reasonLabel });

    if (isTransientDenial(decision.reason) && message.priority !== 'urgent') {
      const retryDelay = decision.retryAfterMs ?? RETRY_LATER_DELAY_MS;
      if (retryDelay >= MAX_NORMAL_QUEUE_AGE_MS - queueAgeMs) {
        await expireQueuedMessage(message, deviceKey, queryFn, log, now.getTime());
      }
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
          delay: retryDelay,
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
    if (!message.systemOtp) await dispatchWebhook(
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

  // LAST CHECK before the transport call. Nothing that can take time (pacing delay, typing simulation, presence) sits between this
  // read and sendMessage. Once sendMessage has started it cannot be recalled: a suspension that lands during that call does not undo it.
  const last = await checkTransmission(message.deviceKey, queryFn, deps.now?.());
  if (!last.allowed) await applyTransmitBlock(last, job, message, deviceKey, connection, queryFn, log);

  let sendResult;
  try {
    sendResult = await withRecipientConsentLock(message.tenantId, consentRecipient, async () => {
      return withDeviceSendLock(message.deviceKey, async () => {
      const currentReply = await getReplyContext(message, queryFn, deps.now?.() ?? new Date());
      const sendNow = deps.now?.() ?? new Date();
      if (sendNow.getTime() - message.queueStartedAt.getTime() >= maxQueueAgeMs) {
        await expireQueuedMessage(message, deviceKey, queryFn, log, sendNow.getTime());
      }
      const currentConsent = await getStoredRecipientConsent(queryFn, message.tenantId,
        groupReply ? (currentReply?.fromNumber ?? message.to) : message.to);
      const currentReplyContext = Boolean(currentReply);
      if (!message.quotaExempt && (currentConsent === 'opted_out' || (currentConsent !== 'opted_in' && !currentReplyContext))) {
        throw new RecipientConsentDenied(currentConsent === 'opted_out' ? 'RECIPIENT_OPTED_OUT' : 'RECIPIENT_CONSENT_REQUIRED');
      }
      const last = await checkTransmission(message.deviceKey, queryFn, deps.now?.());
      if (!last.allowed) await applyTransmitBlock(last, job, message, deviceKey, connection, queryFn, log);
      const latestDecision = await (deps.canSend ?? canSendMessage)(message.deviceKey, {
        queryFn,
        content: message.content,
        recipient: consentRecipient,
        hasMedia: message.type !== 'text',
        isProactive: groupReply ? !currentReplyContext : isProactive,
        allowWarmupOverride: message.allowWarmupOverride,
        priority: message.priority,
        ...(deps.now ? { now: deps.now() } : {}),
      });
      if (!latestDecision.allowed) return { denied: true as const, decision: latestDecision };
      const quoted: WAMessage | undefined = groupReply && currentReply?.whatsappMessageId ? {
        key: {
          remoteJid: message.to,
          fromMe: false,
          id: currentReply.whatsappMessageId,
          participant: currentReply.fromNumber ? `${currentReply.fromNumber}@s.whatsapp.net` : undefined,
        },
        message: { conversation: currentReply.content },
      } as WAMessage : undefined;
      // Store the WhatsApp correlation ID before touching the socket. A later
      // SERVER_ACK can then reconcile even if the worker loses its connection.
      const whatsappMessageId = generateMessageIDV2(sock.user?.id);
      const claim = await queryFn(
        `UPDATE messages SET status = 'sending', send_started_at = now(), error_message = NULL,
             whatsapp_message_id = $2
         WHERE id = $1 AND status = 'queued' RETURNING id`,
        [message.id, whatsappMessageId],
      );
      if (claim.rows.length === 0) return { skipped: true as const };
      const result = await withSpan(
        'message.send',
        { device_key: deviceKey, message_id: message.id, 'message.type': message.type },
        () => sock.sendMessage(jid, toMessageContent(message), { messageId: whatsappMessageId, ...(quoted ? { quoted } : {}) }),
      );
      // sendMessage only confirms that the stanza was written to the socket;
      // mark it sent only after WhatsApp's SERVER_ACK event arrives.
      if (result?.key.id && result.key.id !== whatsappMessageId) {
        log.error('WhatsApp returned an unexpected message ID; leaving send status pending', {
          messageId: message.id,
          expectedMessageId: whatsappMessageId,
          returnedMessageId: result.key.id,
        });
      }
      return { skipped: false as const, whatsappMessageId };
      });
    });
  } catch (err) {
    if (err instanceof RecipientConsentDenied) {
      await updateMessageStatus(message.id, { status: 'blocked', errorMessage: err.code.toLocaleLowerCase() }, queryFn);
      log.warn('Message stopped before transport by recipient consent', {
        tenantId: message.tenantId, recipientLast4: message.to.replace(/\D/g, '').slice(-4),
        messageId: message.id, errorCode: err.code,
      });
      if (!message.systemOtp) await dispatchWebhook(message.tenantId, {
        event: 'message.failed', device_key: message.deviceKey, message_id: message.id,
        to: message.to, status: 'failed', reason: err.code, timestamp: nowIso(),
      }, { queryFn });
      throw new UnrecoverableError(err.code);
    }
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (isDefinitelyNotSent(err)) {
      // Nothing left the socket: a retry cannot duplicate the message.
      await failAttempt(job, message, deviceKey, connection, queryFn, log, errorMessage, 'send_error');
      return;
    }
    // The outcome is UNCERTAIN (a timeout may follow a message WhatsApp already accepted). Never retry automatically:
    // mark it, tell the tenant, and keep the job in the dead-letter queue for inspection. A person may retry it by hand.
    log.error('Send outcome uncertain; not retrying automatically', { messageId: message.id, error: errorMessage });
    const uncertain = await queryFn(
      `UPDATE messages SET status = 'failed', error_message = 'delivery_uncertain',
         content = CASE WHEN system_otp OR system_notification THEN '[redacted]' ELSE content END,
         to_number = CASE WHEN system_otp OR system_notification THEN '[redacted]' ELSE to_number END
       WHERE id = $1 AND status = 'sending' RETURNING id`,
      [message.id],
    );
    if (uncertain.rows.length === 0) {
      log.info('Late WhatsApp confirmation arrived before uncertain status was recorded', { messageId: message.id });
      return;
    }
    await moveToDeadLetter(deviceKey, job.data, connection, log);
    messagesFailedTotal.inc({ device_key: deviceKey, reason: 'delivery_uncertain' });
    if (!message.systemOtp) await dispatchWebhook(message.tenantId, {
      event: 'message.failed', device_key: message.deviceKey, message_id: message.id, to: message.to,
      status: 'failed', reason: 'delivery_uncertain', timestamp: nowIso(),
    }, { queryFn });
    throw new UnrecoverableError('delivery_uncertain');
  }

  // Another delivery attempt already owns the send claim, or the status was
  // changed while this job waited. In either case the transport must not run.
  if (sendResult.skipped) {
    log.info('Message send claim already taken; skipping duplicate job', { messageId: message.id });
    return;
  }

  if ('denied' in sendResult && sendResult.denied) {
    const reason = sendResult.decision.reason ?? 'content_rejected';
    antiBanDenialsTotal.inc({ device_key: deviceKey, reason });
    if (isTransientDenial(sendResult.decision.reason) && message.priority !== 'urgent') {
      const retryDelay = sendResult.decision.retryAfterMs ?? RETRY_LATER_DELAY_MS;
      const deniedAt = deps.now?.() ?? new Date();
      if (retryDelay >= MAX_NORMAL_QUEUE_AGE_MS - (deniedAt.getTime() - message.queueStartedAt.getTime())) {
        await expireQueuedMessage(message, deviceKey, queryFn, log, deniedAt.getTime());
      }
      await updateMessageStatus(message.id, { status: 'queued', errorMessage: reason }, queryFn);
      await getQueueByName(queueName(deviceKey), connection).add(JOB_NAME, { messageId: message.id }, {
        delay: retryDelay, attempts: MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: BACKOFF_BASE_MS },
        removeOnComplete: { age: 24 * 3_600, count: 1_000 }, removeOnFail: false,
      });
      return;
    }
    await updateMessageStatus(message.id, { status: 'failed', errorMessage: reason }, queryFn);
    messagesFailedTotal.inc({ device_key: deviceKey, reason });
    if (!message.systemOtp) await dispatchWebhook(message.tenantId, {
      event: 'message.failed', device_key: message.deviceKey, message_id: message.id,
      to: message.to, status: 'failed', reason, timestamp: nowIso(),
    }, { queryFn });
    throw new UnrecoverableError(`Anti-ban rejected message at dispatch: ${reason}`);
  }

  void deps.presence?.afterSend();
  log.info('Message stanza handed to WhatsApp socket; awaiting server confirmation', {
    messageId: message.id,
    whatsappMessageId: sendResult.whatsappMessageId,
  });
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
    `SELECT id, tenant_id, device_key, to_number, COALESCE(system_otp, false) AS system_otp,
       COALESCE(system_notification, false) AS system_notification FROM messages
     WHERE device_key = $1 AND direction = 'outbound' AND status = 'queued'
       AND queue_started_at < now() - CASE WHEN priority = 'urgent' THEN interval '2 minutes' ELSE interval '15 minutes' END`,
    [deviceKey],
  );
  let failed = 0;
  for (const row of rows as { id: string; tenant_id: string; device_key: string; to_number: string; system_otp: boolean; system_notification: boolean }[]) {
    if (liveMessageIds.has(row.id)) continue;
    const updated = await queryFn(
      `UPDATE messages SET status = 'failed', error_message = 'lost_in_queue',
         content = CASE WHEN system_otp OR system_notification THEN '[redacted]' ELSE content END,
         to_number = CASE WHEN system_otp OR system_notification THEN '[redacted]' ELSE to_number END
       WHERE id = $1 AND status = 'queued' RETURNING id`,
      [row.id],
    );
    if (updated.rows.length === 0) continue;
    failed += 1;
    log.error('Queued message had no live job; marked failed', { messageId: row.id, deviceKey });
    if (!row.system_otp && !row.system_notification) {
      await dispatch(row.tenant_id, {
        event: 'message.failed', device_key: row.device_key, message_id: row.id,
        to: row.to_number, status: 'failed', reason: 'lost_in_queue', timestamp: nowIso(),
      }, { queryFn }).catch((error: unknown) => {
        log.error('Failed to dispatch lost-message webhook', { error: error instanceof Error ? error.message : String(error) });
      });
    }
  }
  return failed;
}

/**
 * A process can die after claiming a send and before saving the WhatsApp result.
 * Such outcomes are unknowable, so close them as uncertain and never enqueue a retry.
 */
export async function failStuckSendingMessages(
  deviceKey: string,
  queryFn: QueryFn,
  log: Logger,
  dispatch: typeof dispatchWebhook = dispatchWebhook,
): Promise<number> {
  const { rows } = await queryFn(
    `SELECT id, tenant_id, device_key, to_number, COALESCE(system_otp, false) AS system_otp,
       COALESCE(system_notification, false) AS system_notification FROM messages
     WHERE device_key = $1 AND direction = 'outbound' AND status = 'sending'
       AND send_started_at < now() - interval '2 minutes'`,
    [deviceKey],
  );
  let failed = 0;
  for (const row of rows as { id: string; tenant_id: string; device_key: string; to_number: string; system_otp: boolean; system_notification: boolean }[]) {
    const updated = await queryFn(
      `UPDATE messages SET status = 'failed', error_message = 'delivery_uncertain',
         content = CASE WHEN system_otp OR system_notification THEN '[redacted]' ELSE content END,
         to_number = CASE WHEN system_otp OR system_notification THEN '[redacted]' ELSE to_number END
       WHERE id = $1 AND status = 'sending' RETURNING id`,
      [row.id],
    );
    if (!updated.rows.length) continue;
    failed += 1;
    log.error('Stuck send claim marked delivery uncertain; automatic retry prohibited', { messageId: row.id, deviceKey });
    if (!row.system_otp && !row.system_notification) {
      await dispatch(row.tenant_id, {
        event: 'message.failed', device_key: row.device_key, message_id: row.id,
        to: row.to_number, status: 'failed', reason: 'delivery_uncertain', timestamp: nowIso(),
      }, { queryFn }).catch((error: unknown) => {
        log.error('Failed to dispatch uncertain-delivery webhook', { error: error instanceof Error ? error.message : String(error) });
      });
    }
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
      await failStuckSendingMessages(deviceKey, queryFn, log);
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

  let newStatus: 'sent' | 'delivered' | 'read' | undefined;
  let event: WebhookEventType | undefined;

  if (update.status === WAMessageStatus.SERVER_ACK) {
    newStatus = 'sent';
    event = 'message.sent';
  } else if (update.status === WAMessageStatus.DELIVERY_ACK) {
    newStatus = 'delivered';
    event = 'message.delivered';
  } else if (update.status === WAMessageStatus.READ || update.status === WAMessageStatus.PLAYED) {
    newStatus = 'read';
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
    recipientLast4: key.remoteJid?.replace(/\D/g, '').slice(-4) ?? '',
    fromMe: key.fromMe,
  });

  const allowedStatuses = newStatus === 'read'
    ? ['queued', 'sending', 'sent', 'delivered']
    : newStatus === 'delivered'
      ? ['queued', 'sending', 'sent']
      : ['sending'];
  const uncertainStatusClause = newStatus === 'sent'
    ? " OR (status = 'failed' AND error_message = 'delivery_uncertain')"
    : newStatus === 'delivered' || newStatus === 'read'
      ? " OR (status = 'failed' AND error_message = 'delivery_uncertain')"
      : '';
  const timestampSets = newStatus === 'read'
    ? "sent_at = COALESCE(sent_at, now()), delivered_at = COALESCE(delivered_at, now()), read_at = COALESCE(read_at, now())"
    : newStatus === 'delivered'
      ? "sent_at = COALESCE(sent_at, now()), delivered_at = COALESCE(delivered_at, now())"
      : "sent_at = COALESCE(sent_at, now())";
  const { rows } = await queryFn(
    `UPDATE messages
     SET status = $1, ${timestampSets}, error_message = NULL, send_started_at = NULL
     WHERE whatsapp_message_id = $2
       AND (status = ANY($3::varchar[])${uncertainStatusClause})
     RETURNING id, tenant_id, device_key, to_number, COALESCE(system_otp, false) AS system_otp,
       COALESCE(system_notification, false) AS system_notification, type`,
    [newStatus, key.id, allowedStatuses],
  );
  const row = rows[0] as
    | { id: string; tenant_id: string; device_key: string; to_number: string; system_otp: boolean; system_notification: boolean }
    | undefined;
  if (!row) {
    log.warn('WhatsApp receipt did not match an updatable message', {
      whatsappMessageId: key.id,
      mappedStatus: newStatus,
    });
    return;
  }

  if (!row.system_otp && !row.system_notification) {
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
  }

  if (newStatus === 'sent') {
    const messageType = (row as typeof row & { type?: string }).type ?? 'text';
    messagesSentTotal.inc({ device_key: row.device_key, type: messageType });
  }

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

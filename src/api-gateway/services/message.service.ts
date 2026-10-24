import { Queue } from 'bullmq';
import { randomInt } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import config from '../../shared/config';
import pool, { transaction } from '../../shared/database/connection';
import { getRedisClient } from '../../shared/redis';
import type { PaginatedResponse, SendMessageRequest } from '../../shared/types/api';
import { ServiceError } from './service-error';
import { assertSubscriptionActive, currentUsage } from './billing.service';
import { assertRecipientConsent, assertReplyRecipientAllowed } from './recipient-consent.service';
import logger from '../../shared/utils/logger';
import { withRecipientConsentLock } from '../../shared/recipient-consent';
import { currentPaygSettings, reserveMessageCharge } from './wallet.service';

const messageQueues = new Map<string, Queue>();

function getMessageQueue(deviceKey: string, priority: 'normal' | 'urgent' = 'normal'): Queue {
  // Must match queueName()/urgentQueueName() in bot-container/queue.ts.
  const name = priority === 'urgent' ? `${deviceKey}-urgent` : deviceKey;
  let queue = messageQueues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: getRedisClient(config.redis.url),
      prefix: 'queue:messages',
    });
    messageQueues.set(name, queue);
  }
  return queue;
}

async function enqueueStoredMessage(
  deviceKey: string,
  messageId: string,
  jobId = messageId,
  priority: 'normal' | 'urgent' = 'normal',
  delayMs = 0,
): Promise<void> {
  const urgent = priority === 'urgent';
  await getMessageQueue(deviceKey, priority).add('send', { messageId }, {
    jobId,
    // A failed WhatsApp request is never replayed automatically. The owner can
    // explicitly choose one retry after reviewing a definite failure.
    attempts: 1,
    ...(delayMs > 0 ? { delay: delayMs } : {}),
    removeOnComplete: { age: 86_400, count: 1000 },
  });
}

interface MessageRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  device_id: string;
  device_key: string;
  to_number: string;
  content: string;
  status: string;
  external_id: string | null;
  priority?: string;
  quota_exempt?: boolean;
  system_otp?: boolean;
  system_notification?: boolean;
  reply_to_message_id?: string | null;
  error_message?: string | null;
  created_at: Date;
  retry_count?: number;
}

export async function queueMessage(
  tenantId: string,
  input: SendMessageRequest,
  sendContext: 'api' | 'broadcast' = 'api',
): Promise<MessageRow> {
  return queueMessageInternal(tenantId, input, null, 0, sendContext);
}

/** Platform-only OTP path. Its marker is set in SQL, never accepted from an API request. */
export async function queueSystemOtp(tenantId: string, input: SendMessageRequest): Promise<MessageRow> {
  return queueMessageInternal(tenantId, input, 'otp');
}

/** Platform notifications use the same sender at normal priority and are delayed 5–30 seconds. */
export async function queueSystemNotification(tenantId: string, eventId: string, input: SendMessageRequest, delayMs = randomInt(5_000, 30_001)): Promise<MessageRow> {
  return queueMessageInternal(tenantId, { ...input, external_id: `snotif_${eventId}` }, 'notification', delayMs);
}

async function queueMessageInternal(tenantId: string, input: SendMessageRequest, systemKind: 'otp' | 'notification' | null, notificationDelayMs = 0, sendContext: 'api' | 'broadcast' = 'api'): Promise<MessageRow> {
  const groupLockRecipient = input.to.endsWith('@g.us') && input.reply_to_message_id
    ? ((await pool.query<{ from_number: string | null }>(
      `SELECT m.from_number FROM messages m JOIN devices d ON d.id=m.device_id
       WHERE m.id=$1 AND m.tenant_id=$2 AND d.device_key=$3 AND m.direction='inbound' AND m.chat_jid=$4
         AND m.created_at >= now() - interval '24 hours'`,
      [input.reply_to_message_id, tenantId, input.device_key, input.to],
    )).rows[0]?.from_number ?? input.to)
    : input.to;
  const systemOtp = systemKind === 'otp';
  const systemNotification = systemKind === 'notification';
  const systemManaged = systemOtp || systemNotification;
  // Scheduled campaigns can resume after an API restart. Their deterministic external IDs make the
  // database insert and BullMQ enqueue safely repeatable across the scheduler's claim lease.
  if (input.external_id?.startsWith('cmp_')) {
    const existing = await pool.query<MessageRow>(
      `SELECT id, tenant_id, device_id, device_key, to_number, content, status, external_id, priority, quota_exempt, created_at, type, media_url
       FROM messages WHERE tenant_id = $1 AND external_id = $2`, [tenantId, input.external_id],
    );
    const prior = existing.rows[0];
    if (prior) {
      const expectedType = input.media_url ? (input.media_type ?? 'image') : 'text';
      if (prior.device_key !== input.device_key || prior.to_number !== input.to || prior.content !== input.message
        || prior.type !== expectedType || (prior as MessageRow & { media_url?: string | null }).media_url !== (input.media_url ?? null)) {
        throw new ServiceError(409, 'CAMPAIGN_MESSAGE_ID_CONFLICT', 'Campaign message id was already used for different content');
      }
      if (prior.status === 'queued') {
        await enqueueStoredMessage(prior.device_key, prior.id, prior.id, (prior.priority as 'normal' | 'urgent' | undefined) ?? 'normal');
      }
      return prior;
    }
  }
  if (systemNotification && input.external_id) {
    const prior = (await pool.query<MessageRow>(
      `SELECT id, tenant_id, device_id, device_key, to_number, content, status, external_id, priority, quota_exempt, error_message, created_at
       FROM messages WHERE system_notification=true AND external_id=$1`, [input.external_id],
    )).rows[0];
    if (prior) {
      if (prior.status === 'queued') {
        await enqueueStoredMessage(prior.device_key, prior.id, prior.id, 'normal', notificationDelayMs);
      } else if (prior.status === 'failed' && prior.error_message === 'QUEUE_UNAVAILABLE') {
        const restored = await pool.query<MessageRow>(
          `UPDATE messages SET status='queued', queue_started_at=now(), error_message=NULL, content=$2, to_number=$3
           WHERE id=$1 AND status='failed' AND error_message='QUEUE_UNAVAILABLE' RETURNING *`,
          [prior.id, input.message, input.to],
        );
        if (restored.rows[0]) {
          try {
            await enqueueStoredMessage(prior.device_key, prior.id, prior.id, 'normal', notificationDelayMs);
          } catch (error) {
            await pool.query(`UPDATE messages SET status='failed',error_message='QUEUE_UNAVAILABLE',content='[redacted]',to_number='[redacted]' WHERE id=$1`, [prior.id]);
            throw new ServiceError(503, 'QUEUE_UNAVAILABLE', 'Unable to enqueue message');
          }
          return restored.rows[0];
        }
      }
      return prior;
    }
  }
  // Only internal platform flows can classify messages as transactional. A tenant
  // cannot self-declare an OTP based on text they supplied, or gain an exemption.
  const exempt = systemManaged;

  const transactionResult = await transaction(async (client: PoolClient) => {
    // Use the same tenant/recipient lock key as STOP/START handling, but keep
    // it transaction-scoped so a burst of sends does not pin one pool client
    // for the lock and a second client for the insert transaction.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `${tenantId}:${groupLockRecipient.replace(/\D/g, '')}`,
    ]);
    // Serialize retries carrying the same tenant-scoped external_id. The lock
    // and recheck happen inside the insertion transaction, so simultaneous API
    // retries cannot both create a row.
    if (input.external_id && !input.external_id.startsWith('cmp_') && !systemNotification) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [tenantId, input.external_id]);
      const prior = (await client.query<MessageRow & { media_url?: string | null; reply_to_message_id?: string | null }>(
        `SELECT id, tenant_id, device_id, device_key, to_number, content, status, external_id,
                priority, quota_exempt, created_at, type, media_url, reply_to_message_id
         FROM messages WHERE tenant_id=$1 AND external_id=$2 LIMIT 1`,
        [tenantId, input.external_id],
      )).rows[0];
      if (prior) {
        const expectedType = input.media_url ? (input.media_type ?? 'image') : 'text';
        if (prior.device_key !== input.device_key || prior.to_number !== input.to || prior.content !== input.message
          || prior.type !== expectedType || (prior.media_url ?? null) !== (input.media_url ?? null)
          || (prior.reply_to_message_id ?? null) !== (input.reply_to_message_id ?? null)) {
          throw new ServiceError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'external_id sudah digunakan untuk isi pesan yang berbeda');
        }
        return { message: prior, reused: true };
      }
    }
    if (systemManaged) {
      const platformTenant = (await client.query<{ is_system: boolean }>(
        'SELECT is_system FROM tenants WHERE id=$1 FOR SHARE', [tenantId],
      )).rows[0];
      if (!platformTenant?.is_system) throw new ServiceError(403, 'SYSTEM_MESSAGE_FORBIDDEN', 'Pesan sistem hanya boleh dikirim dari workspace sistem.');
    } else {
      await assertSubscriptionActive(client, tenantId);
    }
    const deviceResult = await client.query<{ id: string; status: string }>(
      'SELECT id, status FROM devices WHERE tenant_id = $1 AND device_key = $2',
      [tenantId, input.device_key],
    );
    const device = deviceResult.rows[0];
    if (!device) throw new ServiceError(404, 'DEVICE_NOT_FOUND', 'Device not found');
    if (device.status !== 'online') {
      throw new ServiceError(503, 'DEVICE_OFFLINE', 'Device is not online');
    }

    let replyContext = false;
    let replyRecipient = input.to;
    if (input.reply_to_message_id) {
      const groupReply = input.to.endsWith('@g.us');
      const inbound = await client.query<{ from_number: string | null }>(
        groupReply
          ? `SELECT from_number FROM messages
             WHERE id = $1 AND tenant_id = $2 AND device_id = $3 AND direction = 'inbound'
               AND chat_jid = $4 AND created_at >= now() - interval '24 hours'`
          : `SELECT from_number FROM messages
             WHERE id = $1 AND tenant_id = $2 AND device_id = $3 AND direction = 'inbound'
               AND regexp_replace(COALESCE(from_number, ''), '[^0-9]', '', 'g') = $4
               AND created_at >= now() - interval '24 hours'`,
        [input.reply_to_message_id, tenantId, device.id, groupReply ? input.to : input.to.replace(/\D/g, '')],
      );
      if (!inbound.rows[0]) {
        throw new ServiceError(409, 'REPLY_CONTEXT_INVALID', 'A reply must reference a customer message from this number within the last 24 hours');
      }
      if (groupReply && inbound.rows[0]?.from_number) replyRecipient = inbound.rows[0].from_number;
      replyContext = true;
    }
    if (replyContext) await assertReplyRecipientAllowed(client, tenantId, replyRecipient);
    else await assertRecipientConsent(client, tenantId, input.to, exempt);

    // Exempt sends skip the quota check entirely and never count toward used_messages. Everything else is held,
    // not dropped or rejected, once the regular quota is spent -- a periodic sweep (see sweepQuotaHolds) and every
    // fresh billing window release held messages in order once headroom exists (see releaseHeldMessages).
    const payg = await currentPaygSettings(client);
    const overQuota = !payg.enabled && !exempt && await (async () => {
      const usage = await currentUsage(client, tenantId);
      return usage.used >= usage.quota;
    })();
    const status = overQuota ? 'quota_hold' : 'queued';
    // `priority` from a caller is never proof that a send is transactional or urgent.
    const priority = systemOtp || (!systemNotification && exempt) ? 'urgent' : 'normal';

    const result = await client.query<MessageRow>(
      `INSERT INTO messages
         (tenant_id, device_id, device_key, to_number, chat_jid, content, external_id, status, priority, type, media_url, quota_exempt, system_otp, system_notification, reply_to_message_id, send_context)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
      [tenantId, device.id, input.device_key, input.to,
        input.to.endsWith('@g.us') ? input.to : `${input.to.replace(/\D/g, '')}@s.whatsapp.net`,
        input.message, input.external_id ?? null, status, priority,
        input.media_url ? (input.media_type ?? 'image') : 'text', input.media_url ?? null, exempt, systemOtp, systemNotification, input.reply_to_message_id ?? null, systemManaged ? 'api' : sendContext],
    );
    if (status === 'queued' && !exempt && payg.enabled) {
      await reserveMessageCharge(client, tenantId, result.rows[0]!.id, 0);
    }
    if (status === 'queued' && !exempt) await client.query('UPDATE tenants SET used_messages = used_messages + 1 WHERE id = $1', [tenantId]);
    return { message: result.rows[0]!, reused: false };
  });
  const { message, reused } = transactionResult;

  if (reused) {
    if (message.status === 'queued') {
      await enqueueStoredMessage(message.device_key, message.id, message.id, (message.priority as 'normal' | 'urgent' | undefined) ?? 'normal');
    }
    return message;
  }

  if (message.status === 'quota_hold') return message; // held, not enqueued; released later without ever being dropped

  try {
    const delayMs = systemNotification ? notificationDelayMs : 0;
    await enqueueStoredMessage(input.device_key, message.id, message.id, (message.priority as 'normal' | 'urgent' | undefined) ?? 'normal', delayMs);
  } catch (error) {
    await pool.query(
      `UPDATE messages SET status = 'failed', error_message = $2,
         content = CASE WHEN system_otp OR system_notification THEN '[redacted]' ELSE content END,
         to_number = CASE WHEN system_otp OR system_notification THEN '[redacted]' ELSE to_number END WHERE id = $1`,
      [message.id, systemManaged ? 'QUEUE_UNAVAILABLE' : error instanceof Error ? error.message : 'Queue unavailable'],
    );
    throw new ServiceError(503, 'QUEUE_UNAVAILABLE', 'Unable to enqueue message');
  }

  return message;
}

/**
 * Releases messages held by quota_hold, oldest first, up to however much headroom the tenant now has -- called
 * periodically (sweepQuotaHolds) and right after a plan change/renewal, so a hold never outlives the quota that
 * caused it by more than one sweep interval. Exempt messages are never held in the first place, so nothing here
 * revisits exemption.
 */
export async function releaseHeldMessages(tenantId: string, now: Date = new Date()): Promise<{ released: number }> {
  if ((await currentPaygSettings(pool)).enabled) return { released: 0 };
  const toRelease = await transaction(async (client) => {
    const usage = await currentUsage(client, tenantId, now);
    const remaining = Math.max(0, usage.quota - usage.used);
    if (remaining <= 0) return [];
    const held = (await client.query<{ id: string; device_key: string; priority: string | null }>(
      `SELECT id, device_key, priority FROM messages WHERE tenant_id = $1 AND status = 'quota_hold' ORDER BY created_at ASC LIMIT $2 FOR UPDATE`,
      [tenantId, remaining],
    )).rows;
    if (held.length === 0) return [];
    await client.query(`UPDATE messages SET status = 'queued', queue_started_at = now() WHERE id = ANY($1::uuid[])`, [held.map((h) => h.id)]);
    await client.query('UPDATE tenants SET used_messages = used_messages + $2 WHERE id = $1', [tenantId, held.length]);
    return held;
  });
  for (const row of toRelease) {
    try {
      await enqueueStoredMessage(row.device_key, row.id, row.id, row.priority === 'urgent' ? 'urgent' : 'normal');
    } catch (error) {
      // Left as 'queued' in the DB even though enqueueing failed here: the existing stuck-message sweep in the
      // bot container (queue.ts) already re-queues rows whose status says queued but have no matching job, exactly
      // like any other lost enqueue (see docs/HANDOFF.md "Antrean andal"). Not re-marked quota_hold: it already
      // has its quota slot counted, and holding it again would double-count on the next release.
      logger.error('releaseHeldMessages: enqueue failed after release', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { released: toRelease.length };
}

/** Every tenant with at least one held message, oldest hold first, so no one tenant's backlog starves another. */
export async function sweepQuotaHolds(): Promise<{ tenants: number; released: number }> {
  const tenants = (await pool.query<{ tenant_id: string }>(
    `SELECT DISTINCT tenant_id FROM messages WHERE status = 'quota_hold'`,
  )).rows;
  let released = 0;
  for (const { tenant_id } of tenants) released += (await releaseHeldMessages(tenant_id)).released;
  return { tenants: tenants.length, released };
}

export async function getMessageStatus(tenantId: string, messageId: string) {
  const result = await pool.query(
    `SELECT m.*,
       COALESCE(json_agg(json_build_object('status', h.status, 'created_at', h.created_at)
         ORDER BY h.created_at) FILTER (WHERE h.id IS NOT NULL), '[]') AS status_history
     FROM messages m
     LEFT JOIN message_status_history h ON h.message_id = m.id
     WHERE m.tenant_id = $1 AND m.id = $2 AND m.system_otp = false AND system_notification = false
     GROUP BY m.id`,
    [tenantId, messageId],
  );
  if (!result.rows[0]) throw new ServiceError(404, 'MESSAGE_NOT_FOUND', 'Message not found');
  return result.rows[0];
}

export async function listMessages(
  tenantId: string,
  filter: {
    device_key?: string | undefined;
    status?: string | undefined;
    direction?: 'inbound' | 'outbound' | undefined;
    created_today?: boolean | undefined;
    search?: string | undefined;
    chat_jid?: string | undefined;
    limit: number;
    offset: number;
  },
): Promise<PaginatedResponse<QueryResultRow>> {
  const values: unknown[] = [tenantId];
  const conditions = ['tenant_id = $1', 'system_otp = false AND system_notification = false'];
  if (filter.device_key) {
    values.push(filter.device_key);
    conditions.push(`device_key = $${values.length}`);
  }
  if (filter.status) {
    values.push(filter.status);
    conditions.push(`status = $${values.length}`);
  }
  if (filter.direction) {
    values.push(filter.direction);
    conditions.push(`direction = $${values.length}`);
  }
  if (filter.created_today) {
    conditions.push(`created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta')
      AND created_at < ((date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') + interval '1 day') AT TIME ZONE 'Asia/Jakarta')`);
  }
  if (filter.search) {
    values.push(`%${filter.search}%`);
    conditions.push(`(content ILIKE $${values.length} OR from_number ILIKE $${values.length}
      OR to_number ILIKE $${values.length} OR external_id ILIKE $${values.length})`);
  }
  if (filter.chat_jid) {
    values.push(filter.chat_jid);
    conditions.push(`chat_jid = $${values.length}`);
  }
  const where = conditions.join(' AND ');
  const count = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM messages WHERE ${where}`,
    values,
  );
  values.push(filter.limit, filter.offset);
  const rows = await pool.query(
    `SELECT * FROM messages WHERE ${where} ORDER BY created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return {
    success: true,
    data: rows.rows,
    pagination: {
      limit: filter.limit, offset: filter.offset, total: count.rows[0]?.total ?? 0,
      has_more: filter.offset + rows.rows.length < (count.rows[0]?.total ?? 0),
    },
  };
}

export async function listInboxDevices(tenantId: string) {
  const result = await pool.query(
    `SELECT device_key, label, phone_number, status FROM devices
     WHERE tenant_id = $1 AND status <> 'deleted' ORDER BY label NULLS LAST, device_key`,
    [tenantId],
  );
  return { success: true, data: result.rows };
}

const inboxChatKey = (alias: string) => `COALESCE(NULLIF(${alias}chat_jid, ''),
  CASE WHEN ${alias}direction = 'inbound'
    THEN regexp_replace(COALESCE(${alias}from_number, ''), '[^0-9]', '', 'g') || '@s.whatsapp.net'
    ELSE regexp_replace(COALESCE(${alias}to_number, ''), '[^0-9]', '', 'g') || '@s.whatsapp.net'
  END)`;

export async function listInboxConversations(
  tenantId: string,
  filter: { device_key?: string; search?: string; limit: number; offset: number },
) {
  const values: unknown[] = [tenantId];
  const conditions = ["m.tenant_id = $1", "m.system_otp = false AND m.system_notification = false"];
  if (filter.device_key) {
    values.push(filter.device_key);
    conditions.push(`m.device_key = $${values.length}`);
  }
  if (filter.search) {
    values.push(`%${filter.search}%`);
    conditions.push(`(m.content ILIKE $${values.length} OR m.from_number ILIKE $${values.length} OR m.to_number ILIKE $${values.length} OR d.label ILIKE $${values.length})`);
  }
  const where = conditions.join(' AND ');
  const count = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM (
       SELECT m.device_key, ${inboxChatKey('m.')} AS chat_key
       FROM messages m JOIN devices d ON d.id = m.device_id
       WHERE ${where}
       GROUP BY m.device_key, ${inboxChatKey('m.')}
     ) conversations`, values,
  );
  values.push(filter.limit, filter.offset);
  const rows = await pool.query(
    `WITH grouped AS (
       SELECT m.id, m.device_key, d.label AS device_label,
              ${inboxChatKey('m.')} AS chat_key, m.chat_jid,
              CASE WHEN m.direction = 'inbound' THEN m.from_number ELSE m.to_number END AS peer_number,
              m.direction, m.content, m.type, m.status, m.created_at,
              COUNT(*) OVER (PARTITION BY m.device_key, ${inboxChatKey('m.')})::int AS message_count,
              ROW_NUMBER() OVER (PARTITION BY m.device_key, ${inboxChatKey('m.')} ORDER BY m.created_at DESC, m.id DESC) AS position
       FROM messages m JOIN devices d ON d.id = m.device_id
       WHERE ${where}
     )
     SELECT id AS latest_message_id, device_key, device_label, chat_key, chat_jid,
            peer_number, direction, content, type, status, created_at, message_count
     FROM grouped WHERE position = 1 ORDER BY created_at DESC, latest_message_id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return {
    success: true,
    data: rows.rows,
    pagination: { limit: filter.limit, offset: filter.offset, total: count.rows[0]?.total ?? 0 },
  };
}

export async function listInboxMessages(
  tenantId: string,
  filter: { device_key: string; chat_key: string; limit: number; offset: number },
): Promise<PaginatedResponse<QueryResultRow>> {
  const where = `tenant_id = $1 AND device_key = $2 AND ${inboxChatKey('')} = $3
    AND system_otp = false AND system_notification = false`;
  const args = [tenantId, filter.device_key, filter.chat_key];
  const count = await pool.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM messages WHERE ${where}`, args);
  const rows = await pool.query(
    `SELECT * FROM messages WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $4 OFFSET $5`,
    [...args, filter.limit, filter.offset],
  );
  const total = count.rows[0]?.total ?? 0;
  return { success: true, data: rows.rows, pagination: { limit: filter.limit, offset: filter.offset, total, has_more: filter.offset + rows.rows.length < total } };
}

export async function queueInboxReply(tenantId: string, messageId: string, content: string): Promise<MessageRow> {
  const original = (await pool.query<{ device_key: string; from_number: string | null; chat_jid: string | null }>(
    `SELECT device_key, from_number, chat_jid FROM messages
     WHERE tenant_id = $1 AND id = $2 AND direction = 'inbound'
       AND system_otp = false AND system_notification = false`, [tenantId, messageId],
  )).rows[0];
  if (!original) throw new ServiceError(404, 'INBOX_MESSAGE_NOT_FOUND', 'Pesan masuk tidak ditemukan.');
  const isGroup = original.chat_jid?.endsWith('@g.us') ?? false;
  const recipient = isGroup ? original.chat_jid! : original.from_number;
  if (!recipient) throw new ServiceError(409, 'INBOX_REPLY_UNAVAILABLE', 'Nomor pengirim tidak tersedia untuk dibalas.');
  if (isGroup ? !/^(?:\d{5,32}-\d{5,32}|\d{5,32})@g\.us$/.test(recipient) : !/^\+?[1-9]\d{6,19}$/.test(recipient)) {
    throw new ServiceError(409, 'INBOX_REPLY_UNAVAILABLE', 'Alamat WhatsApp pengirim tidak didukung untuk balasan.');
  }
  return queueMessage(tenantId, {
    device_key: original.device_key,
    to: recipient,
    message: content,
    reply_to_message_id: messageId,
  });
}

export async function retryMessage(tenantId: string, messageId: string): Promise<MessageRow> {
  // A manual retry is a new send attempt. PAYG reserves a fresh charge for it;
  // legacy subscriptions retain their existing quota rules.
  await assertSubscriptionActive(pool, tenantId);
  const target = (await pool.query<{ device_status: string | null; device_id: string | null; to_number: string; quota_exempt: boolean; error_message: string | null; reply_to_message_id: string | null }>(
    `SELECT d.status AS device_status, m.device_id, m.to_number, COALESCE(m.quota_exempt, false) AS quota_exempt,
            m.error_message, m.reply_to_message_id
     FROM messages m LEFT JOIN devices d ON d.id = m.device_id WHERE m.id = $1 AND m.tenant_id = $2 AND m.system_otp = false AND system_notification = false`, [messageId, tenantId])).rows[0];
  const retry = async (): Promise<MessageRow> => {
  if (target?.error_message === 'delivery_uncertain') {
    throw new ServiceError(409, 'DELIVERY_UNCERTAIN_MANUAL_REVIEW_REQUIRED', 'WhatsApp may already have accepted this message. Check the chat before composing a new message; this message cannot be retried.');
  }
  if (target?.error_message === 'recipient_opted_out' || target?.error_message === 'recipient_consent_required') {
    logger.warn('Consent-suppressed message retry refused', {
      tenant_id: tenantId, message_id: messageId,
      error_code: 'RECIPIENT_CONSENT_SUPPRESSED',
    });
    throw new ServiceError(409, 'RECIPIENT_CONSENT_SUPPRESSED', 'This message was suppressed by recipient consent; create a new message after re-opt-in');
  }
  if (target?.reply_to_message_id && target.device_id) {
    const groupReply = target.to_number.endsWith('@g.us');
    const inbound = await pool.query<{ from_number: string | null }>(
      groupReply
        ? `SELECT from_number FROM messages WHERE id=$1 AND tenant_id=$2 AND device_id=$3 AND direction='inbound'
             AND chat_jid=$4 AND created_at >= now() - interval '24 hours'`
        : `SELECT from_number FROM messages WHERE id=$1 AND tenant_id=$2 AND device_id=$3 AND direction='inbound'
             AND regexp_replace(COALESCE(from_number, ''), '[^0-9]', '', 'g')=$4
             AND created_at >= now() - interval '24 hours'`,
      [target.reply_to_message_id, tenantId, target.device_id, groupReply ? target.to_number : target.to_number.replace(/\D/g, '')],
    );
    if (!inbound.rows[0]) throw new ServiceError(409, 'REPLY_CONTEXT_EXPIRED', 'This reply can no longer be retried because its customer-chat window expired');
    await assertReplyRecipientAllowed(pool, tenantId, groupReply ? (inbound.rows[0].from_number ?? '') : target.to_number);
  } else if (target) {
    await assertRecipientConsent(pool, tenantId, target.to_number, target.quota_exempt);
  }
  if (target && target.device_status !== 'online') throw new ServiceError(503, 'DEVICE_OFFLINE', 'Device is not online');
  const message = await transaction(async (client) => {
    const current = (await client.query<MessageRow & { retry_count: number }>(
      `SELECT * FROM messages WHERE id=$1 AND tenant_id=$2 AND system_otp=false AND system_notification=false FOR UPDATE`,
      [messageId, tenantId],
    )).rows[0];
    if (!current) return null;
    if (!['failed', 'blocked'].includes(current.status) || current.error_message === 'delivery_uncertain') return null;
    const attemptNo = (current.retry_count ?? 0) + 1;
    const updated = (await client.query<MessageRow>(
      `UPDATE messages SET status='queued', retry_count=$3, queue_started_at=now(), error_message=NULL
       WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [messageId, tenantId, attemptNo],
    )).rows[0]!;
    if (!updated.quota_exempt && (await currentPaygSettings(client)).enabled) {
      await reserveMessageCharge(client, tenantId, messageId, attemptNo);
    }
    return updated;
  });
  if (!message) {
    const exists = await pool.query<{ status: string; error_message: string | null }>(
      'SELECT status,error_message FROM messages WHERE id=$1 AND tenant_id=$2 AND system_otp=false AND system_notification=false',
      [messageId, tenantId],
    );
    if (!exists.rows[0]) throw new ServiceError(404, 'MESSAGE_NOT_FOUND', 'Message not found');
    if (exists.rows[0].error_message === 'delivery_uncertain') {
      throw new ServiceError(409, 'DELIVERY_UNCERTAIN_MANUAL_REVIEW_REQUIRED', 'WhatsApp may already have accepted this message. Check the chat before composing a new message; this message cannot be retried.');
    }
    throw new ServiceError(409, 'MESSAGE_NOT_RETRYABLE', 'Only failed or blocked messages can be retried');
  }
  try {
    await enqueueStoredMessage(
      message.device_key, message.id, `${message.id}:retry:${message.retry_count ?? 0}`,
      message.quota_exempt ? 'urgent' : 'normal',
    );
  } catch (error) {
    await pool.query(`UPDATE messages SET status='failed', error_message=$2 WHERE id=$1`,
      [message.id, error instanceof Error ? error.message : 'Queue unavailable']);
    throw new ServiceError(503, 'QUEUE_UNAVAILABLE', 'Unable to enqueue message retry');
  }
  return message;
  };
  return target ? withRecipientConsentLock(tenantId, target.to_number, retry) : retry();
}

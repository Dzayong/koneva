import { Queue } from 'bullmq';
import type { PoolClient, QueryResultRow } from 'pg';
import config from '../../shared/config';
import pool, { transaction } from '../../shared/database/connection';
import { getRedisClient } from '../../shared/redis';
import type { PaginatedResponse, SendMessageRequest } from '../../shared/types/api';
import { ServiceError } from './service-error';
import { assertSubscriptionActive, currentUsage } from './billing.service';
import { looksLikeTransactional, reserveTransactionalExemption } from './message-exempt-limits';
import { assertRecipientConsent } from './recipient-consent.service';
import logger from '../../shared/utils/logger';

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
): Promise<void> {
  const urgent = priority === 'urgent';
  await getMessageQueue(deviceKey, priority).add('send', { messageId }, {
    jobId,
    attempts: urgent ? 2 : 3,
    backoff: urgent ? { type: 'fixed', delay: 1500 } : { type: 'exponential', delay: 5000 },
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
  created_at: Date;
}

export async function queueMessage(
  tenantId: string,
  input: SendMessageRequest,
): Promise<MessageRow> {
  // Classification happens BEFORE the send transaction and is never the client's `priority` field: it requires the
  // request's own otp_code to genuinely appear in the message content (short, no media) AND a per-recipient/tenant
  // rate limit not already spent. See message-exempt-limits.ts. A failed/skipped claim never blocks the send --
  // it just means this particular send counts against quota like any other.
  const exempt = looksLikeTransactional({ message: input.message, mediaUrl: input.media_url, otpCode: input.otp_code })
    && await reserveTransactionalExemption(tenantId, input.to);

  const message = await transaction(async (client: PoolClient) => {
    await assertSubscriptionActive(client, tenantId);
    await assertRecipientConsent(client, tenantId, input.to, exempt);

    const deviceResult = await client.query<{ id: string; status: string }>(
      'SELECT id, status FROM devices WHERE tenant_id = $1 AND device_key = $2',
      [tenantId, input.device_key],
    );
    const device = deviceResult.rows[0];
    if (!device) throw new ServiceError(404, 'DEVICE_NOT_FOUND', 'Device not found');
    if (device.status !== 'online') {
      throw new ServiceError(503, 'DEVICE_OFFLINE', 'Device is not online');
    }

    // Exempt sends skip the quota check entirely and never count toward used_messages. Everything else is held,
    // not dropped or rejected, once the regular quota is spent -- a periodic sweep (see sweepQuotaHolds) and every
    // fresh billing window release held messages in order once headroom exists (see releaseHeldMessages).
    const overQuota = !exempt && await (async () => {
      const usage = await currentUsage(client, tenantId);
      return usage.used >= usage.quota;
    })();
    const status = overQuota ? 'quota_hold' : 'queued';
    // `priority` from a caller is never proof that a send is transactional or urgent.
    const priority = exempt ? 'urgent' : 'normal';

    const result = await client.query<MessageRow>(
      `INSERT INTO messages
         (tenant_id, device_id, device_key, to_number, content, external_id, status, priority, type, media_url, quota_exempt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [tenantId, device.id, input.device_key, input.to, input.message, input.external_id ?? null, status, priority,
        input.media_url ? (input.media_type ?? 'image') : 'text', input.media_url ?? null, exempt],
    );
    if (status === 'queued' && !exempt) await client.query('UPDATE tenants SET used_messages = used_messages + 1 WHERE id = $1', [tenantId]);
    return result.rows[0]!;
  });

  if (message.status === 'quota_hold') return message; // held, not enqueued; released later without ever being dropped

  try {
    await enqueueStoredMessage(input.device_key, message.id, message.id, (message.priority as 'normal' | 'urgent' | undefined) ?? 'normal');
  } catch (error) {
    await pool.query(
      `UPDATE messages SET status = 'failed', error_message = $2 WHERE id = $1`,
      [message.id, error instanceof Error ? error.message : 'Queue unavailable'],
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
  const toRelease = await transaction(async (client) => {
    const usage = await currentUsage(client, tenantId, now);
    const remaining = Math.max(0, usage.quota - usage.used);
    if (remaining <= 0) return [];
    const held = (await client.query<{ id: string; device_key: string; priority: string | null }>(
      `SELECT id, device_key, priority FROM messages WHERE tenant_id = $1 AND status = 'quota_hold' ORDER BY created_at ASC LIMIT $2 FOR UPDATE`,
      [tenantId, remaining],
    )).rows;
    if (held.length === 0) return [];
    await client.query(`UPDATE messages SET status = 'queued' WHERE id = ANY($1::uuid[])`, [held.map((h) => h.id)]);
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
     WHERE m.tenant_id = $1 AND m.id = $2
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
    search?: string | undefined;
    limit: number;
    offset: number;
  },
): Promise<PaginatedResponse<QueryResultRow>> {
  const values: unknown[] = [tenantId];
  const conditions = ['tenant_id = $1'];
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
  if (filter.search) {
    values.push(`%${filter.search}%`);
    conditions.push(`(content ILIKE $${values.length} OR from_number ILIKE $${values.length}
      OR to_number ILIKE $${values.length} OR external_id ILIKE $${values.length})`);
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

export async function retryMessage(tenantId: string, messageId: string): Promise<MessageRow> {
  // A retry is a new send: it needs a live plan and an online number, exactly like the first attempt (it does not use quota again).
  await assertSubscriptionActive(pool, tenantId);
  const target = (await pool.query<{ device_status: string | null; to_number: string; quota_exempt: boolean }>(
    `SELECT d.status AS device_status, m.to_number, COALESCE(m.quota_exempt, false) AS quota_exempt
     FROM messages m LEFT JOIN devices d ON d.id = m.device_id WHERE m.id = $1 AND m.tenant_id = $2`, [messageId, tenantId])).rows[0];
  if (target) await assertRecipientConsent(pool, tenantId, target.to_number, target.quota_exempt);
  if (target && target.device_status !== 'online') throw new ServiceError(503, 'DEVICE_OFFLINE', 'Device is not online');
  const result = await pool.query<MessageRow>(
    `UPDATE messages SET status='queued', error_message=NULL
     WHERE id=$1 AND tenant_id=$2 AND status IN ('failed','blocked') RETURNING *`,
    [messageId, tenantId],
  );
  const message = result.rows[0];
  if (!message) {
    const exists = await pool.query('SELECT status FROM messages WHERE id=$1 AND tenant_id=$2', [messageId, tenantId]);
    if (!exists.rows[0]) throw new ServiceError(404, 'MESSAGE_NOT_FOUND', 'Message not found');
    throw new ServiceError(409, 'MESSAGE_NOT_RETRYABLE', 'Only failed or blocked messages can be retried');
  }
  try {
    await enqueueStoredMessage(
      message.device_key, message.id, `${message.id}:retry:${Date.now()}`,
      message.quota_exempt ? 'urgent' : 'normal',
    );
  } catch (error) {
    await pool.query(`UPDATE messages SET status='failed', error_message=$2 WHERE id=$1`,
      [message.id, error instanceof Error ? error.message : 'Queue unavailable']);
    throw new ServiceError(503, 'QUEUE_UNAVAILABLE', 'Unable to enqueue message retry');
  }
  return message;
}

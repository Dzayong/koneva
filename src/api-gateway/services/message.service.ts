import { Queue } from 'bullmq';
import type { PoolClient, QueryResultRow } from 'pg';
import config from '../../shared/config';
import pool, { transaction } from '../../shared/database/connection';
import { getRedisClient } from '../../shared/redis';
import type { PaginatedResponse, SendMessageRequest } from '../../shared/types/api';

const redis = getRedisClient(config.redis.url);
const messageQueues = new Map<string, Queue>();

function getMessageQueue(deviceKey: string): Queue {
  let queue = messageQueues.get(deviceKey);
  if (!queue) {
    queue = new Queue(deviceKey, { connection: redis, prefix: 'queue:messages' });
    messageQueues.set(deviceKey, queue);
  }
  return queue;
}

export class ServiceError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
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
  created_at: Date;
}

export async function queueMessage(
  tenantId: string,
  input: SendMessageRequest,
): Promise<MessageRow> {
  const message = await transaction(async (client: PoolClient) => {
    const tenantResult = await client.query<{
      quota_messages: number;
      used_messages: number;
    }>(
      'SELECT quota_messages, used_messages FROM tenants WHERE id = $1 FOR UPDATE',
      [tenantId],
    );
    const tenant = tenantResult.rows[0];
    if (!tenant || tenant.used_messages >= tenant.quota_messages) {
      throw new ServiceError(429, 'QUOTA_EXCEEDED', 'Message quota exceeded');
    }

    const deviceResult = await client.query<{ id: string; status: string }>(
      'SELECT id, status FROM devices WHERE tenant_id = $1 AND device_key = $2',
      [tenantId, input.device_key],
    );
    const device = deviceResult.rows[0];
    if (!device) throw new ServiceError(404, 'DEVICE_NOT_FOUND', 'Device not found');
    if (device.status !== 'online') {
      throw new ServiceError(409, 'DEVICE_OFFLINE', 'Device is not online');
    }

    const result = await client.query<MessageRow>(
      `INSERT INTO messages
         (tenant_id, device_id, device_key, to_number, content, external_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'queued') RETURNING *`,
      [tenantId, device.id, input.device_key, input.to, input.message, input.external_id ?? null],
    );
    await client.query('UPDATE tenants SET used_messages = used_messages + 1 WHERE id = $1', [tenantId]);
    return result.rows[0]!;
  });

  try {
    await getMessageQueue(input.device_key).add(
      'send',
      { messageId: message.id },
      {
        jobId: message.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 86_400, count: 1000 },
      },
    );
  } catch (error) {
    await pool.query(
      `UPDATE messages SET status = 'failed', error_message = $2 WHERE id = $1`,
      [message.id, error instanceof Error ? error.message : 'Queue unavailable'],
    );
    throw new ServiceError(503, 'QUEUE_UNAVAILABLE', 'Unable to enqueue message');
  }

  return message;
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
    data: rows.rows,
    pagination: { limit: filter.limit, offset: filter.offset, total: count.rows[0]?.total ?? 0 },
  };
}

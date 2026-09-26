import { Queue } from 'bullmq';
import type { PoolClient, QueryResultRow } from 'pg';
import config from '../../shared/config';
import pool, { transaction } from '../../shared/database/connection';
import { getRedisClient } from '../../shared/redis';
import type { PaginatedResponse, SendMessageRequest } from '../../shared/types/api';
import { ServiceError } from './service-error';

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
      throw new ServiceError(503, 'DEVICE_OFFLINE', 'Device is not online');
    }

    const result = await client.query<MessageRow>(
      `INSERT INTO messages
         (tenant_id, device_id, device_key, to_number, content, external_id, status, priority)
       VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7) RETURNING *`,
      [tenantId, device.id, input.device_key, input.to, input.message, input.external_id ?? null, input.priority ?? 'normal'],
    );
    await client.query('UPDATE tenants SET used_messages = used_messages + 1 WHERE id = $1', [tenantId]);
    return result.rows[0]!;
  });

  try {
    await enqueueStoredMessage(input.device_key, message.id, message.id, input.priority ?? 'normal');
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
      message.priority === 'urgent' ? 'urgent' : 'normal',
    );
  } catch (error) {
    await pool.query(`UPDATE messages SET status='failed', error_message=$2 WHERE id=$1`,
      [message.id, error instanceof Error ? error.message : 'Queue unavailable']);
    throw new ServiceError(503, 'QUEUE_UNAVAILABLE', 'Unable to enqueue message retry');
  }
  return message;
}

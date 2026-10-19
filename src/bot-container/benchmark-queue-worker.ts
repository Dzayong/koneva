/**
 * Disposable T3.1 worker load. This intentionally bypasses WhatsApp: the only
 * transport is the in-memory fake below, and hard guards pin DB/Redis to the
 * benchmark stack before a connection or query is made.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import pool, { query } from '../shared/database/connection';
import { queueName } from './queue';
import type { QueueJobData } from './types';

const env = process.env;
assert.equal(env['T31_QUEUE_BENCHMARK'], '1', 'Set T31_QUEUE_BENCHMARK=1 to run this disposable-only utility');
assert.equal(env['NODE_ENV'], 'test', 'Queue benchmark only runs with NODE_ENV=test');
assert.equal(env['KONEVA_SANDBOX'], '1', 'Queue benchmark requires the WhatsApp sandbox kill-switch');
assert.equal(new URL(env['DATABASE_URL'] ?? '').hostname, 'pg', 'Refusing database outside the isolated benchmark network');
assert.equal(new URL(env['DATABASE_URL'] ?? '').pathname, '/koneva', 'Refusing unexpected benchmark database');
assert.equal(new URL(env['REDIS_URL'] ?? '').hostname, 'redis', 'Refusing Redis outside the isolated benchmark network');
const deviceKey = env['BOT_ID'] ?? '';
assert.match(deviceKey, /^WAPI-T31-[0-9]{2}$/, 'Refusing non-synthetic device key');

const countArg = process.argv.find((arg) => arg.startsWith('--count='))?.slice('--count='.length);
const count = Number(countArg ?? 250);
assert.ok(Number.isInteger(count) && count > 0 && count <= 5000, 'count must be an integer from 1 to 5000');
const recipient = '1000000000000'; // synthetic; never sent outside the fake transport
const content = `T31 synthetic benchmark ${randomUUID()}`;
const redis = new Redis(env['REDIS_URL']!, { maxRetriesPerRequest: null });

async function main(): Promise<void> {
  const queue = new Queue<QueueJobData>(queueName(deviceKey), { connection: redis, prefix: 'queue:messages' });
  await query("UPDATE devices SET status='online', paused_until=NULL WHERE device_key=$1", [deviceKey]);
  try {
    const result = await query(
      `INSERT INTO messages (tenant_id, device_id, device_key, to_number, content, type, status, priority, direction)
       SELECT d.tenant_id, d.id, d.device_key, $2, $3, 'text', 'queued', 'normal', 'outbound'
       FROM devices d WHERE d.device_key = $1 RETURNING id`,
      [deviceKey, recipient, content],
    );
    assert.equal(result.rows.length, 1, 'Synthetic device fixture was not found');
    // One SQL insert per synthetic item keeps message creation outside the measured worker path.
    const ids: string[] = [String((result.rows[0] as { id: string }).id)];
    if (count > 1) {
      const rest = await query(
        `INSERT INTO messages (tenant_id, device_id, device_key, to_number, content, type, status, priority, direction)
         SELECT d.tenant_id, d.id, d.device_key, $2, $3, 'text', 'queued', 'normal', 'outbound'
         FROM devices d CROSS JOIN generate_series(1, $4::int) AS g
         WHERE d.device_key = $1 RETURNING id`,
        [deviceKey, recipient, content, count - 1],
      );
      ids.push(...rest.rows.map((row) => String((row as { id: string }).id)));
    }
    const started = Date.now();
    await queue.addBulk(ids.map((messageId) => ({
      name: 'send', data: { messageId },
      opts: { attempts: 1, removeOnComplete: true, removeOnFail: false },
    })));

    const deadline = Date.now() + 180_000;
    let completed = 0;
    while (Date.now() < deadline) {
      const state = await query(
        `SELECT count(*) FILTER (WHERE status = 'sent')::int AS sent,
                count(*) FILTER (WHERE status IN ('failed','blocked'))::int AS failed,
                count(*) FILTER (WHERE status = 'queued')::int AS queued,
                percentile_cont(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (sent_at-created_at))*1000)
                  FILTER (WHERE status = 'sent') AS p50_ms,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (sent_at-created_at))*1000)
                  FILTER (WHERE status = 'sent') AS p95_ms,
                max(EXTRACT(EPOCH FROM (sent_at-created_at))*1000) FILTER (WHERE status = 'sent') AS max_ms
         FROM messages WHERE device_key = $1 AND content = $2`, [deviceKey, content],
      );
      const row = state.rows[0] as { sent: number; failed: number; queued: number; p50_ms: number | null; p95_ms: number | null; max_ms: number | null };
      completed = row.sent + row.failed;
      if (completed >= count) {
        const elapsedMs = Date.now() - started;
        const fakeCalls = await query(
          `SELECT count(*)::int AS count FROM messages
           WHERE device_key=$1 AND content=$2 AND status='sent' AND whatsapp_message_id LIKE 't31-fake-%'`,
          [deviceKey, content],
        );
        const errors = await query(
          `SELECT COALESCE(error_message, 'none') AS reason, count(*)::int AS count
           FROM messages WHERE device_key=$1 AND content=$2 AND status IN ('failed','blocked')
           GROUP BY error_message ORDER BY count DESC`, [deviceKey, content],
        );
        console.log(JSON.stringify({
          deviceKey, requested: count, sent: row.sent, failed: row.failed,
          fakeTransportCalls: (fakeCalls.rows[0] as { count: number }).count,
          elapsedMs, throughputPerSecond: Number((row.sent / (elapsedMs / 1000)).toFixed(2)),
          queueAgeMs: { p50: Math.round(row.p50_ms ?? 0), p95: Math.round(row.p95_ms ?? 0), max: Math.round(row.max_ms ?? 0) },
          failureReasons: errors.rows,
        }));
        assert.equal(row.sent, count, `Expected all messages to reach sent state; ${row.failed} failed`);
        assert.equal((fakeCalls.rows[0] as { count: number }).count, count, 'Fake transport call count did not match completed sends');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Worker timeout after ${completed}/${count} terminal messages`);
  } finally {
    await queue.close();
    await redis.quit();
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});

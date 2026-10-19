import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import Redis from 'ioredis';
import type { Pool, PoolClient } from 'pg';

const COLLECTION_INTERVAL_MS = 60_000;
const RETENTION_DAYS = 35;
const MAX_HISTORY_DAYS = 31;
const DEVICE_KEY_PATTERN = /^WAPI-[A-Z0-9-]{1,59}$/i;
const QUEUE_PREFIX = 'queue:messages';

type Db = Pick<Pool, 'connect' | 'query'>;
export interface DeviceInventoryRow { id: string; tenant_id: string; device_key: string }
export interface QueueUsageCounts {
  waitingCount: number;
  activeCount: number;
  delayedCount: number;
  failedCount: number;
  deadLetterCount: number;
}
export interface DeviceUsageSample {
  id: string;
  tenantId: string;
  deviceKey: string;
  sessionStorageBytes: number | null;
  waitingCount: number | null;
  activeCount: number | null;
  delayedCount: number | null;
  failedCount: number | null;
  deadLetterCount: number | null;
}
export interface DeviceUsageReader {
  read(deviceKey: string): Promise<QueueUsageCounts>;
  close(): Promise<void>;
}

function safeDeviceSessionPath(root: string, deviceKey: string): string {
  if (!DEVICE_KEY_PATTERN.test(deviceKey)) throw new Error('Invalid device key');
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, deviceKey);
  if (path.dirname(resolved) !== resolvedRoot) throw new Error('Session path escapes configured root');
  return resolved;
}

/** Returns allocated bytes for regular files only; links are ignored to avoid following paths outside the session root. */
export async function measureSessionStorage(root: string, deviceKey: string): Promise<number> {
  const target = safeDeviceSessionPath(root, deviceKey);
  const pending = [target];
  let bytes = 0;
  while (pending.length) {
    const current = pending.pop()!;
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        pending.push(path.join(current, entry.name));
      }
    } else if (info.isFile()) {
      bytes += Number.isFinite(info.blocks) && info.blocks > 0 ? info.blocks * 512 : info.size;
    }
  }
  return bytes;
}

/** Reads BullMQ state-list cardinalities directly, never job data or message payloads. */
export class RedisDeviceUsageReader implements DeviceUsageReader {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2_500,
      retryStrategy: (attempt) => attempt <= 3 ? Math.min(attempt * 250, 750) : null,
    });
    this.redis.on('error', () => {});
  }

  async read(deviceKey: string): Promise<QueueUsageCounts> {
    if (!DEVICE_KEY_PATTERN.test(deviceKey)) throw new Error('Invalid device key');
    const queueNames = [deviceKey, `${deviceKey}-urgent`, `${deviceKey}-dead`];
    const pipeline = this.redis.pipeline();
    for (const name of queueNames) {
      const base = `${QUEUE_PREFIX}:${name}`;
      pipeline.llen(`${base}:wait`);
      pipeline.llen(`${base}:paused`);
      pipeline.zcard(`${base}:prioritized`);
      pipeline.zcard(`${base}:waiting-children`);
      pipeline.llen(`${base}:active`);
      pipeline.zcard(`${base}:delayed`);
      pipeline.zcard(`${base}:failed`);
    }
    const results = await pipeline.exec();
    if (!results || results.some(([error]) => error)) throw new Error('Redis queue metrics unavailable');
    const values = results.map(([, value]) => Number(value));
    if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid Redis queue metrics');
    const sum = (...indexes: number[]) => indexes.reduce((total, index) => total + values[index]!, 0);
    // Four pending states, active, delayed, failed for each queue; dead-letter queue backlog is reported separately.
    return {
      waitingCount: sum(0, 1, 2, 3, 7, 8, 9, 10),
      activeCount: sum(4, 11),
      delayedCount: sum(5, 12),
      failedCount: sum(6, 13),
      deadLetterCount: sum(14, 15, 16, 17),
    };
  }

  async close(): Promise<void> { await this.redis.quit(); }
}

export async function readDeviceInventory(db: Pick<Pool, 'query'>): Promise<DeviceInventoryRow[]> {
  const result = await db.query<DeviceInventoryRow>(
    'SELECT id, tenant_id, device_key FROM devices ORDER BY id',
  );
  return result.rows;
}

export async function collectDeviceUsage(
  db: Db,
  options: {
    sessionRoot: string;
    inventory: () => Promise<DeviceInventoryRow[]>;
    reader: DeviceUsageReader;
    sampledAt?: Date;
    measureSession?: typeof measureSessionStorage;
  },
): Promise<number> {
  const sampledAt = options.sampledAt ?? new Date();
  if (!Number.isFinite(sampledAt.getTime())) throw new Error('Invalid device usage timestamp');
  const devices = await options.inventory();
  const measure = options.measureSession ?? measureSessionStorage;
  const samples: DeviceUsageSample[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(8, devices.length) }, async () => {
    while (cursor < devices.length) {
      const device = devices[cursor++];
      if (!device) continue;
      const [sessionStorageBytes, queueCounts] = await Promise.all([
        measure(options.sessionRoot, device.device_key).catch(() => null),
        options.reader.read(device.device_key).catch(() => null),
      ]);
      samples.push({
        id: device.id,
        tenantId: device.tenant_id,
        deviceKey: device.device_key,
        sessionStorageBytes,
        waitingCount: queueCounts?.waitingCount ?? null,
        activeCount: queueCounts?.activeCount ?? null,
        delayedCount: queueCounts?.delayedCount ?? null,
        failedCount: queueCounts?.failedCount ?? null,
        deadLetterCount: queueCounts?.deadLetterCount ?? null,
      });
    }
  });
  await Promise.all(workers);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const sample of samples) {
      await client.query(
        `INSERT INTO device_usage_hourly (
           bucket_start, resource_key, tenant_id, device_id, session_storage_bytes,
           queue_waiting_count, queue_active_count, queue_delayed_count,
           queue_failed_count, dead_letter_count, sampled_at
         ) VALUES (date_trunc('hour', $1::timestamptz), 'device:' || $2::text, $3, $2,
                   $4, $5, $6, $7, $8, $9, $1)
         ON CONFLICT (bucket_start, resource_key) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           device_id = EXCLUDED.device_id,
           session_storage_bytes = EXCLUDED.session_storage_bytes,
           queue_waiting_count = EXCLUDED.queue_waiting_count,
           queue_active_count = EXCLUDED.queue_active_count,
           queue_delayed_count = EXCLUDED.queue_delayed_count,
           queue_failed_count = EXCLUDED.queue_failed_count,
           dead_letter_count = EXCLUDED.dead_letter_count,
           sampled_at = EXCLUDED.sampled_at,
           updated_at = now()`,
        [sampledAt, sample.id, sample.tenantId, sample.sessionStorageBytes, sample.waitingCount,
          sample.activeCount, sample.delayedCount, sample.failedCount, sample.deadLetterCount],
      );
    }
    await client.query("DELETE FROM device_usage_hourly WHERE bucket_start < now() - ($1::int * interval '1 day')", [RETENTION_DAYS]);
    await client.query('COMMIT');
    return samples.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function startDeviceUsageCollector(
  db: Db,
  options: { sessionRoot: string; reader: DeviceUsageReader; onError: (error: unknown) => void },
): () => void {
  let active = false;
  const run = async (): Promise<void> => {
    if (active) return;
    active = true;
    try {
      await collectDeviceUsage(db, { ...options, inventory: () => readDeviceInventory(db) });
    } catch (error) { options.onError(error); }
    finally { active = false; }
  };
  const timer = setInterval(() => void run(), COLLECTION_INTERVAL_MS);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}

export async function readDeviceUsageHistory(db: Pick<Pool, 'query'>, query: {
  from: Date; to: Date; tenantId?: string | undefined;
}): Promise<{ from: string; to: string; buckets: Array<{
  bucketStart: string; tenantId: string | null; deviceId: string | null;
  sessionStorageBytes: number | null; waitingCount: number | null; activeCount: number | null;
  delayedCount: number | null; failedCount: number | null; deadLetterCount: number | null; sampledAt: string;
}> }> {
  if (!Number.isFinite(query.from.getTime()) || !Number.isFinite(query.to.getTime()) || query.from >= query.to) {
    throw new Error('Invalid device usage history range');
  }
  if (query.to.getTime() - query.from.getTime() > MAX_HISTORY_DAYS * 86_400_000) {
    throw new Error('Device usage history range exceeds 31 days');
  }
  const result = await db.query<{
    bucket_start: Date; tenant_id: string | null; device_id: string | null;
    session_storage_bytes: string | null; queue_waiting_count: number | null; queue_active_count: number | null;
    queue_delayed_count: number | null; queue_failed_count: number | null; dead_letter_count: number | null; sampled_at: Date;
  }>(
    `SELECT bucket_start, tenant_id, device_id, session_storage_bytes, queue_waiting_count,
            queue_active_count, queue_delayed_count, queue_failed_count, dead_letter_count, sampled_at
     FROM device_usage_hourly
     WHERE bucket_start >= date_trunc('hour', $1::timestamptz)
       AND bucket_start < date_trunc('hour', $2::timestamptz) + interval '1 hour'
       AND ($3::uuid IS NULL OR tenant_id = $3)
     ORDER BY bucket_start DESC, tenant_id, device_id`,
    [query.from, query.to, query.tenantId ?? null],
  );
  return {
    from: query.from.toISOString(), to: query.to.toISOString(),
    buckets: result.rows.map((row) => ({
      bucketStart: row.bucket_start.toISOString(), tenantId: row.tenant_id, deviceId: row.device_id,
      sessionStorageBytes: row.session_storage_bytes === null ? null : Number(row.session_storage_bytes),
      waitingCount: row.queue_waiting_count, activeCount: row.queue_active_count,
      delayedCount: row.queue_delayed_count, failedCount: row.queue_failed_count,
      deadLetterCount: row.dead_letter_count, sampledAt: row.sampled_at.toISOString(),
    })),
  };
}

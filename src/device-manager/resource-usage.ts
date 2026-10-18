import type { Pool, PoolClient } from 'pg';
import type { BotOrchestrator, BotResourceSnapshot } from './types';

const COLLECTION_INTERVAL_MS = 60_000;
const RETENTION_DAYS = 35;
const MAX_HISTORY_DAYS = 31;

type Db = Pick<Pool, 'connect' | 'query'>;
type ResourceRow = Extract<BotResourceSnapshot, { available: true }>['containers'][number];

function hourBucket(sampledAt: string): Date {
  const date = new Date(sampledAt);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid resource snapshot timestamp');
  date.setUTCMinutes(0, 0, 0);
  return date;
}

async function persistResourceRow(client: PoolClient, row: ResourceRow, bucket: Date): Promise<void> {
  if (row.kind === 'device') {
    if (!row.deviceKey) return;
    await client.query(
      `INSERT INTO resource_usage_hourly (
         bucket_start, resource_key, tenant_id, device_id, kind, service,
         cpu_percent_sum, memory_usage_bytes_sum, memory_usage_bytes_max,
         memory_limit_bytes_max, sample_count
       )
       SELECT date_trunc('hour', $1::timestamptz), 'device:' || d.id::text,
              d.tenant_id, d.id, 'device', NULL, $3, $4, $4, $5, 1
       FROM devices d WHERE d.device_key = $2
       ON CONFLICT (bucket_start, resource_key) DO UPDATE SET
         cpu_percent_sum = resource_usage_hourly.cpu_percent_sum + EXCLUDED.cpu_percent_sum,
         memory_usage_bytes_sum = resource_usage_hourly.memory_usage_bytes_sum + EXCLUDED.memory_usage_bytes_sum,
         memory_usage_bytes_max = GREATEST(resource_usage_hourly.memory_usage_bytes_max, EXCLUDED.memory_usage_bytes_max),
         memory_limit_bytes_max = GREATEST(resource_usage_hourly.memory_limit_bytes_max, EXCLUDED.memory_limit_bytes_max),
         sample_count = resource_usage_hourly.sample_count + 1,
         updated_at = now()`,
      [bucket, row.deviceKey, row.cpuPercent, row.memoryUsageBytes, row.memoryLimitBytes],
    );
    return;
  }

  if (!row.service) return;
  await client.query(
    `INSERT INTO resource_usage_hourly (
       bucket_start, resource_key, kind, service, cpu_percent_sum,
       memory_usage_bytes_sum, memory_usage_bytes_max, memory_limit_bytes_max, sample_count
     ) VALUES (date_trunc('hour', $1::timestamptz), 'shared:' || $2, 'shared', $2, $3, $4, $4, $5, 1)
     ON CONFLICT (bucket_start, resource_key) DO UPDATE SET
       cpu_percent_sum = resource_usage_hourly.cpu_percent_sum + EXCLUDED.cpu_percent_sum,
       memory_usage_bytes_sum = resource_usage_hourly.memory_usage_bytes_sum + EXCLUDED.memory_usage_bytes_sum,
       memory_usage_bytes_max = GREATEST(resource_usage_hourly.memory_usage_bytes_max, EXCLUDED.memory_usage_bytes_max),
       memory_limit_bytes_max = GREATEST(resource_usage_hourly.memory_limit_bytes_max, EXCLUDED.memory_limit_bytes_max),
       sample_count = resource_usage_hourly.sample_count + 1,
       updated_at = now()`,
    [bucket, row.service, row.cpuPercent, row.memoryUsageBytes, row.memoryLimitBytes],
  );
}

/** Store only an hourly aggregate. Device keys are resolved to internal IDs and never persisted as labels. */
export async function persistResourceSnapshot(db: Db, snapshot: BotResourceSnapshot): Promise<number> {
  if (!snapshot.available) {
    await db.query("DELETE FROM resource_usage_hourly WHERE bucket_start < now() - ($1::int * interval '1 day')", [RETENTION_DAYS]);
    return 0;
  }
  const bucket = hourBucket(snapshot.sampledAt);
  const client = await db.connect();
  let written = 0;
  try {
    await client.query('BEGIN');
    for (const row of snapshot.containers) {
      await persistResourceRow(client, row, bucket);
      written += 1;
    }
    await client.query('DELETE FROM resource_usage_hourly WHERE bucket_start < now() - ($1::int * interval \'1 day\')', [RETENTION_DAYS]);
    await client.query('COMMIT');
    return written;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function collectResourceSnapshot(orchestrator: BotOrchestrator, db: Db): Promise<number> {
  const snapshot = await orchestrator.getResourceSnapshot();
  return persistResourceSnapshot(db, snapshot);
}

export interface ResourceHistoryQuery {
  from: Date;
  to: Date;
  tenantId?: string | undefined;
}

export async function readResourceHistory(db: Db, query: ResourceHistoryQuery): Promise<{
  from: string;
  to: string;
  buckets: Array<{
    bucketStart: string;
    tenantId: string | null;
    kind: 'device' | 'shared';
    service: string | null;
    deviceCount: number;
    cpuPercentAverage: number;
    memoryUsageBytesAverage: number;
    memoryUsageBytesPeak: number;
    memoryLimitBytesPeak: number;
    sampleCount: number;
  }>;
}> {
  if (!Number.isFinite(query.from.getTime()) || !Number.isFinite(query.to.getTime()) || query.from >= query.to) {
    throw new Error('Invalid resource history range');
  }
  if (query.to.getTime() - query.from.getTime() > MAX_HISTORY_DAYS * 86_400_000) {
    throw new Error('Resource history range exceeds 31 days');
  }
  const result = await db.query<{
    bucket_start: Date; tenant_id: string | null; kind: 'device' | 'shared'; service: string | null;
    device_count: string; cpu_percent_average: string; memory_usage_bytes_average: string;
    memory_usage_bytes_peak: string; memory_limit_bytes_peak: string; sample_count: string;
  }>(
    `SELECT bucket_start, tenant_id, kind, service,
            count(*)::int AS device_count,
            sum(cpu_percent_sum) / NULLIF(sum(sample_count), 0) AS cpu_percent_average,
            sum(memory_usage_bytes_sum) / NULLIF(sum(sample_count), 0) AS memory_usage_bytes_average,
            max(memory_usage_bytes_max) AS memory_usage_bytes_peak,
            max(memory_limit_bytes_max) AS memory_limit_bytes_peak,
            sum(sample_count)::int AS sample_count
     FROM resource_usage_hourly
     WHERE bucket_start >= date_trunc('hour', $1::timestamptz)
       AND bucket_start < date_trunc('hour', $2::timestamptz) + interval '1 hour'
       AND ($3::uuid IS NULL OR tenant_id = $3)
     GROUP BY bucket_start, tenant_id, kind, service
     ORDER BY bucket_start DESC, kind, service NULLS FIRST, tenant_id`,
    [query.from, query.to, query.tenantId ?? null],
  );
  return {
    from: query.from.toISOString(),
    to: query.to.toISOString(),
    buckets: result.rows.map((row) => ({
      bucketStart: row.bucket_start.toISOString(),
      tenantId: row.tenant_id,
      kind: row.kind,
      service: row.service,
      deviceCount: Number(row.device_count),
      cpuPercentAverage: Number(row.cpu_percent_average),
      memoryUsageBytesAverage: Number(row.memory_usage_bytes_average),
      memoryUsageBytesPeak: Number(row.memory_usage_bytes_peak),
      memoryLimitBytesPeak: Number(row.memory_limit_bytes_peak),
      sampleCount: Number(row.sample_count),
    })),
  };
}

export function startResourceUsageCollector(orchestrator: BotOrchestrator, db: Db, onError: (error: unknown) => void): () => void {
  let active = false;
  const run = async (): Promise<void> => {
    if (active) return;
    active = true;
    try {
      await collectResourceSnapshot(orchestrator, db);
    } catch (error) {
      onError(error);
    } finally {
      active = false;
    }
  };
  const timer = setInterval(() => void run(), COLLECTION_INTERVAL_MS);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}

import type { Pool } from 'pg';

const MAX_SAMPLE_BYTES_PER_TABLE = 4 * 1024 * 1024;

// These tables have a direct tenant_id and contain most tenant-owned DB storage.
// Keep this list fixed: identifiers are interpolated only from this allow-list.
const TENANT_TABLES = [
  'messages', 'webhook_logs', 'contacts', 'device_commands', 'device_events', 'auto_reply_logs', 'auto_reply_rules',
] as const;

type Db = Pick<Pool, 'connect' | 'query'>;
interface RelationInfo { table_name: (typeof TENANT_TABLES)[number]; heap_bytes: string; relation_bytes: string }
interface SampleCount { tenant_id: string; sampled_rows: number }

export interface DatabaseUsageEstimate {
  measuredAt: string;
  method: 'postgres_system_block_sample';
  confidence: 'directional';
  billingReady: false;
  totalDatabaseBytes: number;
  sampledTables: Array<{ table: string; relationBytes: number; samplePercent: number; sampledRows: number }>;
  tenants: Array<{
    tenantId: string;
    estimatedBytes: number;
    breakdown: Array<{ table: string; estimatedBytes: number; sampledRows: number; tableSampledRows: number }>;
  }>;
  note: string;
}

function nonNegativeInteger(value: string | number, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid ${label} returned by PostgreSQL`);
  return parsed;
}

/**
 * Estimates tenant shares from a small TABLESAMPLE SYSTEM sample. It reads only tenant_id,
 * never message/webhook payload columns, and is deliberately on-demand rather than a poller.
 */
export async function estimateDatabaseUsage(db: Db, measuredAt = new Date()): Promise<DatabaseUsageEstimate> {
  if (!Number.isFinite(measuredAt.getTime())) throw new Error('Invalid database estimate timestamp');
  const client = await db.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5s'");
    const databaseSize = await client.query<{ bytes: string }>(
      'SELECT pg_database_size(current_database())::text AS bytes',
    );
    const tenants = await client.query<{ id: string }>('SELECT id::text AS id FROM tenants ORDER BY id');
    const relations = await client.query<RelationInfo>(
      `SELECT c.relname AS table_name,
              pg_relation_size(c.oid)::text AS heap_bytes,
              pg_total_relation_size(c.oid)::text AS relation_bytes
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'm') AND c.relname = ANY($1::text[])`,
      [TENANT_TABLES],
    );
    const totalDatabaseBytes = nonNegativeInteger(databaseSize.rows[0]?.bytes ?? -1, 'database size');
    const tenantIds = tenants.rows.map((row) => row.id);
    const estimatedByTenant = new Map(tenantIds.map((id) => [id, { estimatedBytes: 0, breakdown: [] as DatabaseUsageEstimate['tenants'][number]['breakdown'] }]));
    const sampledTables: DatabaseUsageEstimate['sampledTables'] = [];

    for (const relation of relations.rows) {
      const heapBytes = nonNegativeInteger(relation.heap_bytes, `${relation.table_name} heap size`);
      const relationBytes = nonNegativeInteger(relation.relation_bytes, `${relation.table_name} total size`);
      if (heapBytes === 0 || relationBytes === 0) {
        sampledTables.push({ table: relation.table_name, relationBytes, samplePercent: 0, sampledRows: 0 });
        continue;
      }
      const samplePercent = Math.min(100, Math.max(0.000001, MAX_SAMPLE_BYTES_PER_TABLE / heapBytes * 100));
      // relation.table_name can only be one of TENANT_TABLES (from the catalog query above).
      const sample = await client.query<SampleCount>(
        `SELECT tenant_id::text AS tenant_id, count(*)::int AS sampled_rows
         FROM public."${relation.table_name}" TABLESAMPLE SYSTEM ($1::real)
         WHERE tenant_id IS NOT NULL
         GROUP BY tenant_id`,
        [samplePercent],
      );
      const tableSampledRows = sample.rows.reduce((sum, row) => sum + nonNegativeInteger(row.sampled_rows, 'sample row count'), 0);
      sampledTables.push({ table: relation.table_name, relationBytes, samplePercent, sampledRows: tableSampledRows });
      if (tableSampledRows === 0) continue;
      for (const row of sample.rows) {
        const tenant = estimatedByTenant.get(row.tenant_id);
        if (!tenant) continue;
        const sampledRows = nonNegativeInteger(row.sampled_rows, 'sample row count');
        const estimatedBytes = Math.round(relationBytes * sampledRows / tableSampledRows);
        tenant.estimatedBytes += estimatedBytes;
        tenant.breakdown.push({ table: relation.table_name, estimatedBytes, sampledRows, tableSampledRows });
      }
    }

    await client.query('COMMIT');
    return {
      measuredAt: measuredAt.toISOString(),
      method: 'postgres_system_block_sample',
      confidence: 'directional',
      billingReady: false,
      totalDatabaseBytes,
      sampledTables,
      tenants: [...estimatedByTenant.entries()].map(([tenantId, usage]) => ({ tenantId, ...usage })),
      note: 'Estimasi arah dari sampel blok dan porsi baris; variasi ukuran baris serta sampel kosong dapat membuat hasil meleset. Bukan kuota, penagihan, atau ukuran presisi per tenant.',
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

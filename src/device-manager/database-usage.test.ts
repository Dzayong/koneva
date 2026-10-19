import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { test } from 'node:test';
import { estimateDatabaseUsage } from './database-usage';

function fakePool(onQuery: (sql: string, values?: unknown[]) => unknown) {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  let released = false;
  const client = {
    query: async (sql: string, values?: unknown[]) => { calls.push({ sql, values }); return onQuery(sql, values); },
    release: () => { released = true; },
  };
  return {
    pool: { connect: async () => client } as unknown as Pool,
    calls,
    wasReleased: () => released,
  };
}

test('database usage estimate uses capped block samples and returns only tenant-level size shares', async () => {
  const db = fakePool((sql) => {
    if (sql.includes('pg_database_size')) return { rows: [{ bytes: '1000000' }] };
    if (sql.includes('FROM tenants')) return { rows: [{ id: 'tenant-a' }, { id: 'tenant-b' }] };
    if (sql.includes('FROM pg_class')) return { rows: [
      { table_name: 'messages', heap_bytes: '8388608', relation_bytes: '12000000' },
      { table_name: 'contacts', heap_bytes: '0', relation_bytes: '0' },
    ] };
    if (sql.includes('TABLESAMPLE SYSTEM')) return { rows: [
      { tenant_id: 'tenant-a', sampled_rows: 3 }, { tenant_id: 'tenant-b', sampled_rows: 1 },
    ] };
    return { rows: [] };
  });
  const measuredAt = new Date('2026-10-18T12:00:00.000Z');
  const result = await estimateDatabaseUsage(db.pool, measuredAt);
  assert.equal(result.totalDatabaseBytes, 1_000_000);
  assert.equal(result.confidence, 'directional');
  assert.equal(result.billingReady, false);
  assert.equal(result.sampledTables[0]?.samplePercent, 50);
  assert.equal(result.sampledTables[0]?.sampledRows, 4);
  assert.equal(result.tenants.find((tenant) => tenant.tenantId === 'tenant-a')?.estimatedBytes, 9_000_000);
  assert.equal(result.tenants.find((tenant) => tenant.tenantId === 'tenant-b')?.estimatedBytes, 3_000_000);
  assert.equal(result.tenants.find((tenant) => tenant.tenantId === 'tenant-b')?.breakdown[0]?.sampledRows, 1);
  const sampleCall = db.calls.find((call) => call.sql.includes('TABLESAMPLE SYSTEM'))!;
  assert.match(sampleCall.sql, /FROM public\."messages" TABLESAMPLE SYSTEM/);
  assert.deepEqual(sampleCall.values, [50]);
  assert.equal(/content|payload|response_body|phone_number/i.test(sampleCall.sql), false);
  assert.equal(db.calls[0]?.sql, 'BEGIN READ ONLY');
  assert.equal(db.calls.at(-1)?.sql, 'COMMIT');
  assert.equal(db.wasReleased(), true);
});

test('database estimate rolls back when sampling fails and rejects invalid measurement time', async () => {
  const db = fakePool((sql) => {
    if (sql.includes('pg_database_size')) return { rows: [{ bytes: '1000' }] };
    if (sql.includes('FROM tenants')) return { rows: [] };
    if (sql.includes('FROM pg_class')) return { rows: [{ table_name: 'messages', heap_bytes: '4096', relation_bytes: '8192' }] };
    if (sql.includes('TABLESAMPLE SYSTEM')) throw new Error('statement timeout');
    return { rows: [] };
  });
  await assert.rejects(() => estimateDatabaseUsage(db.pool), /statement timeout/);
  assert.equal(db.calls.at(-1)?.sql, 'ROLLBACK');
  assert.equal(db.wasReleased(), true);
  await assert.rejects(() => estimateDatabaseUsage(db.pool, new Date(Number.NaN)), /Invalid database estimate timestamp/);
});

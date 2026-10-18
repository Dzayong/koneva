import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { test } from 'node:test';
import { persistResourceSnapshot, readResourceHistory } from './resource-usage';
import type { BotResourceSnapshot } from './types';

function fakePool(onQuery: (sql: string, values?: unknown[]) => unknown = () => ({ rows: [] })) {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  let released = false;
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return onQuery(sql, values);
    },
    release: () => { released = true; },
  };
  const pool = {
    connect: async () => client,
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return onQuery(sql, values);
    },
  } as unknown as Pool;
  return { pool, calls, wasReleased: () => released };
}

const snapshot: BotResourceSnapshot = {
  available: true,
  source: 'docker-stats',
  sampledAt: '2026-10-18T12:34:56.000Z',
  containers: [
    { kind: 'device', name: 'wa-bot-wapi-private', service: null, deviceKey: 'WAPI-PRIVATE', cpuPercent: 12.5, memoryUsageBytes: 1000, memoryLimitBytes: 4000 },
    { kind: 'shared', name: 'koneva-postgres-1', service: 'postgres', deviceKey: null, cpuPercent: 4, memoryUsageBytes: 2000, memoryLimitBytes: 8000 },
  ],
};

test('resource collection writes only coarse device/shared aggregates and releases the transaction client', async () => {
  const db = fakePool();
  const written = await persistResourceSnapshot(db.pool, snapshot);
  assert.equal(written, 2);
  assert.equal(db.calls[0]?.sql, 'BEGIN');
  assert.equal(db.calls.at(-2)?.sql.startsWith('DELETE FROM resource_usage_hourly'), true);
  assert.equal(db.calls.at(-1)?.sql, 'COMMIT');
  const inserts = db.calls.filter((call) => call.sql.includes('INSERT INTO resource_usage_hourly'));
  assert.equal(inserts.length, 2);
  assert.equal(inserts[0]?.values?.[0] instanceof Date, true);
  assert.deepEqual(inserts[0]?.values?.slice(1), ['WAPI-PRIVATE', 12.5, 1000, 4000]);
  assert.deepEqual(inserts[1]?.values?.slice(1), ['postgres', 4, 2000, 8000]);
  assert.equal(inserts.some((call) => /phone|message|container_name/i.test(call.sql)), false);
  assert.equal(db.wasReleased(), true);
});

test('unavailable snapshots write no metrics and still enforce history retention', async () => {
  const db = fakePool();
  assert.equal(await persistResourceSnapshot(db.pool, {
    available: false, source: 'unavailable', sampledAt: '2026-10-18T12:00:00.000Z', reason: 'container_metrics_not_configured',
  }), 0);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0]!.sql, /DELETE FROM resource_usage_hourly/);
});

test('resource collection rolls back when persistence fails', async () => {
  const db = fakePool((sql) => {
    if (sql.includes('INSERT INTO resource_usage_hourly')) throw new Error('db unavailable');
    return { rows: [] };
  });
  await assert.rejects(() => persistResourceSnapshot(db.pool, snapshot), /db unavailable/);
  assert.equal(db.calls.at(-1)?.sql, 'ROLLBACK');
  assert.equal(db.wasReleased(), true);
});

test('resource history aggregates rows and rejects invalid or excessive ranges', async () => {
  const now = new Date('2026-10-18T12:00:00.000Z');
  const db = fakePool((sql) => {
    if (!sql.includes('FROM resource_usage_hourly')) return { rows: [] };
    return { rows: [{
      bucket_start: new Date('2026-10-18T11:00:00.000Z'), tenant_id: 'tenant-1', kind: 'device', service: null,
      device_count: '2', cpu_percent_average: '11.25', memory_usage_bytes_average: '2048',
      memory_usage_bytes_peak: '4096', memory_limit_bytes_peak: '8192', sample_count: '60',
    }] };
  });
  const result = await readResourceHistory(db.pool, { from: new Date(now.getTime() - 3_600_000), to: now, tenantId: 'tenant-1' });
  assert.equal(result.buckets[0]?.deviceCount, 2);
  assert.equal(result.buckets[0]?.cpuPercentAverage, 11.25);
  assert.equal(result.buckets[0]?.memoryUsageBytesPeak, 4096);
  assert.equal(result.buckets[0]?.sampleCount, 60);
  assert.deepEqual(db.calls[0]?.values?.slice(2), ['tenant-1']);
  await assert.rejects(() => readResourceHistory(db.pool, { from: now, to: now }), /Invalid resource history range/);
  await assert.rejects(() => readResourceHistory(db.pool, { from: new Date(now.getTime() - 32 * 86_400_000), to: now }), /exceeds 31 days/);
});


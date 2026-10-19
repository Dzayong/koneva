import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Pool } from 'pg';
import { test } from 'node:test';
import {
  collectDeviceUsage, measureSessionStorage, readDeviceUsageHistory,
  type DeviceInventoryRow, type DeviceUsageReader, type QueueUsageCounts,
} from './device-usage';

const queueCounts: QueueUsageCounts = { waitingCount: 4, activeCount: 2, delayedCount: 1, failedCount: 3, deadLetterCount: 5 };

function fakePool(onQuery: (sql: string, values?: unknown[]) => unknown = () => ({ rows: [] })) {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  let released = false;
  const client = {
    query: async (sql: string, values?: unknown[]) => { calls.push({ sql, values }); return onQuery(sql, values); },
    release: () => { released = true; },
  };
  const pool = {
    connect: async () => client,
    query: async (sql: string, values?: unknown[]) => { calls.push({ sql, values }); return onQuery(sql, values); },
  } as unknown as Pool;
  return { pool, calls, wasReleased: () => released };
}

test('session size counts regular files, ignores symlinks and treats a missing session as empty', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'koneva-device-usage-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'koneva-device-outside-'));
  t.after(async () => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  await mkdir(path.join(root, 'WAPI-ABC', 'nested'), { recursive: true });
  await writeFile(path.join(root, 'WAPI-ABC', 'one'), 'session');
  await writeFile(path.join(outside, 'secret'), 'outside');
  await symlink(outside, path.join(root, 'WAPI-ABC', 'linked'));
  const withLink = await measureSessionStorage(root, 'WAPI-ABC');
  assert.ok(withLink > 0);
  await unlink(path.join(root, 'WAPI-ABC', 'linked'));
  assert.equal(await measureSessionStorage(root, 'WAPI-ABC'), withLink);
  assert.equal(await measureSessionStorage(root, 'WAPI-MISSING'), 0);
  await assert.rejects(() => measureSessionStorage(root, '../escape'), /Invalid device key/);
});

test('device collector records unknown queue metrics as null instead of zero', async () => {
  const db = fakePool();
  let closed = false;
  const reader: DeviceUsageReader = {
    read: async () => { throw new Error('redis unavailable'); },
    close: async () => { closed = true; },
  };
  const inventory: DeviceInventoryRow[] = [{ id: 'device-1', tenant_id: 'tenant-1', device_key: 'WAPI-ABC' }];
  const written = await collectDeviceUsage(db.pool, {
    sessionRoot: '/sessions', inventory: async () => inventory, reader,
    sampledAt: new Date('2026-10-18T12:34:00.000Z'),
    measureSession: async () => 1234,
  });
  assert.equal(written, 1);
  const insert = db.calls.find((call) => call.sql.includes('INSERT INTO device_usage_hourly'))!;
  assert.deepEqual(insert.values, [new Date('2026-10-18T12:34:00.000Z'), 'device-1', 'tenant-1', 1234, null, null, null, null, null]);
  assert.equal(db.calls.at(-1)?.sql, 'COMMIT');
  assert.equal(db.wasReleased(), true);
  await reader.close();
  assert.equal(closed, true);
  assert.equal(/content|payload|to_number/i.test(insert.sql), false);
});

test('device collector persists available queue counts and rolls back on database failure', async () => {
  const inventory: DeviceInventoryRow[] = [{ id: 'device-1', tenant_id: 'tenant-1', device_key: 'WAPI-ABC' }];
  const reader: DeviceUsageReader = { read: async () => queueCounts, close: async () => {} };
  const db = fakePool();
  await collectDeviceUsage(db.pool, { sessionRoot: '/sessions', inventory: async () => inventory, reader, measureSession: async () => 10 });
  const insert = db.calls.find((call) => call.sql.includes('INSERT INTO device_usage_hourly'))!;
  assert.deepEqual(insert.values?.slice(4), [4, 2, 1, 3, 5]);
  assert.equal(db.calls.some((call) => call.sql.includes('DELETE FROM device_usage_hourly')), true);

  const failing = fakePool((sql) => { if (sql.includes('INSERT INTO device_usage_hourly')) throw new Error('db unavailable'); return { rows: [] }; });
  await assert.rejects(() => collectDeviceUsage(failing.pool, {
    sessionRoot: '/sessions', inventory: async () => inventory, reader, measureSession: async () => 10,
  }), /db unavailable/);
  assert.equal(failing.calls.at(-1)?.sql, 'ROLLBACK');
  assert.equal(failing.wasReleased(), true);
});

test('device usage history converts nullable database values and limits requested history', async () => {
  const now = new Date('2026-10-18T12:00:00.000Z');
  const db = fakePool((sql) => sql.includes('FROM device_usage_hourly') ? { rows: [{
    bucket_start: new Date('2026-10-18T11:00:00.000Z'), tenant_id: 'tenant-1', device_id: 'device-1',
    session_storage_bytes: '4096', queue_waiting_count: null, queue_active_count: 2,
    queue_delayed_count: 0, queue_failed_count: 1, dead_letter_count: 0, sampled_at: now,
  }] } : { rows: [] });
  const result = await readDeviceUsageHistory(db.pool, { from: new Date(now.getTime() - 3_600_000), to: now, tenantId: 'tenant-1' });
  assert.equal(result.buckets[0]?.sessionStorageBytes, 4096);
  assert.equal(result.buckets[0]?.waitingCount, null);
  assert.equal(result.buckets[0]?.activeCount, 2);
  assert.deepEqual(db.calls[0]?.values?.slice(2), ['tenant-1']);
  await assert.rejects(() => readDeviceUsageHistory(db.pool, { from: now, to: now }), /Invalid device usage history range/);
  await assert.rejects(() => readDeviceUsageHistory(db.pool, { from: new Date(now.getTime() - 32 * 86_400_000), to: now }), /exceeds 31 days/);
});

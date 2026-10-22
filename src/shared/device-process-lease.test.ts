import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { acquireDeviceProcessLease } from './device-process-lease';

function fakePool() {
  const held = new Set<string>();
  const pool = {
    async connect() {
      let key = '';
      let released = false;
      return {
        async query(text: string, values?: unknown[]) {
          key = String(values?.[0] ?? '');
          if (text.includes('pg_try_advisory_lock')) {
            const acquired = !held.has(key);
            if (acquired) held.add(key);
            return { rows: [{ acquired }] };
          }
          if (text.includes('pg_advisory_unlock')) {
            const existed = held.delete(key);
            return { rows: [{ pg_advisory_unlock: existed }] };
          }
          throw new Error(`Unexpected SQL: ${text}`);
        },
        release() { released = true; },
        wasReleased: () => released,
      };
    },
  };
  return { pool: pool as unknown as Pool, held };
}

test('a device process lease rejects another owner and becomes available after release', async () => {
  const { pool, held } = fakePool();
  const owner = await acquireDeviceProcessLease(pool, 'WAPI-1');
  await assert.rejects(acquireDeviceProcessLease(pool, 'wapi-1'), /already owns device/);
  assert.equal(held.size, 1);

  await owner.release();
  await owner.release();
  assert.equal(held.size, 0, 'release is idempotent');
  const nextOwner = await acquireDeviceProcessLease(pool, 'WAPI-1');
  await nextOwner.release();
});

test('a device process lease does not block a different device', async () => {
  const { pool } = fakePool();
  const first = await acquireDeviceProcessLease(pool, 'WAPI-1');
  const second = await acquireDeviceProcessLease(pool, 'WAPI-2');
  await Promise.all([first.release(), second.release()]);
});

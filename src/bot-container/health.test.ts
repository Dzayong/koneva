import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getHealthReport } from './health';
import type { ConnectionState } from './types';

function fakeRedis(ok: boolean) {
  return {
    ping: async () => {
      if (!ok) throw new Error('connection refused');
      return 'PONG';
    },
  } as unknown as import('ioredis').default;
}

function state(status: ConnectionState['status']): ConnectionState {
  return { botId: 'WAPI-TEST01', status, reconnectAttempt: 0 };
}

test('healthy when db, redis, and whatsapp are all fine', async () => {
  const report = await getHealthReport(fakeRedis(true), state('online'), async () => ({ rows: [{ '?column?': 1 }] }));
  assert.equal(report.status, 'healthy');
  assert.deepEqual(report.dependencies, { db: true, redis: true, whatsapp: true });
  assert.equal(report.detail, undefined);
});

test('degraded (not unhealthy) when only whatsapp is not connected yet', async () => {
  const report = await getHealthReport(fakeRedis(true), state('qr_pending'), async () => ({ rows: [{ '?column?': 1 }] }));
  assert.equal(report.status, 'degraded');
  assert.equal(report.dependencies.whatsapp, false);
  assert.equal(report.dependencies.db, true);
});

test('unhealthy when redis is unreachable', async () => {
  const report = await getHealthReport(fakeRedis(false), state('online'));
  assert.equal(report.status, 'unhealthy');
  assert.equal(report.dependencies.redis, false);
  assert.ok(report.detail?.redis);
});

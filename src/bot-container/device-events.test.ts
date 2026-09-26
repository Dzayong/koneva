import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Logger } from 'winston';
import { DeviceStatusNotifier, notifiableStatus } from './device-events';
import type { QueryFn } from './health-score';
import type { ConnectionState } from './types';
import type { WebhookPayload } from './webhook';

const silent = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger;
const st = (status: ConnectionState['status'], extra: Partial<ConnectionState> = {}): ConnectionState =>
  ({ botId: 'WAPI-1', status, reconnectAttempt: 0, ...extra });

function harness(initialDbStatus: string) {
  const inserts: unknown[][] = [];
  const hooks: WebhookPayload[] = [];
  const queryFn: QueryFn = async (sql, params) => {
    if (sql.startsWith('SELECT id, tenant_id, status')) return { rows: [{ id: 'dev-1', tenant_id: 'ten-1', status: initialDbStatus }] };
    if (sql.includes('INSERT INTO device_events')) inserts.push(params ?? []);
    return { rows: [] };
  };
  const notifier = new DeviceStatusNotifier('WAPI-1', queryFn, silent, async (_tenant, payload) => { hooks.push(payload); });
  return { notifier, inserts, hooks };
}

test('only settled states are notifiable', () => {
  assert.equal(notifiableStatus(st('reconnecting')), undefined);
  assert.equal(notifiableStatus(st('qr_pending')), undefined);
  assert.equal(notifiableStatus(st('banned')), 'banned');
});

test('a ban is recorded and sent as device.status_changed with the reason and code', async () => {
  const { notifier, inserts, hooks } = harness('online');
  await notifier.init();
  await notifier.handle(st('banned', { lastDisconnectReason: 'forbidden_403', disconnectCode: 403 }));

  assert.equal(hooks.length, 1);
  assert.equal(hooks[0]?.event, 'device.status_changed');
  assert.equal(hooks[0]?.status, 'banned');
  assert.equal(hooks[0]?.previous_status, 'online');
  assert.equal(hooks[0]?.reason, 'forbidden_403');
  assert.equal(hooks[0]?.code, 403);
  assert.deepEqual(inserts[0], ['dev-1', 'ten-1', 'WAPI-1', 'banned', 'online', 'forbidden_403', 403]);
});

test('a restart that lands on the stored status is not a change, and repeats are deduplicated', async () => {
  const { notifier, hooks } = harness('online');
  await notifier.init();
  await notifier.handle(st('online'));
  await notifier.handle(st('reconnecting'));
  await notifier.handle(st('online'));
  assert.equal(hooks.length, 0);

  await notifier.handle(st('offline', { lastDisconnectReason: 'Connection was lost' }));
  await notifier.handle(st('offline'));
  assert.equal(hooks.length, 1);
  await notifier.handle(st('online'));
  assert.equal(hooks.length, 2);
  assert.equal(hooks[1]?.reason, undefined);
});

test('a failing webhook or database never throws into the connection handler', async () => {
  const notifier = new DeviceStatusNotifier('WAPI-1',
    async (sql) => { if (sql.startsWith('SELECT')) return { rows: [{ id: 'd', tenant_id: 't', status: 'online' }] }; throw new Error('db down'); },
    silent, async () => { throw new Error('hook down'); });
  await notifier.init();
  await assert.doesNotReject(() => notifier.handle(st('logged_out')));
});

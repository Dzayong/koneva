import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import pool from '../shared/database/connection';
import { assertCsInboxAccess } from './services/inbox-access.service';
import { resolveDeviceGrants, setMemberDevices } from './services/team.service';
import { ServiceError } from './services/service-error';

const database = pool as unknown as { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }> };
const originalQuery = database.query;
afterEach(() => { database.query = originalQuery; });
const errorCode = (code: string) => (error: unknown) => error instanceof ServiceError && error.code === code;

for (const resource of ['device', 'message', 'media'] as const) {
  test(`CS ${resource} access rechecks grants after revocation`, async () => {
    let granted = true;
    let calls = 0;
    database.query = async (_sql, values) => {
      calls++;
      assert.deepEqual(values, ['tenant-a', 'cs-a', 'target']);
      return { rows: granted ? [{ id: 'device-a' }] : [] };
    };
    await assertCsInboxAccess('tenant-a', 'cs-a', resource, 'target');
    granted = false;
    await assert.rejects(assertCsInboxAccess('tenant-a', 'cs-a', resource, 'target'), errorCode('DEVICE_ACCESS_DENIED'));
    assert.equal(calls, 2);
  });
}

test('missing, deleted or foreign device selection is rejected, not partially granted', async () => {
  database.query = async (_sql, values) => {
    assert.deepEqual(values, ['tenant-a', ['own', 'foreign']]);
    return { rows: [{ id: 'own-id' }] };
  };
  await assert.rejects(resolveDeviceGrants('tenant-a', ['own', 'foreign', 'own']), errorCode('INVALID_DEVICE_GRANT'));
});

test('only owner can change device access; unauthorized attempts never query DB', async () => {
  database.query = async () => { throw new Error('must not query'); };
  for (const role of ['cs', 'developer', 'admin', 'viewer'] as const) {
    await assert.rejects(setMemberDevices('tenant-a', { userId: 'actor', role }, 'cs-a', ['device']), errorCode('FORBIDDEN'));
  }
});

test('owner can revoke every device without deleting CS membership', async () => {
  database.query = async (_sql, values) => {
    assert.deepEqual(values, ['tenant-a', 'cs-a', []]);
    return { rows: [{ user_id: 'cs-a' }], rowCount: 1 };
  };
  await setMemberDevices('tenant-a', { userId: 'owner', role: 'owner' }, 'cs-a', []);
});

test('a non-CS or absent member cannot receive CS grants', async () => {
  database.query = async () => ({ rows: [], rowCount: 0 });
  await assert.rejects(setMemberDevices('tenant-a', { userId: 'owner', role: 'owner' }, 'not-cs', []), errorCode('CS_NOT_FOUND'));
});

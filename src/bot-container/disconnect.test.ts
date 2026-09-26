import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyDisconnect } from './disconnect';

test('401 means logged out and 403 means the account was refused (suspected ban); neither reconnects', () => {
  assert.deepEqual(classifyDisconnect(401), { reconnect: false, status: 'logged_out', reason: 'logged_out' });
  assert.deepEqual(classifyDisconnect(403), { reconnect: false, status: 'banned', reason: 'forbidden_403' });
});

test('unusable sessions stop instead of looping: replaced, bad session, multidevice mismatch', () => {
  for (const [code, reason] of [[440, 'connection_replaced'], [500, 'bad_session'], [411, 'multidevice_mismatch']] as const) {
    const c = classifyDisconnect(code);
    assert.equal(c.reconnect, false);
    assert.equal(c.status, 'error');
    assert.equal(c.reason, reason);
  }
});

test('network-style closes are retried, including the 515 restart that follows a QR scan', () => {
  for (const code of [408, 428, 503, 515, undefined]) {
    assert.equal(classifyDisconnect(code).reconnect, true, `code ${code}`);
  }
});

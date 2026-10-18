import test from 'node:test';
import assert from 'node:assert/strict';
import { recordSystemNotification } from './system-notification-outbox';

test('system notifications are sanitized and inserted only when an operator recipient is enabled', async () => {
  let sql = '';
  let values: unknown[] = [];
  const db = {
    query: async (statement: string, parameters: unknown[]) => {
      sql = statement;
      values = parameters;
      return { rowCount: 1, rows: [] };
    },
  };
  await recordSystemNotification(db as never, 'signup.created:tenant-1', 'signup.created', '  Signup\nbaru\u0000 KONEVA  ');
  assert.match(sql, /notifications_enabled=true/);
  assert.match(sql, /notification_recipient_phone IS NOT NULL/);
  assert.match(sql, /ON CONFLICT\(event_key\) DO NOTHING/);
  assert.deepEqual(values, ['signup.created:tenant-1', 'signup.created', 'Signup baru KONEVA']);
});

test('system notification content is bounded before it reaches persistent storage', async () => {
  let values: unknown[] = [];
  const db = { query: async (_statement: string, parameters: unknown[]) => { values = parameters; return { rowCount: 1, rows: [] }; } };
  await recordSystemNotification(db as never, 'x'.repeat(200), 'invoice.paid', 'a'.repeat(1200));
  assert.equal((values[0] as string).length, 160);
  assert.equal((values[2] as string).length, 1000);
});

test('empty notification content is ignored', async () => {
  let called = false;
  const db = { query: async () => { called = true; return { rowCount: 1, rows: [] }; } };
  await recordSystemNotification(db as never, 'event-1', 'device.status_changed', '\n\u0000  ');
  assert.equal(called, false);
});

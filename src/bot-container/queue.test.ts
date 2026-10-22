import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WAMessageStatus, type WAMessageUpdate } from '@whiskeysockets/baileys';
import type { Logger } from 'winston';
import { queueName, deadLetterQueueName, handleReceiptUpdate, failStuckSendingMessages } from './queue';
import { processJob } from './queue';
import { UnrecoverableError, type Job } from 'bullmq';
import type { QueryFn } from './health-score';
import type { WebhookPayload } from './webhook';

// BullMQ queue names cannot contain ':', so the "queue:messages:{device_key}"
// convention is applied via the Redis key prefix instead of the name itself.
test('queueName is the bare device key (colon-free, valid as a BullMQ name)', () => {
  assert.equal(queueName('WAPI-TEST01'), 'WAPI-TEST01');
});

test('deadLetterQueueName suffixes the device key with -dead', () => {
  assert.equal(deadLetterQueueName('WAPI-TEST01'), 'WAPI-TEST01-dead');
});

test('an expired queue job is failed without checking or calling the WhatsApp transport', async () => {
  let statusUpdate = '';
  let transportTouched = false;
  const queryFn: QueryFn = async (sql) => {
    if (sql.startsWith('SELECT id, tenant_id, device_id')) return { rows: [{
      id: 'expired-1', tenant_id: 'tenant-1', device_id: 'device-1', device_key: 'WAPI-1',
      to_number: '6281234567890', content: 'lama', media_url: null, type: 'text', status: 'queued',
      whatsapp_message_id: null, error_message: null, priority: 'normal', quota_exempt: false,
      system_otp: false, system_notification: false, reply_to_message_id: null,
      created_at: new Date(Date.now() - 60 * 60_000), queue_started_at: new Date(Date.now() - 16 * 60_000),
    }] };
    if (sql.startsWith('UPDATE messages')) statusUpdate = sql;
    return { rows: [] };
  };
  const job = { data: { messageId: 'expired-1' }, attemptsMade: 0, opts: { attempts: 3 } } as unknown as Job<{ messageId: string }>;
  await assert.rejects(processJob(job, 'WAPI-1', {
    getSocket: () => { transportTouched = true; return undefined; },
    isConnected: () => { transportTouched = true; return true; },
    now: () => new Date(),
  }, undefined as never, queryFn, testLogger()), (error) => error instanceof UnrecoverableError);
  assert.match(statusUpdate, /status = \$2/);
  assert.equal(transportTouched, false);
});

test('a retry for a message with an existing send claim never touches WhatsApp again', async () => {
  let transportTouched = false;
  const queryFn: QueryFn = async (sql) => {
    assert.match(sql, /SELECT id, tenant_id, device_id/);
    return { rows: [{
      id: 'uncertain-1', tenant_id: 'tenant-1', device_id: 'device-1', device_key: 'WAPI-1',
      to_number: '6281234567890', content: 'uji', media_url: null, type: 'text', status: 'sending',
      whatsapp_message_id: null, error_message: null, priority: 'normal', quota_exempt: false,
      system_otp: false, system_notification: false, reply_to_message_id: null,
      created_at: new Date(), queue_started_at: new Date(), send_started_at: new Date(),
    }] };
  };
  const job = { data: { messageId: 'uncertain-1' }, attemptsMade: 1, opts: { attempts: 3 } } as unknown as Job<{ messageId: string }>;
  await processJob(job, 'WAPI-1', {
    getSocket: () => { transportTouched = true; return undefined; },
    isConnected: () => { transportTouched = true; return true; },
  }, undefined as never, queryFn, testLogger());
  assert.equal(transportTouched, false);
});

test('stale send claims close as uncertain and are never requeued', async () => {
  const updates: string[] = [];
  const hooks: WebhookPayload[] = [];
  const queryFn: QueryFn = async (sql, params) => {
    if (sql.startsWith('SELECT id, tenant_id')) return { rows: [
      { id: 'stuck-1', tenant_id: 'tenant-1', device_key: 'WAPI-1', to_number: '6281', system_otp: false, system_notification: false },
    ] };
    if (sql.startsWith('UPDATE messages')) { updates.push(sql); assert.deepEqual(params, ['stuck-1']); return { rows: [{ id: 'stuck-1' }] }; }
    return { rows: [] };
  };
  const failed = await failStuckSendingMessages('WAPI-1', queryFn, testLogger(), async (_tenant, payload) => { hooks.push(payload); });
  assert.equal(failed, 1);
  assert.match(updates[0]!, /status = 'failed', error_message = 'delivery_uncertain'/);
  assert.doesNotMatch(updates[0]!, /send_started_at = NULL/);
  assert.match(updates[0]!, /WHERE id = \$1 AND status = 'sending'/);
  assert.equal(hooks[0]?.reason, 'delivery_uncertain');
});

function receipt(status: NonNullable<WAMessageUpdate['update']['status']>): WAMessageUpdate {
  return {
    key: { id: 'wamid-read-1', remoteJid: '6281234567890@s.whatsapp.net', fromMe: true },
    update: { status },
  };
}

function testLogger(): Logger {
  const noop = () => undefined;
  return { debug: noop, info: noop, warn: noop, error: noop } as unknown as Logger;
}

for (const status of [WAMessageStatus.READ, WAMessageStatus.PLAYED]) {
  test(`receipt status ${status} updates read_at and dispatches message.read`, async () => {
    const queries: Array<{ text: string; params?: unknown[] }> = [];
    const queryFn: QueryFn = async (text, params) => {
      queries.push({ text, ...(params ? { params } : {}) });
      return { rows: [{
        id: 'message-1', tenant_id: 'tenant-1', device_key: 'WAPI-TEST01',
        to_number: '6281234567890',
      }] };
    };
    let webhook: { tenantId: string; payload: WebhookPayload } | undefined;

    await handleReceiptUpdate(receipt(status), queryFn, testLogger(), async (tenantId, payload) => {
      webhook = { tenantId, payload };
    });

    assert.match(queries[0]!.text, /SET status = \$1, sent_at = COALESCE\(sent_at, now\(\)\), delivered_at = COALESCE\(delivered_at, now\(\)\), read_at = COALESCE\(read_at, now\(\)\)/);
    assert.deepEqual(queries[0]!.params, [
      'read', 'wamid-read-1', ['queued', 'sending', 'sent', 'delivered'],
    ]);
    assert.equal(webhook?.tenantId, 'tenant-1');
    assert.equal(webhook?.payload.event, 'message.read');
    assert.equal(webhook?.payload.status, 'read');
  });
}

test('delivery receipt updates delivered_at and dispatches message.delivered', async () => {
  const queryFn: QueryFn = async (text, params) => {
    assert.match(text, /sent_at = COALESCE\(sent_at, now\(\)\), delivered_at = COALESCE\(delivered_at, now\(\)\)/);
    assert.deepEqual(params, ['delivered', 'wamid-read-1', ['queued', 'sending', 'sent']]);
    return { rows: [{
      id: 'message-1', tenant_id: 'tenant-1', device_key: 'WAPI-TEST01',
      to_number: '6281234567890',
    }] };
  };
  let event: string | undefined;

  await handleReceiptUpdate(
    receipt(WAMessageStatus.DELIVERY_ACK),
    queryFn,
    testLogger(),
    async (_tenantId, payload) => { event = payload.event; },
  );

  assert.equal(event, 'message.delivered');
});

test('server acknowledgement is the first point a message becomes sent', async () => {
  let sql = '';
  let params: unknown[] = [];
  let event: string | undefined;
  const queryFn: QueryFn = async (text, values) => {
    sql = text;
    params = values ?? [];
    return { rows: [{
      id: 'message-1', tenant_id: 'tenant-1', device_key: 'WAPI-TEST01',
      to_number: '6281234567890', type: 'text',
    }] };
  };

  await handleReceiptUpdate(
    receipt(WAMessageStatus.SERVER_ACK),
    queryFn,
    testLogger(),
    async (_tenantId, payload) => { event = payload.event; },
  );

  assert.match(sql, /status = ANY\(\$3::varchar\[\]\) OR \(status = 'failed' AND error_message = 'delivery_uncertain'\)/);
  assert.match(sql, /sent_at = COALESCE\(sent_at, now\(\)\)/);
  assert.deepEqual(params, ['sent', 'wamid-read-1', ['sending']]);
  assert.equal(event, 'message.sent');
});

test('late WhatsApp acknowledgement reconciles an uncertain result to sent', async () => {
  let sql = '';
  let event: string | undefined;
  const queryFn: QueryFn = async (text) => {
    sql = text;
    return { rows: [{
      id: 'message-1', tenant_id: 'tenant-1', device_key: 'WAPI-TEST01',
      to_number: '6281234567890', type: 'text',
    }] };
  };

  await handleReceiptUpdate(
    receipt(WAMessageStatus.SERVER_ACK),
    queryFn,
    testLogger(),
    async (_tenantId, payload) => { event = payload.event; },
  );

  assert.match(sql, /status = 'failed' AND error_message = 'delivery_uncertain'/);
  assert.match(sql, /error_message = NULL, send_started_at = NULL/);
  assert.equal(event, 'message.sent');
});

test('system OTP delivery receipts update status without exposing the recipient to tenant webhooks', async () => {
  let query = '';
  let dispatched = false;
  const queryFn: QueryFn = async (sql) => {
    query = sql;
    return { rows: [{
      id: 'otp-1', tenant_id: 'platform', device_key: 'WAPI-OTP',
      to_number: '[redacted]', system_otp: true,
    }] };
  };
  await handleReceiptUpdate(receipt(WAMessageStatus.DELIVERY_ACK), queryFn, testLogger(), async () => { dispatched = true; });
  assert.match(query, /COALESCE\(system_otp, false\) AS system_otp/);
  assert.equal(dispatched, false);
});

import { failStuckMessages } from './queue';

test('queued messages without a live job are failed and reported; live ones are left alone', async () => {
  const updates: unknown[][] = [];
  const hooks: WebhookPayload[] = [];
  const queryFn: QueryFn = async (sql, params) => {
    if (sql.startsWith('SELECT id, tenant_id')) {
      return { rows: [
        { id: 'lost-1', tenant_id: 't1', device_key: 'WAPI-1', to_number: '6281', system_otp: false },
        { id: 'lost-otp', tenant_id: 'platform', device_key: 'WAPI-1', to_number: '6283', system_otp: true },
        { id: 'delayed-1', tenant_id: 't1', device_key: 'WAPI-1', to_number: '6282', system_otp: false },
      ] };
    }
    if (sql.includes("SET status = 'failed'")) { updates.push(params ?? []); return { rows: [{ id: params?.[0] }] }; }
    return { rows: [] };
  };

  const failed = await failStuckMessages('WAPI-1', new Set(['delayed-1']), queryFn, testLogger(), async (_t, payload) => { hooks.push(payload); });

  assert.equal(failed, 2);
  assert.deepEqual(updates, [['lost-1'], ['lost-otp']]);
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0]?.event, 'message.failed');
  assert.equal(hooks[0]?.message_id, 'lost-1');
  assert.equal(hooks[0]?.reason, 'lost_in_queue');
});

test('a message another worker already finished is not failed or reported twice', async () => {
  const hooks: WebhookPayload[] = [];
  const queryFn: QueryFn = async (sql) => {
    if (sql.startsWith('SELECT id, tenant_id')) return { rows: [{ id: 'm1', tenant_id: 't1', device_key: 'WAPI-1', to_number: '6281' }] };
    return { rows: [] }; // UPDATE ... WHERE status='queued' matched nothing
  };
  assert.equal(await failStuckMessages('WAPI-1', new Set(), queryFn, testLogger(), async (_t, p) => { hooks.push(p); }), 0);
  assert.equal(hooks.length, 0);
});

import { hasRecentInbound } from './queue';

test('someone who wrote in the last 24h counts as a reply, normalising the number', async () => {
  let params: unknown[] = [];
  const yes: QueryFn = async (_sql, p) => { params = p ?? []; return { rows: [{ '?column?': 1 }] }; };
  assert.equal(await hasRecentInbound('dev-1', '+62 858-6203-3524', yes), true);
  assert.equal(params[1], '6285862033524');
  assert.equal(await hasRecentInbound('dev-1', '628123', async () => ({ rows: [] })), false);
  assert.equal(await hasRecentInbound('dev-1', '', yes), false);
});

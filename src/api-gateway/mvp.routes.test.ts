import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { Request, Response } from 'express';
import pool from '../shared/database/connection';
import type { TenantContext } from '../shared/types/api';
import { ServiceError } from './services/service-error';
import { listContacts, parseContactsCsv } from './routes/contact.routes';
import { analyticsOverview } from './routes/analytics.routes';
import { listAutoReplyRules } from './routes/auto-reply.routes';
import { dashboardStats } from './routes/stats.routes';
import { broadcastSchema } from './routes/broadcast.routes';
import { scheduledCampaignSchema } from './routes/campaign.routes';
import { listMessages, retryMessage } from './services/message.service';
import { renderMessageTemplate, templateVariables } from '../shared/utils/message-template';

type Query = (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
const database = pool as unknown as { query: Query };
const originalQuery = database.query;
afterEach(() => { database.query = originalQuery; });

const tenant: TenantContext = {
  id: '8fca6485-b3df-47c2-b87e-0c235c0a4bb9', name: 'Test', email: null,
  webhook_url: null, webhook_secret: null, max_devices: 3,
  quota_messages: 1000, used_messages: 0, status: 'active',
};
function response(): Response & { payload?: unknown } {
  const result = { payload: undefined as unknown, json(payload: unknown) { this.payload = payload; return this; } };
  return result as unknown as Response & { payload?: unknown };
}

test('CSV contact import handles quoted values and tags', () => {
  const contacts = parseContactsCsv('phone_number,name,tags,notes\n628123456789,"Budi, Sales",vip|jakarta,"Follow, up"');
  assert.deepEqual(contacts, [{ phone_number: '628123456789', name: 'Budi, Sales', tags: ['vip', 'jakarta'], notes: 'Follow, up' }]);
});

test('CSV contact import rejects rows without valid phone numbers', () => {
  assert.throws(() => parseContactsCsv('phone_number,name\nabc,Bad'), (error) =>
    error instanceof ServiceError && error.code === 'INVALID_CSV');
});

test('message templates render spintax and named variables', () => {
  const rendered = renderMessageTemplate('{Halo|Hi} {nama}, tanggal {tanggal}', { nama: 'Ayu', tanggal: '25 September' }, () => 0.99);
  assert.equal(rendered, 'Hi Ayu, tanggal 25 September');
  assert.deepEqual(templateVariables('{Halo|Hi} {nama} {tanggal} {nama}'), ['nama', 'tanggal']);
});

test('contact search matches individual tags with ILIKE', async () => {
  let sql = '';
  let values: unknown[] | undefined;
  database.query = async (text, parameters) => { sql = text; values = parameters; return { rows: [] }; };
  const reply = response();
  await listContacts({ tenant, validated: { query: { search: 'vip', limit: 20, offset: 0 } } } as Request, reply);
  assert.match(sql, /unnest\(tags\).*ILIKE/s);
  assert.deepEqual(values, [tenant.id, '%vip%', 20, 0]);
});

test('analytics overview normalizes PostgreSQL numeric strings', async () => {
  let call = 0;
  database.query = async () => ({ rows: [call++ === 0
    ? { total_messages: '12', delivery_rate: '87.50', avg_response_time: '4.25' }
    : { active_devices: '3' }] });
  const reply = response();
  await analyticsOverview({ tenant } as Request, reply);
  assert.deepEqual(reply.payload, { success: true, data: {
    total_messages: 12, delivery_rate: 87.5, avg_response_time: 4.25, active_devices: 3,
  } });
});

test('auto-reply rule listing is tenant scoped and supports device filter', async () => {
  let values: unknown[] | undefined;
  database.query = async (_text, parameters) => { values = parameters; return { rows: [{ id: 'rule-1' }] }; };
  const reply = response();
  await listAutoReplyRules({
    tenant, validated: { query: { device_key: 'WAPI-1', limit: 20, offset: 0 } },
  } as Request, reply);
  assert.deepEqual(values, [tenant.id, 'WAPI-1', 20, 0]);
  assert.deepEqual(reply.payload, {
    success: true, data: [{ id: 'rule-1' }],
    pagination: { total: 0, limit: 20, offset: 0, has_more: false },
  });
});

test('dashboard stats returns normalized numeric aggregates', async () => {
  let call = 0;
  const rows = [
    { total_messages: '10', messages_today: '2', delivery_rate: '90.50' },
    { total_devices: '3', active_devices: '2' },
    { total_contacts: '7' },
  ];
  database.query = async () => ({ rows: [rows[call++]!] });
  const reply = response();
  await dashboardStats({ tenant } as Request, reply);
  assert.deepEqual(reply.payload, { success: true, data: {
    total_messages: 10, messages_today: 2, delivery_rate: 90.5,
    total_devices: 3, active_devices: 2, total_contacts: 7,
  } });
});

test('broadcast contract accepts snake_case device key and recipient list', () => {
  assert.equal(broadcastSchema.safeParse({
    device_key: 'WAPI-1', recipients: ['628123456789'], message: 'Halo',
  }).success, true);
  assert.equal(broadcastSchema.safeParse({
    deviceKey: 'WAPI-1', recipients: [], message: 'Halo',
  }).success, false);
});

test('scheduled campaign requires a future time, a group and message content', () => {
  const base = {
    name: 'Promo', group_id: '8fca6485-b3df-47c2-b87e-0c235c0a4bb9', device_key: 'WAPI-1',
    scheduled_at: new Date(Date.now() + 10 * 60_000).toISOString(), message: 'Halo {{nama}}',
  };
  assert.equal(scheduledCampaignSchema.safeParse(base).success, true);
  assert.equal(scheduledCampaignSchema.safeParse({ ...base, scheduled_at: new Date(Date.now() + 60_000).toISOString() }).success, false);
  assert.equal(scheduledCampaignSchema.safeParse({ ...base, message: ' ' }).success, false);
});

test('retry rejects a tenant-owned message that is not failed or blocked', async () => {
  database.query = async (text: string) => {
    if (text.includes('FROM subscriptions')) return { rows: [] }; // older workspace: no plan row, allowed
    if (text.includes('AS device_status')) return { rows: [{ device_status: 'online', to_number: '6281234567890', quota_exempt: false }] };
    if (text.includes('FROM recipient_preferences')) return { rows: [{ status: 'opted_in' }] };
    if (text.startsWith('UPDATE messages')) return { rows: [] }; // not failed/blocked: nothing updated
    return { rows: [{ status: 'sent' }] };
  };
  await assert.rejects(() => retryMessage(tenant.id, '00000000-0000-0000-0000-000000000001'),
    (error) => error instanceof ServiceError && error.code === 'MESSAGE_NOT_RETRYABLE');
});

test('message list applies direction and search and returns standard pagination', async () => {
  const sql: string[] = [];
  let call = 0;
  database.query = async (text) => {
    sql.push(text);
    return call++ === 0 ? { rows: [{ total: 21 }] } : { rows: [{ id: 'message-1' }] };
  };
  const result = await listMessages(tenant.id, {
    direction: 'inbound', created_today: true, search: 'halo', limit: 20, offset: 0,
  });
  assert.match(sql[0]!, /direction = \$2/);
  assert.match(sql[0]!, /date_trunc\('day', now\(\) AT TIME ZONE 'Asia\/Jakarta'\)/);
  assert.match(sql[0]!, /interval '1 day'/);
  assert.match(sql[0]!, /content ILIKE \$3/);
  assert.deepEqual(result.pagination, { total: 21, limit: 20, offset: 0, has_more: true });
  assert.equal(result.success, true);
});

test('message list can be scoped to one exact WhatsApp group conversation', async () => {
  const sql: string[] = [];
  let call = 0;
  database.query = async (text) => { sql.push(text); return call++ === 0 ? { rows: [{ total: 1 }] } : { rows: [{ id: 'group-message' }] }; };
  const result = await listMessages(tenant.id, { device_key: 'WAPI-TEST', chat_jid: '120363000000-123456@g.us', limit: 100, offset: 0 });
  assert.match(sql[0]!, /device_key = \$2/);
  assert.match(sql[0]!, /chat_jid = \$3/);
  assert.deepEqual(result.data.map((message) => message.id), ['group-message']);
});

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { Request, Response } from 'express';
import pool from '../shared/database/connection';
import type { TenantContext } from '../shared/types/api';
import { getTenant, updateTenant, updateTenantSchema } from './routes/tenant.routes';

const tenant = {
  id: '8fca6485-b3df-47c2-b87e-0c235c0a4bb9',
  name: 'Test tenant', email: null, webhook_url: null,
  webhook_secret: null, max_devices: 2, quota_messages: 1_000, used_messages: 10,
  status: 'active',
} satisfies TenantContext;

type Query = (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
const database = pool as unknown as { query: Query };
const originalQuery = database.query;
afterEach(() => { database.query = originalQuery; });

function request(body?: unknown): Request {
  return { tenant, validated: { body } } as Request;
}

function response(): Response & { statusCode: number; payload?: unknown } {
  const result = {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.payload = payload; return this; },
  };
  return result as unknown as Response & { statusCode: number; payload?: unknown };
}

test('GET tenant returns the authenticated tenant public fields', async () => {
  const row = { ...tenant, created_at: new Date(), updated_at: new Date() };
  database.query = async (_text, values) => {
    assert.deepEqual(values, [tenant.id]);
    return { rows: [row] };
  };
  const reply = response();

  await getTenant(request(), reply);

  assert.deepEqual(reply.payload, { success: true, data: row });
});

test('PATCH tenant updates only the authenticated tenant webhook URL', async () => {
  const webhookUrl = 'https://example.com/wa-webhook';
  const row = { ...tenant, webhook_url: webhookUrl };
  database.query = async (text, values) => {
    assert.match(text, /UPDATE tenants SET webhook_url/);
    assert.deepEqual(values, [webhookUrl, tenant.id]);
    return { rows: [row] };
  };
  const reply = response();

  await updateTenant(request({ webhook_url: webhookUrl }), reply);

  assert.deepEqual(reply.payload, { success: true, data: row });
});

test('PATCH tenant accepts only HTTP(S) webhook URLs or null', () => {
  assert.equal(updateTenantSchema.safeParse({ webhook_url: 'https://example.com/hook' }).success, true);
  assert.equal(updateTenantSchema.safeParse({ webhook_url: null }).success, true);
  assert.equal(updateTenantSchema.safeParse({ webhook_url: 'javascript:alert(1)' }).success, false);
  assert.equal(updateTenantSchema.safeParse({ webhook_url: 'not-a-url' }).success, false);
});

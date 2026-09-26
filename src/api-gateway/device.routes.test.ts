import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { Request, Response } from 'express';
import pool from '../shared/database/connection';
import type { TenantContext } from '../shared/types/api';
import { createDevice, deleteDevice, getDeviceQr } from './routes/device.routes';

const tenant: TenantContext = {
  id: '8fca6485-b3df-47c2-b87e-0c235c0a4bb9',
  name: 'Test tenant', email: null, api_key: 'tenant-key', webhook_url: null,
  webhook_secret: null, max_devices: 2, quota_messages: 1_000, used_messages: 0,
  status: 'active',
};

type Query = (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
const database = pool as unknown as { query: Query };
const originalQuery = database.query;
const originalFetch = globalThis.fetch;

beforeEach(() => { database.query = async () => ({ rows: [] }); });
afterEach(() => {
  database.query = originalQuery;
  globalThis.fetch = originalFetch;
});

function request(validated: Request['validated']): Request {
  return { tenant, validated } as Request;
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

test('create device uses the authenticated tenant rather than request input', async () => {
  database.query = async () => ({ rows: [{ count: 0 }] });
  let managerBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    managerBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ success: true, device_key: 'WAPI-NEW' }, { status: 201 });
  };
  const reply = response();

  await createDevice(request({ body: { phone_number: '+6281234567890', label: 'Sales' } }), reply);

  assert.equal(reply.statusCode, 201);
  assert.equal(managerBody?.tenant_id, tenant.id);
  assert.equal((reply.payload as { data: { device_key: string } }).data.device_key, 'WAPI-NEW');
});

test('create device enforces max_devices before calling Device Manager', async () => {
  database.query = async () => ({ rows: [{ count: tenant.max_devices }] });
  let managerCalled = false;
  globalThis.fetch = async () => { managerCalled = true; return Response.json({}); };
  const reply = response();

  await createDevice(request({ body: {} }), reply);

  assert.equal(reply.statusCode, 429);
  assert.equal(managerCalled, false);
});

test('delete device rejects a device not owned by the authenticated tenant', async () => {
  database.query = async (_text, values) => {
    assert.deepEqual(values, ['WAPI-OTHER', tenant.id]);
    return { rows: [] };
  };
  let managerCalled = false;
  globalThis.fetch = async () => { managerCalled = true; return new Response(null, { status: 204 }); };
  const reply = response();

  await deleteDevice(request({ params: { deviceKey: 'WAPI-OTHER' } }), reply);

  assert.equal(reply.statusCode, 404);
  assert.equal(managerCalled, false);
});

test('delete device removes an owned workload through Device Manager', async () => {
  database.query = async () => ({ rows: [{ id: 'device-id' }] });
  let managerMethod: string | undefined;
  globalThis.fetch = async (_input, init) => {
    managerMethod = init?.method;
    return new Response(null, { status: 204 });
  };
  const reply = response();

  await deleteDevice(request({ params: { deviceKey: 'WAPI-OWN' } }), reply);

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.payload, { success: true, data: null });
  assert.equal(managerMethod, 'DELETE');
});

test('QR lookup returns 200-style payload even when a QR code is unavailable', async () => {
  database.query = async () => ({ rows: [{
    device_key: 'WAPI-ONLINE', status: 'online', qr_code: null,
  }] });
  const reply = response();

  await getDeviceQr(request({ params: { deviceKey: 'WAPI-ONLINE' } }), reply);

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.payload, {
    success: true,
    data: {
      device_key: 'WAPI-ONLINE', status: 'online', qr_code: null, has_qr: false,
    },
    device_key: 'WAPI-ONLINE',
    status: 'online',
    qr_code: null,
    has_qr: false,
  });
});

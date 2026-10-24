import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import pool from '../shared/database/connection';
import { authorize, enforceDeviceKeyScope } from './middleware/auth';
import { sha256 } from './services/account.service';
import {
  KEY_SCOPES, assertScopesAllowed, createApiKey, newApiKey, resolveApiKey, rotateApiKey, revokeApiKey,
} from './services/apikey.service';
import { createKey, listKeys } from './routes/keys.routes';
import { ServiceError } from './services/service-error';

type Query = (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
const database = pool as unknown as { query: Query };
const originalQuery = database.query;
afterEach(() => { database.query = originalQuery; });

test('a new key is random, prefixed, and only its hash is meant for storage', () => {
  const a = newApiKey();
  assert.match(a.key, /^wgk_[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(a.key, newApiKey().key);
  assert.equal(a.hash, sha256(a.key));
  assert.equal(a.prefix, a.key.slice(0, 12));
});

test('keys can never carry key, team or billing management', () => {
  for (const reserved of ['keys:manage', 'team:manage', 'billing:manage', 'inbox:read', 'messages:reply']) {
    assert.equal((KEY_SCOPES as readonly string[]).includes(reserved), false, reserved);
    assert.throws(() => assertScopesAllowed([reserved], 'owner'), (e: unknown) => e instanceof ServiceError && e.code === 'INVALID_SCOPE');
  }
});

test('a person cannot grant a scope their own role lacks', () => {
  assert.deepEqual(assertScopesAllowed(['messages:read', 'devices:read'], 'viewer'), ['messages:read', 'devices:read']);
  assert.throws(() => assertScopesAllowed(['messages:send'], 'viewer'), (e: unknown) => e instanceof ServiceError && e.code === 'SCOPE_EXCEEDS_ROLE');
  assert.deepEqual(assertScopesAllowed(['devices:delete'], 'developer'), ['devices:delete']);
  assert.throws(() => assertScopesAllowed(['devices:delete'], 'viewer'), (e: unknown) => e instanceof ServiceError && e.code === 'SCOPE_EXCEEDS_ROLE');
  assert.throws(() => assertScopesAllowed(['audit:read'], 'developer'), (e: unknown) => e instanceof ServiceError && e.code === 'SCOPE_EXCEEDS_ROLE');
  assert.deepEqual(assertScopesAllowed(['messages:send', 'messages:send'], 'developer'), ['messages:send']);
});

test('creating a key stores the hash, not the key, and returns the key once', async () => {
  let stored: unknown[] = [];
  database.query = async (text, values) => {
    if (text.includes('COUNT(*)')) return { rows: [{ n: 2 }] };
    if (text.includes('INSERT INTO api_keys')) { stored = values ?? []; return { rows: [{ id: 'k1', name: 'CI', prefix: 'wgk_x', scopes: ['messages:send'], created_at: new Date(), last_used_at: null, expires_at: null, revoked_at: null }] }; }
    return { rows: [] };
  };
  const created = await createApiKey('t1', 'u1', 'developer', { name: 'CI', scopes: ['messages:send'] });
  assert.match(created.key, /^wgk_/);
  assert.equal(stored[3], sha256(created.key));
  assert.ok(!stored.includes(created.key));
});

test('a workspace cannot exceed its active key limit', async () => {
  database.query = async () => ({ rows: [{ n: 20 }] });
  await assert.rejects(() => createApiKey('t1', 'u1', 'owner', { name: 'x', scopes: ['messages:read'] }), (e: unknown) => e instanceof ServiceError && e.code === 'KEY_LIMIT');
});

test('resolveApiKey returns the tenant and scopes for a live key, and nothing otherwise', async () => {
  const row = { key_id: 'k1', scopes: ['messages:send'], last_used_at: new Date(), id: 't1', name: 'Acme', email: null, webhook_url: null, webhook_secret: null, max_devices: 1, quota_messages: 5, used_messages: 0, status: 'active' };
  database.query = async (_t, values) => { assert.equal(values?.[0], sha256('wgk_live')); return { rows: [row] }; };
  const ok = await resolveApiKey('wgk_live');
  assert.equal(ok?.tenant.id, 't1');
  assert.deepEqual(ok?.scopes, ['messages:send']);

  database.query = async () => ({ rows: [] });
  assert.equal(await resolveApiKey('wgk_revoked'), undefined);

  database.query = async () => ({ rows: [{ ...row, status: 'suspended' }] });
  assert.equal(await resolveApiKey('wgk_live'), undefined);
});

test('revoking an unknown or already revoked key is a 404', async () => {
  database.query = async () => ({ rows: [] });
  await assert.rejects(() => revokeApiKey('t1', 'k1'), (e: unknown) => e instanceof ServiceError && e.status === 404);
});

test('rotation issues a new key and lets the old one expire after the overlap', async () => {
  const updates: unknown[][] = [];
  const oldRow = { id: 'k1', name: 'CI', prefix: 'wgk_old', scopes: ['messages:send'], created_at: new Date(), last_used_at: null, expires_at: null, revoked_at: null };
  database.query = async (text, values) => {
    if (text.includes('FROM api_keys WHERE id')) return { rows: [oldRow] };
    if (text.includes('COUNT(*)')) return { rows: [{ n: 1 }] };
    if (text.includes('INSERT INTO api_keys')) return { rows: [{ ...oldRow, id: 'k2', prefix: 'wgk_new' }] };
    if (text.includes('LEAST(')) { updates.push(values ?? []); return { rows: [] }; }
    return { rows: [] };
  };
  const created = await rotateApiKey('t1', 'k1', 'u1', 'developer', 24);
  assert.equal(created.id, 'k2');
  assert.deepEqual(updates, [['k1', 24]]);
});

function fakeRes() {
  const r = { code: 200, body: undefined as unknown, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  return r as unknown as Response & { code: number; body: Record<string, unknown> };
}

test('API keys cannot create keys; a signed-in person can, and gets the key once', async () => {
  const asKey = { tenant: { id: 't1' }, actor: { kind: 'api_key', role: 'admin' }, validated: { body: { name: 'x', scopes: ['messages:read'] } } } as unknown as Request;
  await assert.rejects(() => createKey(asKey, fakeRes()), (e: unknown) => e instanceof ServiceError && e.status === 403);

  database.query = async (text) => text.includes('COUNT(*)') ? { rows: [{ n: 0 }] }
    : text.includes('INSERT') ? { rows: [{ id: 'k1', name: 'x', prefix: 'wgk_a', scopes: ['messages:read'], created_at: new Date(), last_used_at: null, expires_at: null, revoked_at: null }] } : { rows: [] };
  const asPerson = { tenant: { id: 't1' }, actor: { kind: 'user', userId: 'u1', email: 'e', role: 'developer' }, validated: { body: { name: 'x', scopes: ['messages:read'] } } } as unknown as Request;
  const res = fakeRes();
  await createKey(asPerson, res);
  assert.equal(res.code, 201);
  assert.match(String((res.body.data as { key: string }).key), /^wgk_/);
});

test('listing keys never returns the key or its hash', async () => {
  database.query = async () => ({ rows: [{ id: 'k1', name: 'CI', prefix: 'wgk_abc', scopes: ['messages:send'], created_at: new Date(), last_used_at: null, expires_at: null, revoked_at: null }] });
  const res = fakeRes();
  await listKeys({ tenant: { id: 't1' } } as unknown as Request, res);
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes('key_hash') && !/"key":/.test(text));
});

function callAuthorize(actor: unknown, method: string, path: string) {
  let status = 0; let nexted = false;
  const res = { status(c: number) { status = c; return this; }, json() { return this; } } as unknown as Response;
  authorize({ method, path, actor } as unknown as Request, res, (() => { nexted = true; }) as NextFunction);
  return { status, nexted };
}

test('a scoped key is limited to exactly its scopes, whatever the placeholder role says', () => {
  const sendOnly = { kind: 'api_key', role: 'viewer', scopes: ['messages:send'] };
  assert.equal(callAuthorize(sendOnly, 'POST', '/message/send').nexted, true);
  assert.equal(callAuthorize(sendOnly, 'GET', '/devices').status, 403);
  assert.equal(callAuthorize(sendOnly, 'GET', '/keys').status, 403);
  const readOnly = { kind: 'api_key', role: 'viewer', scopes: ['messages:read', 'devices:read'] };
  assert.equal(callAuthorize(readOnly, 'GET', '/messages').nexted, true);
  assert.equal(callAuthorize(readOnly, 'POST', '/message/send').status, 403);
});

test('a device-bound key cannot target another device or an unbound endpoint', async () => {
  const check = async (deviceKey: string, body: unknown, path = '/message/send') => {
    let status = 0; let nexted = false;
    const response = { status(code: number) { status = code; return this; }, json() { return this; } } as unknown as Response;
    await enforceDeviceKeyScope({ method: 'POST', actor: { kind: 'api_key', role: 'viewer', deviceKey }, tenant: { id: 't1' }, body, query: {}, params: {}, path } as unknown as Request,
      response, (() => { nexted = true; }) as NextFunction);
    return { status, nexted };
  };
  assert.equal((await check('WAPI-1', { device_key: 'WAPI-1' })).nexted, true);
  assert.equal((await check('WAPI-1', { device_key: 'WAPI-2' })).status, 403);
  assert.equal((await check('WAPI-1', {} as unknown, '/devices')).status, 403);
  assert.equal((await check('WAPI-1', { device_key: 'WAPI-1' }, '/unrelated-endpoint')).status, 403);
  assert.equal((await check('WAPI-1', {}, '/devices/WAPI-1')).nexted, true);
});

test('the legacy tenant key (no scopes) keeps admin-level access', () => {
  const legacy = { kind: 'api_key', role: 'admin' };
  assert.equal(callAuthorize(legacy, 'DELETE', '/devices/X').nexted, true);
  assert.equal(callAuthorize(legacy, 'GET', '/keys').nexted, true);
});

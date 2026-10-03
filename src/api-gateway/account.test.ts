import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import pool from '../shared/database/connection';
import { authorize } from './middleware/auth';
import { hashPassword, login, newSessionToken, resolveSession, sha256, verifyPassword, type SessionResult } from './services/account.service';
import { ServiceError } from './services/service-error';

type Query = (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
const database = pool as unknown as { query: Query };
const originalQuery = database.query;
afterEach(() => { database.query = originalQuery; });

test('passwords are hashed and verified; an unknown user still costs a hash comparison', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.notEqual(hash, 'correct horse battery');
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(await verifyPassword('wrong password!!', hash), false);
  assert.equal(await verifyPassword('anything', undefined), false);
});

test('session tokens are random, prefixed, and only their hash is stored', () => {
  const a = newSessionToken();
  const b = newSessionToken();
  assert.match(a.token, /^wgs_[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(a.token, b.token);
  assert.equal(a.hash, sha256(a.token));
  assert.equal(a.hash.length, 64);
});

test('login rejects an unknown email and a wrong password with the same error', async () => {
  const hash = await hashPassword('right-password-123');
  database.query = async (text) => text.includes('FROM users') ? { rows: [] } : { rows: [] };
  await assert.rejects(() => login('nobody@example.com', 'right-password-123', {}), (e: unknown) => e instanceof ServiceError && e.code === 'INVALID_CREDENTIALS');

  database.query = async (text) => text.includes('FROM users')
    ? { rows: [{ id: 'u1', email: 'a@b.co', name: 'A', password_hash: hash, status: 'active' }] } : { rows: [] };
  await assert.rejects(() => login('a@b.co', 'wrong-password-123', {}), (e: unknown) => e instanceof ServiceError && e.code === 'INVALID_CREDENTIALS');
});

test('login succeeds, stores only a token hash, and lists workspaces', async () => {
  const hash = await hashPassword('right-password-123');
  const inserted: unknown[][] = [];
  database.query = async (text, values) => {
    if (text.includes('FROM users')) return { rows: [{ id: 'u1', email: 'a@b.co', name: 'A', password_hash: hash, status: 'active' }] };
    if (text.includes('INSERT INTO user_sessions')) { inserted.push(values ?? []); return { rows: [] }; }
    if (text.includes('FROM memberships')) return { rows: [{ id: 't1', name: 'Acme', role: 'owner' }] };
    return { rows: [] };
  };
  const result = await login('a@b.co', 'right-password-123', { ip: '1.2.3.4' }) as SessionResult;
  assert.match(result.token, /^wgs_/);
  assert.equal(inserted[0]?.[1], sha256(result.token));
  assert.notEqual(inserted[0]?.[1], result.token);
  assert.deepEqual(result.workspaces, [{ id: 't1', name: 'Acme', role: 'owner' }]);
});

test('a suspended user cannot log in even with the right password', async () => {
  const hash = await hashPassword('right-password-123');
  database.query = async () => ({ rows: [{ id: 'u1', email: 'a@b.co', name: 'A', password_hash: hash, status: 'suspended' }] });
  await assert.rejects(() => login('a@b.co', 'right-password-123', {}), /incorrect/);
});

test('resolveSession picks the requested workspace and rejects one the user is not in', async () => {
  const membership = (id: string, role: string) => ({
    role, id, name: id, email: null, webhook_url: null, webhook_secret: null,
    max_devices: 1, quota_messages: 10, used_messages: 0, status: 'active',
  });
  database.query = async (text) => {
    if (text.includes('FROM user_sessions')) {
      return { rows: [{ session_id: 's1', expires_at: new Date(Date.now() + 1e9), last_used_at: new Date(), user_id: 'u1', email: 'a@b.co', name: 'A', user_status: 'active' }] };
    }
    if (text.includes('FROM memberships')) return { rows: [membership('t1', 'owner'), membership('t2', 'viewer')] };
    return { rows: [] };
  };
  assert.equal((await resolveSession('wgs_x'))?.tenant.id, 't1');
  const second = await resolveSession('wgs_x', 't2');
  assert.equal(second?.tenant.id, 't2');
  assert.equal(second?.role, 'viewer');
  assert.equal(await resolveSession('wgs_x', 'someone-elses'), undefined);
});

test('an expired or revoked session resolves to nothing', async () => {
  database.query = async () => ({ rows: [] });
  assert.equal(await resolveSession('wgs_gone'), undefined);
});

function run(role: 'owner' | 'admin' | 'developer' | 'viewer' | undefined, method: string, path: string) {
  let status = 0;
  let nexted = false;
  const req = { method, path, actor: role ? { kind: 'user', userId: 'u', email: 'e', role } : undefined } as unknown as Request;
  const res = { status(c: number) { status = c; return this; }, json() { return this; } } as unknown as Response;
  authorize(req, res, (() => { nexted = true; }) as NextFunction);
  return { status, nexted };
}

test('authorize lets permitted roles through and blocks the rest with 403', () => {
  assert.equal(run('developer', 'POST', '/message/send').nexted, true);
  assert.equal(run('viewer', 'POST', '/message/send').status, 403);
  assert.equal(run('viewer', 'GET', '/devices').nexted, true);
  assert.equal(run('viewer', 'GET', '/devices/X/qr').status, 403);
  assert.equal(run('developer', 'DELETE', '/devices/X').nexted, true, 'a Developer manages devices, including deleting them');
  assert.equal(run('viewer', 'DELETE', '/devices/X').status, 403);
  assert.equal(run('developer', 'GET', '/billing').status, 403);
  assert.equal(run('developer', 'POST', '/team/invitations').status, 403);
  assert.equal(run('admin', 'DELETE', '/devices/X').nexted, true);
  assert.equal(run('owner', 'GET', '/unknown-route').status, 403);
  assert.equal(run(undefined, 'GET', '/devices').status, 403);
});

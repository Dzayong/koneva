import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import pool from '../shared/database/connection';
import { hash } from './operator/core';
import { createOperatorRouter } from './operator/router';
import { DEFAULT_OTP_LIMITS, reserveIpRequest, reserveOtpSend, type OtpLimits } from './services/otp-limits';
import { ServiceError } from './services/service-error';

const enabled = process.env['OPERATOR_STACK_TEST'] === '1';
const root = path.join(__dirname, '../..');

test('OTP alerts in the Operator Panel API (disposable database only; email stays pinned off by the test script)', { skip: !enabled }, async (t) => {
  assert.ok(['none', 'dev-outbox'].includes(process.env['EMAIL_TRANSPORT'] ?? 'none') && !process.env['GMAIL_OAUTH_REFRESH_TOKEN'], 'refusing to run with email enabled');
  const url = new URL(process.env['DATABASE_URL']!);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/operator_test', 'Refusing non-test database');
  await pool.query('CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY)');
  const done = new Set((await pool.query<{ name: string }>('SELECT name FROM _migrations')).rows.map((r) => r.name));
  for (const file of (await fsp.readdir(path.join(root, 'migrations'))).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const client = await pool.connect();
    try { await client.query('BEGIN'); await client.query(await fsp.readFile(path.join(root, 'migrations', file), 'utf8')); await client.query('INSERT INTO _migrations(name) VALUES ($1)', [file]); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  const origin = 'http://localhost:13000';
  const config = { enabled: true, origin, cookieName: 'koneva_op_test', secure: false, mfaKey: Buffer.from(process.env['OPERATOR_MFA_ENC_KEY']!, 'base64'), requestsPerMinute: 100_000 };
  const app = express();
  app.use('/operator', createOperatorRouter(pool, config));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await pool.end(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/operator`;

  async function operator(permissions: string[]) {
    const id = randomUUID(), token = randomBytes(32).toString('hex');
    await pool.query("INSERT INTO operators(id,email,name,password_hash,permissions) VALUES ($1,$2,'Operator Uji','x',$3)", [id, `${id}@example.test`, permissions]);
    await pool.query('INSERT INTO operator_sessions(token_hash,operator_id) VALUES ($1,$2)', [hash(token), id]);
    return `${config.cookieName}=${token}`;
  }
  const get = async (cookie?: string, headers: Record<string, string> = {}) => {
    const r = await fetch(`${base}/alerts/otp`, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
    const text = await r.text();
    return { status: r.status, headers: r.headers, text, body: text ? JSON.parse(text) : undefined };
  };
  const reset = async () => { await pool.query("DELETE FROM otp_rate_events WHERE dim = 'sender'"); await pool.query('DELETE FROM otp_threshold_events'); };
  const seed = (kind: string, count: number, cap: number, ago: string) => pool.query("INSERT INTO otp_threshold_events(at, kind, window_count, cap) VALUES (now() - $1::interval, $2, $3, $4)", [ago, kind, count, cap]);
  const send = (limits: OtpLimits) => reserveOtpSend({ email: `d${randomUUID().slice(0, 8)}@gmail.com`, invitationId: randomUUID(), tenantId: randomUUID() }, limits);
  const viewer = await operator(['audit:read']);

  await t.test('empty state: no events, nothing active, current usage shown against the configured cap', async () => {
    await reset();
    const r = await get(viewer);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.data.events, []);
    assert.equal(r.body.data.has_active, false);
    assert.deepEqual([r.body.data.current.usage, r.body.data.current.cap, r.body.data.current.percent, r.body.data.current.window_hours], [0, 200, 0, 24]);
    assert.equal(r.body.data.history_days, 30);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  await t.test('threshold: nothing below 70 %; one warning at 70 %; one critical at the cap; repeats never add events (deduplication)', async () => {
    await reset();
    const limits: OtpLimits = { ...DEFAULT_OTP_LIMITS, senderPerDay: 10 };
    for (let i = 0; i < 6; i++) await send(limits);
    assert.deepEqual((await get(viewer)).body.data.events, [], 'below the threshold');
    await send(limits); // 7th = 70 %
    let data = (await get(viewer)).body.data;
    assert.equal(data.events.length, 1); assert.equal(data.has_active, true);
    const [warning] = data.events;
    assert.deepEqual({ ...warning, id: undefined, at: undefined }, {
      id: undefined, at: undefined, kind: 'sender_70_percent', scope: 'sender_daily', window_hours: 24, threshold_percent: 70, severity: 'warning',
      usage_at_event: 7, cap_at_event: 10, percent_at_event: 70, active: true, snapshot: true });
    assert.ok(Math.abs(Date.now() - new Date(warning.at).getTime()) < 60_000);
    for (let i = 0; i < 3; i++) await send(limits); // 8, 9, 10: still one warning
    assert.equal((await get(viewer)).body.data.events.length, 1);
    for (let i = 0; i < 3; i++) await assert.rejects(send(limits), (e) => e instanceof ServiceError && e.code === 'OTP_CAPACITY_REACHED'); // over the cap, three times
    data = (await get(viewer)).body.data;
    assert.deepEqual(data.events.map((e: { kind: string }) => e.kind), ['sender_cap_reached', 'sender_70_percent'], 'one critical event, newest first');
    assert.deepEqual([data.events[0].severity, data.events[0].threshold_percent, data.events[0].usage_at_event, data.events[0].cap_at_event], ['critical', 100, 10, 10]);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM otp_threshold_events')).rows[0].n, 2);
    // Snapshot versus now: the event says 7 of 10; the current figure is measured now against the cap configured now (200).
    assert.deepEqual([data.current.usage, data.current.cap, data.current.percent], [10, 200, 5]);
    assert.notEqual(data.current.cap, data.events[1].cap_at_event);
    // Reading never writes.
    const before = (await pool.query('SELECT count(*)::int AS n FROM otp_threshold_events')).rows[0].n;
    await get(viewer); await get(viewer);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM otp_threshold_events')).rows[0].n, before);
  });

  await t.test('snapshots stay when usage falls; "active" ends with the 24 h window; only 30 days and 50 events are listed', async () => {
    await reset();
    await seed('sender_70_percent', 140, 200, '2 hours');
    await seed('sender_cap_reached', 200, 200, '26 hours');
    await seed('sender_70_percent', 140, 200, '40 days'); // outside the history window
    let data = (await get(viewer)).body.data;
    assert.deepEqual(data.events.map((e: { kind: string; active: boolean }) => [e.kind, e.active]), [['sender_70_percent', true], ['sender_cap_reached', false]]);
    assert.equal(data.events[0].usage_at_event, 140, 'a snapshot, whatever the current usage is');
    assert.equal(data.current.usage, 0);
    assert.equal(data.has_active, true);
    await reset();
    await seed('sender_cap_reached', 200, 200, '3 days');
    data = (await get(viewer)).body.data;
    assert.equal(data.events.length, 1); assert.equal(data.has_active, false, 'old events are history, not an active alert');
    await reset();
    for (let i = 0; i < 55; i++) await seed('sender_70_percent', 140, 200, `${i + 1} minutes`);
    data = (await get(viewer)).body.data;
    assert.equal(data.events.length, 50);
    assert.ok(new Date(data.events[0].at) > new Date(data.events[49].at), 'newest first');
    await reset();
  });

  await t.test('access: only operators with audit:read; anonymous, other permissions, tenant and admin credentials are refused', async () => {
    await reset(); await seed('sender_70_percent', 140, 200, '1 hour');
    assert.equal((await get()).status, 401);
    const noAudit = await operator(['payments:read', 'payments:confirm', 'students:read', 'students:decide', 'workspaces:read']);
    const denied = await get(noAudit);
    assert.equal(denied.status, 403); assert.equal(denied.body.error.code, 'FORBIDDEN');
    assert.ok(!denied.text.includes('sender_70_percent') && !denied.text.includes('140'), 'a refused caller learns nothing');
    for (const headers of [{ Authorization: 'Bearer wgs_synthetic' }, { 'x-admin-key': 'operator-test-admin' }, { Cookie: 'wa_gateway_session=synthetic' }]) assert.equal((await get(undefined, headers)).status, 401, JSON.stringify(headers));
    assert.equal((await get(viewer)).status, 200);
    const post = await fetch(`${base}/alerts/otp`, { method: 'POST', headers: { Origin: origin, Cookie: viewer, 'X-Requested-With': 'koneva-operator' } });
    assert.ok([403, 404].includes(post.status), 'read-only: no write verb reaches it');
    await reset();
  });

  await t.test('privacy: the response has only the allowed fields and never an email, address, IP, code or limiter key', async () => {
    await reset();
    const email = `sensitif${randomUUID().slice(0, 6)}@gmail.com`, ip = '203.0.113.77', tenant = randomUUID(), invitation = randomUUID();
    const limits: OtpLimits = { ...DEFAULT_OTP_LIMITS, senderPerDay: 3 };
    await reserveIpRequest(ip);
    for (let i = 0; i < 3; i++) await reserveOtpSend({ email: i === 0 ? email : `x${i}${randomUUID().slice(0, 4)}@gmail.com`, invitationId: invitation, tenantId: tenant }, limits).catch(() => undefined);
    await reserveOtpSend({ email, invitationId: randomUUID(), tenantId: tenant }, limits).catch(() => undefined);
    const r = await get(viewer);
    assert.ok(r.body.data.events.length >= 1);
    const allowed = ['id', 'at', 'kind', 'scope', 'window_hours', 'threshold_percent', 'severity', 'usage_at_event', 'cap_at_event', 'percent_at_event', 'active', 'snapshot'].sort();
    for (const e of r.body.data.events) assert.deepEqual(Object.keys(e).sort(), allowed);
    assert.deepEqual(Object.keys(r.body.data).sort(), ['current', 'events', 'has_active', 'history_days']);
    assert.deepEqual(Object.keys(r.body.data.current).sort(), ['cap', 'measured_at', 'percent', 'scope', 'usage', 'window_hours']);
    for (const raw of [email, email.split('@')[0]!, ip, tenant, invitation, 'gmail']) assert.ok(!r.text.includes(raw), `leaked ${raw.slice(0, 6)}`);
    assert.ok(!/[a-f0-9]{64}/.test(r.text.replace(/"(?:id)":"[^"]*"/g, '')), 'no limiter key (64 hex characters) anywhere');
    await reset();
  });
});

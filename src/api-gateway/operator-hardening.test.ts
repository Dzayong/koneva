import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcryptjs';
import express from 'express';
import pool from '../shared/database/connection';
import { adminNetworkGuard, legacyBillingWrites, parseAdminNetworks } from './middleware/admin-access';
import { hash } from './operator/core';
import { cleanupOperatorData, idempotencyRetentionDays } from './operator/maintenance';
import { createOperatorRouter } from './operator/router';
import { csrfFor } from './operator/auth';
import { getBillingState, requestStudentVerification } from './services/billing.service';

const enabled = process.env['OPERATOR_STACK_TEST'] === '1';
const root = path.join(__dirname, '../..');

function runScript(script: string, stdin: string, env: Record<string, string | undefined>): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, ['--require', 'ts-node/register', script], { cwd: root, env: { ...process.env, NODE_ENV: 'test', ...env } },
      (error, out, err) => resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out, err }));
    child.stdin!.end(stdin);
  });
}

test('operator hardening: security events, offline administration, key management, cleanup, /admin restriction', { skip: !enabled }, async (t) => {
  const url = new URL(process.env['DATABASE_URL']!);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/operator_test', 'Refusing non-test database');
  await pool.query('CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY)');
  const done = new Set((await pool.query<{ name: string }>('SELECT name FROM _migrations')).rows.map((r) => r.name));
  const dir = path.join(root, 'migrations');
  for (const file of (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const client = await pool.connect();
    try { await client.query('BEGIN'); await client.query(await fs.readFile(path.join(dir, file), 'utf8')); await client.query('INSERT INTO _migrations(name) VALUES ($1)', [file]); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  const origin = 'http://localhost:13000';
  const config = { enabled: true, origin, cookieName: 'koneva_op_test', secure: false, requestsPerMinute: 100_000 };
  const app = express();
  app.use('/operator', createOperatorRouter(pool, config));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await pool.end(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/operator`;
  const password = 'synthetic-test-password-26';
  const passwordHash = await bcrypt.hash(password, 10);
  const all = ['payments:read', 'payments:confirm', 'students:read', 'students:decide', 'workspaces:read', 'audit:read'];
  const call = async (route: string, o: { method?: string; body?: unknown; cookie?: string; csrf?: string } = {}) => {
    const headers: Record<string, string> = { Origin: origin, 'X-Requested-With': 'koneva-operator' };
    if (o.cookie) headers['Cookie'] = o.cookie;
    if (o.csrf) headers['X-CSRF-Token'] = o.csrf;
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + route, { method: o.method ?? 'GET', headers, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) });
    const text = await r.text();
    return { status: r.status, headers: r.headers, text, body: text ? JSON.parse(text) : undefined };
  };
  const resetLimits = () => pool.query('DELETE FROM operator_login_attempts');
  async function newOperator() {
    const id = randomUUID(), email = `${id}@example.test`;
    await pool.query(`INSERT INTO operators(id,email,name,password_hash,permissions)
      VALUES ($1,$2,'Operator Uji',$3,$4)`, [id, email, passwordHash, all]);
    return { id, email };
  }
  const events = async (operatorId: string | null, extra = '') => (await pool.query(
    `SELECT event, reason, source, actor_label, ip_hash FROM operator_security_events WHERE ${operatorId ? 'operator_id=$1' : 'operator_id IS NULL AND $1::text IS NULL'} ${extra} ORDER BY at, id`, [operatorId])).rows;
  const login = async (email: string) => {
    const r = await call('/auth/login', { method: 'POST', body: { email, password } });
    return { cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '', csrf: r.body?.data?.csrf_token as string };
  };

  await t.test('there is no bootstrap account: migrations create zero operators', async () => {
    // Other tests create synthetic operators; the property is that no operator exists WITHOUT having been inserted by a test/script.
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM operators WHERE email NOT LIKE '%@example.test'")).rows[0].n, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM operators WHERE password_hash IS NULL OR password_hash=''")).rows[0].n, 0);
  });

  await t.test('security events: login success is recorded; no password or IP is stored; log is append-only', async () => {
    await resetLimits();
    const op = await newOperator();
    const session = await login(op.email);
    assert.ok(session.cookie);
    const rows = await events(op.id);
    assert.deepEqual(rows.map((r) => r.event), ['login_success']);
    assert.ok(rows.every((r) => r.source === 'web' && r.actor_label === null && /^[a-f0-9]{64}$/.test(r.ip_hash)));
    const dump = JSON.stringify((await pool.query('SELECT * FROM operator_security_events')).rows);
    for (const secretText of [password, '127.0.0.1']) assert.ok(!dump.includes(secretText), `leaked ${secretText.slice(0, 3)}…`);
    await assert.rejects(pool.query("UPDATE operator_security_events SET reason='x' WHERE operator_id=$1", [op.id]), /append only/);
    await assert.rejects(pool.query('DELETE FROM operator_security_events WHERE operator_id=$1', [op.id]), /append only/);
    await assert.rejects(pool.query("INSERT INTO operator_security_events(event,source) VALUES ('mfa_reset','offline')"), /operator_security_events_offline_actor/);
    // MFA endpoints are disabled: 410 Gone.
    assert.equal((await call('/auth/mfa/verify', { method: 'POST', body: { challenge_id: 'a'.repeat(64), code: '123456' } })).status, 410);
  });

  await t.test('offline provisioning: needs an explicit target and an accountable label, records who, prints no password', async () => {
    const email = `owner-${randomUUID()}@example.test`;
    const input = JSON.stringify({ email, name: 'Pemilik Uji', password, permissions: ['payments:read'] });
    const local = { OPERATOR_PROVISION_LOCAL: 'true', DATABASE_URL: process.env['DATABASE_URL'] };
    assert.notEqual((await runScript('scripts/create-local-operator.ts', input, { ...local, OPERATOR_ADMIN_LABEL: '' })).code, 0, 'no label, no provisioning');
    assert.notEqual((await runScript('scripts/create-local-operator.ts', input, { ...local, OPERATOR_PROVISION_LOCAL: '', OPERATOR_ADMIN_LABEL: 'pemilik-proyek-uji' })).code, 0, 'no explicit opt-in');
    const target = `${url.hostname}/operator_test`;
    const wrongConfirm = await runScript('scripts/create-local-operator.ts', input, { ...local, OPERATOR_PROVISION_LOCAL: '', OPERATOR_PROVISION_OFFLINE: 'true', OPERATOR_PROVISION_CONFIRM_DATABASE: 'db.other.example/koneva', OPERATOR_ADMIN_LABEL: 'pemilik-proyek-uji' });
    assert.notEqual(wrongConfirm.code, 0, 'a mistyped confirmation refuses');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM operators WHERE email=$1', [email])).rows[0].n, 0);
    const ok = await runScript('scripts/create-local-operator.ts', input, { ...local, OPERATOR_PROVISION_LOCAL: '', OPERATOR_PROVISION_OFFLINE: 'true', OPERATOR_PROVISION_CONFIRM_DATABASE: target, OPERATOR_ADMIN_LABEL: 'pemilik-proyek-uji' });
    assert.equal(ok.code, 0, ok.err);
    assert.ok(!ok.out.includes(password) && !ok.err.includes(password));
    const row = (await pool.query('SELECT id FROM operators WHERE email=$1', [email])).rows[0];
    assert.deepEqual((await events(row.id)).map((e) => [e.event, e.source, e.actor_label]), [['operator_provisioned', 'offline', 'pemilik-proyek-uji']]);
    const loginResult = await call('/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(loginResult.body.data.status, 'authenticated');
    // owner:insights can now be assigned via provisioning.
    const ownerEmail = `owner-insights-${randomUUID()}@example.test`;
    const ownerInput = JSON.stringify({ email: ownerEmail, name: 'Staf Uji', password, permissions: ['payments:read','owner:insights'] });
    const ownerResult = await runScript('scripts/create-local-operator.ts', ownerInput, { ...local, OPERATOR_ADMIN_LABEL: 'pemilik-proyek-uji' });
    assert.equal(ownerResult.code, 0, ownerResult.err);
  });

  await t.test('break-glass provisioning creates at most one audit:read-only account and never prints its password', async () => {
    const email = `break-glass-${randomUUID()}@example.test`;
    const input = JSON.stringify({ email, name: 'Akun Darurat Uji', password });
    const env = { OPERATOR_PROVISION_LOCAL: 'true', OPERATOR_ADMIN_LABEL: 'pemilik-proyek-uji', DATABASE_URL: process.env['DATABASE_URL'] };
    const created = await runScript('scripts/provision-break-glass-operator.ts', input, env);
    assert.equal(created.code, 0, created.err);
    assert.ok(!created.out.includes(password) && !created.err.includes(password));
    assert.match(created.out, /audit:read only/);
    const row = (await pool.query<{ id: string; permissions: string[]; is_break_glass: boolean }>(
      'SELECT id,permissions,is_break_glass FROM operators WHERE email=$1', [email])).rows[0]!;
    assert.deepEqual(row.permissions, ['audit:read']);
    assert.equal(row.is_break_glass, true);
    assert.deepEqual((await events(row.id)).map((e) => [e.event,e.source,e.actor_label]), [['break_glass_provisioned','offline','pemilik-proyek-uji']]);

    const secondEmail = `break-glass-${randomUUID()}@example.test`;
    const second = await runScript('scripts/provision-break-glass-operator.ts', JSON.stringify({ email: secondEmail, name: 'Akun Darurat Kedua', password }), env);
    assert.notEqual(second.code, 0, 'a second emergency account is refused');
    assert.equal((await pool.query('SELECT id FROM operators WHERE email=$1', [secondEmail])).rowCount, 0);
    await pool.query('UPDATE operators SET is_break_glass=false WHERE id=$1', [row.id]);
  });

  await t.test('offline MFA reset script exits with error message since MFA was removed', async () => {
    const run = await runScript('scripts/reset-operator-mfa.ts', JSON.stringify({ email: 'anyone@example.test' }), { OPERATOR_PROVISION_LOCAL: 'true', OPERATOR_ADMIN_LABEL: 'pemilik-proyek-uji', DATABASE_URL: process.env['DATABASE_URL'] });
    assert.notEqual(run.code, 0);
    assert.match(run.err, /MFA has been removed/);
  });

  await t.test('MFA key rotation script exits with error since MFA was removed', async () => {
    const env = { OPERATOR_PROVISION_LOCAL: 'true', OPERATOR_ADMIN_LABEL: 'pemilik-proyek-uji', DATABASE_URL: process.env['DATABASE_URL'] };
    const run = await runScript('scripts/rotate-operator-mfa-key.ts', '', { ...env, OPERATOR_MFA_ENC_KEY_OLD: randomBytes(32).toString('base64'), OPERATOR_MFA_ENC_KEY_NEW: randomBytes(32).toString('base64') });
    assert.notEqual(run.code, 0);
    assert.match(run.err, /MFA has been removed/);
  });

  await t.test('cleanup removes only expired session/challenge/bucket rows and idempotency rows past retention; audit and events are never touched', async () => {
    const op = await newOperator();
    const old = (col: string) => `now() - interval '${col}'`;
    const oldSession = hash(randomUUID()), liveSession = hash(randomUUID());
    await pool.query(`INSERT INTO operator_sessions(token_hash,operator_id,absolute_expires_at,idle_expires_at) VALUES ($1,$2,${old('3 days')},${old('3 days')})`, [oldSession, op.id]);
    await pool.query('INSERT INTO operator_sessions(token_hash,operator_id) VALUES ($1,$2)', [liveSession, op.id]);
    await pool.query(`INSERT INTO operator_challenges(token_hash,operator_id,purpose,expires_at) VALUES ($1,$2,'verify',${old('3 days')}), ($3,$2,'verify',now()+interval '5 minutes')`, [hash(randomUUID()), op.id, hash(randomUUID())]);
    await pool.query(`INSERT INTO operator_login_attempts(bucket,attempts,expires_at) VALUES ($1,3,${old('1 hour')}), ($2,3,now()+interval '10 minutes')`, [`old-${randomUUID()}`, `live-${randomUUID()}`]);
    const target = randomUUID();
    await pool.query(`INSERT INTO operator_idempotency(operator_id,operation,target_id,key,payload_hash,response_body,created_at) VALUES
      ($1,'confirm-payment',$2,$3,'h','{}',${old('8 days')}), ($1,'confirm-payment',$2,$4,'h','{}',${old('4 days')}), ($1,'confirm-payment',$2,$5,'h','{}',${old('1 hour')})`, [op.id, target, randomUUID(), randomUUID(), randomUUID()]);
    await pool.query("INSERT INTO operator_audit(operator_id,action,target_type,target_id,changes,request_id,at) VALUES ($1,'invoice.confirm_payment','invoice',$2,'{}'::jsonb,$3, now() - interval '400 days')", [op.id, target, randomUUID()]);
    const auditBefore = (await pool.query('SELECT count(*)::int AS n FROM operator_audit')).rows[0].n;
    const eventsBefore = (await pool.query('SELECT count(*)::int AS n FROM operator_security_events')).rows[0].n;
    const result = await cleanupOperatorData(pool, 7);
    assert.ok(result.sessions >= 1 && result.challenges >= 1 && result.login_buckets >= 1);
    assert.equal(result.idempotency >= 1, true);
    const remaining = (await pool.query('SELECT created_at FROM operator_idempotency WHERE target_id=$1', [target])).rows;
    assert.equal(remaining.length, 2, '7-day retention keeps the 4-day and 1-hour rows');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM operator_sessions WHERE token_hash=$1', [liveSession])).rows[0].n, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM operator_sessions WHERE token_hash=$1', [oldSession])).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM operator_audit')).rows[0].n, auditBefore);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM operator_security_events')).rows[0].n, eventsBefore);
    await assert.rejects(cleanupOperatorData(pool, 2), /72-hour/);
    assert.equal(idempotencyRetentionDays({}), 7);
    assert.equal(idempotencyRetentionDays({ OPERATOR_IDEMPOTENCY_RETENTION_DAYS: '3' }), 3);
    for (const bad of ['2', '0', 'abc', '1.5', '400']) assert.throws(() => idempotencyRetentionDays({ OPERATOR_IDEMPOTENCY_RETENTION_DAYS: bad }), /RETENTION_DAYS/);
  });

  await t.test('after idempotency retention a stale retry is a NEW request and still cannot double-apply', async () => {
    await resetLimits();
    const op = await newOperator();
    const session = await login(op.email);
    const cookie = session.cookie, csrf = session.csrf;
    const tenant = randomUUID(), invoice = randomUUID();
    await pool.query("INSERT INTO tenants(id,name,email,webhook_secret) VALUES ($1,'Uji',$2,$3)", [tenant, `${tenant}@example.test`, `w-${tenant}`]);
    await pool.query("INSERT INTO invoices(id,tenant_id,number,plan_id,cycle,amount_idr,due_at) VALUES ($1,$2,$3,'umkm','monthly',99000,now()+interval '7 days')", [invoice, tenant, `RET-${invoice.slice(0, 16)}`]);
    const key = randomUUID();
    const body = { method: 'transfer', reference: `REF-${key.slice(0, 8)}`, expected: { amount_idr: 99000, version: 1 } };
    const send = async () => { const r = await fetch(`${base}/invoices/${invoice}/confirm-payment`, { method: 'POST', headers: { Origin: origin, 'X-Requested-With': 'koneva-operator', 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': key }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() as { error?: { code: string } } }; };
    assert.equal((await send()).status, 200);
    await pool.query("UPDATE operator_idempotency SET created_at = now() - interval '8 days' WHERE target_id=$1", [invoice]);
    await cleanupOperatorData(pool, 7);
    const stale = await send();
    assert.equal(stale.status, 409); assert.equal(stale.body.error?.code, 'INVOICE_NOT_PAYABLE');
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM operator_audit WHERE target_id=$1", [invoice])).rows[0].n, 1);
  });

  await t.test('/admin: network guard, key-only credential (operator cookie is not one), legacy billing writes closed while the panel is on', async () => {
    assert.equal(parseAdminNetworks('', 'development'), null);
    assert.equal(parseAdminNetworks('any', 'production'), null);
    assert.throws(() => parseAdminNetworks('not-an-ip', 'production'), /invalid entry/);
    assert.throws(() => parseAdminNetworks('10.0.0.0/99', 'production'), /invalid prefix/);
    const guarded = express();
    guarded.set('trust proxy', 1);
    guarded.use('/admin', adminNetworkGuard({ NODE_ENV: 'production' }), (_req, res) => { res.json({ ok: true }); });
    const gs = guarded.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => gs.once('listening', resolve));
    try {
      // Owner decision 2026-10-02: production default is loopback-only. A private-range or public client is
      // refused unless ADMIN_ALLOWED_NETWORKS explicitly widens it (see the next block).
      const at = (xff?: string) => fetch(`http://127.0.0.1:${(gs.address() as AddressInfo).port}/admin/x`, { headers: xff ? { 'X-Forwarded-For': xff } : {} }).then((r) => r.status);
      assert.equal(await at(), 200, 'direct loopback');
      assert.equal(await at('10.1.2.3'), 403, 'private range is refused by default (localhost-only)');
      assert.equal(await at('203.0.113.9'), 403, 'public client behind the proxy');
      assert.equal(await at('::ffff:127.0.0.1'), 200, 'v4-mapped loopback');
      assert.equal(await at('::ffff:172.16.0.4'), 403, 'v4-mapped private is refused by default');
      assert.equal(await at('2001:db8::1'), 403, 'public v6');
      assert.equal(await at('::1'), 200, 'v6 loopback');
    } finally { await new Promise<void>((resolve) => gs.close(() => resolve())); }
    const widened = express();
    widened.set('trust proxy', 1);
    widened.use('/admin', adminNetworkGuard({ NODE_ENV: 'production', ADMIN_ALLOWED_NETWORKS: 'loopback,private' }), (_req, res) => { res.json({ ok: true }); });
    const ws = widened.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => ws.once('listening', resolve));
    try {
      const at = (xff: string) => fetch(`http://127.0.0.1:${(ws.address() as AddressInfo).port}/admin/x`, { headers: { 'X-Forwarded-For': xff } }).then((r) => r.status);
      assert.equal(await at('10.1.2.3'), 200, 'explicit opt-back-in to private ranges still works');
      assert.equal(await at('203.0.113.9'), 403, 'still refuses public clients');
    } finally { await new Promise<void>((resolve) => ws.close(() => resolve())); }
    const allow = express();
    allow.use(adminNetworkGuard({ NODE_ENV: 'production', ADMIN_ALLOWED_NETWORKS: '198.51.100.0/24' }), (_req, res) => { res.json({ ok: true }); });
    const as = allow.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => as.once('listening', resolve));
    try { assert.equal((await fetch(`http://127.0.0.1:${(as.address() as AddressInfo).port}/`)).status, 403, 'explicit list replaces defaults'); }
    finally { await new Promise<void>((resolve) => as.close(() => resolve())); }
    const legacy = (env: NodeJS.ProcessEnv) => new Promise<number>((resolve) => {
      let status = 0;
      legacyBillingWrites(env)({} as express.Request, { status: (s: number) => { status = s; return { json: () => resolve(status) }; } } as unknown as express.Response, () => resolve(200));
    });
    assert.equal(await legacy({}), 200, 'panel off: legacy path unchanged');
    assert.equal(await legacy({ OPERATOR_ENABLED: 'true' }), 403);
    assert.equal(await legacy({ OPERATOR_ENABLED: 'true', ADMIN_LEGACY_BILLING_WRITES: 'true' }), 200, 'explicit override');
  });

  await t.test('legacy pending student request: flagged for resubmission, approvals stay valid, nothing invented', async () => {
    const legacy = randomUUID(), approved = randomUUID(), fresh = randomUUID();
    for (const id of [legacy, approved, fresh]) await pool.query("INSERT INTO tenants(id,name,email,webhook_secret) VALUES ($1,'Uji',$2,$3)", [id, `${id}@example.test`, `w-${id}`]);
    await pool.query('UPDATE tenants SET student_request_at=now(), student_note=$2 WHERE id=$1', [legacy, 'catatan lama']);
    await pool.query('UPDATE tenants SET student_request_at=now(), student_verified_at=now() WHERE id=$1', [approved]);
    await requestStudentVerification(fresh, 'mahasiswa@kampus.ac.id', 'baru');
    assert.deepEqual((await getBillingState(legacy)).student, { verified: false, requested: false, needs_resubmission: true, status: 'legacy_pending', correction_due_at: null });
    assert.deepEqual((await getBillingState(approved)).student, { verified: true, requested: true, needs_resubmission: false, status: null, correction_due_at: null });
    assert.deepEqual((await getBillingState(fresh)).student, { verified: false, requested: true, needs_resubmission: false, status: 'pending', correction_due_at: null });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM student_requests WHERE tenant_id=$1', [legacy])).rows[0].n, 0, 'no requester identity is invented');
    await requestStudentVerification(legacy, 'mahasiswa@kampus.ac.id', 'ajukan ulang');
    assert.equal((await getBillingState(legacy)).student.needs_resubmission, false);
    const report = await runScript('scripts/report-legacy-student-requests.ts', '', { OPERATOR_PROVISION_LOCAL: 'true', OPERATOR_ADMIN_LABEL: 'pemilik-proyek-uji', DATABASE_URL: process.env['DATABASE_URL'] });
    assert.equal(report.code, 0, report.err);
    assert.ok(!report.out.includes('example.test') && !report.out.includes('catatan'), 'report has ids and dates only');
  });
});

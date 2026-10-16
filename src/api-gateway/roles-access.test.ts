import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express, { type ErrorRequestHandler } from 'express';
import pool from '../shared/database/connection';
import { closeRedisClient } from '../shared/redis';
import { authorize, tenantAuth } from './middleware/auth';
import { auditTrail } from './middleware/audit';
import authRoutes from './routes/auth.routes';
import billingRoutes from './routes/billing.routes';
import deviceRoutes from './routes/device.routes';
import teamRoutes from './routes/team.routes';
import { hashPassword, login } from './services/account.service';
import { createTrial } from './services/billing.service';
import { emailTransport } from './services/mailer';
import { ServiceError } from './services/service-error';
import { createApiKey, newApiKey } from './services/apikey.service';

// STACK-local: real PostgreSQL (disposable), real routers and middleware, a FAKE device manager on loopback (no container, no WhatsApp).
const enabled = process.env['OPERATOR_STACK_TEST'] === '1';
if (enabled) {
  // Safety net: a test run must never be able to send real email, whatever the developer's .env contains.
  assert.ok(['none', 'dev-outbox', undefined].includes(process.env['EMAIL_TRANSPORT']) && !process.env['GMAIL_OAUTH_REFRESH_TOKEN'],
    'refusing to run: EMAIL_TRANSPORT/GMAIL_* must be pinned by the test scripts (see scripts/test-operator-*.sh)');
}
const root = path.join(__dirname, '../..');

/** Spawns an offline admin script (scripts/migrate-legacy-api-keys.ts) the same way an owner would. */
function runMigrationScript(args: string[], env: Record<string, string | undefined> = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath, ['--require', 'ts-node/register', 'scripts/migrate-legacy-api-keys.ts', ...args],
      { cwd: root, env: { ...process.env, NODE_ENV: 'test', OPERATOR_PROVISION_LOCAL: 'true', OPERATOR_ADMIN_LABEL: 'test-cutover', ...env } },
      (error, out, err) => resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out, err }),
    );
  });
}

test('roles, Gmail invitations and OTP (disposable database only)', { skip: !enabled }, async (t) => {
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

  // Fake device manager: records DELETE calls, touches nothing real.
  const managerCalls: string[] = [];
  const manager = http.createServer((req, res) => { managerCalls.push(`${req.method} ${req.url}`); res.setHeader('content-type', 'application/json'); res.end('{"success":true}'); });
  await new Promise<void>((resolve) => manager.listen(18093, '127.0.0.1', resolve));

  const outbox = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'koneva-outbox-')), 'outbox.jsonl');
  const app = express();
  app.set('trust proxy', 1); // each subtest presents its own client address so OTP/IP limits do not bleed between them
  app.use(express.json());
  app.use('/auth', authRoutes);
  app.use('/api/v1', tenantAuth, authorize, auditTrail, deviceRoutes, teamRoutes, billingRoutes);
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ServiceError) { if (error.retryAfter) res.set('Retry-After', String(error.retryAfter)); res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } }); return; }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: String(error) } });
  };
  app.use(errors);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => manager.close(() => resolve()));
    await fsp.rm(path.dirname(outbox), { recursive: true, force: true });
    await closeRedisClient();
    await pool.end();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const password = 'synthetic-test-password-26';

  let clientIp = '198.51.100.1', ipCounter = 1;
  const newClient = () => { ipCounter += 1; clientIp = `198.51.100.${ipCounter}`; };
  const call = async (route: string, o: { method?: string; body?: unknown; token?: string; apiKey?: string; workspace?: string } = {}) => {
    const headers: Record<string, string> = { 'X-Forwarded-For': clientIp };
    if (o.token) headers['Authorization'] = `Bearer ${o.token}`;
    if (o.apiKey) headers['apikey'] = o.apiKey;
    if (o.workspace) headers['x-workspace'] = o.workspace;
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + route, { method: o.method ?? 'GET', headers, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) });
    const text = await r.text();
    return { status: r.status, text, headers: r.headers, body: text ? JSON.parse(text) : undefined };
  };
  const meta = { ip: '127.0.0.1', userAgent: 'test' };
  const owner = async (email = `${randomUUID()}@gmail.com`, verified = true) => {
    const userId = randomUUID(), tenant = randomUUID();
    await pool.query(
      `INSERT INTO users(id,email,name,password_hash,status,email_verified_at,terms_accepted_at)
       VALUES ($1,$2,'Pemilik Uji',$3,'active',$4,now())`,
      [userId, email, await hashPassword(password), verified ? new Date() : null],
    );
    await pool.query(
      'INSERT INTO tenants(id,name,email,webhook_secret) VALUES ($1,$2,$3,$4)',
      [tenant, 'Workspace Pemilik Uji', email, `whsec_${randomBytes(24).toString('hex')}`],
    );
    await createTrial(pool, tenant);
    await pool.query("INSERT INTO memberships(user_id,tenant_id,role) VALUES ($1,$2,'owner')", [userId, tenant]);
    // The trial plan allows one member (the owner); a paid plan is what lets an owner add a Developer.
    await pool.query("UPDATE subscriptions SET plan_id='umkm', status='active', period_end=now()+interval '30 days' WHERE tenant_id=$1", [tenant]);
    const session = await login(email, password, meta);
    return { email, token: session.token, userId, tenant };
  };
  const otpFor = (to: string): string[] => fs.existsSync(outbox) ? fs.readFileSync(outbox, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { to: string; code: string }).filter((m) => m.to === to).map((m) => m.code) : [];
  const invite = async (o: Awaited<ReturnType<typeof owner>>, email: string) => {
    const r = await call('/api/v1/team/invitations', { method: 'POST', token: o.token, body: { email, role: 'developer' } });
    assert.equal(r.status, 201, r.text);
    return { token: r.body.data.token as string, id: r.body.data.id as string, email: r.body.data.email as string };
  };
  const useOutbox = () => { process.env['EMAIL_TRANSPORT'] = 'dev-outbox'; process.env['DEV_EMAIL_OUTBOX_FILE'] = outbox; };
  const noEmail = () => { delete process.env['EMAIL_TRANSPORT']; };
  const other = (_token: string): string => 'wgs_' + 'x'.repeat(40);
  const wrongCode = (real: string) => (real === '000000' ? '111111' : '000000');
  const accept = (token: string, body: unknown, bearerToken?: string) => call(`/auth/invitations/${token}/accept`, { method: 'POST', body, ...(bearerToken ? { token: bearerToken } : {}) });
  const newUserBody = (otp: string) => ({ otp, name: 'Developer Uji', password, accept_terms: true });

  await t.test('signup creates no active account or workspace before mailbox OTP, and a pending email can safely restart registration', async () => {
    newClient(); useOutbox();
    const email = `${randomUUID()}@gmail.com`, firstPassword = 'first-synthetic-password-26', secondPassword = 'second-synthetic-password-26';
    const first = await call('/auth/signup', { method: 'POST', body: { email, password: firstPassword, name: 'Pendaftar Pertama', accept_terms: true } });
    assert.equal(first.status, 202, first.text);
    assert.deepEqual(first.body.data, { verification_required: true, verification_method: 'email', email, resend_after: 60 });
    assert.equal('token' in first.body.data, false);
    const pending = (await pool.query<{ status: string; email_verified_at: Date | null }>('SELECT status,email_verified_at FROM users WHERE lower(email)=lower($1)', [email])).rows[0];
    assert.deepEqual(pending, { status: 'pending_email', email_verified_at: null });
    assert.equal(Number((await pool.query('SELECT count(*) FROM memberships m JOIN users u ON u.id=m.user_id WHERE lower(u.email)=lower($1)', [email])).rows[0]!.count), 0);
    assert.equal((await call('/auth/login', { method: 'POST', body: { email, password: firstPassword } })).status, 401);

    const staleCode = otpFor(email).at(-1)!;
    newClient();
    const restarted = await call('/auth/signup', { method: 'POST', body: { email, password: secondPassword, name: 'Pemilik Sebenarnya', accept_terms: true } });
    assert.equal(restarted.status, 202, restarted.text);
    // The original OTP still proves the mailbox, while the pending password/name now belong to the latest attempt.
    const activated = await call('/auth/signup/verification/confirm', { method: 'POST', body: { email, code: staleCode } });
    assert.equal(activated.status, 200, activated.text);
    assert.equal(activated.body.data.user.email, email);
    assert.equal(activated.body.data.workspaces.length, 1);
    const active = (await pool.query<{ status: string; verified: boolean }>('SELECT status,email_verified_at IS NOT NULL AS verified FROM users WHERE lower(email)=lower($1)', [email])).rows[0];
    assert.deepEqual(active, { status: 'active', verified: true });
    assert.equal((await call('/auth/login', { method: 'POST', body: { email, password: firstPassword } })).status, 401);
    assert.equal((await call('/auth/login', { method: 'POST', body: { email, password: secondPassword } })).status, 200);
    noEmail();
  });

  await t.test('database: one owner per workspace; no new admin/viewer memberships; invitations Developer+Gmail only; system admin is not a customer role', async () => {
    newClient();
    const o = await owner();
    const other = await owner();
    await assert.rejects(pool.query("INSERT INTO memberships(user_id,tenant_id,role) VALUES ($1,$2,'owner')", [other.userId, o.tenant]), /memberships_one_owner_idx/);
    for (const role of ['admin', 'viewer']) await assert.rejects(pool.query('INSERT INTO memberships(user_id,tenant_id,role) VALUES ($1,$2,$3)', [other.userId, o.tenant, role]), /can no longer be assigned/, role);
    for (const role of ['operator', 'system_admin', 'superadmin']) await assert.rejects(pool.query('INSERT INTO memberships(user_id,tenant_id,role) VALUES ($1,$2,$3)', [other.userId, o.tenant, role]), /check|constraint/i, role);
    const ins = (role: string, email: string) => pool.query('INSERT INTO invitations(tenant_id,email,role,token_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval \'1 day\')', [o.tenant, email, role, randomUUID().replace(/-/g, '').padEnd(64, '0')]);
    await assert.rejects(ins('viewer', 'a@gmail.com'), /only grant the developer role|check/i);
    await assert.rejects(ins('admin', 'a@gmail.com'), /only grant the developer role|check/i);
    await assert.rejects(ins('developer', 'a@yahoo.com'), /gmail\.com/);
    await assert.rejects(ins('developer', 'A@gmail.com'), /gmail\.com/, 'unnormalised address never reaches the table');
    await assert.doesNotReject(ins('developer', 'ok@gmail.com'));
  });

  await t.test('owner invites Developer by Gmail; non-Gmail and every other role are refused; Developer cannot invite', async () => {
    newClient();
    const o = await owner();
    const good = await call('/api/v1/team/invitations', { method: 'POST', token: o.token, body: { email: '  Rekan.Uji@GMAIL.com ', role: 'developer' } });
    assert.equal(good.status, 201, good.text);
    assert.equal(good.body.data.email, 'rekan.uji@gmail.com');
    for (const email of ['x@yahoo.com', 'x@googlemail.com', 'x@kampus.ac.id', 'x@gmail.com.evil.test']) {
      const r = await call('/api/v1/team/invitations', { method: 'POST', token: o.token, body: { email, role: 'developer' } });
      assert.equal(r.status, 400, email); assert.equal(r.body.error.code, 'GMAIL_REQUIRED', email);
    }
    for (const role of ['owner', 'admin', 'viewer', 'operator']) assert.equal((await call('/api/v1/team/invitations', { method: 'POST', token: o.token, body: { email: 'y@gmail.com', role } })).status, 400, role);
    assert.equal((await call('/api/v1/team/invitations', { method: 'POST', token: o.token, body: { email: o.email, role: 'developer' } })).body.error.code, 'ALREADY_MEMBER', 'the owner does not invite themself');
    // A developer can neither invite nor manage the team.
    const dev = await owner();
    useOutbox();
    const inv = await invite(o, dev.email);
    const requested = await call(`/auth/invitations/${inv.token}/otp`, { method: 'POST' });
    assert.equal(requested.status, 200, requested.text);
    const joined = await accept(inv.token, { otp: otpFor(dev.email).at(-1)! }, dev.token);
    assert.equal(joined.status, 201, joined.text);
    assert.equal((await call('/api/v1/team/invitations', { method: 'POST', token: dev.token, workspace: o.tenant, body: { email: 'z@gmail.com', role: 'developer' } })).status, 403);
    noEmail();
  });

  await t.test('OTP: fails safe without a sender; goes only to the invited address; wrong/expired/reused codes and a wrong signed-in address are refused', async () => {
    newClient();
    const o = await owner();
    const invited = `dev-${randomUUID().slice(0, 8)}@gmail.com`;
    const inv = await invite(o, invited);
    noEmail();
    const preview = await call(`/auth/invitations/${inv.token}`);
    assert.equal(preview.body.data.requires_otp, true); assert.equal(preview.body.data.otp_available, false);
    assert.ok(!preview.text.includes(invited), 'only a masked hint');
    const eventsBefore = (await pool.query('SELECT count(*)::int AS n FROM otp_rate_events')).rows[0].n;
    const blocked = await call(`/auth/invitations/${inv.token}/otp`, { method: 'POST' });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM otp_rate_events')).rows[0].n, eventsBefore, 'a fail-safe refusal counts nothing');
    assert.equal(blocked.status, 503); assert.equal(blocked.body.error.code, 'EMAIL_NOT_CONFIGURED');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM invitation_otps WHERE invitation_id=$1', [inv.id])).rows[0].n, 0, 'nothing generated or stored');
    // No bypass: accepting with any code, or none, fails; nothing is created.
    assert.equal((await accept(inv.token, newUserBody('123456'))).body.error.code, 'OTP_INVALID');
    assert.equal((await accept(inv.token, { name: 'X', password, accept_terms: true })).status, 400);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM users WHERE lower(email)=$1', [invited])).rows[0].n, 0);
    assert.throws(() => emailTransport({ NODE_ENV: 'production', EMAIL_TRANSPORT: 'dev-outbox', DEV_EMAIL_OUTBOX_FILE: outbox }), /forbidden in production/);
    assert.throws(() => emailTransport({ EMAIL_TRANSPORT: 'smtp' }), /not supported/);
    assert.throws(() => emailTransport({ EMAIL_TRANSPORT: 'dev-outbox', DEV_EMAIL_OUTBOX_FILE: 'relative.jsonl' }), /absolute/);

    useOutbox();
    assert.equal((await call(`/auth/invitations/${inv.token}/otp`, { method: 'POST' })).status, 200);
    const mails = otpFor(invited);
    assert.equal(mails.length, 1); assert.match(mails[0]!, /^\d{6}$/);
    assert.equal(otpFor(o.email).length, 0, 'never to anyone else');
    const stored = JSON.stringify((await pool.query('SELECT * FROM invitation_otps WHERE invitation_id=$1', [inv.id])).rows);
    assert.ok(!stored.includes(mails[0]!) && /"code_hash":"[a-f0-9]{64}"/.test(stored), 'only a keyed hash is stored');
    assert.equal((await call(`/auth/invitations/${inv.token}/otp`, { method: 'POST' })).body.error.code, 'OTP_COOLDOWN');
    // A signed-in stranger cannot burn the real recipient's attempts.
    const stranger = await owner();
    assert.equal((await accept(inv.token, { otp: wrongCode(mails[0]!) }, stranger.token)).body.error.code, 'EMAIL_MISMATCH');
    assert.equal((await pool.query('SELECT attempts FROM invitation_otps WHERE invitation_id=$1', [inv.id])).rows[0].attempts, 0);
    // Wrong guesses: five allowed, then the code is dead even if it is right.
    for (let i = 0; i < 5; i++) assert.equal((await accept(inv.token, newUserBody(wrongCode(mails[0]!)))).body.error.code, 'OTP_INVALID');
    assert.equal((await accept(inv.token, newUserBody(mails[0]!))).body.error.code, 'OTP_INVALID', 'exhausted');
    // Resend replaces the old code (after the cooldown) and the old one stops working.
    await pool.query("UPDATE invitation_otps SET created_at = created_at - interval '2 minutes' WHERE invitation_id=$1", [inv.id]);
    assert.equal((await call(`/auth/invitations/${inv.token}/otp`, { method: 'POST' })).status, 200);
    const fresh = otpFor(invited).at(-1)!;
    if (fresh !== mails[0]) assert.equal((await accept(inv.token, newUserBody(mails[0]!))).body.error.code, 'OTP_INVALID');
    // Expired code.
    await pool.query("UPDATE invitation_otps SET expires_at = now() - interval '1 second' WHERE invitation_id=$1 AND consumed_at IS NULL", [inv.id]);
    assert.equal((await accept(inv.token, newUserBody(fresh))).body.error.code, 'OTP_INVALID');
    // Per invitation: 3 sends per rolling hour (the 60 s pause is separate). Two sends happened above (first + resend); a third is allowed, a fourth is not.
    await pool.query("UPDATE invitation_otps SET created_at = created_at - interval '2 minutes' WHERE invitation_id=$1", [inv.id]);
    assert.equal((await call(`/auth/invitations/${inv.token}/otp`, { method: 'POST' })).status, 200);
    await pool.query("UPDATE invitation_otps SET created_at = created_at - interval '2 minutes' WHERE invitation_id=$1", [inv.id]);
    const limited = await call(`/auth/invitations/${inv.token}/otp`, { method: 'POST' });
    assert.equal(limited.status, 429); assert.equal(limited.body.error.code, 'OTP_RATE_LIMITED');
    await pool.query("UPDATE otp_rate_events SET at = at - interval '2 hours'"); // let the rolling hour pass
    // Success: new account with the invited address, verified, Developer only, one-time.
    await pool.query("DELETE FROM invitation_otps WHERE invitation_id=$1", [inv.id]);
    assert.equal((await call(`/auth/invitations/${inv.token}/otp`, { method: 'POST' })).status, 200);
    const good = otpFor(invited).at(-1)!;
    const ok = await accept(inv.token, newUserBody(good));
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.body.data.joined.role, 'developer');
    const user = (await pool.query('SELECT email, email_verified_at FROM users WHERE lower(email)=$1', [invited])).rows[0];
    assert.equal(user.email, invited); assert.ok(user.email_verified_at);
    assert.equal((await accept(inv.token, newUserBody(good))).body.error.code, 'INVITATION_INVALID', 'a used invitation is gone');
    noEmail();
  });

  await t.test('a different address cannot accept; an existing account must be signed in as the invited address', async () => {
    newClient();
    const o = await owner();
    const existing = await owner();
    useOutbox();
    const forSomeoneElse = await invite(o, `someone-${randomUUID().slice(0, 8)}@gmail.com`);
    await call(`/auth/invitations/${forSomeoneElse.token}/otp`, { method: 'POST' });
    assert.equal((await accept(forSomeoneElse.token, { otp: otpFor(forSomeoneElse.email).at(-1)! }, existing.token)).body.error.code, 'EMAIL_MISMATCH');
    // Existing account, not signed in: still refused (it must sign in), never silently merged.
    const mine = await invite(o, existing.email);
    await call(`/auth/invitations/${mine.token}/otp`, { method: 'POST' });
    assert.equal((await accept(mine.token, newUserBody(otpFor(existing.email).at(-1)!))).body.error.code, 'ACCOUNT_EXISTS');
    noEmail();
  });

  await t.test('one account: Owner of its own workspace and Developer in another; permissions follow the workspace, no duplicate membership', async () => {
    newClient();
    const a = await owner(), b = await owner();
    useOutbox();
    const inv = await invite(b, a.email);
    await call(`/auth/invitations/${inv.token}/otp`, { method: 'POST' });
    const joined = await accept(inv.token, { otp: otpFor(a.email).at(-1)! }, a.token);
    assert.equal(joined.status, 201, joined.text);
    noEmail();
    const rows = (await pool.query('SELECT tenant_id, role FROM memberships WHERE user_id=$1 ORDER BY role', [a.userId])).rows;
    assert.deepEqual(rows.map((r) => r.role).sort(), ['developer', 'owner']);
    assert.equal(new Set(rows.map((r) => r.tenant_id)).size, 2);
    assert.equal((await call('/auth/me', { token: a.token, workspace: a.tenant })).body.data.workspace.role, 'owner');
    assert.equal((await call('/auth/me', { token: a.token, workspace: b.tenant })).body.data.workspace.role, 'developer');
    assert.equal((await call('/api/v1/billing', { token: a.token, workspace: a.tenant })).status, 200, 'owner of their own workspace');
    assert.equal((await call('/api/v1/billing', { token: a.token, workspace: b.tenant })).status, 403, 'only a developer in the other');
    assert.equal((await call('/api/v1/team', { token: a.token, workspace: b.tenant })).status, 403);
    assert.equal((await call('/api/v1/team', { token: a.token, workspace: a.tenant })).status, 200);
    // The owner cannot add a second (Developer) membership for themself.
    const dup = await call('/api/v1/team/invitations', { method: 'POST', token: a.token, workspace: a.tenant, body: { email: a.email, role: 'developer' } });
    assert.equal(dup.body.error.code, 'ALREADY_MEMBER');
    await assert.rejects(pool.query("INSERT INTO memberships(user_id,tenant_id,role) VALUES ($1,$2,'developer')", [a.userId, a.tenant]), /memberships_user_id_tenant_id_key|duplicate/);
    // Ownership is not movable through the members API.
    assert.equal((await call(`/api/v1/team/members/${a.userId}`, { method: 'PATCH', token: b.token, workspace: b.tenant, body: { role: 'owner' } })).status, 400);
  });

  await t.test('device management: Developer and Owner may delete through the API; Developer never touches billing or the team', async () => {
    newClient();
    const o = await owner(), dev = await owner();
    useOutbox();
    const inv = await invite(o, dev.email);
    await call(`/auth/invitations/${inv.token}/otp`, { method: 'POST' });
    assert.equal((await accept(inv.token, { otp: otpFor(dev.email).at(-1)! }, dev.token)).status, 201);
    noEmail();
    const key = `T${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    await pool.query('INSERT INTO devices(tenant_id,device_key,label) VALUES ($1,$2,$3)', [o.tenant, key, 'perangkat uji']);
    const asDev = { token: dev.token, workspace: o.tenant };
    assert.equal((await call('/api/v1/devices', asDev)).status, 200);
    const before = managerCalls.length;
    const del = await call(`/api/v1/devices/${key}`, { method: 'DELETE', ...asDev });
    assert.equal(del.status, 200, del.text);
    assert.equal(managerCalls.length, before + 1); assert.match(managerCalls.at(-1)!, /^DELETE \/devices\//);
    const key2 = `T${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    await pool.query('INSERT INTO devices(tenant_id,device_key,label) VALUES ($1,$2,$3)', [o.tenant, key2, 'perangkat uji 2']);
    assert.equal((await call(`/api/v1/devices/${key2}`, { method: 'DELETE', token: o.token })).status, 200, 'owner: developer powers without a second membership');
    for (const [method, route, body] of [['GET', '/api/v1/billing', undefined], ['POST', '/api/v1/billing/order', { plan_id: 'umkm', cycle: 'monthly' }], ['GET', '/api/v1/team', undefined],
      ['POST', '/api/v1/team/invitations', { email: 'q@gmail.com', role: 'developer' }], ['PATCH', `/api/v1/team/members/${o.userId}`, { role: 'developer' }], ['DELETE', `/api/v1/team/members/${o.userId}`, undefined],
      ['GET', '/api/v1/audit', undefined]] as const) {
      const r = await call(route, { method, body, ...asDev });
      assert.equal(r.status, 403, `${method} ${route}: ${r.text}`);
    }
    // The owner can.
    assert.equal((await call('/api/v1/billing', { token: o.token })).status, 200);
    assert.equal((await call('/api/v1/team', { token: o.token })).status, 200);
  });

  await t.test('Gmail aliases share one limiter bucket across invitations and workspaces; the original address is still what gets mailed', async () => {
    newClient(); useOutbox();
    const one = await owner(), two = await owner();
    const a = `ali.as${randomUUID().slice(0, 6)}@gmail.com`;
    const b = a.replace('.', '').replace('@', '+tag@');
    const invA = await invite(one, a), invB = await invite(two, b);
    const send = (inv: { token: string; id: string }) => call(`/auth/invitations/${inv.token}/otp`, { method: 'POST' });
    const pause = () => pool.query("UPDATE invitation_otps SET created_at = created_at - interval '2 minutes'");
    assert.equal((await send(invA)).status, 200); assert.equal((await send(invB)).status, 200);
    await pause();
    assert.equal((await send(invA)).status, 200);
    await pause();
    const blocked = await send(invB); // fourth mail to the same inbox in one hour, through a different invitation and workspace
    assert.equal(blocked.status, 429, blocked.text); assert.equal(blocked.body.error.code, 'OTP_RATE_LIMITED');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0 && Number(blocked.headers.get('retry-after')) <= 3600);
    assert.ok(!blocked.text.includes('gmail'), 'the refusal reveals nothing about other sends');
    assert.equal(otpFor(a).length, 2); assert.equal(otpFor(b).length, 1); // mailed to the ORIGINAL addresses
    assert.equal(otpFor(a.replace('.', '')).length, 0);
    const stored = (await pool.query('SELECT email FROM invitations WHERE id = ANY($1)', [[invA.id, invB.id]])).rows.map((r) => r.email).sort();
    assert.deepEqual(stored, [a, b].sort(), 'invitation addresses are never altered');
    noEmail();
  });

  await t.test('Owner email verification: gates inviting and ordering only; non-Gmail sign-up works; devices and messaging are unaffected', async () => {
    newClient(); noEmail();
    const campus = `mahasiswa${randomUUID().slice(0, 6)}@kampus.ac.id`;
    const o = await owner(campus, false); // unverified, non-Gmail, on a paid plan
    assert.equal((await call('/auth/me', { token: o.token })).body.data.user.email_verified, false);
    assert.equal((await call('/api/v1/devices', { token: o.token })).status, 200);
    assert.equal((await call('/api/v1/team', { token: o.token })).status, 200);
    assert.equal((await call('/api/v1/billing', { token: o.token })).status, 200);
    const gated: Array<[string, string, unknown]> = [['POST', '/api/v1/team/invitations', { email: 'x@gmail.com', role: 'developer' }],
      ['POST', '/api/v1/billing/orders', { plan: 'umkm', cycle: 'monthly' }], ['PATCH', `/api/v1/team/members/${o.userId}`, { role: 'developer' }], ['DELETE', `/api/v1/team/members/${o.userId}`, undefined]];
    for (const [method, route, body] of gated) {
      const r = await call(route, { method, token: o.token, body });
      assert.equal(r.status, 403, `${method} ${route}`); assert.equal(r.body.error.code, 'EMAIL_NOT_VERIFIED', route);
    }
    // No sender configured: fail safe, nothing counted.
    const before = (await pool.query('SELECT count(*)::int AS n FROM otp_rate_events')).rows[0].n;
    assert.equal((await call('/auth/email-verification/request', { method: 'POST', token: o.token })).body.error.code, 'EMAIL_NOT_CONFIGURED');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM otp_rate_events')).rows[0].n, before);
    useOutbox();
    assert.equal((await call('/auth/email-verification/request', { method: 'POST', token: o.token })).status, 200);
    const code = otpFor(campus).at(-1)!;
    assert.match(code, /^\d{6}$/);
    assert.equal((await call('/auth/email-verification/request', { method: 'POST', token: o.token })).body.error.code, 'OTP_COOLDOWN');
    assert.equal((await call('/auth/email-verification/confirm', { method: 'POST', token: o.token, body: { code: wrongCode(code) } })).body.error.code, 'OTP_INVALID');
    assert.equal((await call('/auth/email-verification/confirm', { method: 'POST', token: other(o.token), body: { code } })).status, 401);
    assert.equal((await call('/auth/email-verification/confirm', { method: 'POST', token: o.token, body: { code } })).status, 200);
    assert.equal((await call('/auth/email-verification/confirm', { method: 'POST', token: o.token, body: { code } })).body.error.code, 'OTP_INVALID', 'a code works once');
    assert.equal((await call('/auth/me', { token: o.token })).body.data.user.email_verified, true);
    assert.equal((await call('/auth/email-verification/request', { method: 'POST', token: o.token })).body.data.already_verified, true);
    assert.equal((await call('/api/v1/team/invitations', { method: 'POST', token: o.token, body: { email: `n${randomUUID().slice(0, 6)}@gmail.com`, role: 'developer' } })).status, 201);
    // Five wrong guesses kill a code.
    const p = await owner(`p${randomUUID().slice(0, 6)}@example.org`, false);
    await pool.query('DELETE FROM otp_rate_events');
    assert.equal((await call('/auth/email-verification/request', { method: 'POST', token: p.token })).status, 200);
    const pc = otpFor(p.email).at(-1)!;
    for (let i = 0; i < 5; i++) assert.equal((await call('/auth/email-verification/confirm', { method: 'POST', token: p.token, body: { code: wrongCode(pc) } })).status, 422);
    assert.equal((await call('/auth/email-verification/confirm', { method: 'POST', token: p.token, body: { code: pc } })).status, 422, 'exhausted');
    noEmail();
  });

  await t.test('atomic: consuming an OTP and setting email_verified_at succeed or fail together, for Owner verification and for invitations', async () => {
    newClient(); useOutbox();
    // -- Owner verification: a failure while setting email_verified_at must not burn the code.
    const email = `atom${randomUUID().slice(0, 6)}@kampus.ac.id`;
    const o = await owner(email, false);
    assert.equal((await call('/auth/email-verification/request', { method: 'POST', token: o.token })).status, 200);
    const code = otpFor(email).at(-1)!;
    await pool.query(`CREATE OR REPLACE FUNCTION test_block_verified() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.email_verified_at IS NOT NULL AND OLD.email_verified_at IS NULL THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER test_block_verified BEFORE UPDATE ON users FOR EACH ROW WHEN (OLD.id = '${o.userId}') EXECUTE FUNCTION test_block_verified()`);
    try {
      assert.equal((await call('/auth/email-verification/confirm', { method: 'POST', token: o.token, body: { code } })).status, 500);
    } finally { await pool.query('DROP TRIGGER test_block_verified ON users'); }
    const row = (await pool.query('SELECT consumed_at, attempts FROM email_verifications WHERE user_id=$1', [o.userId])).rows[0];
    assert.equal(row.consumed_at, null, 'the code is not consumed when the account could not be verified');
    assert.equal((await pool.query('SELECT email_verified_at FROM users WHERE id=$1', [o.userId])).rows[0].email_verified_at, null);
    // Two parallel confirms with the right code: exactly one wins, and afterwards both facts hold together.
    const parallel = await Promise.all([1, 2, 3].map(() => call('/auth/email-verification/confirm', { method: 'POST', token: o.token, body: { code } })));
    assert.deepEqual(parallel.map((r) => r.status).sort(), [200, 422, 422]);
    const after = (await pool.query('SELECT v.consumed_at, u.email_verified_at FROM email_verifications v JOIN users u ON u.id = v.user_id WHERE v.user_id=$1', [o.userId])).rows[0];
    assert.ok(after.consumed_at && after.email_verified_at);
    // A wrong guess still counts even though nothing else changed.
    const p = await owner(`atom2${randomUUID().slice(0, 6)}@example.org`, false);
    assert.equal((await call('/auth/email-verification/request', { method: 'POST', token: p.token })).status, 200);
    const pc = otpFor(p.email).at(-1)!;
    assert.equal((await call('/auth/email-verification/confirm', { method: 'POST', token: p.token, body: { code: wrongCode(pc) } })).status, 422);
    assert.equal((await pool.query('SELECT attempts FROM email_verifications WHERE user_id=$1', [p.userId])).rows[0].attempts, 1);

    // -- Invitation: a failure while joining must not burn the code, create the account, or accept the invitation.
    const host = await owner();
    const invited = `atom-inv-${randomUUID().slice(0, 6)}@gmail.com`;
    const inv = await invite(host, invited);
    assert.equal((await call(`/auth/invitations/${inv.token}/otp`, { method: 'POST' })).status, 200);
    const invCode = otpFor(invited).at(-1)!;
    await pool.query(`CREATE OR REPLACE FUNCTION test_block_membership() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$`);
    await pool.query(`CREATE TRIGGER test_block_membership BEFORE INSERT ON memberships FOR EACH ROW WHEN (NEW.tenant_id = '${host.tenant}') EXECUTE FUNCTION test_block_membership()`);
    try {
      assert.equal((await accept(inv.token, newUserBody(invCode))).status, 500);
    } finally { await pool.query('DROP TRIGGER test_block_membership ON memberships'); }
    assert.equal((await pool.query('SELECT consumed_at FROM invitation_otps WHERE invitation_id=$1', [inv.id])).rows[0].consumed_at, null, 'code not burned');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM users WHERE lower(email)=$1', [invited])).rows[0].n, 0, 'no half-created account');
    assert.equal((await pool.query('SELECT accepted_at FROM invitations WHERE id=$1', [inv.id])).rows[0].accepted_at, null);
    assert.equal((await pool.query('SELECT attempts FROM invitation_otps WHERE invitation_id=$1', [inv.id])).rows[0].attempts, 1, 'the attempt itself is counted');
    // Same code, several parallel accepts after the fault is gone: exactly one succeeds.
    const race = await Promise.all([1, 2, 3].map(() => accept(inv.token, newUserBody(invCode))));
    assert.equal(race.filter((r) => r.status === 201).length, 1);
    assert.ok(race.filter((r) => r.status !== 201).every((r) => [401, 404].includes(r.status)), 'losers get OTP_INVALID or INVITATION_INVALID, never a second membership');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM memberships m JOIN users u ON u.id=m.user_id WHERE lower(u.email)=$1', [invited])).rows[0].n, 1);
    const joined = (await pool.query('SELECT u.email_verified_at, o.consumed_at, i.accepted_at FROM users u, invitation_otps o, invitations i WHERE lower(u.email)=$1 AND o.invitation_id=$2 AND i.id=$2', [invited, inv.id])).rows[0];
    assert.ok(joined.email_verified_at && joined.consumed_at && joined.accepted_at, 'account, verification, code and invitation all changed together');
    noEmail();
  });

  await t.test('legacy admin/viewer memberships keep their historical access but nothing can create or assign them', async () => {
    newClient();
    const o = await owner();
    const viewer = await owner(), admin = await owner();
    await pool.query('ALTER TABLE memberships DISABLE TRIGGER memberships_no_new_legacy_role'); // simulate rows that existed before migration 021
    try {
      await pool.query("INSERT INTO memberships(user_id,tenant_id,role) VALUES ($1,$2,'viewer'), ($3,$2,'admin')", [viewer.userId, o.tenant, admin.userId]);
    } finally { await pool.query('ALTER TABLE memberships ENABLE TRIGGER memberships_no_new_legacy_role'); }
    const asViewer = { token: viewer.token, workspace: o.tenant }, asAdmin = { token: admin.token, workspace: o.tenant };
    assert.equal((await call('/api/v1/devices', asViewer)).status, 200);
    assert.equal((await call('/api/v1/devices/X', { method: 'DELETE', ...asViewer })).status, 403);
    assert.equal((await call('/api/v1/team', asViewer)).status, 403);
    assert.equal((await call('/api/v1/billing', asAdmin)).status, 403);
    assert.equal((await call('/api/v1/team', asAdmin)).status, 200, 'historical access kept');
    assert.equal((await call('/api/v1/team/invitations', { method: 'POST', ...asAdmin, body: { email: 'n@gmail.com', role: 'developer' } })).status, 403, 'a legacy admin can no longer invite');
    assert.equal((await call(`/api/v1/team/members/${viewer.userId}`, { method: 'PATCH', token: o.token, body: { role: 'admin' } })).status, 400);
    assert.equal((await call(`/api/v1/team/members/${viewer.userId}`, { method: 'PATCH', token: o.token, body: { role: 'viewer' } })).status, 400);
    // No silent upgrade: still legacy until the owner explicitly chooses.
    assert.deepEqual((await pool.query('SELECT role FROM memberships WHERE tenant_id=$1 AND user_id IN ($2,$3) ORDER BY role', [o.tenant, viewer.userId, admin.userId])).rows.map((r) => r.role), ['admin', 'viewer']);
    assert.equal((await call(`/api/v1/team/members/${viewer.userId}`, { method: 'PATCH', token: o.token, body: { role: 'developer' } })).status, 200, 'explicit owner decision');
    assert.equal((await pool.query('SELECT role FROM memberships WHERE user_id=$1 AND tenant_id=$2', [viewer.userId, o.tenant])).rows[0].role, 'developer');
    assert.equal((await login(viewer.email, password, meta)).workspaces.length >= 1, true);
  });

  await t.test('owner-issued 60-day notice preserves access, then suspends only unresolved legacy memberships without deleting or promoting them', async () => {
    newClient();
    const o = await owner();
    const admin = await owner(), viewer = await owner();
    await pool.query('ALTER TABLE memberships DISABLE TRIGGER memberships_no_new_legacy_role');
    try {
      await pool.query("INSERT INTO memberships(user_id,tenant_id,role) VALUES ($1,$2,'admin'),($3,$2,'viewer')", [admin.userId, o.tenant, viewer.userId]);
    } finally { await pool.query('ALTER TABLE memberships ENABLE TRIGGER memberships_no_new_legacy_role'); }

    const scopedKey = newApiKey();
    await pool.query(
      `INSERT INTO api_keys (tenant_id, name, prefix, key_hash, scopes, created_by)
       VALUES ($1, 'Transition test', $2, $3, ARRAY['devices:read'], $4)`,
      [o.tenant, scopedKey.prefix, scopedKey.hash, o.userId],
    );

    assert.equal((await call('/api/v1/devices', { token: admin.token, workspace: o.tenant })).status, 200, 'no notice means no clock');
    assert.equal((await call('/api/v1/devices', { token: scopedKey.key })).status, 200, 'scoped API key works before the notice deadline');
    assert.equal((await call('/api/v1/team/legacy-role-notice', { method: 'POST', token: admin.token, workspace: o.tenant, body: { confirm: true } })).status, 403, 'only Owner can issue notice');
    const ownerPage = await call('/api/v1/team/legacy-role-notice', { method: 'POST', token: o.token, workspace: o.tenant, body: { confirm: true } });
    assert.equal(ownerPage.status, 201, ownerPage.text);
    const sent = new Date(ownerPage.body.data.notice_sent_at as string), deadline = new Date(ownerPage.body.data.deadline_at as string);
    assert.equal(deadline.getTime() - sent.getTime(), 60 * 24 * 60 * 60 * 1000, 'deadline is exactly 60 UTC days after formal notice');
    assert.deepEqual((await pool.query('SELECT role FROM memberships WHERE tenant_id=$1 AND user_id IN ($2,$3) ORDER BY role', [o.tenant, admin.userId, viewer.userId])).rows.map((r) => r.role), ['admin', 'viewer'], 'issuing notice does not change roles');
    assert.equal((await call('/api/v1/devices', { token: admin.token, workspace: o.tenant })).status, 200, 'legacy access remains through the deadline');
    const repeated = await call('/api/v1/team/legacy-role-notice', { method: 'POST', token: o.token, workspace: o.tenant, body: { confirm: true } });
    assert.equal(repeated.status, 200, 'repeated request cannot restart the clock');
    assert.equal(repeated.body.data.deadline_at, ownerPage.body.data.deadline_at);

    await pool.query(`UPDATE legacy_role_notices SET notice_sent_at=now()-interval '61 days', deadline_at=now()-interval '1 day' WHERE tenant_id=$1`, [o.tenant]);
    const suspended = await call('/api/v1/devices', { token: admin.token, workspace: o.tenant });
    assert.equal(suspended.status, 403);
    assert.equal(suspended.body.error.code, 'LEGACY_ROLE_TRANSITION_EXPIRED');
    assert.match(suspended.body.error.message, /Owner menentukan peran/);
    const apiCredentials = [{ token: scopedKey.key }];
    for (const credentials of apiCredentials) {
      const deniedKey = await call('/api/v1/devices', credentials);
      assert.equal(deniedKey.status, 403, 'API key cannot bypass an expired workspace transition');
      assert.equal(deniedKey.body.error.code, 'LEGACY_ROLE_TRANSITION_EXPIRED');
    }
    assert.equal((await call('/api/v1/team', { token: o.token, workspace: o.tenant })).body.data.legacy_role_transition.phase, 'suspended', 'owner can still access the member-management page');
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM memberships WHERE tenant_id=$1 AND role IN ('admin','viewer')", [o.tenant])).rows[0].n, 2, 'no auto-promotion or deletion at day 60');
    assert.equal((await call(`/api/v1/team/members/${admin.userId}`, { method: 'PATCH', token: o.token, workspace: o.tenant, body: { role: 'developer' } })).status, 200, 'Owner can make an explicit decision after expiry');
    assert.equal((await call('/api/v1/devices', { token: admin.token, workspace: o.tenant })).status, 200, 'only an explicitly converted member regains access');
    assert.equal((await call('/api/v1/devices', { token: viewer.token, workspace: o.tenant })).status, 403, 'unresolved Viewer remains suspended');
    assert.equal((await call(`/api/v1/team/members/${viewer.userId}`, { method: 'PATCH', token: o.token, workspace: o.tenant, body: { role: 'developer' } })).status, 200);
    assert.equal((await call('/api/v1/devices', { token: scopedKey.key })).status, 200, 'scoped key resumes after the owner resolves every legacy membership');
  });

  await t.test('Password reset: emailed 6-digit code, no account enumeration, old sessions revoked, wrong/reused code refused', async () => {
    useOutbox();
    try {
      const o = await owner();
      const resetCodeFor = (to: string): string | undefined => {
        if (!fs.existsSync(outbox)) return undefined;
        const last = fs.readFileSync(outbox, 'utf8').trim().split('\n').filter(Boolean)
          .map((l) => JSON.parse(l) as { to: string; body: string }).filter((m) => m.to === to).at(-1);
        return last?.body.match(/\b(\d{6})\b/)?.[1];
      };
      const unknownEmail = `nobody-${randomUUID()}@example.test`;
      const req1 = await call('/auth/password-reset/request', { method: 'POST', body: { email: o.email } });
      assert.equal(req1.status, 200);
      const req2 = await call('/auth/password-reset/request', { method: 'POST', body: { email: unknownEmail } });
      assert.equal(req2.status, 200, 'an unknown address gets the same generic response');
      assert.equal(resetCodeFor(unknownEmail), undefined, 'and genuinely no email was sent to it');
      const code = resetCodeFor(o.email)!;
      assert.match(code, /^\d{6}$/);

      const wrong = await call('/auth/password-reset/confirm', { method: 'POST', body: { email: o.email, code: '000000', new_password: 'another-strong-password-1' } });
      assert.equal(wrong.status, 422);

      // The session from owner() is still valid right up until the reset succeeds.
      assert.equal((await call('/auth/me', { token: o.token })).status, 200);

      const newPassword = 'another-strong-password-1';
      const confirm = await call('/auth/password-reset/confirm', { method: 'POST', body: { email: o.email, code, new_password: newPassword } });
      assert.equal(confirm.status, 200, confirm.text);

      assert.equal((await call('/auth/me', { token: o.token })).status, 401, 'every session is revoked by a successful reset');
      const reuse = await call('/auth/password-reset/confirm', { method: 'POST', body: { email: o.email, code, new_password: 'yet-another-password-2' } });
      assert.equal(reuse.status, 422, 'the code is single-use');

      const oldPasswordLogin = await call('/auth/login', { method: 'POST', body: { email: o.email, password } });
      assert.equal(oldPasswordLogin.status, 401);
      const newPasswordLogin = await call('/auth/login', { method: 'POST', body: { email: o.email, password: newPassword } });
      assert.equal(newPasswordLogin.status, 200);
    } finally { noEmail(); }
  });

  await t.test('legacy static API key: fully removed (no fallback path), and the owner-run cutover script provisions a scoped key then clears it, never printing either value', async () => {
    // tenants.api_key is nullable but still present (migration 034); a row with a value simulates one of
    // the pre-existing tenants from before 2026-10-02's removal. owner() itself never sets api_key any more.
    const legacy = await owner();
    const fakeLegacyKey = `wg_${randomBytes(24).toString('hex')}`;
    await pool.query('UPDATE tenants SET api_key = $2 WHERE id = $1', [legacy.tenant, fakeLegacyKey]);

    // The old static key never authenticates: there is no code path left that reads tenants.api_key for auth.
    const deniedLegacy = await call('/api/v1/devices', { apiKey: fakeLegacyKey });
    assert.equal(deniedLegacy.status, 401, 'the static key format is simply an unrecognised apikey now');

    const provisionDry = await runMigrationScript(['provision']);
    assert.equal(provisionDry.code, 0, provisionDry.err);
    assert.match(provisionDry.out, /tenant\(s\) need a scoped key/);
    assert.match(provisionDry.out, new RegExp(legacy.tenant));
    assert.doesNotMatch(provisionDry.out, /wg_|wgk_/, 'dry-run never prints a key value');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM api_keys WHERE tenant_id=$1', [legacy.tenant])).rows[0].n, 0, 'dry-run creates nothing');

    const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'koneva-legacy-key-cutover-'));
    const outFile = path.join(outDir, 'new-keys.jsonl');
    await fsp.writeFile(outFile, '', { mode: 0o600 });
    const provisioned = await runMigrationScript(['provision', '--out', outFile, '--execute']);
    assert.equal(provisioned.code, 0, provisioned.err);
    assert.doesNotMatch(provisioned.out, /wg_[0-9a-f]{40,}|wgk_[A-Za-z0-9_-]{30,}/, 'the stdout summary never prints a key value');
    const scopedRow = (await pool.query<{ key_hash: string; scopes: string[] }>('SELECT key_hash, scopes FROM api_keys WHERE tenant_id=$1', [legacy.tenant])).rows[0]!;
    assert.ok(scopedRow, 'a scoped key row was created');
    assert.ok(!scopedRow.scopes.includes('billing:manage') && !scopedRow.scopes.includes('keys:manage') && !scopedRow.scopes.includes('team:manage'), 'ceiling matches KEY_SCOPES, never the management scopes');
    const fileLine = (await fsp.readFile(outFile, 'utf8')).trim();
    assert.match(fileLine, new RegExp(`"tenant_id":"${legacy.tenant}"`));
    assert.match(fileLine, /"key":"wgk_/, 'the new key is written only to the private --out file');
    assert.equal((await pool.query('SELECT api_key FROM tenants WHERE id=$1', [legacy.tenant])).rows[0].api_key, fakeLegacyKey, 'provision alone does not touch the legacy key yet');
    assert.equal((await fsp.stat(outFile)).mode & 0o777, 0o600);

    // Idempotent: a second provision run finds nothing left to do for this tenant.
    const provisionAgain = await runMigrationScript(['provision']);
    assert.doesNotMatch(provisionAgain.out, new RegExp(legacy.tenant), 're-running provision skips an already-migrated tenant');

    // A second tenant, also legacy, left un-provisioned on purpose: cutover must refuse to touch it.
    const notReady = await owner();
    const notReadyKey = `wg_${randomBytes(24).toString('hex')}`;
    await pool.query('UPDATE tenants SET api_key = $2 WHERE id = $1', [notReady.tenant, notReadyKey]);

    const cutoverDry = await runMigrationScript(['cutover']);
    assert.equal(cutoverDry.code, 0, cutoverDry.err);
    assert.match(cutoverDry.out, new RegExp(`${legacy.tenant}[\\s\\S]*ready`));
    assert.match(cutoverDry.out, /NOT ready/);
    assert.match(cutoverDry.out, new RegExp(notReady.tenant));

    const cutoverExec = await runMigrationScript(['cutover', '--execute']);
    assert.equal(cutoverExec.code, 0, cutoverExec.err);
    assert.equal((await pool.query('SELECT api_key FROM tenants WHERE id=$1', [legacy.tenant])).rows[0].api_key, null, 'the ready tenant is cut over');
    assert.equal((await pool.query('SELECT api_key FROM tenants WHERE id=$1', [notReady.tenant])).rows[0].api_key, notReadyKey, 'a tenant with no scoped key yet is left untouched');

    await fsp.rm(outDir, { recursive: true, force: true });
  });

  await t.test('legacy static API key: the guarded column-drop script refuses while any tenant still has one, and succeeds once none do', async () => {
    // Exercises scripts/drop-legacy-api-key-column.sql's exact SQL text (run deliberately by
    // scripts/drop-legacy-api-key-column.ts, never by the automatic migrations/ sweep) against a
    // throwaway schema-qualified replica of `tenants`, so this never risks the shared suite database.
    const client = await pool.connect();
    const schema = `cutover_guard_test_${randomUUID().replace(/-/g, '')}`;
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}, public`);
      await client.query('CREATE TABLE tenants (id uuid PRIMARY KEY, api_key text)');
      await client.query("INSERT INTO tenants (id, api_key) VALUES ('11111111-1111-4111-8111-111111111111', 'still-has-a-key')");
      const migrationSql = await fsp.readFile(path.join(root, 'scripts/drop-legacy-api-key-column.sql'), 'utf8');
      await assert.rejects(() => client.query(migrationSql), /Refusing to drop tenants\.api_key: 1 tenant/);
      const stillThere = await client.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='tenants' AND column_name='api_key'`, [schema]);
      assert.equal(stillThere.rowCount, 1, 'the column survives a refused attempt');

      await client.query('UPDATE tenants SET api_key = NULL');
      await client.query(migrationSql);
      const goneNow = await client.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='tenants' AND column_name='api_key'`, [schema]);
      assert.equal(goneNow.rowCount, 0, 'the column is dropped once no tenant has a value');
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
    }
  });
});

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import pool from '../shared/database/connection';

// Runs the REAL src/api-gateway/index.ts as a child process (scripts/test-operator-entry.sh: disposable PostgreSQL + Redis).
const enabled = process.env['OPERATOR_ENTRY_TEST'] === '1';
if (enabled) {
  // Safety net: a test run must never be able to send real email, whatever the developer's .env contains.
  assert.ok(['none', 'dev-outbox', undefined].includes(process.env['EMAIL_TRANSPORT']) && !process.env['GMAIL_OAUTH_REFRESH_TOKEN'],
    'refusing to run: EMAIL_TRANSPORT/GMAIL_* must be pinned by the test scripts (see scripts/test-operator-*.sh)');
}
const root = path.join(__dirname, '../..');
const strong = randomBytes(24).toString('hex');
const password = 'synthetic-test-password-26';

const freePort = () => new Promise<number>((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });

interface Running { port: number; child: ChildProcess; output: () => string; stop: () => Promise<void> }
async function start(env: Record<string, string>): Promise<Running> {
  const port = await freePort();
  const child = spawn(process.execPath, ['--require', 'ts-node/register', 'src/api-gateway/index.ts'], { cwd: root, env: { ...process.env, PORT: String(port), ...env } });
  let text = '';
  child.stdout.on('data', (d) => { text += String(d); }); child.stderr.on('data', (d) => { text += String(d); });
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`entrypoint exited early (${child.exitCode}): ${text.slice(-400)}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* not yet */ }
    if (Date.now() > deadline) { child.kill(); throw new Error('entrypoint did not start'); }
    await new Promise((r) => setTimeout(r, 300));
  }
  return { port, child, output: () => text, stop: () => new Promise((resolve) => { if (child.exitCode !== null) resolve(); else { child.once('exit', () => resolve()); child.kill('SIGTERM'); } }) };
}
/** Expect the process to refuse to start: exits non-zero and never accepts a connection. */
async function mustFail(env: Record<string, string>, pattern: RegExp): Promise<void> {
  const port = await freePort();
  const child = spawn(process.execPath, ['--require', 'ts-node/register', 'src/api-gateway/index.ts'], { cwd: root, env: { ...process.env, PORT: String(port), ...env } });
  let text = '';
  child.stdout.on('data', (d) => { text += String(d); }); child.stderr.on('data', (d) => { text += String(d); });
  const code = await new Promise<number | null>((resolve) => { const timer = setTimeout(() => { child.kill(); resolve(null); }, 60_000); child.once('exit', (c) => { clearTimeout(timer); resolve(c); }); });
  assert.notEqual(code, null, 'must exit, not keep running');
  assert.notEqual(code, 0);
  assert.match(text, pattern);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`), 'must not be listening');
}

const production = { NODE_ENV: 'production', ADMIN_API_KEY: strong, JWT_SECRET: strong };
const operatorOn = { OPERATOR_ENABLED: 'true', OPERATOR_ALLOWED_ORIGIN: 'http://localhost:13000' };

test('real entrypoint: startup failures, middleware, cookies, proxy config, error handling', { skip: !enabled }, async (t) => {
  const passwordHash = await bcrypt.hash(password, 10);
  const all = ['payments:read', 'payments:confirm', 'students:read', 'students:decide', 'workspaces:read', 'audit:read'];
  async function operator() {
    const id = randomUUID(), email = `${id}@example.test`;
    await pool.query('INSERT INTO operators(id,email,name,password_hash,permissions) VALUES ($1,$2,$3,$4,$5)', [id, email, 'Operator Uji', passwordHash, all]);
    return { id, email };
  }
  const client = (server: Running, ip: string, origin = 'http://localhost:13000') => async (route: string, o: { method?: string; body?: unknown; cookie?: string; csrf?: string; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { Origin: origin, 'X-Requested-With': 'koneva-operator', 'X-Forwarded-For': ip, ...o.headers };
    if (o.cookie) headers['Cookie'] = o.cookie;
    if (o.csrf) headers['X-CSRF-Token'] = o.csrf;
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(`http://127.0.0.1:${server.port}${route}`, { method: o.method ?? 'GET', headers, ...(o.body !== undefined ? { body: typeof o.body === 'string' ? o.body : JSON.stringify(o.body) } : {}) });
    const text = await r.text();
    let body: any; try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; } // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: r.status, headers: r.headers, text, body };
  };
  let ipCounter = 0;
  const nextIp = () => `198.51.100.${(ipCounter += 1)}`;

  await t.test('invalid security configuration stops startup before the server listens', async () => {
    await mustFail({ ...operatorOn, OPERATOR_COOKIE_SECURE: 'false', OPERATOR_COOKIE_NAME: 'koneva_op' }, /Weak operator cookies/);
    await mustFail({ ...operatorOn, OPERATOR_ALLOWED_ORIGIN: 'http://panel.example.test' }, /loopback/);
    await mustFail({ ...production, OPERATOR_INSECURE_DEV_COOKIES: 'true' }, /Insecure operator cookie/);
    await mustFail({ ...production, OPERATOR_COOKIE_SECURE: 'false' }, /Insecure operator cookie/);
    await mustFail({ ...production, ...operatorOn, OPERATOR_ALLOWED_ORIGIN: 'https://panel.example.test' }, /OPERATOR_ALLOW_PRODUCTION/);
    await mustFail({ ...production, ...operatorOn, OPERATOR_ALLOW_PRODUCTION: 'true' }, /https origin|loopback/);
    await mustFail({ ...operatorOn, OPERATOR_IDEMPOTENCY_RETENTION_DAYS: '1' }, /RETENTION_DAYS/);
    await mustFail({ NODE_ENV: 'production', ADMIN_API_KEY: 'change_me_please', JWT_SECRET: strong }, /too weak/);
    await mustFail({ ADMIN_ALLOWED_NETWORKS: 'not-an-ip' }, /ADMIN_ALLOWED_NETWORKS/);
    await mustFail({ OTP_SENDER_DAILY_CAP: '0' }, /OTP_SENDER_DAILY_CAP/);
    // Mail settings: a development outbox can never run in production, and an unsupported transport is refused (no silent fallback).
    await mustFail({ ...production, EMAIL_TRANSPORT: 'dev-outbox', DEV_EMAIL_OUTBOX_FILE: '/tmp/koneva-never.jsonl' }, /forbidden in production/);
    await mustFail({ EMAIL_TRANSPORT: 'smtp' }, /not supported/);
    await mustFail({ EMAIL_TRANSPORT: 'dev-outbox', DEV_EMAIL_OUTBOX_FILE: 'relative.jsonl' }, /absolute/);
  });

  await t.test('development-style instance: middleware order, headers, error handlers, strict cookie via the real Express app', async () => {
    const server = await start({ ...operatorOn, TRUST_PROXY_HOPS: '1' }); // default cookie config: __Host-koneva_op, Secure
    try {
      const api = client(server, nextIp());
      const health = await fetch(`http://127.0.0.1:${server.port}/health`);
      assert.equal(health.headers.get('x-powered-by'), null);
      assert.equal(health.headers.get('x-content-type-options'), 'nosniff'); // helmet
      assert.equal((await fetch(`http://127.0.0.1:${server.port}/ready`)).status, 200, 'PostgreSQL and Redis reachable');
      const me = await api('/operator/me');
      assert.equal(me.status, 401); assert.equal(me.headers.get('cache-control'), 'no-store'); assert.equal(me.headers.get('access-control-allow-origin'), null);
      const preflight = await fetch(`http://127.0.0.1:${server.port}/operator/me`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
      assert.equal(preflight.headers.get('access-control-allow-origin'), null, 'no CORS on the operator surface');
      // Own error handling: malformed JSON never echoes the body; unknown routes use the generic 404; the generic handler keeps its shape.
      const malformed = await api('/operator/auth/login', { method: 'POST', body: '{"note":"PRIVATE' });
      assert.equal(malformed.status, 400); assert.ok(!malformed.text.includes('PRIVATE'));
      assert.equal((await api('/nonexistent')).body.error.code, 'NOT_FOUND');
      assert.equal((await api('/auth/login', { method: 'POST', body: '{bad' })).body.error.code, 'INVALID_JSON');
      assert.equal((await api('/operator/nope')).status, 401, 'unknown operator paths do not reveal themselves without a session');
      // Full sign-in through the real app; cookie attributes exactly as designed, and the CSRF token is not in a cookie.
      const op = await operator();
      const done = await api('/operator/auth/login', { method: 'POST', body: { email: op.email, password } });
      assert.equal(done.status, 200, done.text);
      assert.equal(done.body.data.status, 'authenticated');
      const setCookie = done.headers.get('set-cookie')!;
      assert.match(setCookie, /^__Host-koneva_op=[a-f0-9]{64}; /); assert.match(setCookie, /Path=\//); assert.match(setCookie, /HttpOnly/);
      assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Strict/); assert.ok(!/Domain=/i.test(setCookie));
      assert.ok(!setCookie.includes(done.body.data.csrf_token));
      const cookie = setCookie.split(';')[0]!;
      assert.equal((await api('/operator/me', { cookie })).status, 200);
      // Origin is enforced on mutations (through the real middleware chain), including behind the proxy configuration.
      assert.equal((await client(server, nextIp(), 'https://evil.example')('/operator/auth/logout', { method: 'POST', cookie, csrf: done.body.data.csrf_token })).status, 403);
      // Redis being unreachable does not affect the operator surface (it does not use Redis).
    } finally { await server.stop(); }
    const noRedis = await start({ ...operatorOn, REDIS_URL: 'redis://127.0.0.1:1' });
    try { assert.equal((await client(noRedis, nextIp())('/operator/me')).status, 401); } finally { await noRedis.stop(); }
  });

  await t.test('production-mode instance: /admin is localhost-only by default, legacy billing writes are closed, operator cookie/admin key never cross', async () => {
    const server = await start({ ...production, ...operatorOn, OPERATOR_ALLOWED_ORIGIN: 'https://panel.example.test', OPERATOR_ALLOW_PRODUCTION: 'true', TRUST_PROXY_HOPS: '1' });
    try {
      const loopback = client(server, '127.0.0.1', 'https://panel.example.test'), privateNet = client(server, '10.20.30.40', 'https://panel.example.test'), publicNet = client(server, '203.0.113.50', 'https://panel.example.test');
      assert.equal((await publicNet('/admin/plans', { headers: { 'x-admin-key': strong } })).body.error.code, 'ADMIN_NETWORK_FORBIDDEN', 'a public client is stopped before the key is even checked');
      assert.equal((await privateNet('/admin/plans', { headers: { 'x-admin-key': strong } })).body.error.code, 'ADMIN_NETWORK_FORBIDDEN', 'a private non-loopback client is also rejected under the localhost-only default');
      assert.equal((await loopback('/admin/plans', { headers: { 'x-admin-key': strong } })).status, 200);
      assert.equal((await loopback('/admin/plans')).status, 401);
      assert.equal((await loopback('/admin/plans', { headers: { 'x-admin-key': 'wrong' } })).status, 401);
      // Operator credentials are not admin credentials, and the admin key is not an operator credential.
      const op = await operator();
      const loginResult = await loopback('/operator/auth/login', { method: 'POST', body: { email: op.email, password } });
      assert.equal(loginResult.status, 200, loginResult.text);
      const cookie = loginResult.headers.get('set-cookie')!.split(';')[0]!;
      assert.equal((await loopback('/admin/plans', { cookie })).status, 401);
      assert.equal((await loopback('/admin/plans', { headers: { Authorization: `Bearer ${cookie.split('=')[1]}` } })).status, 401);
      assert.equal((await loopback('/operator/me', { headers: { 'x-admin-key': strong } })).status, 401);
      assert.equal((await loopback('/operator/me', { cookie })).status, 200);
      // Legacy payment/student writes: closed while the panel is enabled; reads and unreplaced maintenance stay.
      const id = randomUUID();
      const pay = await loopback(`/admin/invoices/${id}/pay`, { method: 'POST', body: { method: 'transfer' }, headers: { 'x-admin-key': strong } });
      assert.equal(pay.status, 403); assert.equal(pay.body.error.code, 'LEGACY_ENDPOINT_DISABLED');
      assert.equal((await loopback(`/admin/tenant/${id}/student-verify`, { method: 'POST', body: { approved: true }, headers: { 'x-admin-key': strong } })).body.error.code, 'LEGACY_ENDPOINT_DISABLED');
      assert.notEqual((await loopback(`/admin/invoices/${id}/void`, { method: 'POST', headers: { 'x-admin-key': strong } })).body?.error?.code, 'LEGACY_ENDPOINT_DISABLED', 'void has no replacement yet and stays');
      assert.equal((await loopback('/admin/invoices', { headers: { 'x-admin-key': strong } })).status, 200);
    } finally { await server.stop(); }
    // The panel off (today's production state): legacy writes keep working exactly as before.
    const off = await start({ ...production, TRUST_PROXY_HOPS: '1', OPERATOR_ENABLED: 'false' });
    try {
      const pay = await client(off, '127.0.0.1')(`/admin/invoices/${randomUUID()}/pay`, { method: 'POST', body: { method: 'transfer' }, headers: { 'x-admin-key': strong } });
      assert.equal(pay.status, 404, 'reaches the business logic (invoice does not exist), not the guard');
      assert.equal((await client(off, '127.0.0.1')('/operator/me')).body.error.code, 'OPERATOR_DISABLED');
    } finally { await off.stop(); }
  });

  await t.test('OTP limits are shared across API processes and answer 429 with Retry-After through the real error handler', async () => {
    const outbox = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'koneva-entry-outbox-')), 'outbox.jsonl');
    const env = { ...operatorOn, TRUST_PROXY_HOPS: '1', EMAIL_TRANSPORT: 'dev-outbox', DEV_EMAIL_OUTBOX_FILE: outbox };
    const [one, two] = await Promise.all([start(env), start(env)]);
    try {
      const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
      const token = `wgi_${'a'.repeat(43)}`; // well-formed but unknown
      const hit = (server: Running) => client(server, ip)(`/auth/invitations/${token}/otp`, { method: 'POST' });
      // Twelve requests to each process: neither process's own in-memory limiter (20) trips, but the shared budget is 20 per 15 minutes.
      const results: Array<Awaited<ReturnType<typeof hit>>> = [];
      for (let i = 0; i < 12; i++) { results.push(await hit(one)); results.push(await hit(two)); }
      const accepted = results.filter((r) => r.status === 404), limited = results.filter((r) => r.status === 429);
      assert.equal(accepted.length, 20, 'exactly the shared budget got through (to the invitation lookup)');
      assert.equal(limited.length, 4);
      for (const r of limited) { assert.equal(r.body.error.code, 'OTP_RATE_LIMITED'); assert.ok(Number(r.headers.get('retry-after')) > 0); }
      assert.equal(existsSync(outbox), false, 'no mail is written for unknown invitations');
      // Another address is unaffected.
      assert.equal((await client(one, '198.18.0.9')(`/auth/invitations/${token}/otp`, { method: 'POST' })).status, 404);
    } finally { await Promise.all([one.stop(), two.stop()]); await fs.rm(path.dirname(outbox), { recursive: true, force: true }); }
  });

  await t.test('rate limits with the REAL configuration (no raised limits, no bucket resets): 429 + Retry-After, isolation, recovery after the window', async () => {
    const server = await start({ ...operatorOn, TRUST_PROXY_HOPS: '1' });
    try {
      const retryAfter = (r: { headers: Headers }) => Number(r.headers.get('retry-after'));
      // Per account: five failures, then 429 even for the right password; another account and another address are unaffected.
      const victim = await operator(), bystander = await operator();
      const ip = nextIp(), api = client(server, ip);
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await api('/operator/auth/login', { method: 'POST', body: { email: victim.email, password: `wrong-password-${i}-xx` } })).status);
      assert.deepEqual(statuses, [401, 401, 401, 401, 401]);
      const blocked = await api('/operator/auth/login', { method: 'POST', body: { email: victim.email, password } });
      assert.equal(blocked.status, 429); assert.equal(blocked.body.error.code, 'RATE_LIMITED');
      assert.ok(retryAfter(blocked) > 0 && retryAfter(blocked) <= 900, `Retry-After ${blocked.headers.get('retry-after')}`);
      assert.equal((await client(server, nextIp())('/operator/auth/login', { method: 'POST', body: { email: victim.email, password } })).status, 429, 'the account bucket is per account, whatever the address');
      assert.equal((await api('/operator/auth/login', { method: 'POST', body: { email: bystander.email, password } })).status, 200, 'a different account from the same address still works');
      // Recovery: the window is shortened in the database to 2 s (15 real minutes are impractical); the server's own expiry logic then runs for real.
      await pool.query("UPDATE operator_login_attempts SET expires_at = now() + interval '2 seconds' WHERE expires_at > now() + interval '1 minute' AND attempts > 5");
      await new Promise((r) => setTimeout(r, 3000));
      const recovered = await api('/operator/auth/login', { method: 'POST', body: { email: victim.email, password } });
      assert.equal(recovered.status, 200, 'accepted again once the window ended');
      // Per address: 30 attempts on distinct unknown accounts, then 429; another address is unaffected.
      const flood = client(server, nextIp());
      let last = 0;
      for (let i = 0; i < 31; i++) last = (await flood('/operator/auth/login', { method: 'POST', body: { email: `nobody-${i}-${randomUUID()}@example.test`, password: 'whatever-password-1' } })).status;
      assert.equal(last, 429);
      const floodBlocked = await flood('/operator/auth/login', { method: 'POST', body: { email: bystander.email, password } });
      assert.equal(floodBlocked.status, 429); assert.ok(retryAfter(floodBlocked) > 0);
      assert.equal((await client(server, nextIp())('/operator/auth/login', { method: 'POST', body: { email: `x-${randomUUID()}@example.test`, password: 'whatever-password-1' } })).status, 401);
      // MFA endpoints return 410 Gone.
      const mfaApi = client(server, nextIp());
      const mfaResult = await mfaApi('/operator/auth/mfa/verify', { method: 'POST', body: { challenge_id: 'a'.repeat(64), code: '123456' }, headers: { 'Content-Type': 'application/json' } });
      assert.equal(mfaResult.status, 410);
      assert.equal(mfaResult.body.error.code, 'MFA_REMOVED');
      // Router-wide ceiling: 120 requests a minute per address, isolated per address.
      const busy = client(server, nextIp());
      const codes: number[] = [];
      for (let i = 0; i < 121; i++) codes.push((await busy('/operator/me')).status);
      assert.equal(codes.filter((c) => c === 401).length, 120); assert.equal(codes[120], 429);
      const limited = await busy('/operator/me');
      assert.equal(limited.status, 429); assert.ok(retryAfter(limited) > 0 && retryAfter(limited) <= 60, `Retry-After ${limited.headers.get('retry-after')}`);
      assert.equal((await client(server, nextIp())('/operator/me')).status, 401, 'another address is not limited');
    } finally { await server.stop(); }
  });

  t.after(async () => { await pool.end(); });
});

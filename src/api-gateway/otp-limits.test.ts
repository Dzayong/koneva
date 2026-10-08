import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pool from '../shared/database/connection';
import { cleanupOtpData, startOtpMaintenance } from './services/otp-maintenance';
import {
  DEFAULT_OTP_LIMITS, SENDER_WARN_RATIO, invitationKey, ipKey, limiterAddress, otpLimits, recipientKey, reserveIpRequest, reserveOtpSend, workspaceKey, type OtpLimits,
} from './services/otp-limits';
import { ServiceError } from './services/service-error';

const enabled = process.env['OPERATOR_STACK_TEST'] === '1';
const root = path.join(__dirname, '../..');
const codeOf = (error: unknown) => (error instanceof ServiceError ? `${error.status}:${error.code}` : 'other');

test('limiter keys: Gmail dots, +tags and googlemail.com fold into one bucket; other domains do not; keys are opaque', () => {
  const same = ['A.b+x@gmail.com', 'ab@gmail.com', ' a.b@GMAIL.com ', 'a.b+anything.else@googlemail.com', 'ab+@gmail.com'];
  for (const address of same) assert.equal(recipientKey(address), recipientKey('ab@gmail.com'), address);
  for (const address of ['abc@gmail.com', 'a@gmail.com', 'ab@gmail.co', 'ab@example.com', 'ab@gmail.com.evil.test']) assert.notEqual(recipientKey(address), recipientKey('ab@gmail.com'), address);
  assert.notEqual(recipientKey('a.b@example.com'), recipientKey('ab@example.com'), 'no folding outside Gmail');
  assert.notEqual(recipientKey('ab+x@example.com'), recipientKey('ab@example.com'), 'no +tag folding outside Gmail');
  assert.equal(limiterAddress('J.o.e+news@googlemail.com'), 'joe@gmail.com');
  for (const key of [recipientKey('ab@gmail.com'), invitationKey('inv-1'), workspaceKey('ws-1'), ipKey('203.0.113.7')]) {
    assert.match(key, /^[a-f0-9]{64}$/);
    for (const raw of ['ab', 'gmail', 'inv-1', 'ws-1', '203.0.113.7']) assert.ok(!key.includes(raw) || raw === 'ab' /* hex can contain "ab" */, raw);
  }
  assert.notEqual(recipientKey('ab@gmail.com'), invitationKey('ab@gmail.com'), 'labels separate the key spaces');
});

test('limits: defaults are the approved numbers; the sender cap is configurable but validated; 70 % of 200 is 140', () => {
  assert.deepEqual(DEFAULT_OTP_LIMITS, { recipientPerHour: 3, recipientPerDay: 6, invitationPerHour: 3, workspacePerDay: 10, senderPerDay: 200, ipPer15Min: 20 });
  assert.equal(Math.ceil(DEFAULT_OTP_LIMITS.senderPerDay * SENDER_WARN_RATIO), 140);
  assert.equal(otpLimits({}).senderPerDay, 200);
  assert.equal(otpLimits({ OTP_SENDER_DAILY_CAP: '50' }).senderPerDay, 50);
  for (const bad of ['0', '-1', 'abc', '1.5', '100001']) assert.throws(() => otpLimits({ OTP_SENDER_DAILY_CAP: bad }), /OTP_SENDER_DAILY_CAP/, bad);
});

test('test scripts pin email off: no Gmail variable reaches a test run', { skip: !enabled }, () => {
  assert.ok(['none', 'dev-outbox'].includes(process.env['EMAIL_TRANSPORT'] ?? 'none'));
  for (const name of ['GMAIL_OAUTH_CLIENT_ID', 'GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_OAUTH_REFRESH_TOKEN', 'GMAIL_SENDER_EMAIL']) assert.equal(process.env[name] ?? '', '', name);
});

test('OTP limits against PostgreSQL: rolling windows, aliases, concurrency, sender budget (disposable database only)', { skip: !enabled }, async (t) => {
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
  t.after(async () => { await pool.end(); });
  const id = () => randomUUID().slice(0, 8);
  const email = () => `dev${id()}@gmail.com`;
  const clearSender = async () => { await pool.query("DELETE FROM otp_rate_events WHERE dim = 'sender'"); await pool.query('DELETE FROM otp_threshold_events'); };
  const age = (dim: string, key: string, interval: string, limit?: number) => pool.query(
    `UPDATE otp_rate_events SET at = at - $3::interval WHERE id IN (SELECT id FROM otp_rate_events WHERE dim = $1 AND key = $2 ORDER BY at ${limit ? `LIMIT ${limit}` : ''})`, [dim, key, interval]);
  const count = async (dim: string, key: string) => (await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM otp_rate_events WHERE dim=$1 AND key=$2', [dim, key])).rows[0]!.n;

  await t.test('per recipient: 3 per rolling hour and 6 per rolling 24 h, across aliases, invitations and workspaces', async () => {
    await clearSender();
    const base = `al${id()}`;
    const variants = [`${base}@gmail.com`, `${base.slice(0, 3)}.${base.slice(3)}@gmail.com`, `${base}+news@gmail.com`, `${base}@googlemail.com`];
    const key = recipientKey(variants[0]!);
    for (let i = 0; i < 3; i++) await reserveOtpSend({ email: variants[i]!, invitationId: randomUUID(), tenantId: randomUUID() });
    await assert.rejects(reserveOtpSend({ email: variants[3]!, invitationId: randomUUID(), tenantId: randomUUID() }), (e) => codeOf(e) === '429:OTP_RATE_LIMITED');
    assert.equal(await count('recipient', key), 3, 'a refused request records nothing');
    // Retry-After is the exact time until the oldest counted send leaves the window.
    const refused = await reserveOtpSend({ email: variants[3]! }).catch((e: ServiceError) => e);
    assert.ok(refused instanceof ServiceError && refused.retryAfter! > 3500 && refused.retryAfter! <= 3600, `retryAfter ${(refused as ServiceError).retryAfter}`);
    // Rolling, not fixed: once only the oldest send is 61 minutes old, exactly one slot is free.
    await age('recipient', key, '61 minutes', 1);
    await reserveOtpSend({ email: variants[3]! });
    await assert.rejects(reserveOtpSend({ email: variants[0]! }), (e) => codeOf(e) === '429:OTP_RATE_LIMITED');
    // 24 h window: 3 more mails after the first hour make 6 in a day; the 7th is refused until the oldest ages past 24 h.
    await age('recipient', key, '2 hours');
    for (let i = 0; i < 2; i++) await reserveOtpSend({ email: variants[i]! });
    await assert.rejects(reserveOtpSend({ email: variants[1]! }), (e) => codeOf(e) === '429:OTP_RATE_LIMITED');
    await age('recipient', key, '23 hours', 1);
    await reserveOtpSend({ email: variants[2]! });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM otp_rate_events WHERE dim=$1 AND key=$2 AND at > now() - interval \'24 hours\'', ['recipient', key])).rows[0].n, 6, 'after the oldest send aged out, the 24 h count is back to the limit of 6');
  });

  await t.test('per invitation 3 per hour; per workspace 10 per 24 h; other invitations and workspaces are independent', async () => {
    await clearSender();
    const invitation = randomUUID(), tenant = randomUUID();
    for (let i = 0; i < 3; i++) await reserveOtpSend({ email: email(), invitationId: invitation, tenantId: tenant });
    await assert.rejects(reserveOtpSend({ email: email(), invitationId: invitation, tenantId: tenant }), (e) => codeOf(e) === '429:OTP_RATE_LIMITED');
    await reserveOtpSend({ email: email(), invitationId: randomUUID(), tenantId: tenant }); // another invitation is fine
    await age('invitation', invitationKey(invitation), '61 minutes');
    await reserveOtpSend({ email: email(), invitationId: invitation, tenantId: tenant }); // rolling: the hour passed
    const busy = randomUUID();
    for (let i = 0; i < 10; i++) await reserveOtpSend({ email: email(), invitationId: randomUUID(), tenantId: busy });
    await assert.rejects(reserveOtpSend({ email: email(), invitationId: randomUUID(), tenantId: busy }), (e) => codeOf(e) === '429:OTP_RATE_LIMITED');
    await reserveOtpSend({ email: email(), invitationId: randomUUID(), tenantId: randomUUID() }); // another workspace is fine
    await age('workspace', workspaceKey(busy), '25 hours', 1);
    await reserveOtpSend({ email: email(), invitationId: randomUUID(), tenantId: busy });
  });

  await t.test('per IP: 20 OTP requests per 15 minutes, another address unaffected, rolling recovery', async () => {
    await pool.query("DELETE FROM otp_rate_events WHERE dim = 'ip'");
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    for (let i = 0; i < 20; i++) await reserveIpRequest(ip);
    const refused = await reserveIpRequest(ip).then(() => undefined, (e: ServiceError) => e);
    assert.ok(refused && refused.status === 429 && refused.code === 'OTP_RATE_LIMITED' && refused.retryAfter! > 800 && refused.retryAfter! <= 900);
    await reserveIpRequest('198.18.0.1'); // someone else
    await age('ip', ipKey(ip), '16 minutes', 1);
    await reserveIpRequest(ip);
    await assert.rejects(reserveIpRequest(ip), (e) => codeOf(e) === '429:OTP_RATE_LIMITED');
  });

  await t.test('sender budget: 70 % is recorded once (counts only), the cap answers 503 with Retry-After and is recorded once, nothing is bypassed', async () => {
    await clearSender();
    const limits: OtpLimits = { ...DEFAULT_OTP_LIMITS, senderPerDay: 10 };
    for (let i = 0; i < 6; i++) await reserveOtpSend({ email: email(), invitationId: randomUUID(), tenantId: randomUUID() }, limits);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM otp_threshold_events')).rows[0].n, 0, 'below 70 %');
    for (let i = 0; i < 2; i++) await reserveOtpSend({ email: email(), invitationId: randomUUID(), tenantId: randomUUID() }, limits);
    const rows = (await pool.query('SELECT * FROM otp_threshold_events ORDER BY at')).rows;
    assert.equal(rows.length, 1, 'once per 24 h, not per email'); assert.equal(rows[0].kind, 'sender_70_percent');
    assert.deepEqual([rows[0].window_count, rows[0].cap], [7, 10]);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['at', 'cap', 'id', 'kind', 'window_count'], 'no email, address or person in the record');
    for (let i = 0; i < 2; i++) await reserveOtpSend({ email: email(), invitationId: randomUUID(), tenantId: randomUUID() }, limits);
    const capped = await reserveOtpSend({ email: email() }, limits).then(() => undefined, (e: ServiceError) => e);
    assert.ok(capped && capped.status === 503 && capped.code === 'OTP_CAPACITY_REACHED' && capped.retryAfter! > 0 && capped.retryAfter! <= 86_400, String(capped?.retryAfter));
    await reserveOtpSend({ email: email() }, limits).then(() => assert.fail('cap must hold'), () => undefined);
    assert.deepEqual((await pool.query('SELECT kind FROM otp_threshold_events ORDER BY kind')).rows.map((r) => r.kind), ['sender_70_percent', 'sender_cap_reached']);
    assert.equal(await count('sender', '0'.repeat(64)), 10);
    await assert.rejects(pool.query("UPDATE otp_threshold_events SET cap = 1"), /append only/);
    await clearSender();
  });

  await t.test('concurrency: parallel requests cannot take the last slot twice (recipient, workspace, sender, IP)', async () => {
    await clearSender();
    const outcome = (results: PromiseSettledResult<void>[]) => ({ ok: results.filter((r) => r.status === 'fulfilled').length, refused: results.filter((r) => r.status === 'rejected').length });
    const base = `cc${id()}`;
    // Same inbox through many alias spellings at once: exactly 3.
    const spellings = Array.from({ length: 12 }, (_, i) => (i % 3 === 0 ? `${base}@gmail.com` : i % 3 === 1 ? `${base.slice(0, 3)}.${base.slice(3)}@gmail.com` : `${base}+t${i}@googlemail.com`));
    const recipient = outcome(await Promise.allSettled(spellings.map((address) => reserveOtpSend({ email: address, invitationId: randomUUID(), tenantId: randomUUID() }))));
    assert.deepEqual(recipient, { ok: 3, refused: 9 });
    assert.equal(await count('recipient', recipientKey(spellings[0]!)), 3);
    // One workspace, many different recipients: exactly 10.
    await clearSender();
    const tenant = randomUUID();
    const workspace = outcome(await Promise.allSettled(Array.from({ length: 16 }, () => reserveOtpSend({ email: email(), invitationId: randomUUID(), tenantId: tenant }))));
    assert.deepEqual(workspace, { ok: 10, refused: 6 });
    // The sender budget with cap 5: exactly 5, the rest get 503.
    await clearSender();
    const limits: OtpLimits = { ...DEFAULT_OTP_LIMITS, senderPerDay: 5 };
    const results = await Promise.allSettled(Array.from({ length: 14 }, () => reserveOtpSend({ email: email(), invitationId: randomUUID(), tenantId: randomUUID() }, limits)));
    assert.deepEqual(outcome(results), { ok: 5, refused: 9 });
    assert.ok(results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').every((r) => codeOf(r.reason) === '503:OTP_CAPACITY_REACHED'));
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM otp_threshold_events WHERE kind='sender_cap_reached'")).rows[0].n, 1, 'recorded once even under contention');
    // One IP, 30 parallel requests: exactly 20.
    const ip = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
    assert.deepEqual(outcome(await Promise.allSettled(Array.from({ length: 30 }, () => reserveIpRequest(ip)))), { ok: 20, refused: 10 });
    await clearSender();
  });

  await t.test('OTP housekeeping: expired/consumed codes are deleted after a day, live ones never; threshold records and the 60 s pause are unaffected; the schedule runs', async () => {
    const tenant = randomUUID(), user = randomUUID(), other = randomUUID();
    await pool.query("INSERT INTO tenants(id,name,email,webhook_secret) VALUES ($1,'Uji',$2,$3)", [tenant, `${tenant}@example.test`, `w-${tenant}`]);
    for (const u of [user, other]) await pool.query("INSERT INTO users(id,email,name,password_hash) VALUES ($1,$2,'Uji','x')", [u, `${u}@example.test`]);
    const invitation = async () => (await pool.query<{ id: string }>("INSERT INTO invitations(tenant_id,email,role,token_hash,expires_at) VALUES ($1,$2,'developer',$3,now()+interval '2 days') RETURNING id", [tenant, `x${id()}@gmail.com`, randomUUID().replace(/-/g, '').padEnd(64, '0')])).rows[0]!.id;
    const inv = await invitation();
    const otp = (created: string, expires: string, consumed: string | null) => pool.query(
      `INSERT INTO invitation_otps(invitation_id, code_hash, created_at, expires_at, consumed_at) VALUES ($1,$2, now() - $3::interval, now() - $4::interval, ${consumed ? 'now() - $5::interval' : 'NULL'})`,
      consumed ? [inv, 'a'.repeat(64), created, expires, consumed] : [inv, 'a'.repeat(64), created, expires]);
    await otp('3 days', '2 days', null);       // expired long ago: deleted
    await otp('3 days', '-10 minutes', '2 days'); // consumed long ago: deleted
    await otp('30 hours', '29 hours', null);   // expired 29 h ago: deleted
    await otp('12 hours', '11 hours', null);   // expired 11 h ago: kept (a day of slack)
    await otp('1 minute', '-9 minutes', null); // live: kept
    const verification = (created: string, expires: string, consumed: string | null, who = user) => pool.query(
      `INSERT INTO email_verifications(user_id, code_hash, created_at, expires_at, consumed_at) VALUES ($1,$2, now() - $3::interval, now() - $4::interval, ${consumed ? 'now() - $5::interval' : 'NULL'})`,
      consumed ? [who, 'b'.repeat(64), created, expires, consumed] : [who, 'b'.repeat(64), created, expires]);
    await verification('3 days', '2 days', null);
    await verification('3 days', '-10 minutes', '2 days');
    await verification('1 minute', '-9 minutes', null);   // live: kept
    await verification('2 hours', '1 hour', '90 minutes'); // recently consumed: kept
    await pool.query("INSERT INTO otp_threshold_events(kind, window_count, cap) VALUES ('sender_cap_reached', 200, 200)");
    const thresholdBefore = (await pool.query('SELECT count(*)::int AS n FROM otp_threshold_events')).rows[0].n;
    const result = await cleanupOtpData(pool);
    assert.ok(result.invitation_otps >= 3 && result.email_verifications >= 2, JSON.stringify(result));
    const left = async (table: string, col: string, ref: string) => (await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${col} = $1`, [ref])).rows[0].n;
    assert.equal(await left('invitation_otps', 'invitation_id', inv), 2, 'only the day-of-slack row and the live row remain');
    assert.equal(await left('email_verifications', 'user_id', user), 2, 'live and recently consumed remain');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM otp_threshold_events')).rows[0].n, thresholdBefore);
    // The hourly schedule really runs (short delays here; production uses 90 s and 1 h).
    await otp('5 days', '4 days', null);
    await verification('5 days', '4 days', null, other);
    const stop = startOtpMaintenance(pool, { firstDelayMs: 30, intervalMs: 3_600_000 });
    try {
      for (let i = 0; i < 50 && (await left('email_verifications', 'user_id', other)) > 0; i++) await new Promise((r) => setTimeout(r, 100));
      assert.equal(await left('email_verifications', 'user_id', other), 0);
      assert.equal(await left('invitation_otps', 'invitation_id', inv), 2);
    } finally { stop(); }
  });

  await t.test('limiter tables hold only opaque keys; cleanup removes old counters and keeps threshold records', async () => {
    const address = `raw${id()}@gmail.com`, invitation = randomUUID(), tenant = randomUUID(), ip = '203.0.113.250';
    await clearSender();
    await reserveOtpSend({ email: address, invitationId: invitation, tenantId: tenant });
    await reserveIpRequest(ip);
    const dump = JSON.stringify((await pool.query('SELECT * FROM otp_rate_events')).rows) + JSON.stringify((await pool.query('SELECT * FROM otp_threshold_events')).rows);
    for (const raw of [address, address.split('@')[0]!, invitation, tenant, ip]) assert.ok(!dump.includes(raw), `leaked ${raw.slice(0, 6)}`);
    await pool.query("INSERT INTO otp_threshold_events(kind, window_count, cap) VALUES ('sender_70_percent', 140, 200)");
    await pool.query("UPDATE otp_rate_events SET at = now() - interval '3 days' WHERE dim = 'ip'");
    const result = await cleanupOtpData(pool);
    assert.ok(result.otp_events >= 1);
    assert.equal(await count('ip', ipKey(ip)), 0);
    assert.equal(await count('recipient', recipientKey(address)), 1, 'recent counters stay');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM otp_threshold_events')).rows[0].n, 1);
    await clearSender();
  });
});

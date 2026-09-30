import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { emailTransport, sendInvitationOtp, sendNoticeEmail, type OtpMessage } from './mailer';
import { ServiceError } from './service-error';

const MESSAGE: OtpMessage = { to: 'someone@example.com', code: '123456', workspace: 'Toko Uji', validMinutes: 10, purpose: 'invitation' };

function gmailEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    EMAIL_TRANSPORT: 'gmail-api',
    GMAIL_OAUTH_CLIENT_ID: 'test-client-id',
    GMAIL_OAUTH_CLIENT_SECRET: 'test-client-secret',
    GMAIL_OAUTH_REFRESH_TOKEN: 'test-refresh-token',
    GMAIL_SENDER_EMAIL: 'sender@example.com',
    ...extra,
  };
}

test('email default off, unconfigured (production-equivalent default): emailTransport is "none", sending is always refused', () => {
  assert.equal(emailTransport({}), 'none');
  return assert.rejects(() => sendInvitationOtp(MESSAGE, {}), (e) => e instanceof ServiceError && e.code === 'EMAIL_NOT_CONFIGURED');
});

test('sandbox + real transport (gmail-api) + empty allowlist (the default) rejects every recipient, no network call is made', async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { fetchCalls += 1; throw new Error('must not be called'); }) as typeof fetch;
  try {
    const env = gmailEnv({ KONEVA_SANDBOX: '1' }); // SANDBOX_EMAIL_ALLOWLIST intentionally unset
    await assert.rejects(
      () => sendInvitationOtp(MESSAGE, env),
      (e) => e instanceof ServiceError && e.code === 'SANDBOX_RECIPIENT_NOT_ALLOWED' && e.status === 403,
    );
    assert.equal(fetchCalls, 0, 'the Gmail API must never be reached when the recipient is not allowlisted');
  } finally { globalThis.fetch = originalFetch; }
});

test('sandbox + real transport + an address NOT on the allowlist is rejected even when the allowlist is non-empty', async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { fetchCalls += 1; throw new Error('must not be called'); }) as typeof fetch;
  try {
    const env = gmailEnv({ KONEVA_SANDBOX: '1', SANDBOX_EMAIL_ALLOWLIST: 'allowed@example.com' });
    await assert.rejects(
      () => sendInvitationOtp({ ...MESSAGE, to: 'not-allowed@example.com' }, env),
      (e) => e instanceof ServiceError && e.code === 'SANDBOX_RECIPIENT_NOT_ALLOWED',
    );
    assert.equal(fetchCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('sandbox + real transport + an exact, normalized allowlist match is let through to the (mocked) sender', async () => {
  const seenUrls: string[] = [];
  const originalFetch = globalThis.fetch;
  // Fully mocked: no real network call ever reaches Google. Proves the guard passes the request on, not that
  // sendGmailApi itself is correct (that is this module's existing behaviour, unchanged here).
  globalThis.fetch = (async (url: string | URL) => {
    seenUrls.push(String(url));
    if (String(url).includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'fake-token', expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'fake-message-id' }), { status: 200 });
  }) as typeof fetch;
  try {
    const env = gmailEnv({ KONEVA_SANDBOX: '1', SANDBOX_EMAIL_ALLOWLIST: ' Allowed@Example.com ' });
    await sendInvitationOtp({ ...MESSAGE, to: 'allowed@example.com' }, env);
    assert.ok(seenUrls.some((u) => u.includes('oauth2.googleapis.com')));
    assert.ok(seenUrls.some((u) => u.includes('gmail.googleapis.com')));
    assert.equal(seenUrls.every((u) => u.includes('oauth2.googleapis.com') || u.includes('gmail.googleapis.com')), true, 'no call went anywhere other than the (mocked) Gmail endpoints');
  } finally { globalThis.fetch = originalFetch; }
});

test('sandbox does not affect dev-outbox: it already never leaves the machine, so the allowlist does not apply to it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koneva-mailer-test-'));
  const file = path.join(dir, 'outbox.jsonl');
  try {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', EMAIL_TRANSPORT: 'dev-outbox', DEV_EMAIL_OUTBOX_FILE: file, KONEVA_SANDBOX: '1' };
    await sendInvitationOtp(MESSAGE, env); // no SANDBOX_EMAIL_ALLOWLIST set at all, and this must still succeed
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal((JSON.parse(lines[0]!) as { to: string }).to, MESSAGE.to);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('student decision notices use only the local outbox in test mode', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koneva-student-notice-'));
  const file = path.join(dir, 'outbox.jsonl');
  try {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', EMAIL_TRANSPORT: 'dev-outbox', DEV_EMAIL_OUTBOX_FILE: file, KONEVA_SANDBOX: '1' };
    await sendNoticeEmail({ to: 'student@campus.example.ac.id', subject: 'Perbaiki bukti', body: 'Layanan tetap aktif selama tujuh hari.' }, env);
    const notice = JSON.parse(fs.readFileSync(file, 'utf8').trim()) as { to: string; subject: string; body: string; at: string };
    assert.deepEqual({ to: notice.to, subject: notice.subject, body: notice.body }, { to: 'student@campus.example.ac.id', subject: 'Perbaiki bukti', body: 'Layanan tetap aktif selama tujuh hari.' });
    assert.ok(Number.isFinite(Date.parse(notice.at)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('outside sandbox (:13000/production-equivalent), gmail-api sends to any address unaffected by the allowlist', async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    fetchCalls += 1;
    if (String(url).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'fake-token', expires_in: 3600 }), { status: 200 });
    return new Response(JSON.stringify({ id: 'fake-message-id' }), { status: 200 });
  }) as typeof fetch;
  try {
    // KONEVA_SANDBOX intentionally absent -- this is the current, unmodified production path.
    const env = gmailEnv();
    await sendInvitationOtp({ ...MESSAGE, to: 'anyone-not-on-any-allowlist@example.com' }, env);
    assert.ok(fetchCalls > 0);
  } finally { globalThis.fetch = originalFetch; }
});

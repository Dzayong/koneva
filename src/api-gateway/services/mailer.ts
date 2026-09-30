import fs from 'node:fs';
import path from 'node:path';
import { otpLimits } from './otp-limits';
import { ServiceError } from './service-error';
import { isSandbox, isSandboxEmailAllowed } from '../../shared/sandbox';

/**
 * Outgoing email for invitation/email-verification OTPs and queued account notices.
 *
 * EMAIL_TRANSPORT:
 *   (unset) / none : no sender configured. Anything that needs email FAILS SAFE (503 EMAIL_NOT_CONFIGURED).
 *   dev-outbox     : development/test only. Appends a JSON line per message to DEV_EMAIL_OUTBOX_FILE (absolute path, mode 600).
 *                    Nothing leaves the machine and the OTP is never written to the application log. Refused in production.
 *   gmail-api      : Gmail API with OAuth refresh credentials and the gmail.send scope.
 * The Gmail OAuth refresh credential must be stored as a secret and never logged or checked in.
 */
export interface OtpMessage { to: string; code: string; workspace: string; validMinutes: number; purpose?: 'invitation' | 'email-verification' }
export interface NoticeMessage { to: string; subject: string; body: string }

export type EmailTransport = 'none' | 'dev-outbox' | 'gmail-api';
export function emailTransport(env: NodeJS.ProcessEnv = process.env): EmailTransport {
  const value = (env['EMAIL_TRANSPORT'] ?? 'none').trim() || 'none';
  if (value === 'none') return 'none';
  if (value === 'dev-outbox') {
    if (env['NODE_ENV'] === 'production') throw new Error('EMAIL_TRANSPORT=dev-outbox is forbidden in production');
    const file = env['DEV_EMAIL_OUTBOX_FILE'] ?? '';
    if (!path.isAbsolute(file)) throw new Error('DEV_EMAIL_OUTBOX_FILE must be an absolute path when EMAIL_TRANSPORT=dev-outbox');
    return 'dev-outbox';
  }
  if (value === 'gmail-api') {
    for (const name of ['GMAIL_OAUTH_CLIENT_ID','GMAIL_OAUTH_CLIENT_SECRET','GMAIL_OAUTH_REFRESH_TOKEN']) {
      if (!env[name]?.trim()) throw new Error(`${name} is required when EMAIL_TRANSPORT=gmail-api`);
    }
    const sender = env['GMAIL_SENDER_EMAIL'] ?? '';
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sender)) throw new Error('GMAIL_SENDER_EMAIL must be a valid sender email address');
    return 'gmail-api';
  }
  throw new Error(`EMAIL_TRANSPORT "${value}" is not supported (use none, dev-outbox, or gmail-api)`);
}

/** Startup check: an invalid mail configuration stops the API instead of silently weakening verification. */
export function assertMailerConfig(env: NodeJS.ProcessEnv = process.env): void { emailTransport(env); otpLimits(env); }

export const emailAvailable = (env: NodeJS.ProcessEnv = process.env): boolean => emailTransport(env) !== 'none';

export function requireEmail(env: NodeJS.ProcessEnv = process.env): void {
  if (!emailAvailable(env)) throw new ServiceError(503, 'EMAIL_NOT_CONFIGURED', 'Pengiriman email belum dikonfigurasi, jadi kode verifikasi tidak bisa dikirim.');
}

export async function sendInvitationOtp(message: OtpMessage, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  requireEmail(env);
  const transport = emailTransport(env);
  // Sandbox guard: dev-outbox never leaves the machine already, so only the real sender (gmail-api) needs an
  // allowlist. The allowlist is empty by default, so sandbox + gmail-api rejects every recipient until the
  // owner explicitly lists exact addresses in SANDBOX_EMAIL_ALLOWLIST. :13000/production is unaffected.
  if (isSandbox(env) && transport === 'gmail-api' && !isSandboxEmailAllowed(message.to, env)) {
    throw new ServiceError(403, 'SANDBOX_RECIPIENT_NOT_ALLOWED', 'Sandbox hanya mengizinkan pengiriman ke alamat yang ada di allowlist.');
  }
  if (transport === 'dev-outbox') {
    const file = env['DEV_EMAIL_OUTBOX_FILE']!;
    const line = JSON.stringify({
      at: new Date().toISOString(), to: message.to, subject: 'Kode verifikasi KONEVA',
      code: message.code, valid_minutes: message.validMinutes, purpose: message.purpose ?? 'invitation',
    });
    fs.appendFileSync(file, `${line}\n`, { mode: 0o600 });
    return;
  }
  await sendGmailApi(message, env);
}

/** Plain-text account notice for post-payment student verification. */
export async function sendNoticeEmail(message: NoticeMessage, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  requireEmail(env);
  const transport = emailTransport(env);
  if (isSandbox(env) && transport === 'gmail-api' && !isSandboxEmailAllowed(message.to, env)) {
    throw new ServiceError(403, 'SANDBOX_RECIPIENT_NOT_ALLOWED', 'Sandbox hanya mengizinkan pengiriman ke alamat yang ada di allowlist.');
  }
  const safeSubject = message.subject.replace(/[\r\n\x00-\x1f\x7f]/g, ' ').slice(0, 120);
  const safeBody = message.body.replace(/\x00/g, '').slice(0, 8000);
  if (transport === 'dev-outbox') {
    fs.appendFileSync(env['DEV_EMAIL_OUTBOX_FILE']!, `${JSON.stringify({ at: new Date().toISOString(), to: message.to, subject: safeSubject, body: safeBody })}\n`, { mode: 0o600 });
    return;
  }
  await sendGmailRaw(message.to, safeSubject, safeBody, env);
}

interface OAuthTokenResponse { access_token?: string; expires_in?: number }
let accessToken: string | undefined;
let accessTokenExpiresAt = 0;
let pendingRefresh: Promise<string> | undefined;

async function gmailAccessToken(env: NodeJS.ProcessEnv): Promise<string> {
  if (accessToken && Date.now() < accessTokenExpiresAt - 30_000) return accessToken;
  if (!pendingRefresh) {
    pendingRefresh = (async () => {
      const form = new URLSearchParams({
        client_id: env['GMAIL_OAUTH_CLIENT_ID']!,
        client_secret: env['GMAIL_OAUTH_CLIENT_SECRET']!,
        refresh_token: env['GMAIL_OAUTH_REFRESH_TOKEN']!,
        grant_type: 'refresh_token',
      });
      let response: Response;
      try {
        response = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form, signal: AbortSignal.timeout(8_000),
        });
      } catch {
        throw new ServiceError(502, 'EMAIL_SEND_FAILED', 'Layanan email sementara tidak tersedia. Coba lagi nanti.');
      }
      if (!response.ok) throw new ServiceError(502, 'EMAIL_CREDENTIALS_INVALID', 'Kredensial Gmail API tidak dapat digunakan. Periksa konfigurasi OAuth sender.');
      const token = await response.json() as OAuthTokenResponse;
      if (!token.access_token || !Number.isFinite(token.expires_in) || token.expires_in! <= 0) {
        throw new ServiceError(502, 'EMAIL_SEND_FAILED', 'Google tidak memberikan token email yang valid.');
      }
      accessToken = token.access_token;
      accessTokenExpiresAt = Date.now() + token.expires_in! * 1000;
      return accessToken;
    })();
  }
  try { return await pendingRefresh; }
  finally { pendingRefresh = undefined; }
}

export function encodeMessage(message: OtpMessage, sender: string): string {
  const workspace = message.workspace.replace(/[\r\n\x00-\x1f\x7f]/g, ' ').slice(0, 120);
  const body = [
    'Kode verifikasi KONEVA', '', `Kode: ${message.code}`,
    // Only invitations belong to a workspace; an account verification has none, so no (empty) Workspace line.
    ...(message.purpose === 'email-verification' ? ['Untuk memverifikasi alamat email akun KONEVA Anda.'] : [`Workspace: ${workspace}`]),
    `Kode berlaku ${message.validMinutes} menit.`,
    'Jika Anda tidak meminta kode ini, abaikan email ini.',
  ].join('\r\n');
  const mime = [
    `From: KONEVA <${sender}>`, `To: ${message.to}`, 'Subject: Kode verifikasi KONEVA',
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(body, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd(),
  ].join('\r\n');
  return Buffer.from(mime, 'utf8').toString('base64url');
}

async function sendGmailApi(message: OtpMessage, env: NodeJS.ProcessEnv): Promise<void> {
  const raw = encodeMessage(message, env['GMAIL_SENDER_EMAIL']!);
  await sendGmailRawEncoded(raw, env);
}

async function sendGmailRaw(to: string, subject: string, body: string, env: NodeJS.ProcessEnv): Promise<void> {
  const raw = Buffer.from([
    `From: KONEVA <${env['GMAIL_SENDER_EMAIL']!}>`, `To: ${to}`, `Subject: ${subject}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(body, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd(),
  ].join('\r\n'), 'utf8').toString('base64url');
  await sendGmailRawEncoded(raw, env);
}

async function sendGmailRawEncoded(raw: string, env: NodeJS.ProcessEnv): Promise<void> {
  // One credential refresh and retry handles an access token revoked/expired before its cached TTL.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await gmailAccessToken(env);
    let response: Response;
    try {
      response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ raw }), signal: AbortSignal.timeout(8_000),
      });
    } catch {
      // Delivery can be uncertain if a network timeout occurs after Google accepted the message.
      // Invalidate its OTP at the caller and require a newly requested code before another attempt.
      throw new ServiceError(502, 'EMAIL_DELIVERY_UNCERTAIN', 'Status pengiriman email belum pasti. Minta kode baru sebelum mencoba lagi.');
    }
    if (response.ok) return;
    if (response.status === 401 && attempt === 0) {
      accessToken = undefined; accessTokenExpiresAt = 0;
      continue;
    }
    throw new ServiceError(502, 'EMAIL_SEND_FAILED', 'Google gagal mengirim email verifikasi. Periksa konfigurasi sender dan coba minta kode baru.');
  }
  throw new ServiceError(502, 'EMAIL_SEND_FAILED', 'Google gagal mengirim email verifikasi. Minta kode baru.');
}

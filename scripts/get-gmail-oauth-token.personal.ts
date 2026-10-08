/**
 * One-time Gmail OAuth consent helper for the personal stack.
 * Reads OAuth client settings from .env.personal and atomically replaces only
 * GMAIL_OAUTH_REFRESH_TOKEN there. Never prints the code, token, or secret.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const envPath = path.resolve(process.cwd(), '.env.personal');
const stat = fs.statSync(envPath);
if ((stat.mode & 0o077) !== 0) throw new Error('.env.personal must be private (chmod 600) before OAuth setup.');
const rawEnv = fs.readFileSync(envPath, 'utf8');
const env = dotenv.parse(rawEnv);
const clientId = env['GMAIL_OAUTH_CLIENT_ID']?.trim() ?? '';
const clientSecret = env['GMAIL_OAUTH_CLIENT_SECRET'] ?? '';
if (!clientId || !clientSecret) throw new Error('GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET are missing from .env.personal.');

const respond = (response: ServerResponse, status: number, text: string): void => {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(text);
};

function storeRefreshToken(token: string): void {
  if (!/^[A-Za-z0-9._~+\-/]+$/.test(token)) throw new Error('Google returned an unexpected refresh-token format; .env.personal was not changed.');
  const lines = rawEnv.split(/\r?\n/);
  const matches = lines.flatMap((line, index) => line.startsWith('GMAIL_OAUTH_REFRESH_TOKEN=') ? [index] : []);
  if (matches.length > 1) throw new Error('Duplicate GMAIL_OAUTH_REFRESH_TOKEN entries in .env.personal; file was not changed.');
  const nextLine = `GMAIL_OAUTH_REFRESH_TOKEN=${token}`;
  if (matches.length === 1) lines[matches[0]!] = nextLine;
  else lines.push(nextLine);
  const content = `${lines.join('\n').replace(/\n+$/, '')}\n`;
  const temporaryPath = `${envPath}.${process.pid}.tmp`;
  const fd = fs.openSync(temporaryPath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporaryPath, envPath);
  fs.chmodSync(envPath, 0o600);
}

async function main(): Promise<void> {
  const host = '127.0.0.1';
  const port = 45_678;
  const redirectUri = `http://localhost:${port}/oauth2callback`;
  const state = randomBytes(32).toString('base64url');
  const scope = 'https://www.googleapis.com/auth/gmail.send';
  let finish!: (url: URL) => void;
  let fail!: (error: Error) => void;
  const callback = new Promise<URL>((resolve, reject) => { finish = resolve; fail = reject; });
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', redirectUri);
    if (request.method !== 'GET' || url.pathname !== '/oauth2callback') { respond(response, 404, 'Not found'); return; }
    const returnedState = url.searchParams.get('state') ?? '';
    const left = Buffer.from(returnedState), right = Buffer.from(state);
    if (left.length !== right.length || !timingSafeEqual(left, right)) { respond(response, 400, 'State did not match. Close this page and retry.'); return; }
    if (url.searchParams.has('error')) {
      respond(response, 400, 'Google authorization was not completed. You may close this window.');
      fail(new Error('Google authorization was not completed.'));
      return;
    }
    if (!url.searchParams.get('code')) { respond(response, 400, 'Authorization code missing.'); return; }
    respond(response, 200, 'KONEVA Gmail authorization received. You may close this window and return to the terminal.');
    finish(url);
  });
  const deadline = setTimeout(() => fail(new Error('Authorization timed out after 5 minutes.')), 300_000);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
    const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorization.search = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope,
      access_type: 'offline', prompt: 'consent', state,
    }).toString();
    process.stdout.write(`Authorize Gmail as koneva.id26@gmail.com and approve gmail.send in the browser:\n${authorization.toString()}\n\n`);
    const returned = await callback;
    const form = new URLSearchParams({
      code: returned.searchParams.get('code')!, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    });
    let response: Response;
    try {
      response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form, signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error('Could not exchange the authorization code with Google; .env.personal was not changed.');
    }
    const tokens = await response.json() as { refresh_token?: string; scope?: string; error?: string };
    if (!response.ok) throw new Error(`Google rejected OAuth exchange (HTTP ${response.status}, ${tokens.error ?? 'unknown'}); .env.personal was not changed.`);
    if (!tokens.refresh_token || !(tokens.scope ?? '').split(/\s+/).includes(scope)) {
      throw new Error('Google did not return a new refresh token with gmail.send; .env.personal was not changed. Revoke the old app grant in Google Account settings and retry.');
    }
    storeRefreshToken(tokens.refresh_token);
    process.stdout.write('Google authorization succeeded. New refresh token saved directly to .env.personal (value withheld; mode 0600).\n');
  } finally {
    clearTimeout(deadline);
    if (server.listening) server.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Gmail authorization failed.'}\n`);
  process.exitCode = 1;
});

/**
 * One-time local Gmail OAuth consent helper. Saves the refresh token directly to the ignored local .env file.
 * Bind is loopback-only. Never logs the authorization callback, authorization code, token response, or secret.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import dotenv from 'dotenv';

// Loads only the local ignored .env file; never prints values. Caller-provided environment takes precedence.
dotenv.config();

const clientId = process.env['GMAIL_OAUTH_CLIENT_ID']?.trim() ?? '';
const clientSecret = process.env['GMAIL_OAUTH_CLIENT_SECRET'] ?? '';
if (!clientId || !clientSecret) throw new Error('Set GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET in the local process environment first.');

const respond = (response: ServerResponse, status: number, text: string): void => {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(text);
};
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
  const deadline = setTimeout(() => fail(new Error('Authorization timed out after 3 minutes.')), 180_000);
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
    process.stdout.write(`Open this Google authorization link in your browser, sign in as the KONEVA sender, and approve gmail.send:\n${authorization.toString()}\n\n`);
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
    } catch { throw new Error('Could not exchange the authorization code with Google.'); }
    if (!response.ok) throw new Error('Google rejected OAuth configuration. Check the client type and exact localhost redirect URI.');
    const tokens = await response.json() as { refresh_token?: string; scope?: string };
    if (!tokens.refresh_token || !(tokens.scope ?? '').split(/\s+/).includes(scope)) {
      throw new Error('Google did not return a refresh token with the gmail.send scope. Revoke this app grant and retry with prompt=consent.');
    }
    const envPath = path.resolve(process.cwd(), '.env');
    const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const envLines = envText.split(/\r?\n/);
    const existing = envLines.findIndex((line) => line.startsWith('GMAIL_OAUTH_REFRESH_TOKEN='));
    const tokenLine = `GMAIL_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`;
    if (existing >= 0) envLines[existing] = tokenLine;
    else envLines.push(tokenLine);
    const nextEnv = `${envLines.join('\n').replace(/\n+$/, '')}\n`;
    const temporaryPath = `${envPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, nextEnv, { mode: 0o600 });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, envPath);
    fs.chmodSync(envPath, 0o600);
    process.stdout.write('\nGoogle authorization succeeded. Refresh token saved to local .env (value withheld).\n');
  } finally {
    clearTimeout(deadline);
    if (server.listening) server.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Gmail authorization failed.'}\n`);
  process.exitCode = 1;
});

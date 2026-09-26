import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, test } from 'node:test';
import pool from '../shared/database/connection';
import { computeWebhookSignature, webhookHeaders } from '../bot-container/webhook';
import { getWebhookSettings, rotateWebhookSecret, testWebhook } from './services/webhook.service';

type Query = (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
const database = pool as unknown as { query: Query };
const originalQuery = database.query;
afterEach(() => { database.query = originalQuery; });

test('webhookHeaders signs the exact body in both header spellings', () => {
  const h = webhookHeaders('message.sent', '{"a":1}', 'whsec_x');
  const sig = computeWebhookSignature('{"a":1}', 'whsec_x');
  assert.equal(h['X-Webhook-Secret'], sig);
  assert.equal(h['X-Webhook-Signature'], `sha256=${sig}`);
  assert.equal(h['X-Webhook-Event'], 'message.sent');
});

test('webhookHeaders sends no signature when the tenant has no secret', () => {
  const h = webhookHeaders('message.sent', '{}', null);
  assert.equal(h['X-Webhook-Signature'], undefined);
});

test('getWebhookSettings never returns the secret, only a 4-character hint', async () => {
  database.query = async () => ({ rows: [{ webhook_url: 'https://a.example/h', webhook_secret: 'whsec_abcdef1234' }] });
  const s = await getWebhookSettings('t');
  assert.deepEqual(s, { url: 'https://a.example/h', secret_set: true, secret_hint: '1234' });
});

test('rotateWebhookSecret stores and returns a fresh whsec_ secret', async () => {
  let stored: unknown;
  database.query = async (_t, v) => { stored = v?.[0]; return { rows: [] }; };
  const secret = await rotateWebhookSecret('t');
  assert.match(secret, /^whsec_[0-9a-f]{48}$/);
  assert.equal(stored, secret);
});

test('testWebhook posts a verifiable webhook.test and reports the receiver status', async () => {
  const secret = 'whsec_test';
  let seen: { sig?: string; body: string } | undefined;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => { seen = { sig: req.headers['x-webhook-signature'] as string, body }; res.writeHead(200).end('ok'); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  database.query = async (text) => (text.startsWith('SELECT') ? { rows: [{ webhook_url: url, webhook_secret: secret }] } : { rows: [] });
  try {
    const result = await testWebhook('t');
    assert.equal(result.success, true);
    assert.equal(result.status, 200);
    assert.equal(seen?.sig, `sha256=${computeWebhookSignature(seen!.body, secret)}`);
    assert.equal(JSON.parse(seen!.body).event, 'webhook.test');
  } finally { server.close(); }
});

test('testWebhook reports an unreachable receiver instead of throwing', async () => {
  database.query = async (text) => (text.startsWith('SELECT') ? { rows: [{ webhook_url: 'http://127.0.0.1:1/x', webhook_secret: null }] } : { rows: [] });
  const result = await testWebhook('t');
  assert.equal(result.success, false);
  assert.equal(result.status, null);
});

test('testWebhook refuses when no URL is configured', async () => {
  database.query = async () => ({ rows: [{ webhook_url: null, webhook_secret: null }] });
  await assert.rejects(() => testWebhook('t'), { code: 'WEBHOOK_NOT_SET' });
});

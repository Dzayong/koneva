import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { computeWebhookSignature, dispatchWebhook, type WebhookPayload } from './webhook';

test('computeWebhookSignature is deterministic HMAC-SHA256 hex', () => {
  const sig = computeWebhookSignature('{"a":1}', 'secret');
  assert.match(sig, /^[0-9a-f]{64}$/);
  assert.equal(sig, computeWebhookSignature('{"a":1}', 'secret'));
  assert.notEqual(sig, computeWebhookSignature('{"a":2}', 'secret'));
});

test('dispatchWebhook skips silently when tenant has no webhook_url configured', async () => {
  const queryFn = async () => ({ rows: [{ webhook_url: null, webhook_secret: null }] });
  const payload: WebhookPayload = {
    event: 'message.sent',
    device_key: 'WAPI-TEST01',
    timestamp: new Date().toISOString(),
  };

  // Should resolve without throwing and without attempting any HTTP call.
  await dispatchWebhook('tenant-1', payload, { queryFn });
});

test('dispatchWebhook posts a signed payload and logs the attempt on success', async () => {
  let receivedSignature: string | undefined;
  let receivedBody = '';

  const server = http.createServer((req, res) => {
    receivedSignature = req.headers['x-webhook-secret'] as string | undefined;
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      receivedBody = raw;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  const logged: unknown[] = [];
  const queryFn = async (text: string, params?: unknown[]) => {
    if (text.includes('FROM tenants')) {
      return { rows: [{ webhook_url: `http://127.0.0.1:${port}/hook`, webhook_secret: 'top-secret' }] };
    }
    if (text.includes('INSERT INTO webhook_logs')) {
      logged.push(params);
      return { rows: [] };
    }
    return { rows: [] };
  };

  const payload: WebhookPayload = {
    event: 'message.delivered',
    device_key: 'WAPI-TEST01',
    message_id: 'msg-1',
    to: '6281234567890',
    timestamp: new Date().toISOString(),
  };

  await dispatchWebhook('tenant-1', payload, { queryFn });
  await new Promise<void>((resolve) => server.close(() => resolve()));

  assert.equal(receivedBody, JSON.stringify(payload));
  assert.equal(receivedSignature, computeWebhookSignature(JSON.stringify(payload), 'top-secret'));
  assert.equal(logged.length, 1);
});

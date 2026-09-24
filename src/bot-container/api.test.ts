import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createApiRouter, type ApiDependencies } from './api';
import type { BotConfig, ConnectionState } from './types';
import pool from '../shared/database/connection';

after(async () => {
  await pool.end();
});

function baseConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    botId: 'WAPI-TEST01',
    nodeEnv: 'test',
    databaseUrl: 'postgresql://unused',
    redisUrl: 'redis://unused',
    sessionPath: './sessions',
    healthPort: 0,
    maxReconnectAttempts: 5,
    reconnectDelaysMs: [5_000],
    queueName: 'WAPI-TEST01',
    apiKeys: ['test-key'],
    ...overrides,
  };
}

function baseState(overrides: Partial<ConnectionState> = {}): ConnectionState {
  return {
    botId: 'WAPI-TEST01',
    status: 'online',
    reconnectAttempt: 0,
    ...overrides,
  };
}

function fakeRedis(): ApiDependencies['redis'] {
  return { ping: async () => 'PONG' } as unknown as ApiDependencies['redis'];
}

async function withServer(
  deps: Partial<ApiDependencies>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  const fullDeps: ApiDependencies = {
    config: baseConfig(),
    getState: () => baseState(),
    getSocket: () => undefined,
    redis: fakeRedis(),
    queryFn: async () => ({ rows: [] }),
    ...deps,
  };
  app.use(createApiRouter(fullDeps));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('GET /health and /ready work without an API key', async () => {
  await withServer({}, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    const healthBody = (await health.json()) as { device_key: string };
    assert.equal(healthBody.device_key, 'WAPI-TEST01');

    const ready = await fetch(`${baseUrl}/ready`);
    assert.equal(ready.status, 200);
  });
});

test('GET /ready returns 503 when not online', async () => {
  await withServer({ getState: () => baseState({ status: 'qr_pending' }) }, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/ready`);
    assert.equal(res.status, 503);
  });
});

test('protected routes reject requests without an API key', async () => {
  await withServer({}, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/status`);
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'unauthorized');
  });
});

test('protected routes accept a valid x-api-key header', async () => {
  await withServer(
    { queryFn: async () => ({ rows: [] }) },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/status`, { headers: { 'x-api-key': 'test-key' } });
      assert.equal(res.status, 200);
    },
  );
});

test('protected routes accept a Bearer authorization header', async () => {
  await withServer({}, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/status`, { headers: { authorization: 'Bearer test-key' } });
    assert.equal(res.status, 200);
  });
});

test('unknown routes return a consistent 404 envelope', async () => {
  await withServer({}, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/nope`, { headers: { 'x-api-key': 'test-key' } });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'not_found');
  });
});

test('POST /send rejects an empty body', async () => {
  await withServer({}, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/send`, {
      method: 'POST',
      headers: { 'x-api-key': 'test-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'validation_error');
  });
});

test('POST /send rejects a non-digit "to"', async () => {
  await withServer({}, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/send`, {
      method: 'POST',
      headers: { 'x-api-key': 'test-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'not-a-phone', content: 'hi' }),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /send rejects malformed JSON with a validation_error, not a 500', async () => {
  await withServer({}, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/send`, {
      method: 'POST',
      headers: { 'x-api-key': 'test-key', 'Content-Type': 'application/json' },
      body: '{not json',
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'validation_error');
  });
});

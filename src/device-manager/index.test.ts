import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import config from '../shared/config';
import { createDeviceManagerApp } from './index';
import type { BotOrchestrator } from './types';

test('resource snapshot endpoint requires the admin key and returns only the orchestrator snapshot', async (t) => {
  const snapshot = {
    available: true as const,
    source: 'docker-stats' as const,
    sampledAt: '2026-10-17T00:00:00.000Z',
    containers: [{
      name: 'wa-bot-wapi-test1', kind: 'device' as const, service: null, deviceKey: 'WAPI-TEST1',
      cpuPercent: 1.25, memoryUsageBytes: 1024, memoryLimitBytes: 2048,
    }],
  };
  const orchestrator: BotOrchestrator = {
    mode: 'docker',
    healthCheck: async () => {},
    createBot: async () => ({ resourceName: 'unused' }),
    restartBot: async () => ({ resourceName: 'unused' }),
    deleteBot: async () => {},
    getBotStatus: async () => null,
    listBots: async () => [],
    getResourceSnapshot: async () => snapshot,
    scaleBot: async () => {},
  };
  const server = createServer(createDeviceManagerApp(orchestrator));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/resources`;

  const denied = await fetch(url);
  assert.equal(denied.status, 401);

  const allowed = await fetch(url, { headers: { 'x-admin-key': config.adminApiKey } });
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { success: true, data: snapshot });

  const historyDenied = await fetch(`${url}/history`);
  assert.equal(historyDenied.status, 401);
  const usageHistoryDenied = await fetch(`${url}/usage/history`);
  assert.equal(usageHistoryDenied.status, 401);
  const databaseEstimateDenied = await fetch(`${url}/database/estimate`);
  assert.equal(databaseEstimateDenied.status, 401);
  const invalidRange = await fetch(`${url}/history?from=2026-10-18T12:00:00.000Z&to=2026-10-18T11:00:00.000Z`, {
    headers: { 'x-admin-key': config.adminApiKey },
  });
  assert.equal(invalidRange.status, 400);
});

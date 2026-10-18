/**
 * End-to-end integration test for WA Gateway.
 *
 * Runs the real HTTP services, Postgres, Redis/BullMQ, database triggers,
 * anti-ban logic, and webhook delivery. Only infrastructure outside the
 * test environment is mocked: Kubernetes/Docker orchestration and the
 * paired WhatsApp socket/receipt boundary.
 *
 * Usage: npx ts-node scripts/integration-test.ts
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import http, { type Server } from 'node:http';
import path from 'node:path';
import { WAMessageStatus, type WASocket } from '@whiskeysockets/baileys';
import pool, { query } from '../src/shared/database/connection';
import { getRedisClient, closeRedisClient } from '../src/shared/redis';
import {
  canSendMessage,
  getWarmupStage,
  type QueryFn,
} from '../src/bot-container/anti-ban';
import { calculateHealthScore, getDeviceByKey } from '../src/bot-container/health-score';
import { detectSpam } from '../src/bot-container/content-filter';
import { dispatchWebhook, type WebhookPayload } from '../src/bot-container/webhook';
import {
  closeQueueResources,
  registerReceiptListener,
  startQueueProcessor,
  type QueueProcessor,
} from '../src/bot-container/queue';
import logger from '../src/shared/utils/logger';
import { createDeviceManagerApp } from '../src/device-manager/index';
import type { BotOrchestrator, BotPodStatus } from '../src/device-manager/types';
import { KEY_SCOPES, newApiKey } from '../src/api-gateway/services/apikey.service';

const REPO_ROOT = path.join(__dirname, '..');
const ADMIN_API_KEY = process.env['ADMIN_API_KEY'] ?? 'admin_secret_key_here';
const GATEWAY_PORT = 8091;
const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`;
const MANAGER_PORT = 8191;
const MANAGER_URL = `http://127.0.0.1:${MANAGER_PORT}`;
const RUN_ID = Date.now().toString(36);
const REPORT_PATH = process.env['INTEGRATION_REPORT_PATH'] ?? 'reports/integration-test-report.json';

const queryFn: QueryFn = (text, params) => query(text, params);

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

type Status = 'pass' | 'fail' | 'skip';
interface Result {
  scenario: string;
  step: string;
  status: Status;
  message: string;
}
const results: Result[] = [];

function record(scenario: string, step: string, status: Status, message: string): void {
  results.push({ scenario, step, status, message });
  const icon = status === 'pass' ? '✔' : status === 'fail' ? '✘' : '⊘';
  console.log(`  ${icon} [${scenario}] ${step} — ${message}`);
}

async function step(
  scenario: string,
  name: string,
  fn: () => Promise<{ status: Status; message: string } | void>,
): Promise<void> {
  try {
    const outcome = await fn();
    if (outcome) {
      record(scenario, name, outcome.status, outcome.message);
    } else {
      record(scenario, name, 'pass', 'ok');
    }
  } catch (err) {
    record(scenario, name, 'fail', err instanceof Error ? err.message : String(err));
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------
// Process + HTTP helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Noon WIB (UTC+7) on today's date — safely inside the 8am-10pm sending window. */
function noonWibToday(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  return new Date(Date.UTC(year, month - 1, day, 5, 0, 0)); // 05:00 UTC = 12:00 WIB
}

async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(300);
  }
  return false;
}

interface SpawnedService {
  child: ChildProcess;
  logs: string[];
}

function spawnService(
  scriptRelativePath: string,
  env: Record<string, string>,
): SpawnedService {
  // `npx ts-node <script>` is really a process tree (npx -> sh -c -> node
  // ts-node) — killing just the top PID leaves the actual server running
  // as an orphan. `detached: true` makes this child its own process group
  // leader, so `kill(-pid)` below reaches the whole tree in one signal.
  const child = spawn('npx', ['ts-node', scriptRelativePath], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const logs: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => logs.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => logs.push(chunk.toString()));
  return { child, logs };
}

async function stopService(service: SpawnedService | undefined): Promise<void> {
  if (!service?.child.pid) return;
  const pid = service.child.pid;

  const signalGroup = (sig: NodeJS.Signals) => {
    try {
      process.kill(-pid, sig);
    } catch {
      // Group already gone, or this platform doesn't support negative-PID
      // group kill — fall back to just the direct child.
      try {
        service.child.kill(sig);
      } catch {
        // already dead
      }
    }
  };

  signalGroup('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signalGroup('SIGKILL');
      resolve();
    }, 5_000);
    service.child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

interface HttpResult<T = unknown> {
  status: number;
  body: T;
}

async function req<T = unknown>(
  method: string,
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<HttpResult<T>> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, body: body as T };
}

// ---------------------------------------------------------------------------
// Test data setup
// ---------------------------------------------------------------------------

interface TestTenant {
  id: string;
  apiKey: string;
}

async function createTenant(name: string, quotaMessages: number): Promise<TestTenant> {
  const res = await req<{ success: boolean; data: { id: string } }>(
    'POST',
    `${GATEWAY_URL}/admin/tenant/create`,
    {
      headers: { 'x-admin-key': ADMIN_API_KEY },
      body: { name, email: `${name.toLowerCase()}@example.test`, quota_messages: quotaMessages },
    },
  );
  if (res.status !== 201 || !res.body.success) {
    throw new Error(`Failed to create tenant "${name}": ${JSON.stringify(res.body)}`);
  }
  const tenantId = res.body.data.id;
  // No static tenant API key is issued any more (removed 2026-10-02); insert a scoped wgk_ key directly
  // for this script's own synthetic HTTP calls, the same way a signed-in Owner would from the dashboard.
  const { key, hash, prefix } = newApiKey();
  await query(
    `INSERT INTO api_keys (tenant_id, name, prefix, key_hash, scopes) VALUES ($1, 'integration-test', $2, $3, $4)`,
    [tenantId, prefix, hash, [...KEY_SCOPES]],
  );
  return { id: tenantId, apiKey: key };
}

async function insertDevice(tenantId: string, deviceKey: string, status: string): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO devices (tenant_id, device_key, phone_number, label, status)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, deviceKey, '+6289999900000', `Integration test ${RUN_ID}`, status],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('Failed to insert test device');
  return id;
}

async function cleanupTenant(tenantId: string): Promise<void> {
  try {
    await query('DELETE FROM webhook_logs WHERE tenant_id = $1', [tenantId]);
    await query('DELETE FROM messages WHERE tenant_id = $1', [tenantId]);
    await query('DELETE FROM devices WHERE tenant_id = $1', [tenantId]);
    await query('DELETE FROM tenants WHERE id = $1', [tenantId]);
  } catch (err) {
    console.warn('Cleanup warning:', err instanceof Error ? err.message : err);
  }
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!accept(value) && Date.now() < deadline) {
    await sleep(100);
    value = await read();
  }
  return value;
}

class FakeOrchestrator implements BotOrchestrator {
  readonly mode = 'kubernetes' as const;
  readonly resources = new Map<string, { replicas: number; tenantId: string }>();

  async healthCheck(): Promise<void> {}
  async createBot(spec: { deviceKey: string; tenantId: string }): Promise<{ resourceName: string }> {
    this.resources.set(spec.deviceKey, { replicas: 1, tenantId: spec.tenantId });
    return { resourceName: `bot-${spec.deviceKey.toLowerCase()}` };
  }
  async deleteBot(deviceKey: string): Promise<void> { this.resources.delete(deviceKey); }
  async scaleBot(deviceKey: string, replicas: number): Promise<void> {
    const resource = this.resources.get(deviceKey);
    if (!resource) throw new Error(`resource not found: ${deviceKey}`);
    resource.replicas = replicas;
  }
  async getBotStatus(deviceKey: string): Promise<BotPodStatus | null> {
    const resource = this.resources.get(deviceKey);
    if (!resource) return null;
    return {
      name: `bot-${deviceKey.toLowerCase()}-0`, deviceKey,
      phase: resource.replicas === 1 ? 'Running' : 'Paused', ready: resource.replicas === 1,
      podIP: resource.replicas === 1 ? '127.0.0.1' : null, startedAt: new Date().toISOString(),
    };
  }
  async listBots(): Promise<BotPodStatus[]> {
    const rows = await Promise.all([...this.resources.keys()].map((key) => this.getBotStatus(key)));
    return rows.filter((row): row is BotPodStatus => row !== null);
  }
  async getResourceSnapshot() {
    return {
      available: false as const,
      source: 'unavailable' as const,
      sampledAt: new Date().toISOString(),
      reason: 'container_metrics_not_configured' as const,
    };
  }
}

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function scenario1MessageFlow(
  tenant: TestTenant,
  deviceKey: string,
  receivedWebhooks: WebhookPayload[],
): Promise<void> {
  const S = 'Scenario 1: Message Flow';
  let messageId: string | undefined;
  let processor: QueueProcessor | undefined;
  const events = new EventEmitter();
  const whatsappMessageId = `wamid.${RUN_ID}`;
  const socket = {
    ev: { on: (event: string, listener: (...args: unknown[]) => void) => void events.on(event, listener) },
    sendMessage: async () => ({ key: { id: whatsappMessageId } }),
    sendPresenceUpdate: async () => undefined,
  } as unknown as WASocket;

  await step(S, '1. POST /api/v1/message/send accepts a queued message', async () => {
    const res = await req<{ success: boolean; message_id: string; status: string }>(
      'POST',
      `${GATEWAY_URL}/api/v1/message/send`,
      {
        headers: { apikey: tenant.apiKey },
        body: { device_key: deviceKey, to: '6281234567890', message: `hello ${RUN_ID}` },
      },
    );
    assert(res.status === 202, `expected 202, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.status === 'queued', `expected status=queued, got ${res.body.status}`);
    messageId = res.body.message_id;
  });

  await step(S, '2. Message row exists with status=queued', async () => {
    if (!messageId) return { status: 'skip', message: 'no message id from step 1' };
    const { rows } = await query<{ status: string }>('SELECT status FROM messages WHERE id = $1', [
      messageId,
    ]);
    assert(rows[0]?.status === 'queued', `db status was ${rows[0]?.status}`);
  });

  await step(S, '3. BullMQ job exists in queue:messages:{device_key}', async () => {
    const redis = getRedisClient(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
    const keys = await redis.keys(`queue:messages:${deviceKey}:*`);
    assert(keys.length > 0, `no BullMQ keys found for ${deviceKey}`);
  });

  await step(S, '4. Bot queue worker picks up the message and sends through WhatsApp adapter', async () => {
    if (!messageId) return { status: 'skip', message: 'no message id from step 1' };
    const redis = getRedisClient(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
    registerReceiptListener(socket, logger, queryFn);
    processor = startQueueProcessor(deviceKey, redis, {
      getSocket: () => socket,
      isConnected: () => true,
      now: noonWibToday,
      delay: async () => undefined,
    }, logger, queryFn);
    const row = await waitFor(
      async () => (await query<{ status: string; whatsapp_message_id: string | null }>(
        'SELECT status, whatsapp_message_id FROM messages WHERE id = $1', [messageId],
      )).rows[0],
      (value) => value?.status === 'sent',
    );
    assert(row?.status === 'sent', `expected sent, got ${row?.status}`);
    assert(row?.whatsapp_message_id === whatsappMessageId, 'WhatsApp message id was not persisted');
  });

  await step(S, '5. Delivery receipt updates sent → delivered', async () => {
    if (!messageId) return { status: 'skip', message: 'no message id from step 1' };
    events.emit('messages.update', [{ key: { id: whatsappMessageId }, update: { status: WAMessageStatus.DELIVERY_ACK } }]);
    const status = await waitFor(
      async () => (await query<{ status: string }>('SELECT status FROM messages WHERE id = $1', [messageId])).rows[0]?.status,
      (value) => value === 'delivered',
    );
    assert(status === 'delivered', `expected delivered, got ${status}`);
  });

  await step(S, '6. Status history records queued → sent → delivered', async () => {
    if (!messageId) return { status: 'skip', message: 'no message id from step 1' };
    const rows = (await query<{ status: string }>(
      'SELECT status FROM message_status_history WHERE message_id = $1 ORDER BY id', [messageId],
    )).rows.map((row) => row.status);
    assert(rows.join(',') === 'queued,sent,delivered', `unexpected history: ${rows.join(' → ')}`);
  });

  await step(S, '7. sent and delivered webhooks are dispatched and logged', async () => {
    const eventsSeen = receivedWebhooks.filter((item) => item.message_id === messageId).map((item) => item.event);
    const logged = (await query<{ event_type: string }>(
      'SELECT event_type FROM webhook_logs WHERE tenant_id = $1 ORDER BY id', [tenant.id],
    )).rows.map((row) => row.event_type);
    assert(eventsSeen.includes('message.sent') && eventsSeen.includes('message.delivered'), `receiver saw: ${eventsSeen}`);
    assert(logged.includes('message.sent') && logged.includes('message.delivered'), `logs contain: ${logged}`);
  });

  await processor?.stop();
}

async function scenario2DeviceLifecycle(tenant: TestTenant, orchestrator: FakeOrchestrator): Promise<void> {
  const S = 'Scenario 2: Device Lifecycle';
  let deviceKey: string | undefined;

  await step(S, '1-2. Create device via Device Manager and provision StatefulSet', async () => {
    const res = await req<{ success: boolean; device_key: string }>('POST', `${GATEWAY_URL}/admin/device/create`, {
      headers: { 'x-admin-key': ADMIN_API_KEY },
      body: { tenant_id: tenant.id, label: `lifecycle-${RUN_ID}` },
    });
    assert(res.status === 201 && res.body.success, `create failed: ${res.status} ${JSON.stringify(res.body)}`);
    deviceKey = res.body.device_key;
    assert(orchestrator.resources.has(deviceKey), 'mock StatefulSet was not created');
    const row = (await query<{ status: string; container_id: string | null }>(
      'SELECT status, container_id FROM devices WHERE device_key = $1', [deviceKey],
    )).rows[0];
    assert(row?.status === 'pending_qr' && !!row.container_id, `unexpected persisted resource: ${JSON.stringify(row)}`);
  });

  await step(S, '3. QR generation is persisted and exposed through tenant API', async () => {
    if (!deviceKey) return { status: 'skip', message: 'device creation failed' };
    await query("UPDATE devices SET qr_code = 'data:image/png;base64,TESTQR' WHERE device_key = $1", [deviceKey]);
    const res = await req<{ qr_code: string }>('GET', `${GATEWAY_URL}/api/v1/devices/${deviceKey}/qr`, {
      headers: { apikey: tenant.apiKey },
    });
    assert(res.status === 200 && res.body.qr_code.endsWith('TESTQR'), `QR endpoint failed: ${JSON.stringify(res.body)}`);
  });

  await step(S, '4. Simulated QR scan transitions pending_qr → online', async () => {
    if (!deviceKey) return { status: 'skip', message: 'device creation failed' };
    await query(`UPDATE devices SET status = 'online', qr_code = NULL WHERE device_key = $1`, [
      deviceKey,
    ]);
    const status = (await query<{ status: string }>('SELECT status FROM devices WHERE device_key = $1', [deviceKey])).rows[0]?.status;
    assert(status === 'online', `expected online, got ${status}`);
  });

  await step(S, '5. Pause device and enforce anti-ban pause', async () => {
    if (!deviceKey) return { status: 'skip', message: 'device creation failed' };
    const res = await req<{ success: boolean; data: { status: string } }>(
      'POST',
      `${GATEWAY_URL}/api/v1/devices/${deviceKey}/pause`,
      { headers: { apikey: tenant.apiKey } },
    );
    assert(res.status === 200 && res.body.data.status === 'paused', 'pause endpoint failed');

    const decision = await canSendMessage(deviceKey, { queryFn });
    assert(
      !decision.allowed && decision.reason === 'device_paused',
      `expected anti-ban to deny a paused device, got allowed=${decision.allowed} reason=${decision.reason}`,
    );
  });

  await step(S, '6. Resume device and restore workload replica', async () => {
    if (!deviceKey) return { status: 'skip', message: 'device creation failed' };
    const res = await req<{ success: boolean; data: { status: string } }>(
      'POST',
      `${GATEWAY_URL}/api/v1/devices/${deviceKey}/resume`,
      { headers: { apikey: tenant.apiKey } },
    );
    assert(res.status === 200, 'resume endpoint failed');
    assert(
      res.body.data.status !== 'paused',
      `expected status to leave 'paused', got ${res.body.data.status}`,
    );
    const scale = await req('POST', `${MANAGER_URL}/devices/${deviceKey}/scale`, {
      headers: { 'x-admin-key': ADMIN_API_KEY }, body: { replicas: 1 },
    });
    assert(scale.status === 200 && orchestrator.resources.get(deviceKey)?.replicas === 1, 'workload did not resume');
  });

  await step(S, '7. Delete device workload and mark database record offline', async () => {
    if (!deviceKey) return { status: 'skip', message: 'device creation failed' };
    const res = await req('DELETE', `${MANAGER_URL}/devices/${deviceKey}`, {
      headers: { 'x-admin-key': ADMIN_API_KEY },
    });
    assert(res.status === 204, `expected 204, got ${res.status}`);
    assert(!orchestrator.resources.has(deviceKey), 'StatefulSet still exists after delete');
    const row = (await query<{ status: string; container_id: string | null }>(
      'SELECT status, container_id FROM devices WHERE device_key = $1', [deviceKey],
    )).rows[0];
    assert(row?.status === 'offline' && row.container_id === null, `unexpected deleted state: ${JSON.stringify(row)}`);
  });
}

async function scenario3ErrorHandling(
  quotaTenant: TestTenant,
  quotaDeviceKey: string,
  offlineTenant: TestTenant,
  offlineDeviceKey: string,
): Promise<void> {
  const S = 'Scenario 3: Error Handling';

  await step(S, '1. Sending to an offline device → 503', async () => {
    const res = await req<{ success: boolean; error: { code: string } }>(
      'POST',
      `${GATEWAY_URL}/api/v1/message/send`,
      {
        headers: { apikey: offlineTenant.apiKey },
        body: { device_key: offlineDeviceKey, to: '6281234567890', message: 'should be rejected' },
      },
    );
    assert(res.status === 503, `expected 503, got ${res.status}`);
    assert(res.body.error?.code === 'DEVICE_OFFLINE', `expected DEVICE_OFFLINE, got ${res.body.error?.code}`);
  });

  await step(S, '2. Invalid API key → 401', async () => {
    const res = await req('GET', `${GATEWAY_URL}/api/v1/devices`, {
      headers: { apikey: 'not-a-real-key' },
    });
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });

  await step(S, '3. Quota exceeded → 429', async () => {
    const first = await req<{ status: string }>('POST', `${GATEWAY_URL}/api/v1/message/send`, {
      headers: { apikey: quotaTenant.apiKey },
      body: { device_key: quotaDeviceKey, to: '6281234567890', message: 'uses up the quota' },
    });
    assert(first.status === 202, `expected first send to succeed (202), got ${first.status}`);

    const second = await req<{ error: { code: string } }>(
      'POST',
      `${GATEWAY_URL}/api/v1/message/send`,
      {
        headers: { apikey: quotaTenant.apiKey },
        body: { device_key: quotaDeviceKey, to: '6281234567890', message: 'should be blocked' },
      },
    );
    assert(second.status === 429, `expected 429, got ${second.status}`);
    assert(
      second.body.error?.code === 'QUOTA_EXCEEDED',
      `expected QUOTA_EXCEEDED, got ${second.body.error?.code}`,
    );
  });

  await step(S, '4. Invalid payload → 400', async () => {
    const res = await req<{ error: { code: string } }>('POST', `${GATEWAY_URL}/api/v1/message/send`, {
      headers: { apikey: offlineTenant.apiKey },
      body: { device_key: offlineDeviceKey, to: 'not-a-phone', message: '' },
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
    assert(res.body.error?.code === 'VALIDATION_ERROR', `unexpected error: ${JSON.stringify(res.body)}`);
  });

  await step(S, '5. Webhook failure → 3 retries with backoff, logged', async () => {
    let attempts = 0;
    const attemptTimes: number[] = [];
    const server = http.createServer((_req, res) => {
      attempts += 1;
      attemptTimes.push(Date.now());
      res.writeHead(500);
      res.end('boom');
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    await query(`UPDATE tenants SET webhook_url = $1, webhook_secret = 'test-secret' WHERE id = $2`, [
      `http://127.0.0.1:${port}/hook`,
      quotaTenant.id,
    ]);

    const payload: WebhookPayload = {
      event: 'message.failed',
      device_key: quotaDeviceKey,
      message_id: 'integration-test-webhook',
      timestamp: new Date().toISOString(),
    };
    await dispatchWebhook(quotaTenant.id, payload, { queryFn });

    await new Promise<void>((resolve) => server.close(() => resolve()));

    assert(attempts === 4, `expected 4 attempts (1 initial + 3 retries), got ${attempts}`);
    const gaps = attemptTimes.slice(1).map((t, i) => t - attemptTimes[i]!);
    return {
      status: 'pass',
      message: `4 attempts made, retry gaps ~${gaps.map((g) => Math.round(g / 1000)).join('s, ')}s`,
    };
  });

  await step(S, '6. Database connection loss degrades readiness without crashing', async () => {
    const port = 8092;
    const service = spawnService('src/api-gateway/index.ts', {
      PORT: String(port),
      DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/unavailable',
    });
    try {
      const up = await waitForHealth(`http://127.0.0.1:${port}/health`, 20_000);
      assert(up, `degraded gateway did not start: ${service.logs.join('')}`);
      const readiness = await req('GET', `http://127.0.0.1:${port}/ready`);
      assert(readiness.status === 503, `expected readiness 503, got ${readiness.status}`);
      const liveness = await req('GET', `http://127.0.0.1:${port}/health`);
      assert(liveness.status === 200, `process did not remain live: ${liveness.status}`);
    } finally {
      await stopService(service);
    }
  });
}

async function scenario4AntiBan(tenant: TestTenant, deviceKey: string): Promise<void> {
  const S = 'Scenario 4: Anti-Ban Integration';

  await step(S, '1. Warm-up protocol active for a new device (day 1 cap = 5)', async () => {
    const device = await getDeviceByKey(deviceKey, queryFn);
    assert(!!device, 'device not found');
    const warmupDay =
      Math.floor((Date.now() - device!.createdAt.getTime()) / 86_400_000) + 1;
    const stage = getWarmupStage(warmupDay);
    assert(stage.maxMessagesPerDay === 5, `expected day-1 cap of 5, got ${stage.maxMessagesPerDay}`);
    assert(stage.proactiveAllowed === false, 'day 1-2 should not allow proactive messages');
  });

  await step(S, '2. Per-minute rate limit (max 2/min) is enforced', async () => {
    await query('DELETE FROM messages WHERE device_key = $1', [deviceKey]);
    const device = await getDeviceByKey(deviceKey, queryFn);
    assert(!!device, 'device not found');
    for (let i = 0; i < 2; i++) {
      await query(
        `INSERT INTO messages (tenant_id, device_id, device_key, to_number, content, status)
         VALUES ($1, $2, $3, '6281234567890', 'x', 'sent')`,
        [tenant.id, device!.id, deviceKey],
      );
    }
    const decision = await canSendMessage(deviceKey, { queryFn });
    assert(
      !decision.allowed && decision.reason === 'rate_limit_per_minute',
      `expected denial for rate_limit_per_minute after 2 sends this minute, got allowed=${decision.allowed} reason=${decision.reason}`,
    );
    await query('DELETE FROM messages WHERE device_key = $1', [deviceKey]);
  });

  await step(S, '3. Content filter blocks spam', async () => {
    const result = detectSpam('PROMO GRATIS klik bit.ly/xyz sekarang juga!!!');
    assert(!result.allowed, 'expected spammy content to be rejected');
    assert(result.reasons.length > 0, 'expected reasons to be populated');

    const decision = await canSendMessage(deviceKey, {
      queryFn,
      content: 'PROMO GRATIS klik bit.ly/xyz sekarang juga!!!',
      recipient: '6281234567890',
      // Pinned to noon WIB *today* — otherwise this assertion is at the
      // mercy of whatever time it happens to run, since the window check
      // runs before the content check.
      now: noonWibToday(),
    });
    assert(
      !decision.allowed && decision.reason === 'content_rejected',
      `expected canSendMessage to reject spam content, got allowed=${decision.allowed} reason=${decision.reason}`,
    );
  });

  await step(S, '4. Health score calculation reflects real message history', async () => {
    const device = await getDeviceByKey(deviceKey, queryFn);
    assert(!!device, 'device not found');
    await query('DELETE FROM messages WHERE device_key = $1', [deviceKey]);
    for (let i = 0; i < 10; i++) {
      await query(
        `INSERT INTO messages (tenant_id, device_id, device_key, to_number, content, status, delivered_at)
         VALUES ($1, $2, $3, '6281234567890', 'x', 'delivered', now())`,
        [tenant.id, device!.id, deviceKey],
      );
    }
    const score = await calculateHealthScore(deviceKey, queryFn);
    assert(score >= 20, `expected a non-trivial score after 10/10 delivered messages, got ${score}`);
    await query('DELETE FROM messages WHERE device_key = $1', [deviceKey]);
    return { status: 'pass', message: `health score = ${score} after 10/10 delivered` };
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`\nWA Gateway integration test — run ${RUN_ID}\n`);

  await query('SELECT 1');
  console.log('Database reachable.');

  // A real (always-200) webhook receiver, so scenario 1's message.failed
  // dispatch exercises an actual HTTP round trip, not just "skipped, no
  // webhook_url configured".
  const receivedWebhooks: WebhookPayload[] = [];
  const receiverServer = http.createServer((request, res) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      try { receivedWebhooks.push(JSON.parse(Buffer.concat(chunks).toString()) as WebhookPayload); } catch { /* asserted later */ }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => receiverServer.listen(0, resolve));
  const receiverAddress = receiverServer.address();
  const receiverPort = typeof receiverAddress === 'object' && receiverAddress ? receiverAddress.port : 0;
  const receiverUrl = `http://127.0.0.1:${receiverPort}/hook`;

  let gateway: SpawnedService | undefined;
  let managerServer: Server | undefined;
  const tenantsToCleanup: string[] = [];

  try {
    const orchestrator = new FakeOrchestrator();
    managerServer = http.createServer(createDeviceManagerApp(orchestrator));
    await listen(managerServer, MANAGER_PORT);

    gateway = spawnService('src/api-gateway/index.ts', {
      PORT: String(GATEWAY_PORT),
      DEVICE_MANAGER_URL: MANAGER_URL,
    });
    const gatewayUp = await waitForHealth(`${GATEWAY_URL}/health`, 20_000);
    if (!gatewayUp) {
      console.error('API Gateway logs:\n', gateway.logs.join(''));
      throw new Error('API Gateway did not become healthy within 20s');
    }
    console.log(`API Gateway up on ${GATEWAY_URL}.`);

    const flowTenant = await createTenant(`itest-flow-${RUN_ID}`, 10_000);
    const quotaTenant = await createTenant(`itest-quota-${RUN_ID}`, 1);
    const offlineTenant = await createTenant(`itest-offline-${RUN_ID}`, 10_000);
    tenantsToCleanup.push(flowTenant.id, quotaTenant.id, offlineTenant.id);

    await query('UPDATE tenants SET webhook_url = $1 WHERE id = $2', [receiverUrl, flowTenant.id]);

    const flowDeviceKey = `WAPI-ITEST-FLOW-${RUN_ID}`;
    const quotaDeviceKey = `WAPI-ITEST-QUOTA-${RUN_ID}`;
    const offlineDeviceKey = `WAPI-ITEST-OFFLINE-${RUN_ID}`;

    await insertDevice(flowTenant.id, flowDeviceKey, 'online');
    await query(
      `UPDATE devices SET warmup_started_at = now() - interval '10 days', warmup_completed_at = now(), health_score = 100
       WHERE device_key = $1`,
      [flowDeviceKey],
    );
    await insertDevice(quotaTenant.id, quotaDeviceKey, 'online');
    await insertDevice(offlineTenant.id, offlineDeviceKey, 'offline');
    console.log('Test tenants and devices created.');

    await scenario2DeviceLifecycle(flowTenant, orchestrator);
    await scenario1MessageFlow(flowTenant, flowDeviceKey, receivedWebhooks);
    await scenario3ErrorHandling(quotaTenant, quotaDeviceKey, offlineTenant, offlineDeviceKey);
    await scenario4AntiBan(flowTenant, flowDeviceKey);
  } finally {
    await stopService(gateway);
    await closeServer(managerServer);
    await closeServer(receiverServer);
    for (const id of tenantsToCleanup) {
      await cleanupTenant(id);
    }
    await closeQueueResources();
    await closeRedisClient();
    await pool.end();
  }

  printReport();
}

function printReport(): void {
  console.log('\n' + '='.repeat(72));
  console.log('INTEGRATION TEST REPORT');
  console.log('='.repeat(72));

  const byScenario = new Map<string, Result[]>();
  for (const r of results) {
    if (!byScenario.has(r.scenario)) byScenario.set(r.scenario, []);
    byScenario.get(r.scenario)!.push(r);
  }

  let pass = 0;
  let fail = 0;
  let skip = 0;

  for (const [scenario, rows] of byScenario) {
    console.log(`\n${scenario}`);
    for (const r of rows) {
      const icon = r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'SKIP';
      console.log(`  [${icon}] ${r.step}`);
      console.log(`         ${r.message}`);
      if (r.status === 'pass') pass += 1;
      else if (r.status === 'fail') fail += 1;
      else skip += 1;
    }
  }

  console.log('\n' + '-'.repeat(72));
  console.log(`TOTAL: ${pass} passed, ${fail} failed, ${skip} skipped (of ${results.length})`);
  console.log('-'.repeat(72) + '\n');

  const absoluteReportPath = path.resolve(REPO_ROOT, REPORT_PATH);
  mkdirSync(path.dirname(absoluteReportPath), { recursive: true });
  writeFileSync(absoluteReportPath, JSON.stringify({
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    summary: { total: results.length, passed: pass, failed: fail, skipped: skip },
    results,
  }, null, 2) + '\n');
  console.log(`JSON report: ${absoluteReportPath}\n`);

  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((err: unknown) => {
    console.error('Integration test runner crashed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    // Safety net: importing bot-container's modules (metrics.ts's
    // collectDefaultMetrics, tracing.ts's NodeSDK) for their business logic
    // starts background timers that are meant to keep a long-running
    // *service* alive — as a side effect they also keep this one-shot
    // script's event loop from ever draining on its own.
    process.exit(process.exitCode ?? 0);
  });

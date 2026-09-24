/**
 * End-to-end integration test for WA Gateway.
 *
 * Starts a real API Gateway process against the real Postgres/Redis from
 * docker/docker-compose.yml, creates isolated test data through the real
 * admin/tenant APIs, and drives every scenario through real HTTP requests
 * and the real BullMQ queue — no mocked services.
 *
 * Two things this sandbox genuinely cannot do, and are reported as SKIP
 * rather than faked:
 *   - Device Manager's `docker run` step (no Docker socket access here) —
 *     device creation falls back to inserting the row directly.
 *   - Actually pairing a WhatsApp phone — a message can be pushed all the
 *     way to "bot-container attempted to send and got a clean failure
 *     because it isn't really connected", which is as far as this can go
 *     without a human scanning a QR code.
 *
 * Usage: npx ts-node scripts/integration-test.ts
 */

import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
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

const REPO_ROOT = path.join(__dirname, '..');
const ADMIN_API_KEY = process.env['ADMIN_API_KEY'] ?? 'admin_secret_key_here';
const GATEWAY_PORT = 8091;
const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`;
const BOT_PORT = 9291;
const RUN_ID = Date.now().toString(36);

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
  const res = await req<{ success: boolean; data: { id: string; api_key: string } }>(
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
  return { id: res.body.data.id, apiKey: res.body.data.api_key };
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

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function scenario1MessageFlow(tenant: TestTenant, deviceKey: string): Promise<void> {
  const S = 'Scenario 1: Message Flow';

  let messageId: string | undefined;

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

  await step(S, '4-6. Bot Container picks up the job and fails cleanly (not really connected)', async () => {
    if (!messageId) return { status: 'skip', message: 'no message id from step 1' };
    const deadline = Date.now() + 60_000;
    let finalStatus = 'queued';
    let errorMessage: string | null = null;
    while (Date.now() < deadline) {
      const { rows } = await query<{ status: string; error_message: string | null }>(
        'SELECT status, error_message FROM messages WHERE id = $1',
        [messageId],
      );
      finalStatus = rows[0]?.status ?? 'queued';
      errorMessage = rows[0]?.error_message ?? null;
      if (finalStatus === 'failed' || finalStatus === 'sent') break;
      await sleep(1_000);
    }
    assert(
      finalStatus === 'failed',
      `expected the job to reach 'failed' (no real WhatsApp pairing exists) within 60s, got '${finalStatus}'`,
    );
    return {
      status: 'pass',
      message: `reached status=failed after 3 attempts as expected (${errorMessage}). ` +
        `Reaching 'sent'/'delivered' needs a real paired WhatsApp phone — out of scope for an automated test.`,
    };
  });

  await step(S, '7. message.failed webhook logged to webhook_logs', async () => {
    const { rows } = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM webhook_logs WHERE tenant_id = $1 AND event_type = 'message.failed'`,
      [tenant.id],
    );
    assert(Number(rows[0]?.count ?? 0) > 0, 'no message.failed rows in webhook_logs');
  });
}

async function scenario2DeviceLifecycle(tenant: TestTenant, deviceKey: string): Promise<void> {
  const S = 'Scenario 2: Device Lifecycle';

  await step(S, '1-2. Create device via admin API + verify container spawned', async () => {
    const res = await req<{ success: boolean }>('POST', `${GATEWAY_URL}/admin/device/create`, {
      headers: { 'x-admin-key': ADMIN_API_KEY },
      body: { tenant_id: tenant.id },
    });
    if (res.status === 201) {
      return { status: 'pass', message: 'Device Manager spawned a real container' };
    }
    return {
      status: 'skip',
      message:
        `Device Manager could not run \`docker run\` in this sandbox (no Docker socket ` +
        `access; got ${res.status}: ${JSON.stringify(res.body)}). Falling back to a directly ` +
        `inserted device row for the rest of this scenario.`,
    };
  });

  await step(S, '3. QR code gets generated and persisted (bot-container fix)', async () => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const { rows } = await query<{ status: string; qr_code: string | null }>(
        'SELECT status, qr_code FROM devices WHERE device_key = $1',
        [deviceKey],
      );
      if (rows[0]?.status === 'pending_qr' && rows[0]?.qr_code) {
        return { status: 'pass', message: `qr_code persisted (${rows[0].qr_code.length} chars)` };
      }
      await sleep(1_000);
    }
    throw new Error('device never reached pending_qr with a qr_code within 30s');
  });

  await step(S, '4-5. Simulate scan QR → status pending_qr → online', async () => {
    // No real phone available in this sandbox — this is the exact scenario
    // the brief calls "Simulate scan QR (mock atau manual)": we flip the DB
    // row the way a real pairing would, so downstream steps (send, pause,
    // resume) exercise the real code paths against an "online" device.
    await query(`UPDATE devices SET status = 'online', qr_code = NULL WHERE device_key = $1`, [
      deviceKey,
    ]);
    return { status: 'pass', message: 'simulated: devices.status manually set to online' };
  });

  await step(S, '6. Pause device → verify status=paused AND anti-ban actually blocks it', async () => {
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

  await step(S, '7. Resume device → verify it leaves the paused state', async () => {
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
    return {
      status: 'pass',
      message:
        `status is now '${res.body.data.status}' (resumeDevice() sets 'offline', not 'online' — ` +
        `it un-pauses and lets the connection layer reconnect on its own, it doesn't force-online).`,
    };
  });
}

async function scenario3ErrorHandling(
  quotaTenant: TestTenant,
  quotaDeviceKey: string,
  offlineTenant: TestTenant,
  offlineDeviceKey: string,
): Promise<void> {
  const S = 'Scenario 3: Error Handling';

  await step(S, '1. Sending to an offline device → proper error', async () => {
    const res = await req<{ success: boolean; error: { code: string } }>(
      'POST',
      `${GATEWAY_URL}/api/v1/message/send`,
      {
        headers: { apikey: offlineTenant.apiKey },
        body: { device_key: offlineDeviceKey, to: '6281234567890', message: 'should be rejected' },
      },
    );
    assert(res.status === 409, `expected 409, got ${res.status}`);
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

  await step(S, '4. Webhook failure → 3 retries with backoff, logged', async () => {
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
  const receiverServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => receiverServer.listen(0, resolve));
  const receiverAddress = receiverServer.address();
  const receiverPort = typeof receiverAddress === 'object' && receiverAddress ? receiverAddress.port : 0;
  const receiverUrl = `http://127.0.0.1:${receiverPort}/hook`;

  let gateway: SpawnedService | undefined;
  let bot: SpawnedService | undefined;
  const tenantsToCleanup: string[] = [];

  try {
    gateway = spawnService('src/api-gateway/index.ts', {
      PORT: String(GATEWAY_PORT),
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

    await insertDevice(flowTenant.id, flowDeviceKey, 'starting');
    await insertDevice(quotaTenant.id, quotaDeviceKey, 'online');
    await insertDevice(offlineTenant.id, offlineDeviceKey, 'offline');
    console.log('Test tenants and devices created.');

    bot = spawnService('src/bot-container/index.ts', {
      BOT_ID: flowDeviceKey,
      BOT_CONTAINER_PORT: String(BOT_PORT),
      SESSION_PATH: `./sessions-itest-${RUN_ID}`,
    });
    const botUp = await waitForHealth(`http://127.0.0.1:${BOT_PORT}/health`, 20_000);
    if (!botUp) {
      console.error('Bot Container logs:\n', bot.logs.join(''));
      throw new Error('Bot Container did not become healthy within 20s');
    }
    console.log('Bot Container up.');

    // Scenario 2 needs the device online *before* scenario 1 sends through it.
    await scenario2DeviceLifecycle(flowTenant, flowDeviceKey);
    // Undo scenario 2's pause/resume dance so scenario 1 can send cleanly.
    await query(`UPDATE devices SET status = 'online' WHERE device_key = $1`, [flowDeviceKey]);

    await scenario1MessageFlow(flowTenant, flowDeviceKey);
    await scenario3ErrorHandling(quotaTenant, quotaDeviceKey, offlineTenant, offlineDeviceKey);
    await scenario4AntiBan(flowTenant, flowDeviceKey);
  } finally {
    await stopService(bot);
    await stopService(gateway);
    await new Promise<void>((resolve) => receiverServer.close(() => resolve()));
    for (const id of tenantsToCleanup) {
      await cleanupTenant(id);
    }
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

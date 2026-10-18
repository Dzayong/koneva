import { randomBytes } from 'node:crypto';
import http from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import config from '../shared/config';
import pool from '../shared/database/connection';
import logger from '../shared/utils/logger';
import { DockerBotManager } from './docker';
import { createKubernetesClients, KubernetesBotManager } from './kubernetes';
import type { BotOrchestrator, DeviceManagerConfig, OrchestrationMode } from './types';
import { safeEqual } from '../shared/utils/secure-compare';
import { readResourceHistory, startResourceUsageCollector } from './resource-usage';

const createDeviceSchema = z.object({
  tenant_id: z.string().uuid(),
  phone_number: z.string().max(20).optional(),
  label: z.string().max(100).optional(),
});
const scaleSchema = z.object({ replicas: z.union([z.literal(0), z.literal(1)]) });
const deviceKeySchema = z.string().regex(/^WAPI-[A-Z0-9-]+$/i).max(64);
const resourceHistorySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  tenant_id: z.string().uuid().optional(),
});

function resolveMode(): OrchestrationMode {
  if (config.deviceManager.orchestrator !== 'auto') return config.deviceManager.orchestrator;
  if (process.env.KUBERNETES_MODE === 'true') return 'kubernetes';
  if (process.env.DOCKER_MODE === 'true') return 'docker';
  if (process.env.KUBERNETES_SERVICE_HOST) return 'kubernetes';
  return 'docker';
}

export function loadDeviceManagerConfig(): DeviceManagerConfig {
  return {
    mode: resolveMode(),
    port: config.deviceManager.port,
    adminApiKey: config.adminApiKey,
    jwtSecret: config.jwt.secret,
    botImage: config.docker.botImage,
    databaseUrl: config.database.url,
    redisUrl: config.redis.url,
    sessionHostPath: config.sessionHostPath,
    dockerNetwork: config.docker.network,
    botProxyUrl: process.env.WA_PROXY_URL || undefined,
    kubernetes: {
      namespace: config.deviceManager.kubernetes.namespace,
      inCluster: config.deviceManager.kubernetes.inCluster,
      storageClassName: config.deviceManager.kubernetes.storageClassName,
      sessionStorageSize: config.deviceManager.kubernetes.sessionStorageSize,
    },
  };
}

export async function createOrchestrator(managerConfig: DeviceManagerConfig): Promise<BotOrchestrator> {
  if (managerConfig.mode === 'docker') return new DockerBotManager(managerConfig);
  const clients = await createKubernetesClients(managerConfig.kubernetes);
  return new KubernetesBotManager({
    config: managerConfig.kubernetes,
    botImage: managerConfig.botImage,
    clients,
  });
}

function requireAdmin(request: Request, response: Response, next: NextFunction): void {
  if (!safeEqual(request.header('x-admin-key'), config.adminApiKey)) {
    response.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid admin key' } });
    return;
  }
  next();
}

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => void handler(request, response).catch(next);
}

export function createDeviceManagerApp(orchestrator: BotOrchestrator): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', asyncRoute(async (_request, response) => {
    try {
      await Promise.all([pool.query('SELECT 1'), orchestrator.healthCheck()]);
      response.json({ status: 'ok', mode: orchestrator.mode });
    } catch (error) {
      logger.warn('Device Manager dependency health check failed', { mode: orchestrator.mode, error });
      response.status(503).json({ status: 'unhealthy', mode: orchestrator.mode });
    }
  }));

  app.use(requireAdmin);

  app.get('/resources', asyncRoute(async (_request, response) => {
    response.json({ success: true, data: await orchestrator.getResourceSnapshot() });
  }));

  app.get('/resources/history', asyncRoute(async (request, response) => {
    const parsed = resourceHistorySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
      return;
    }
    const to = parsed.data.to ?? new Date();
    const from = parsed.data.from ?? new Date(to.getTime() - 24 * 60 * 60_000);
    try {
      const data = await readResourceHistory(pool, { from, to, tenantId: parsed.data.tenant_id });
      response.json({ success: true, data });
    } catch (error) {
      if (error instanceof Error && (error.message === 'Resource history range exceeds 31 days' || error.message === 'Invalid resource history range')) {
        response.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
        return;
      }
      throw error;
    }
  }));

  app.post('/devices', asyncRoute(async (request, response) => {
    const parsed = createDeviceSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
      return;
    }

    const count = await pool.query<{ count: number; max_devices: number }>(
      `SELECT COUNT(d.id)::int AS count, t.max_devices FROM tenants t
       LEFT JOIN devices d ON d.tenant_id = t.id WHERE t.id = $1 GROUP BY t.id`,
      [parsed.data.tenant_id],
    );
    if (!count.rows[0]) {
      response.status(404).json({ success: false, error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found' } });
      return;
    }
    if (count.rows[0].count >= count.rows[0].max_devices) {
      response.status(409).json({ success: false, error: { code: 'DEVICE_LIMIT', message: 'Device limit reached' } });
      return;
    }

    const deviceKey = `WAPI-${randomBytes(5).toString('hex').toUpperCase()}`;
    const device = (await pool.query<{ id: string }>(
      `INSERT INTO devices (tenant_id, device_key, phone_number, label, status)
       VALUES ($1, $2, $3, $4, 'starting') RETURNING id`,
      [parsed.data.tenant_id, deviceKey, parsed.data.phone_number ?? null, parsed.data.label ?? null],
    )).rows[0]!;

    try {
      const result = await orchestrator.createBot({
        deviceKey,
        tenantId: parsed.data.tenant_id,
        phoneNumber: parsed.data.phone_number,
      });
      await pool.query(
        `UPDATE devices SET container_id = $2, status = 'pending_qr' WHERE id = $1`,
        [device.id, result.resourceName],
      );
      response.status(201).json({ success: true, device_key: deviceKey, qr_url: `/api/v1/devices/${deviceKey}/qr` });
    } catch (error) {
      await pool.query(`UPDATE devices SET status = 'error' WHERE id = $1`, [device.id]);
      logger.error('Unable to provision bot workload', { deviceKey, mode: orchestrator.mode, error });
      response.status(502).json({ success: false, error: { code: 'BOT_START_FAILED', message: 'Unable to start bot workload' } });
    }
  }));

  app.get('/devices', asyncRoute(async (_request, response) => {
    response.json({ success: true, data: await orchestrator.listBots() });
  }));

  app.get('/devices/:deviceKey/status', asyncRoute(async (request, response) => {
    const parsed = deviceKeySchema.safeParse(request.params.deviceKey);
    if (!parsed.success) {
      response.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid device key' } });
      return;
    }
    const status = await orchestrator.getBotStatus(parsed.data);
    if (!status) {
      response.status(404).json({ success: false, error: { code: 'DEVICE_NOT_FOUND', message: 'Bot workload not found' } });
      return;
    }
    response.json({ success: true, data: status });
  }));

  app.post('/devices/:deviceKey/scale', asyncRoute(async (request, response) => {
    const deviceKey = deviceKeySchema.safeParse(request.params.deviceKey);
    const body = scaleSchema.safeParse(request.body);
    if (!deviceKey.success || !body.success) {
      response.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid device key or replicas' } });
      return;
    }
    await orchestrator.scaleBot(deviceKey.data, body.data.replicas);
    await pool.query(`UPDATE devices SET status = $2 WHERE device_key = $1`, [
      deviceKey.data,
      body.data.replicas === 0 ? 'paused' : 'starting',
    ]);
    response.json({ success: true, device_key: deviceKey.data, replicas: body.data.replicas });
  }));

  app.post('/devices/:deviceKey/reconnect', asyncRoute(async (request, response) => {
    const parsed = deviceKeySchema.safeParse(request.params.deviceKey);
    if (!parsed.success) {
      response.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid device key' } });
      return;
    }
    const device = (await pool.query<{ tenant_id: string; phone_number: string | null; status: string }>(
      'SELECT tenant_id, phone_number, status FROM devices WHERE device_key = $1', [parsed.data],
    )).rows[0];
    if (!device) {
      response.status(404).json({ success: false, error: { code: 'DEVICE_NOT_FOUND', message: 'Device not found' } });
      return;
    }
    if (device.status !== 'offline' && device.status !== 'error') {
      response.status(409).json({ success: false, error: { code: 'DEVICE_NOT_RECOVERABLE', message: 'Only offline or error devices can be reconnected' } });
      return;
    }
    const workload = await orchestrator.restartBot({
      deviceKey: parsed.data,
      tenantId: device.tenant_id,
      phoneNumber: device.phone_number ?? undefined,
    });
    await pool.query(`UPDATE devices SET status = 'starting', qr_code = NULL WHERE device_key = $1`, [parsed.data]);
    response.json({ success: true, device_key: parsed.data, resource_name: workload.resourceName, status: 'starting' });
  }));

  app.delete('/devices/:deviceKey', asyncRoute(async (request, response) => {
    const parsed = deviceKeySchema.safeParse(request.params.deviceKey);
    if (!parsed.success) {
      response.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid device key' } });
      return;
    }
    await orchestrator.deleteBot(parsed.data);

    // Hard delete. messages.device_key keeps the history readable, so only the
    // FK is detached; unsent messages can never be delivered anymore.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const device = (await client.query<{ id: string }>(
        'SELECT id FROM devices WHERE device_key = $1', [parsed.data],
      )).rows[0];
      if (device) {
        await client.query(
          `UPDATE messages SET status = 'failed', error_message = 'Device deleted'
           WHERE device_id = $1 AND status IN ('queued', 'sending')`,
          [device.id],
        );
        await client.query('UPDATE messages SET device_id = NULL WHERE device_id = $1', [device.id]);
        await client.query('DELETE FROM devices WHERE id = $1', [device.id]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    response.status(204).send();
  }));

  app.use((_request, response) => {
    response.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    logger.error('Unhandled Device Manager request error', { error });
    response.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
  return app;
}

export async function main(): Promise<void> {
  const managerConfig = loadDeviceManagerConfig();
  const orchestrator = await createOrchestrator(managerConfig);
  const stopResourceCollector = startResourceUsageCollector(orchestrator, pool, (error) => {
    logger.warn('Unable to collect resource usage snapshot', { mode: orchestrator.mode, error });
  });
  const server = http.createServer(createDeviceManagerApp(orchestrator));
  server.listen(managerConfig.port, () => {
    logger.info('Device Manager listening', { port: managerConfig.port, mode: orchestrator.mode });
  });

  const shutdown = (signal: string): void => {
    logger.info('Stopping Device Manager', { signal });
    stopResourceCollector();
    server.close(() => void pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    logger.error('Unable to start Device Manager', { error });
    process.exit(1);
  });
}

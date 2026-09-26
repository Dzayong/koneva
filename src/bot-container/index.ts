import './tracing';
import express from 'express';
import { z } from 'zod';
import type { WASocket } from '@whiskeysockets/baileys';
import sharedConfig from '../shared/config';
import pool, { query } from '../shared/database/connection';
import logger from '../shared/utils/logger';
import { getRedisClient, closeRedisClient } from '../shared/redis';
import { startBotConnection } from './connection';
import { startQueueProcessor, registerReceiptListener, closeQueueResources } from './queue';
import { createApiRouter } from './api';
import { activeConnections } from './metrics';
import { shutdownTracing } from './tracing';
import { registerIncomingMessageListener } from './incoming';
import { AutoReplyEngine } from './auto-reply';
import { PresenceRoutine } from './presence';
import { CommandRunner } from './command-runner';
import { getOrCreatePersona } from '../shared/persona';
import { DeviceStatusNotifier } from './device-events';
import type { BotConfig, ConnectionState, BotStatus } from './types';

const DEVICE_STATUS_BY_BOT_STATUS: Record<BotStatus, string> = {
  initializing: 'starting',
  qr_pending: 'pending_qr',
  connecting: 'starting',
  online: 'online',
  reconnecting: 'starting',
  offline: 'offline',
  logged_out: 'offline',
  banned: 'banned',
  error: 'error',
};

const RECONNECT_DELAYS_MS = [5_000, 10_000, 20_000, 40_000, 60_000];

const botEnvSchema = z.object({
  BOT_ID: z.string().min(1, 'BOT_ID is required'),
  BOT_CONTAINER_PORT: z.coerce.number().int().positive().default(9000),
  MAX_RECONNECT_ATTEMPTS: z.coerce.number().int().positive().default(5),
  // Comma-separated list so a new key can be added ahead of removing the old
  // one during rotation. Falls back to the shared ADMIN_API_KEY if unset.
  BOT_API_KEYS: z.string().optional(),
  // Optional egress proxy (socks5://, http://) so a device keeps one stable IP.
  WA_PROXY_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
});

function loadConfig(): BotConfig {
  const parsed = botEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }

  const env = parsed.data;
  const apiKeys = (env.BOT_API_KEYS ?? sharedConfig.adminApiKey)
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);

  return {
    botId: env.BOT_ID,
    nodeEnv: sharedConfig.env,
    databaseUrl: sharedConfig.database.url,
    redisUrl: sharedConfig.redis.url,
    sessionPath: sharedConfig.sessionPath,
    healthPort: env.BOT_CONTAINER_PORT,
    maxReconnectAttempts: env.MAX_RECONNECT_ATTEMPTS,
    reconnectDelaysMs: RECONNECT_DELAYS_MS,
    queueName: `queue:messages:${env.BOT_ID}`,
    apiKeys,
    proxyUrl: env.WA_PROXY_URL || undefined,
  };
}

async function main(): Promise<void> {
  const botConfig = loadConfig();
  const log = logger.child({ service: 'bot-container', botId: botConfig.botId });

  log.info('Starting bot container', { nodeEnv: botConfig.nodeEnv });

  await pool.query('SELECT 1');
  log.info('Connected to PostgreSQL');

  const redis = getRedisClient(botConfig.redisUrl);
  await redis.ping();
  log.info('Connected to Redis');

  const queryFn = (text: string, params?: unknown[]) => query(text, params);
  const autoReplyEngine = new AutoReplyEngine(botConfig.botId, queryFn, redis, log);
  await autoReplyEngine.initialize();

  const notifier = new DeviceStatusNotifier(botConfig.botId, queryFn, log);
  await notifier.init();

  let currentState: ConnectionState = {
    botId: botConfig.botId,
    status: 'initializing',
    reconnectAttempt: 0,
  };
  let currentSocket: WASocket | undefined;

  const presence = new PresenceRoutine(
    () => currentSocket,
    async () => {
      const device = (await queryFn('SELECT id FROM devices WHERE device_key = $1', [botConfig.botId])).rows[0] as { id: string } | undefined;
      if (!device) return { enabled: false, minMs: 1_000, maxMs: 200_000 };
      const persona = await getOrCreatePersona(device.id, queryFn);
      return { enabled: persona.presenceEnabled, minMs: persona.presenceMinMs, maxMs: persona.presenceMaxMs };
    },
    log,
  );

  const commands = new CommandRunner(
    botConfig.botId, queryFn, () => currentSocket, () => currentState.status === 'online', presence, redis, log,
  );
  await commands.start();

  const queueProcessor = startQueueProcessor(
    botConfig.botId,
    redis,
    {
      getSocket: () => currentSocket,
      isConnected: () => currentState.status === 'online',
      presence,
    },
    log,
    queryFn,
  );

  const app = express();
  app.use(
    createApiRouter({
      config: botConfig,
      getState: () => currentState,
      getSocket: () => currentSocket,
      redis,
      queryFn,
    }),
  );

  const server = app.listen(botConfig.healthPort, () => {
    log.info('Health check endpoint listening', { port: botConfig.healthPort });
  });

  await startBotConnection(botConfig, log, {
    onStateChange: (state) => {
      currentState = state;
      void notifier.handle(state);
      activeConnections.set({ device_key: botConfig.botId }, state.status === 'online' ? 1 : 0);

      const deviceStatus = DEVICE_STATUS_BY_BOT_STATUS[state.status];
      const qrCode = state.status === 'qr_pending' ? (state.qr ?? null) : null;
      const clearsQr = state.status === 'online' || state.status === 'qr_pending';

      // Never clobber an administrative status (paused/banned) with raw
      // connection state — anti-ban.ts owns that transition, not this loop.
      queryFn(
        `UPDATE devices
         SET status = $1::varchar,
             qr_code = CASE WHEN $3::boolean THEN $2 ELSE qr_code END,
             last_connected = CASE WHEN $1::varchar = 'online' THEN now() ELSE last_connected END,
             updated_at = now()
         WHERE device_key = $4 AND status NOT IN ('paused', 'banned')`,
        [deviceStatus, qrCode, clearsQr, botConfig.botId],
      ).catch((err: unknown) => {
        log.error('Failed to sync device status', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    },
    onSocketReady: (sock: WASocket) => {
      currentSocket = sock;
      registerReceiptListener(sock, log, queryFn, botConfig.botId);
      registerIncomingMessageListener(sock, botConfig.botId, log, queryFn, async (message) => {
        // Direct chats only: groups are not "opened" by this routine.
        if (!message.isGroup) await presence.onInbound(message.key);
        await autoReplyEngine.process(message, sock, presence);
      });
    },
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    log.info('Shutting down bot container', { signal });
    server.close();
    presence.stop();
    await commands.stop();
    await queueProcessor.stop();
    await closeQueueResources();
    await autoReplyEngine.close();
    await closeRedisClient();
    await pool.end();
    await shutdownTracing();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('Fatal error starting bot container', err);
  process.exit(1);
});

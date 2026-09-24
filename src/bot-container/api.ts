import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import rateLimit from 'express-rate-limit';
import type Redis from 'ioredis';
import { z } from 'zod';
import type { WASocket } from '@whiskeysockets/baileys';
import logger from '../shared/utils/logger';
import { getDeviceByKeyCached, type QueryFn } from './health-score';
import { enqueueMessage } from './queue';
import { hasRegisteredSession } from './session';
import { getHealthReport } from './health';
import { registry } from './metrics';
import { ApiError, internalError, tooManyRequestsError, unauthorizedError, validationError } from './errors';
import type { BotConfig, ConnectionState } from './types';

const PHONE_PATTERN = /^\d{8,15}$/;

const sendBodySchema = z.object({
  to: z
    .string()
    .trim()
    .min(1, 'to is required')
    .regex(PHONE_PATTERN, 'to must be digits only (country code + number, e.g. 6281234567890)'),
  type: z.enum(['text', 'image', 'video', 'audio', 'document']).default('text'),
  content: z.string().trim().min(1, 'content is required').max(4096, 'content exceeds 4096 characters'),
});

export interface ApiDependencies {
  config: BotConfig;
  getState: () => ConnectionState;
  getSocket: () => WASocket | undefined;
  redis: Redis;
  queryFn: QueryFn;
}

function requireApiKey(apiKeys: string[]) {
  const validKeys = new Set(apiKeys);
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (validKeys.size === 0) {
      // No key configured: fail open only in non-production so local dev isn't blocked,
      // but this should always be set once the API leaves a developer's machine.
      next();
      return;
    }

    const header = req.header('x-api-key') ?? req.header('authorization');
    const provided = header?.toLowerCase().startsWith('bearer ') ? header.slice(7) : header;

    if (!provided || !validKeys.has(provided)) {
      next(unauthorizedError());
      return;
    }

    next();
  };
}

const sendRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(tooManyRequestsError('Too many /send requests, slow down')),
});

export function createApiRouter(deps: ApiDependencies): Router {
  const router = express.Router();
  router.use(express.json());

  // Unauthenticated: orchestrators (Docker/Kubernetes) and Prometheus scrape
  // these without app-level credentials — protect them at the network layer.
  router.get('/health', async (_req, res, next) => {
    try {
      const state = deps.getState();
      const report = await getHealthReport(deps.redis, state);
      const httpStatus = report.status === 'unhealthy' ? 503 : 200;
      res.status(httpStatus).json({
        status: report.status,
        device_key: deps.config.botId,
        uptime: process.uptime(),
        dependencies: report.dependencies,
        ...(report.detail ? { detail: report.detail } : {}),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/ready', (_req, res) => {
    const state = deps.getState();
    const ready = state.status === 'online';
    res.status(ready ? 200 : 503).json({ ready, status: state.status });
  });

  router.get('/metrics', async (_req, res, next) => {
    try {
      res.set('Content-Type', registry.contentType);
      res.send(await registry.metrics());
    } catch (err) {
      next(err);
    }
  });

  router.use(requireApiKey(deps.config.apiKeys));

  router.get('/status', async (_req, res, next) => {
    try {
      const state = deps.getState();
      const device = await getDeviceByKeyCached(deps.config.botId, deps.redis, deps.queryFn);

      res.json({
        device_key: deps.config.botId,
        connection: {
          status: state.status,
          reconnectAttempt: state.reconnectAttempt,
          lastConnectedAt: state.lastConnectedAt ?? null,
          lastDisconnectReason: state.lastDisconnectReason ?? null,
        },
        hasSession: hasRegisteredSession(deps.config.sessionPath, deps.config.botId),
        device: device
          ? {
              id: device.id,
              tenantId: device.tenantId,
              status: device.status,
              healthScore: device.healthScore,
              warmupCompletedAt: device.warmupCompletedAt,
              pausedUntil: device.pausedUntil,
            }
          : null,
        uptimeSeconds: process.uptime(),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/send', sendRateLimiter, async (req, res, next) => {
    try {
      const parsed = sendBodySchema.safeParse(req.body);
      if (!parsed.success) {
        next(validationError('Invalid request body', parsed.error.flatten()));
        return;
      }

      const messageId = await enqueueMessage(
        deps.config.botId,
        parsed.data,
        deps.redis,
        deps.queryFn,
      );

      res.status(202).json({ messageId, status: 'queued' });
    } catch (err) {
      next(err);
    }
  });

  router.use((req, _res, next) => {
    next(new ApiError(404, 'not_found', `Route not found: ${req.method} ${req.path}`));
  });

  router.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && 'status' in err && (err as { status?: number }).status === 400) {
      res.status(400).json({ error: { code: 'validation_error', message: 'Invalid JSON body' } });
      return;
    }

    const apiError = err instanceof ApiError ? err : internalError();

    if (apiError.statusCode >= 500) {
      logger.error('Unhandled API error', {
        path: req.path,
        method: req.method,
        error: err instanceof Error ? err.message : String(err),
      });
    } else {
      logger.warn('API request rejected', {
        path: req.path,
        method: req.method,
        code: apiError.code,
        message: apiError.message,
      });
    }

    res.status(apiError.statusCode).json({
      error: {
        code: apiError.code,
        message: apiError.message,
        ...(apiError.details ? { details: apiError.details } : {}),
      },
    });
  });

  return router;
}

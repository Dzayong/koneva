import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import config from '../shared/config';
import pool from '../shared/database/connection';
import { getRedisClient } from '../shared/redis';
import logger from '../shared/utils/logger';
import { adminAuth, authorize, tenantAuth } from './middleware/auth';
import { adminNetworkGuard } from './middleware/admin-access';
import { assertMailerConfig } from './services/mailer';
import adminRoutes from './routes/admin.routes';
import deviceRoutes from './routes/device.routes';
import messageRoutes from './routes/message.routes';
import tenantRoutes from './routes/tenant.routes';
import contactRoutes from './routes/contact.routes';
import templateRoutes from './routes/template.routes';
import analyticsRoutes from './routes/analytics.routes';
import autoReplyRoutes from './routes/auto-reply.routes';
import statsRoutes from './routes/stats.routes';
import broadcastRoutes from './routes/broadcast.routes';
import activityRoutes from './routes/activity.routes';
import authRoutes from './routes/auth.routes';
import keysRoutes from './routes/keys.routes';
import auditRoutes from './routes/audit.routes';
import teamRoutes from './routes/team.routes';
import { purgeOldCommands } from './services/command.service';
import deviceContentRoutes from './routes/device-content.routes';
import billingRoutes from './routes/billing.routes';
import publicRoutes from './routes/public.routes';
import { sweepSubscriptions } from './services/billing.service';
import { auditTrail } from './middleware/audit';
import { ServiceError } from './services/service-error';
import { createOperatorRouter } from './operator/router';
import { readOperatorConfig } from './operator/config';
import { cleanupOperatorData, idempotencyRetentionDays } from './operator/maintenance';
import { startOtpMaintenance } from './services/otp-maintenance';

assertMailerConfig(); // invalid mail settings stop startup; unset = OTP features fail safe
const operatorConfig = readOperatorConfig();
const operatorRetentionDays = operatorConfig.enabled ? idempotencyRetentionDays() : 0; // invalid retention stops startup
const app = express();
// Explicit opt-in for the local personal proxy; direct deployments remain off.
const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
if (Number.isInteger(proxyHops) && proxyHops > 0 && proxyHops <= 2) {
  app.set('trust proxy', proxyHops);
}
app.disable('x-powered-by');
app.use(helmet());
// Own parser, errors and rate limits; never inherits tenant CORS or generic error logging.
app.use('/operator', createOperatorRouter(pool, operatorConfig));
app.use(cors(config.env === 'production' ? {
  origin: process.env.CORS_ORIGIN?.split(',').map(s => s.trim()) ?? false,
  credentials: true,
} : {}));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_request, response) => response.status(429).json({
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests' },
  }),
}));
app.use((request, response, next) => {
  const started = Date.now();
  response.on('finish', () => logger.info('HTTP request', {
    method: request.method, path: request.path, status: response.statusCode,
    duration: Date.now() - started,
  }));
  next();
});

app.get('/health', (_request, response) => response.json({ status: 'ok' }));
app.get('/ready', async (_request, response) => {
  try {
    await Promise.all([
      pool.query('SELECT 1'),
      getRedisClient(config.redis.url).ping(),
    ]);
    response.json({ status: 'ready' });
  } catch (error) {
    logger.warn('Readiness check failed', { error });
    response.status(503).json({ status: 'not_ready' });
  }
});
app.use('/auth', authRoutes);
app.use('/public', publicRoutes);
app.use('/api/v1', tenantAuth, authorize, auditTrail, messageRoutes, deviceRoutes, tenantRoutes,
  contactRoutes, templateRoutes, analyticsRoutes, autoReplyRoutes, statsRoutes, broadcastRoutes, deviceContentRoutes, activityRoutes, keysRoutes, auditRoutes, teamRoutes, billingRoutes);
app.use('/admin', adminNetworkGuard(), adminAuth, adminRoutes);
app.use((_request, response) => response.status(404).json({
  success: false, error: { code: 'NOT_FOUND', message: 'Route not found' },
}));

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  logger.error('Request failed', { error });
  if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
    response.status(400).json({
      success: false,
      error: { code: 'INVALID_JSON', message: 'Malformed JSON request body' },
    });
    return;
  }
  if (error instanceof ServiceError) {
    if (error.retryAfter) response.set('Retry-After', String(error.retryAfter));
    response.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
    return;
  }
  response.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
};
app.use(errorHandler);

const server = app.listen(config.port, () => logger.info(`API Gateway listening on port ${config.port}`));

// Records lapsed subscriptions for operators. Enforcement is computed from dates and does not depend on this.
const runSweep = (): void => {
  sweepSubscriptions()
    .then((counts) => {
      if (counts.expired + counts.past_due + counts.suspended > 0) logger.info('Subscriptions swept', counts);
    })
    .catch((error: unknown) => logger.error('Subscription sweep failed', { error: error instanceof Error ? error.message : String(error) }));
};
const runPurge = (): void => { void purgeOldCommands().catch((error: unknown) => logger.error('Command purge failed', { error: error instanceof Error ? error.message : String(error) })); };
// Expired operator sessions/challenges/throttle buckets and idempotency rows past retention. Never audit or business data.
const runOperatorCleanup = (): void => {
  cleanupOperatorData(pool, operatorRetentionDays)
    .then((counts) => { if (Object.values(counts).some((n) => n > 0)) logger.info('Operator data cleaned', counts); })
    .catch((error: unknown) => logger.error('Operator cleanup failed', { error: error instanceof Error ? error.message : String(error) }));
};
startOtpMaintenance(pool); // OTP tables are customer-facing: cleaned whether or not the operator panel is on
if (operatorConfig.enabled) {
  setTimeout(runOperatorCleanup, 60_000).unref();
  setInterval(runOperatorCleanup, 60 * 60_000).unref();
}
setTimeout(runPurge, 45_000).unref();
setInterval(runPurge, 60 * 60_000).unref();
setTimeout(runSweep, 30_000).unref();
setInterval(runSweep, 60 * 60_000).unref();

function shutdown(): void {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default app;

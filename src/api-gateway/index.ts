import express, { type ErrorRequestHandler } from 'express';
import { z } from 'zod';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import config from '../shared/config';
import pool from '../shared/database/connection';
import { getRedisClient } from '../shared/redis';
import logger from '../shared/utils/logger';
import { adminAuth, authorize, enforceDeviceKeyScope, tenantAuth } from './middleware/auth';
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
import campaignRoutes, { processDueCampaigns } from './routes/campaign.routes';
import activityRoutes from './routes/activity.routes';
import authRoutes from './routes/auth.routes';
import keysRoutes from './routes/keys.routes';
import auditRoutes from './routes/audit.routes';
import teamRoutes from './routes/team.routes';
import { purgeOldCommands } from './services/command.service';
import deviceContentRoutes from './routes/device-content.routes';
import billingRoutes from './routes/billing.routes';
import publicRoutes from './routes/public.routes';
import dokuWebhookRoutes from './routes/doku-webhook.routes';
import duitkuWebhookRoutes from './routes/duitku-webhook.routes';
import { drainStudentEmailOutbox, sweepStudentVerificationDeadlines, sweepSubscriptions } from './services/billing.service';
import { sweepQuotaHolds } from './services/message.service';
import { auditTrail } from './middleware/audit';
import { ServiceError } from './services/service-error';
import { createOperatorRouter } from './operator/router';
import { generateInternalAiReply } from './operator/ai-reply-settings';
import { readOperatorConfig } from './operator/config';
import { cleanupOperatorData, idempotencyRetentionDays } from './operator/maintenance';
import { startOtpMaintenance } from './services/otp-maintenance';
import { drainSystemNotificationOutbox } from './services/system-notifications';
import { mediaTypeForMime, saveMedia, MEDIA_LIMITS, validMediaBytes, removeMedia } from '../shared/media-storage';
import { purgeExpiredMedia } from './services/media.service';

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
// Private bot-to-gateway media transport. Bots never mount the shared media volume.
app.post('/internal/media/upload', adminAuth, express.raw({ type: 'application/octet-stream', limit: '64mb' }), async (request, response, next) => {
  try {
    const deviceKey = request.header('x-device-key') ?? '';
    const mime = (request.header('x-media-type') ?? '').toLowerCase();
    const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    const mediaType = mediaTypeForMime(mime);
    const device = (await pool.query<{ id: string; tenant_id: string }>('SELECT id, tenant_id FROM devices WHERE device_key=$1 LIMIT 1', [deviceKey])).rows[0];
    if (!device || !mediaType || bytes.length === 0 || bytes.length > (mediaType === 'image' ? MEDIA_LIMITS.image : MEDIA_LIMITS.video) || !validMediaBytes(bytes, mime)) {
      response.status(400).json({ success: false, error: { code: 'INVALID_MEDIA', message: 'Unsupported media or device' } }); return;
    }
    const id = await saveMedia(bytes, mime);
    try {
      await pool.query(`INSERT INTO media_objects (id,tenant_id,device_id,content_type,byte_size,original_name,expires_at)
        SELECT $1,$2,$3,$4,$5,$6, CASE WHEN d.media_retention_days IS NULL THEN NULL
          ELSE now() + make_interval(days => d.media_retention_days) END FROM devices d WHERE d.id=$3`,
        [id, device.tenant_id, device.id, mime, bytes.length, request.header('x-file-name')?.slice(0, 180) ?? null]);
    } catch (error) {
      await removeMedia(id);
      throw error;
    }
    response.status(201).json({ success: true, data: { id, type: mediaType, content_type: mime, byte_size: bytes.length } });
  } catch (error) { next(error); }
});
app.get('/internal/media/:id', adminAuth, async (request, response, next) => {
  try {
    const deviceKey = request.header('x-device-key') ?? '';
    const row = (await pool.query<{ content_type: string }>(
      `SELECT m.content_type FROM media_objects m JOIN devices d ON d.id=m.device_id
       WHERE m.id=$1 AND d.device_key=$2 AND (m.expires_at IS NULL OR m.expires_at>now())`, [String(request.params.id), deviceKey],
    )).rows[0];
    if (!row) { response.status(404).end(); return; }
    const { readMedia } = await import('../shared/media-storage');
    response.type(row.content_type).send(await readMedia(String(request.params.id)));
  } catch (error) { next(error); }
});
// `verify` only stashes the raw bytes (req.rawBody); it does not change parsing. Needed to check an
// inbound webhook signature (DOKU), which is computed over the exact bytes sent, not a re-serialised body.
app.use(express.json({ limit: '1mb', verify: (request, _response, buf) => { (request as express.Request).rawBody = buf; } }));
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

// Private bot-to-gateway proxy: provider credentials and prompts are never injected into bot containers.
app.post('/internal/ai-reply', adminAuth, async (request, response, next) => {
  try {
    const input = z.object({ rule_id: z.string().uuid(), device_key: z.string().regex(/^WAPI-[A-Z0-9-]+$/i).max(64), message: z.string().min(1).max(4000), recipient: z.string().max(128).optional(), contact_name: z.string().max(160).optional(), inbound_message_id: z.string().uuid().optional() }).strict().parse(request.body);
    const message = await generateInternalAiReply(pool, {
      ruleId: input.rule_id,
      deviceKey: input.device_key,
      inboundText: input.message,
      ...(input.inbound_message_id ? { inboundMessageId: input.inbound_message_id } : {}),
      ...(input.recipient !== undefined ? { recipient: input.recipient } : {}),
      ...(input.contact_name !== undefined ? { contactName: input.contact_name } : {}),
    });
    response.json({ success: true, data: { message } });
  } catch (error) { next(error); }
});
app.use('/auth', authRoutes);
app.use('/public', publicRoutes);
app.use(dokuWebhookRoutes);
app.use(duitkuWebhookRoutes);
app.use('/api/v1', tenantAuth, enforceDeviceKeyScope, authorize, auditTrail, messageRoutes, deviceRoutes, tenantRoutes,
  contactRoutes, templateRoutes, analyticsRoutes, autoReplyRoutes, statsRoutes, broadcastRoutes, campaignRoutes, deviceContentRoutes, activityRoutes, keysRoutes, auditRoutes, teamRoutes, billingRoutes);
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
const runStudentVerificationMaintenance = (): void => {
  Promise.all([sweepStudentVerificationDeadlines(), drainStudentEmailOutbox()])
    .then(([expired, email]) => {
      if (expired > 0) logger.info('Student verification deadlines applied', { expired });
      if (email.sent > 0 || email.failed > 0) logger.info('Student verification email outbox processed', email);
    })
    .catch((error: unknown) => logger.error('Student verification maintenance failed', { error: error instanceof Error ? error.message : String(error) }));
};
const runPurge = (): void => { void purgeOldCommands().catch((error: unknown) => logger.error('Command purge failed', { error: error instanceof Error ? error.message : String(error) })); };
// Messages held because the monthly quota was full: released, in order, as soon as any tenant has headroom again
// (a new billing window, an upgrade, or another send finishing this period). Never dropped while held.
const runQuotaRelease = (): void => {
  sweepQuotaHolds()
    .then((counts) => { if (counts.released > 0) logger.info('Held messages released', counts); })
    .catch((error: unknown) => logger.error('Quota hold sweep failed', { error: error instanceof Error ? error.message : String(error) }));
};
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
setTimeout(runStudentVerificationMaintenance, 35_000).unref();
setInterval(runStudentVerificationMaintenance, 60_000).unref();
setTimeout(runQuotaRelease, 40_000).unref();
setInterval(runQuotaRelease, 2 * 60_000).unref();
const runMediaCleanup = (): void => {
  purgeExpiredMedia().catch((error: unknown) => logger.error('Expired media cleanup failed', { error: error instanceof Error ? error.message : String(error) }));
};
setTimeout(runMediaCleanup, 45_000).unref();
setInterval(runMediaCleanup, 30 * 60_000).unref();
const runScheduledCampaigns = (): void => {
  processDueCampaigns()
    .then((count) => { if (count > 0) logger.info('Scheduled campaigns processed', { count }); })
    .catch((error: unknown) => logger.error('Scheduled campaign processing failed', { error: error instanceof Error ? error.message : String(error) }));
};
setTimeout(runScheduledCampaigns, 15_000).unref();
setInterval(runScheduledCampaigns, 15_000).unref();
const runSystemNotifications = (): void => {
  drainSystemNotificationOutbox(pool)
    .then(({ queued, deferred }) => { if (queued || deferred) logger.info('System WhatsApp notifications processed', { queued, deferred }); })
    .catch((error: unknown) => logger.error('System WhatsApp notification dispatcher failed', { error: error instanceof Error ? error.message : String(error) }));
};
setTimeout(runSystemNotifications, 10_000).unref();
setInterval(runSystemNotifications, 5_000).unref();

function shutdown(): void {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default app;

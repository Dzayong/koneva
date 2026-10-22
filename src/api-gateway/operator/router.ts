import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { OperatorConfig } from './config';
import { authenticate, checkCsrf, checkOrigin, clearSessionCookie, login, me, reserveLoginAttempt, sessionToken } from './auth';
import { operatorTransaction, OperatorError, type Actor } from './core';
import { closeWorkspace, confirmPayment, decideStudent } from './mutations';
import { otpAlerts } from './alerts';
import { ownerInsights, ownerDeviceList, ownerDeviceDetail, ownerSystemHealth, ownerWorkspaceList, ownerWorkspaceDetail, ownerWorkspaceCostMeter } from './insights';
import { getSystemWhatsappOtpSender, pairSystemWhatsappOtpSender, queueSystemWhatsappNotificationTest, saveSystemWhatsappNotificationSettings } from './system-whatsapp-otp';
import { getAiReplySettings, saveAiReplySettings } from './ai-reply-settings';
import { invoiceDetail, listAudit, listInvoices, listStudents, listWorkspaces, studentDetail, workspaceDetail } from './reads';

const uuid = z.string().uuid().transform((v) => v.toLowerCase());
const keySchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).transform((v) => v.toLowerCase());
const password = z.string().min(1).max(128).refine((v) => Buffer.byteLength(v, 'utf8') <= 72);
const loginSchema = z.object({ email: z.string().trim().toLowerCase().email().max(255), password }).strict();
const pageSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).max(1_000_000).default(0), q: z.string().max(100).optional() }).strict();
const invoiceFilters = pageSchema.extend({ status: z.enum(['unpaid','paid','void']).optional() });
const studentFilters = pageSchema.extend({ status: z.enum(['pending','approved','rejected','correction_required','expired','superseded']).optional() });
const paymentSchema = z.object({ method: z.enum(['transfer','ewallet','qris','tunai','lainnya']), reference: z.string().max(80).optional(), note: z.string().max(500).optional(),
  expected: z.object({ amount_idr: z.number().int().nonnegative(), version: z.number().int().positive() }).strict() }).strict();
const decisionSchema = z.object({ decision: z.enum(['approve','reject']), reason: z.string().max(500).optional(),
  expected: z.object({ request_id: z.string().uuid(), version: z.number().int().positive() }).strict() }).strict();
const closeWorkspaceSchema = z.object({ confirmation: z.string().trim().min(1).max(100), reason: z.string().trim().min(10).max(500) }).strict();
const ownerPageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  q: z.string().max(100).optional(),
  status: z.string().max(40).optional(),
  workspace: z.string().max(80).optional(),
  sort: z.string().max(40).optional(),
  since: z.string().max(30).optional(),
  attention: z.enum(['1']).optional(),
  plan: z.string().max(80).optional(),
}).strict();
const auditSchema = pageSchema.omit({ q: true }).extend({ action: z.string().max(80).optional(), operator_id: uuid.optional(),
  target_type: z.enum(['invoice','student_request']).optional(), target_id: uuid.optional(),
  from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() });

export function createOperatorRouter(db: Pool, config: OperatorConfig) {
  const router = express.Router();
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store'); response.vary('Cookie');
    response.set('X-Content-Type-Options', 'nosniff');
    response.locals['requestId'] = randomUUID();
    response.set('X-Request-Id', response.locals['requestId']);
    if (!config.enabled) { response.status(404).json({ success: false, error: { code: 'OPERATOR_DISABLED', message: 'Panel operator belum diaktifkan.' } }); return; }
    next();
  });
  router.use(rateLimit({ windowMs: 60_000, limit: config.requestsPerMinute ?? 120, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Terlalu banyak permintaan.' } }) }));
  router.use((request, _response, next) => {
    if (!['GET','HEAD','OPTIONS'].includes(request.method)) checkOrigin(request, config);
    next();
  });
  router.use(express.json({ limit: '16kb', strict: true }));
  const bootstrap = (request: express.Request): void => {
    if (!request.is('application/json') || request.get('X-Requested-With') !== 'koneva-operator') {
      throw new OperatorError(400, 'VALIDATION_ERROR', 'Login memerlukan JSON dan header operator.');
    }
  };
  router.post('/auth/login', async (request, response) => {
    bootstrap(request);
    response.json({ success: true, data: await login(db, config, request, response, loginSchema.parse(request.body)) });
  });
  const mfaDisabled: express.RequestHandler = (_request, response) => {
    response.status(410).json({ success: false, error: { code: 'MFA_REMOVED', message: 'Verifikasi dua langkah sudah dihapus. Gunakan endpoint /auth/login.' } });
  };
  router.post('/auth/mfa/verify', mfaDisabled);
  router.post('/auth/mfa/enroll/start', mfaDisabled);
  router.post('/auth/mfa/enroll/confirm', mfaDisabled);
  router.use(async (request, response, next) => {
    const token = sessionToken(request, config);
    const actor = await authenticate(db, token);
    response.locals['actor'] = actor;
    response.locals['token'] = token;
    if (!['GET','HEAD','OPTIONS'].includes(request.method)) checkCsrf(request, token!);
    next();
  });
  const actorOf = (response: express.Response): Actor => response.locals['actor'] as Actor;
  const permit = (permission: string): RequestHandler => (_request, response, next) => {
    if (!actorOf(response).permissions.includes(permission)) throw new OperatorError(403, 'FORBIDDEN', 'Izin tidak mencukupi.');
    next();
  };
  router.get('/me', (_request, response) => { response.json({ success: true, data: me(actorOf(response), response.locals['token']) }); });
  router.post('/auth/logout', async (_request, response) => {
    await db.query('UPDATE operator_sessions SET revoked_at=now() WHERE token_hash=$1', [actorOf(response).tokenHash]);
    clearSessionCookie(response, config); response.status(204).end();
  });
  router.post('/auth/sessions/revoke-all', async (_request, response) => {
    const actor = actorOf(response);
    await operatorTransaction(db, async (client) => {
      await client.query('SELECT id FROM operators WHERE id=$1 FOR UPDATE', [actor.id]);
      await client.query('UPDATE operator_sessions SET revoked_at=now() WHERE operator_id=$1 AND revoked_at IS NULL', [actor.id]);
    });
    clearSessionCookie(response, config); response.status(204).end();
  });
  router.post('/auth/password', async (request, response) => {
    const input = z.object({ current_password: password, new_password: password.refine((v) => v.length >= 12) }).strict().parse(request.body);
    const actor = actorOf(response);
    await reserveLoginAttempt(db, actor.email, request.ip ?? 'unknown');
    const account = (await db.query<{ password_hash: string }>('SELECT password_hash FROM operators WHERE id=$1', [actor.id])).rows[0]!;
    if (!await bcrypt.compare(input.current_password, account.password_hash)) throw new OperatorError(401, 'INVALID_CREDENTIALS', 'Kata sandi salah.');
    const newHash = await bcrypt.hash(input.new_password, 12);
    const changed = await db.query('UPDATE operators SET password_hash=$2 WHERE id=$1 AND password_hash=$3 AND disabled_at IS NULL RETURNING id', [actor.id, newHash, account.password_hash]);
    if (!changed.rowCount) throw new OperatorError(401, 'SESSION_EXPIRED', 'Sesi berakhir.');
    clearSessionCookie(response, config); response.status(204).end();
  });
  router.get('/invoices', permit('payments:read'), async (request, response) => {
    response.json({ success: true, ...await listInvoices(db, invoiceFilters.parse(request.query)) });
  });
  router.get('/invoices/:id', permit('payments:read'), async (request, response) => {
    response.json({ success: true, data: await invoiceDetail(db, uuid.parse(request.params['id'])) });
  });
  router.post('/invoices/:id/confirm-payment', permit('payments:confirm'), async (request, response) => {
    const result = await confirmPayment(db, actorOf(response), uuid.parse(request.params['id']), keySchema.parse(request.get('Idempotency-Key')), paymentSchema.parse(request.body), response.locals['requestId']);
    if (result.replay) response.set('Idempotent-Replay', 'true');
    response.json(result.body);
  });
  router.get('/student-requests', permit('students:read'), async (request, response) => {
    response.json({ success: true, ...await listStudents(db, studentFilters.parse(request.query)) });
  });
  router.get('/student-requests/:id', permit('students:read'), async (request, response) => {
    response.json({ success: true, data: await studentDetail(db, uuid.parse(request.params['id'])) });
  });
  router.post('/student-requests/:id/decision', permit('students:decide'), async (request, response) => {
    const input = decisionSchema.parse(request.body);
    if (input.decision === 'reject' && !input.reason?.trim()) throw new OperatorError(400, 'REASON_REQUIRED', 'Alasan penolakan wajib diisi.');
    const result = await decideStudent(db, actorOf(response), uuid.parse(request.params['id']), keySchema.parse(request.get('Idempotency-Key')), input, response.locals['requestId']);
    if (result.replay) response.set('Idempotent-Replay', 'true');
    response.json(result.body);
  });
  router.get('/workspaces', permit('workspaces:read'), async (request, response) => {
    response.json({ success: true, ...await listWorkspaces(db, pageSchema.parse(request.query)) });
  });
  router.get('/workspaces/:id', permit('workspaces:read'), async (request, response) => {
    response.json({ success: true, data: await workspaceDetail(db, uuid.parse(request.params['id'])) });
  });
  // Operational alert: OTP sender budget. Same permission as the audit trail (operators trusted with system history); counts and times only.
  router.get('/alerts/otp', permit('audit:read'), async (_request, response) => {
    response.json({ success: true, data: await otpAlerts(db) });
  });
  // Owner-only section: every successful view writes one immutable audit record.
  router.get('/insights', permit('owner:insights'), async (request, response) => {
    response.json({ success: true, data: await ownerInsights(db, actorOf(response), response.locals['requestId'] as string, request.ip ?? 'unknown') });
  });
  router.get('/insights/devices', permit('owner:insights'), async (request, response) => {
    const { limit, offset } = ownerPageSchema.parse(request.query);
    const status = typeof request.query['status'] === 'string' ? request.query['status'] : undefined;
    const workspace = typeof request.query['workspace'] === 'string' ? request.query['workspace'] : undefined;
    const sort = typeof request.query['sort'] === 'string' ? request.query['sort'] : undefined;
    const since = typeof request.query['since'] === 'string' ? request.query['since'] : undefined;
    const attentionOnly = request.query['attention'] === '1';
    response.json({ success: true, ...await ownerDeviceList(db, actorOf(response), response.locals['requestId'] as string, request.ip ?? 'unknown', limit, offset, status, workspace, sort, since, attentionOnly) });
  });
  router.get('/insights/devices/:id', permit('owner:insights'), async (request, response) => {
    response.json({ success: true, data: await ownerDeviceDetail(db, actorOf(response), response.locals['requestId'] as string, request.ip ?? 'unknown', uuid.parse(request.params['id'])) });
  });
  router.get('/insights/health', permit('owner:insights'), async (request, response) => {
    response.json({ success: true, data: await ownerSystemHealth(db, actorOf(response), response.locals['requestId'] as string, request.ip ?? 'unknown') });
  });
  router.get('/system/whatsapp-otp-sender', permit('owner:insights'), async (request, response) => {
    const query = z.object({ include_qr: z.enum(['1']).optional() }).strict().parse(request.query);
    response.json({ success: true, data: await getSystemWhatsappOtpSender(db, actorOf(response), response.locals['requestId'] as string, request.ip ?? 'unknown', query.include_qr === '1') });
  });
  router.post('/system/whatsapp-otp-sender/pair', permit('owner:insights'), async (_request, response) => {
    response.json({ success: true, data: await pairSystemWhatsappOtpSender(db, actorOf(response), response.locals['requestId'] as string, _request.ip ?? 'unknown') });
  });
  router.put('/system/whatsapp-otp-sender/notifications', permit('owner:insights'), async (request, response) => {
    const input = z.object({ recipient_phone: z.string().trim().max(30).nullable().optional(), enabled: z.boolean() }).strict().parse(request.body);
    response.json({ success: true, data: await saveSystemWhatsappNotificationSettings(db, actorOf(response), response.locals['requestId'] as string,
      request.ip ?? 'unknown', { ...(input.recipient_phone !== undefined ? { recipientPhone: input.recipient_phone } : {}), enabled: input.enabled }) });
  });
  router.post('/system/whatsapp-otp-sender/notifications/test', permit('owner:insights'), async (request, response) => {
    response.json({ success: true, data: await queueSystemWhatsappNotificationTest(db, actorOf(response), response.locals['requestId'] as string, request.ip ?? 'unknown') });
  });
  router.get('/system/ai-reply', permit('owner:insights'), async (request, response) => {
    response.json({ success: true, data: await getAiReplySettings(db, actorOf(response), response.locals['requestId'] as string, request.ip ?? 'unknown') });
  });
  router.put('/system/ai-reply', permit('owner:insights'), async (request, response) => {
    const input = z.object({ base_url: z.string().trim().min(1).max(500), model: z.string().trim().min(1).max(160),
      api_key: z.string().max(500).optional(), enabled: z.boolean() }).strict().parse(request.body);
    response.json({ success: true, data: await saveAiReplySettings(db, actorOf(response), response.locals['requestId'] as string,
      request.ip ?? 'unknown', { baseUrl: input.base_url, model: input.model, ...(input.api_key !== undefined ? { apiKey: input.api_key } : {}), enabled: input.enabled }) });
  });
  router.get('/insights/workspaces', permit('owner:insights'), async (request, response) => {
    const { limit, offset, q } = ownerPageSchema.parse(request.query);
    const plan = typeof request.query['plan'] === 'string' ? request.query['plan'] : undefined;
    const status = typeof request.query['status'] === 'string' ? request.query['status'] : undefined;
    response.json({ success: true, ...await ownerWorkspaceList(db, actorOf(response), response.locals['requestId'] as string, request.ip ?? 'unknown', limit, offset, q, plan, status) });
  });
  router.get('/insights/workspaces/:id', permit('owner:insights'), async (request, response) => {
    response.json({ success: true, data: await ownerWorkspaceDetail(db, actorOf(response), response.locals['requestId'] as string, request.ip ?? 'unknown', uuid.parse(request.params['id'])) });
  });
  router.post('/insights/workspaces/:id/close', permit('owner:insights'), async (request, response) => {
    const result = await closeWorkspace(db, actorOf(response), uuid.parse(request.params['id']), keySchema.parse(request.get('Idempotency-Key')),
      closeWorkspaceSchema.parse(request.body), response.locals['requestId'] as string, request.ip ?? 'unknown');
    if (result.replay) response.set('Idempotent-Replay', 'true');
    response.json(result.body);
  });
  router.get('/insights/workspaces/:id/cost-meter', permit('owner:insights'), async (request, response) => {
    response.json({ success: true, data: await ownerWorkspaceCostMeter(db, actorOf(response), response.locals['requestId'] as string, request.ip ?? 'unknown', uuid.parse(request.params['id'])) });
  });
  router.get('/audit', permit('audit:read'), async (request, response) => {
    const filter = auditSchema.parse(request.query);
    const to = filter.to ?? new Date().toISOString();
    const from = filter.from ?? new Date(new Date(to).getTime() - 30 * 86_400_000).toISOString();
    const range = new Date(to).getTime() - new Date(from).getTime();
    if (range <= 0 || range > 90 * 86_400_000) throw new OperatorError(400, 'VALIDATION_ERROR', 'Rentang audit harus lebih dari 0 dan maksimal 90 hari.');
    response.json({ success: true, ...await listAudit(db, { ...filter, from, to, includeClientIp: actorOf(response).permissions.includes('owner:insights') }) });
  });
  router.use((_request, response) => { response.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' } }); });
  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    // Never pass SQL errors or request bodies to generic logging/error middleware (student notes are private).
    if (error instanceof OperatorError) {
      if (error.retryAfter) response.set('Retry-After', String(error.retryAfter));
      response.status(error.status).json({ success: false, error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });
    } else if (error instanceof z.ZodError || error?.type === 'entity.parse.failed') {
      response.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Format permintaan tidak valid.' } });
    } else if (error?.type === 'entity.too.large') {
      response.status(413).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Permintaan terlalu besar.' } });
    } else {
      response.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Permintaan belum dapat diselesaikan. Periksa status sebelum mencoba lagi.' } });
    }
  };
  router.use(errors);
  return router;
}

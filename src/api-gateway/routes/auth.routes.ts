import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import config from '../../shared/config';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../../shared/permissions';
import { getRedisClient } from '../../shared/redis';
import { validate } from '../middleware/validate';
import { login, resolveSession, revokeSession, sha256, signup } from '../services/account.service';
import { acceptInvitation, previewInvitation, requestInvitationOtp } from '../services/team.service';
import { confirmEmailVerification, confirmSignupEmailVerification, requestEmailVerification, requestSignupEmailVerification } from '../services/owner-verification.service';
import { recordSiteEvent } from '../services/site-stats.service';
import { getSubscriptionSummary } from '../services/billing.service';
import { recordAudit } from '../services/audit.service';
import { ServiceError } from '../services/service-error';

const router = Router();

export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(10, 'Password must be at least 10 characters').max(128),
  name: z.string().trim().min(1).max(120),
  workspace_name: z.string().trim().min(2).max(80).optional(),
  accept_terms: z.literal(true, { error: 'You must accept the terms to create an account' }),
}).strict();

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(128),
}).strict();

const limited = (windowMs: number, limit: number) => rateLimit({
  windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' },
  }),
});

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_SECONDS = 15 * 60;
const failKey = (email: string, ip: string | undefined): string => `auth:fail:${sha256(email)}:${ip ?? 'unknown'}`;

function meta(request: Request) {
  return { ip: request.ip, userAgent: request.header('user-agent') };
}

function bearer(request: Request): string | undefined {
  const value = request.header('authorization');
  return value?.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : undefined;
}

router.post('/signup', limited(60 * 60_000, 10), validate({ body: signupSchema }), async (request: Request, response: Response) => {
  if (!config.signup.enabled) throw new ServiceError(403, 'SIGNUP_DISABLED', 'Sign-up is currently closed');
  const body = request.validated!.body as z.infer<typeof signupSchema>;
  const pending = await signup(body);
  let resendAfter: number;
  try {
    const verification = await requestEmailVerification(pending.user_id, request.ip);
    resendAfter = 'resend_after' in verification ? verification.resend_after : 60;
  } catch (error) {
    // A restarted pending signup may reuse an already-sent, still-valid OTP during its cooldown.
    if (error instanceof ServiceError && error.code === 'OTP_COOLDOWN') resendAfter = error.retryAfter ?? 60;
    else throw error;
  }
  response.status(202).json({ success: true, data: {
    verification_required: true, email: pending.email,
    resend_after: resendAfter,
  } });
});

const signupVerificationRequestSchema = z.object({ email: z.string().trim().toLowerCase().email().max(255) }).strict();
const signupVerificationConfirmSchema = signupVerificationRequestSchema.extend({ code: z.string().regex(/^\d{6}$/) }).strict();

router.post('/signup/verification/request', limited(15 * 60_000, 20), validate({ body: signupVerificationRequestSchema }), async (request: Request, response: Response) => {
  const { email } = request.validated!.body as z.infer<typeof signupVerificationRequestSchema>;
  response.json({ success: true, data: await requestSignupEmailVerification(email, request.ip) });
});

router.post('/signup/verification/confirm', limited(15 * 60_000, 30), validate({ body: signupVerificationConfirmSchema }), async (request: Request, response: Response) => {
  const { email, code } = request.validated!.body as z.infer<typeof signupVerificationConfirmSchema>;
  const session = await confirmSignupEmailVerification(email, code, meta(request));
  void recordSiteEvent('signup').catch(() => undefined);
  response.json({ success: true, data: session });
});

router.post('/login', limited(15 * 60_000, 30), validate({ body: loginSchema }), async (request: Request, response: Response) => {
  const { email, password } = request.validated!.body as z.infer<typeof loginSchema>;
  const redis = getRedisClient(config.redis.url);
  const key = failKey(email, request.ip);
  if (Number(await redis.get(key)) >= MAX_FAILED_LOGINS) {
    throw new ServiceError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts, try again in 15 minutes');
  }
  try {
    const result = await login(email, password, meta(request));
    await redis.del(key);
    response.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'INVALID_CREDENTIALS') {
      await redis.multi().incr(key).expire(key, LOCKOUT_SECONDS).exec();
    }
    throw error;
  }
});

router.post('/logout', async (request: Request, response: Response) => {
  const token = bearer(request);
  if (token) await revokeSession(token);
  response.json({ success: true });
});

router.get('/me', async (request: Request, response: Response) => {
  const token = bearer(request);
  const session = token ? await resolveSession(token, request.header('x-workspace') ?? undefined) : undefined;
  if (!session) throw new ServiceError(401, 'UNAUTHORIZED', 'Invalid or expired session');
  response.json({
    success: true,
    data: {
      user: session.user,
      workspace: { id: session.tenant.id, name: session.tenant.name, role: session.role },
      workspaces: session.workspaces,
      permissions: PERMISSIONS.filter((p) => ROLE_PERMISSIONS[session.role].includes(p)),
      subscription: await getSubscriptionSummary(session.tenant.id),
      support_contact: config.billing.operatorContact || null,
    },
  });
});

// Owner email verification (any domain). Needs a signed-in session; the OTP mail and its limits are shared with invitation OTPs.
async function sessionUser(request: Request): Promise<string> {
  const token = bearer(request);
  const session = token ? await resolveSession(token) : undefined;
  if (!session) throw new ServiceError(401, 'UNAUTHORIZED', 'Invalid or expired session');
  return session.user.id;
}
router.post('/email-verification/request', limited(15 * 60_000, 20), async (request: Request, response: Response) => {
  response.json({ success: true, data: await requestEmailVerification(await sessionUser(request), request.ip) });
});
router.post('/email-verification/confirm', limited(15 * 60_000, 30), validate({ body: z.object({ code: z.string().regex(/^\d{6}$/) }).strict() }), async (request: Request, response: Response) => {
  await confirmEmailVerification(await sessionUser(request), (request.validated!.body as { code: string }).code);
  response.json({ success: true, data: { verified: true } });
});

export const acceptSchema = z.object({
  otp: z.string().regex(/^\d{6}$/, 'The verification code has 6 digits'),
  name: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(10, 'Password must be at least 10 characters').max(128).optional(),
  accept_terms: z.literal(true).optional(),
}).strict();
const tokenParams = z.object({ token: z.string().regex(/^wgi_[A-Za-z0-9_-]{20,}$/) });

router.get('/invitations/:token', limited(15 * 60_000, 60), validate({ params: tokenParams }), async (request: Request, response: Response) => {
  response.json({ success: true, data: await previewInvitation((request.validated!.params as { token: string }).token) });
});

// Sends the emailed proof-of-mailbox code. Fails safe with 503 while no email sender is configured.
router.post('/invitations/:token/otp', limited(15 * 60_000, 20), validate({ params: tokenParams }), async (request: Request, response: Response) => {
  response.json({ success: true, data: await requestInvitationOtp((request.validated!.params as { token: string }).token, request.ip) });
});

// A new person supplies name, password and the terms; someone who already has an account signs in first.
router.post('/invitations/:token/accept', limited(15 * 60_000, 30), validate({ params: tokenParams, body: acceptSchema }), async (request: Request, response: Response) => {
  const { token } = request.validated!.params as { token: string };
  const body = request.validated!.body as z.infer<typeof acceptSchema>;
  const presented = bearer(request);
  const session = presented ? await resolveSession(presented) : undefined;
  if (presented && !session) throw new ServiceError(401, 'UNAUTHORIZED', 'Invalid or expired session');
  if (!session && (!body.name || !body.password || body.accept_terms !== true)) {
    throw new ServiceError(400, 'MISSING_ACCOUNT_DETAILS', 'Name, password and acceptance of the terms are required');
  }
  const result = await acceptInvitation(token, {
    session: session ? { userId: session.user.id, email: session.user.email } : undefined,
    newUser: !session && body.name && body.password ? { name: body.name, password: body.password } : undefined,
    otp: body.otp,
    meta: meta(request),
  });
  await recordAudit({
    tenantId: result.tenantId, actorType: 'user', actorId: result.userId,
    actorLabel: session?.user.email ?? result.session?.user.email, action: 'team.join', targetType: 'user', targetId: result.userId, ip: request.ip,
  });
  response.status(201).json({ success: true, data: { joined: result.joined, ...(result.session ? { session: result.session } : {}) } });
});

export default router;

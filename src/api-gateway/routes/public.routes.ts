import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { recordSiteEvent, SITE_EVENTS } from '../services/site-stats.service';
import config from '../../shared/config';
import { listPublicPlans } from '../services/billing.service';

// No sign-in needed: prospective customers compare plans before they register.
const router = Router();

router.get('/plans', async (_request, response) => {
  response.set('Cache-Control', 'public, max-age=60');
  response.json({ success: true, data: await listPublicPlans() });
});

// Contact shown in the public footer; empty when the operator has not set one.
router.get('/info', (_request, response) => {
  response.set('Cache-Control', 'public, max-age=300');
  response.json({ success: true, data: { support_contact: config.billing.operatorContact || null } });
});

const eventSchema = z.object({
  event: z.enum(SITE_EVENTS).refine((e) => e !== 'signup', 'signup is counted server-side'),
  ref: z.string().max(80).optional().default(''),
  utm: z.string().max(40).optional().default(''),
}).strict();
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse/i;

// Counting only: no cookies, no IP or visitor id is stored. Best-effort, so it always answers 204.
router.post('/event', rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }),
  validate({ body: eventSchema }), async (request, response) => {
    const body = request.validated!.body as z.infer<typeof eventSchema>;
    if (!BOT.test(request.get('user-agent') ?? '')) await recordSiteEvent(body.event, body.ref, body.utm).catch(() => undefined);
    response.status(204).end();
  });

export default router;

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { cancelCommand, enqueueCommand, getCommand, listCommands, listStatusViewers, runCommand } from '../services/command.service';
import { mediaUrl } from '../../shared/media-url';

const router = Router();

const deviceParams = z.object({ key: z.string().min(1).max(32) });
const commandParams = deviceParams.extend({ id: z.string().uuid() });
const productParams = deviceParams.extend({ id: z.string().min(1).max(64) });

export const statusSchema = z.object({
  kind: z.enum(['text', 'image', 'video']),
  text: z.string().trim().max(700).optional(),
  media_url: mediaUrl.optional(),
  caption: z.string().trim().max(700).optional(),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  audience: z.enum(['chatted', 'list']).default('chatted'),
  numbers: z.array(z.string().regex(/^\+?[1-9]\d{6,19}$/)).max(500).optional(),
  send_at: z.string().datetime().optional(),
}).strict().superRefine((v, ctx) => {
  if (v.kind === 'text' && !v.text) ctx.addIssue({ code: 'custom', path: ['text'], message: 'text is required for a text status' });
  if (v.kind !== 'text' && !v.media_url) ctx.addIssue({ code: 'custom', path: ['media_url'], message: 'media_url is required for image/video' });
  if (v.audience === 'list' && !v.numbers?.length) ctx.addIssue({ code: 'custom', path: ['numbers'], message: 'numbers is required when audience is "list"' });
  if (v.send_at && new Date(v.send_at).getTime() > Date.now() + 7 * 86_400_000) ctx.addIssue({ code: 'custom', path: ['send_at'], message: 'send_at can be at most 7 days ahead' });
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const businessSchema = z.object({
  description: z.string().trim().max(512).optional(),
  address: z.string().trim().max(256).optional(),
  email: z.string().email().max(128).optional(),
  websites: z.array(z.string().url().max(256)).max(2).optional(),
  hours: z.object({
    timezone: z.string().min(3).max(64),
    days: z.array(z.discriminatedUnion('mode', [
      z.object({ day: z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']), mode: z.literal('specific_hours'), open: hhmm, close: hhmm }),
      z.object({ day: z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']), mode: z.enum(['open_24h', 'appointment_only']) }),
    ])).min(1).max(7),
  }).optional(),
}).strict().refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');

const productBase = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1024).default(''),
  /** Whole currency units, e.g. 25000 for Rp 25.000. */
  price: z.number().nonnegative().max(1_000_000_000),
  currency: z.string().length(3).default('IDR'),
  url: z.string().url().max(512).optional(),
  retailer_id: z.string().max(64).optional(),
  is_hidden: z.boolean().default(false),
  image_urls: z.array(mediaUrl).min(1).max(10),
};
export const productCreateSchema = z.object({ ...productBase, origin_country: z.string().length(2).optional() }).strict();
export const productUpdateSchema = z.object(productBase).strict();
const catalogQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().max(200).optional() });

const key = (request: Request): string => (request.validated!.params as { key: string }).key;

router.post('/devices/:key/status', validate({ params: deviceParams, body: statusSchema }), async (request: Request, response: Response) => {
  const body = request.validated!.body as z.infer<typeof statusSchema>;
  const { send_at, ...payload } = body;
  const row = await enqueueCommand(request.tenant!.id, key(request), 'status.post', payload, send_at ? { runAt: new Date(send_at) } : {});
  response.status(202).json({ success: true, data: { command_id: row.id, status: row.status, run_at: row.run_at } });
});
router.get('/devices/:key/status', validate({ params: deviceParams }), async (request: Request, response: Response) => {
  response.json({ success: true, data: await listCommands(request.tenant!.id, key(request), 'status.post') });
});
router.get('/devices/:key/commands/:id/viewers', validate({ params: commandParams }), async (request: Request, response: Response) => {
  const p = request.validated!.params as z.infer<typeof commandParams>;
  response.json({ success: true, data: await listStatusViewers(request.tenant!.id, p.key, p.id) });
});
router.get('/devices/:key/commands/:id', validate({ params: commandParams }), async (request: Request, response: Response) => {
  const p = request.validated!.params as z.infer<typeof commandParams>;
  response.json({ success: true, data: await getCommand(request.tenant!.id, p.key, p.id) });
});
router.post('/devices/:key/commands/:id/cancel', validate({ params: commandParams }), async (request: Request, response: Response) => {
  const p = request.validated!.params as z.infer<typeof commandParams>;
  response.json({ success: true, data: await cancelCommand(request.tenant!.id, p.key, p.id) });
});

// Business profile, catalog and products only work on numbers registered as WhatsApp Business.
router.get('/devices/:key/business', validate({ params: deviceParams }), async (request: Request, response: Response) => {
  response.json({ success: true, data: await runCommand(request.tenant!.id, key(request), 'business.get', {}) });
});
router.patch('/devices/:key/business', validate({ params: deviceParams, body: businessSchema }), async (request: Request, response: Response) => {
  response.json({ success: true, data: await runCommand(request.tenant!.id, key(request), 'business.update', request.validated!.body) });
});
router.get('/devices/:key/catalog', validate({ params: deviceParams, query: catalogQuery }), async (request: Request, response: Response) => {
  response.json({ success: true, data: await runCommand(request.tenant!.id, key(request), 'catalog.list', request.validated!.query, 26_000) });
});
router.get('/devices/:key/collections', validate({ params: deviceParams }), async (request: Request, response: Response) => {
  response.json({ success: true, data: await runCommand(request.tenant!.id, key(request), 'collections.list', {}, 26_000) });
});
router.post('/devices/:key/products', validate({ params: deviceParams, body: productCreateSchema }), async (request: Request, response: Response) => {
  response.status(201).json({ success: true, data: await runCommand(request.tenant!.id, key(request), 'product.create', request.validated!.body, 40_000) });
});
router.patch('/devices/:key/products/:id', validate({ params: productParams, body: productUpdateSchema }), async (request: Request, response: Response) => {
  const p = request.validated!.params as z.infer<typeof productParams>;
  response.json({ success: true, data: await runCommand(request.tenant!.id, p.key, 'product.update', { id: p.id, ...(request.validated!.body as object) }, 40_000) });
});
router.delete('/devices/:key/products/:id', validate({ params: productParams }), async (request: Request, response: Response) => {
  const p = request.validated!.params as z.infer<typeof productParams>;
  response.json({ success: true, data: await runCommand(request.tenant!.id, p.key, 'product.delete', { id: p.id }, 26_000) });
});

export default router;

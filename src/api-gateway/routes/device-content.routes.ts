import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { cancelCommand, enqueueCommand, getCommand, listCommands, listStatusViewers, runCommand } from '../services/command.service';
import { mediaUrl } from '../../shared/media-url';

const router = Router();

const deviceParams = z.object({ key: z.string().min(1).max(32) });
const commandParams = deviceParams.extend({ id: z.string().uuid() });

export const statusSchema = z.object({
  kind: z.enum(['text', 'image', 'video']),
  text: z.string().trim().max(700).optional(),
  media_url: mediaUrl.optional(),
  caption: z.string().trim().max(700).optional(),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  audience: z.enum(['chatted', 'all_contacts', 'contacts_except', 'list']).default('chatted'),
  numbers: z.array(z.string().regex(/^\+?[1-9]\d{6,19}$/)).max(500).optional(),
  send_at: z.string().datetime().optional(),
}).strict().superRefine((v, ctx) => {
  if (v.kind === 'text' && !v.text) ctx.addIssue({ code: 'custom', path: ['text'], message: 'text is required for a text status' });
  if (v.kind !== 'text' && !v.media_url) ctx.addIssue({ code: 'custom', path: ['media_url'], message: 'media_url is required for image/video' });
  if (v.audience === 'list' && !v.numbers?.length) ctx.addIssue({ code: 'custom', path: ['numbers'], message: 'numbers is required when audience is "list"' });
  if (v.send_at && new Date(v.send_at).getTime() > Date.now() + 7 * 86_400_000) ctx.addIssue({ code: 'custom', path: ['send_at'], message: 'send_at can be at most 7 days ahead' });
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const day = z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
const businessSchema = z.object({
  description: z.string().trim().max(512).optional(),
  address: z.string().trim().max(256).optional(),
  email: z.string().email().max(128).optional(),
  websites: z.array(z.string().url().max(256)).max(2).optional(),
  hours: z.object({
    timezone: z.string().min(3).max(64),
    days: z.array(z.discriminatedUnion('mode', [
      z.object({ day, mode: z.literal('specific_hours'), open: hhmm, close: hhmm }),
      z.object({ day, mode: z.enum(['open_24h', 'appointment_only']) }),
    ])).min(1).max(7),
  }).optional(),
}).strict();

/** Display name (max 25), About text (max 139) and, for WhatsApp Business numbers, the business profile. */
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(25).optional(),
  about: z.string().trim().max(139).optional(),
  business: businessSchema.optional(),
}).strict().refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');

/** Either a public https image address or a small base64 image (the dashboard resizes to 640 px first). */
export const pictureSchema = z.object({
  image_url: mediaUrl.optional(),
  image_base64: z.string().min(100).max(400_000).regex(/^[A-Za-z0-9+/=]+$/, 'image_base64 must be plain base64').optional(),
}).strict().refine((v) => Boolean(v.image_url) !== Boolean(v.image_base64), 'Send exactly one of image_url or image_base64');

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

// Profile: name, About, photo, and for WhatsApp Business numbers the business profile.
router.get('/devices/:key/profile', validate({ params: deviceParams }), async (request: Request, response: Response) => {
  response.json({ success: true, data: await runCommand(request.tenant!.id, key(request), 'profile.get', {}, 22_000) });
});
router.patch('/devices/:key/profile', validate({ params: deviceParams, body: profileSchema }), async (request: Request, response: Response) => {
  response.json({ success: true, data: await runCommand(request.tenant!.id, key(request), 'profile.update', request.validated!.body, 35_000) });
});
router.post('/devices/:key/profile/picture', validate({ params: deviceParams, body: pictureSchema }), async (request: Request, response: Response) => {
  response.json({ success: true, data: await runCommand(request.tenant!.id, key(request), 'profile.picture', request.validated!.body, 40_000) });
});
router.delete('/devices/:key/profile/picture', validate({ params: deviceParams }), async (request: Request, response: Response) => {
  response.json({ success: true, data: await runCommand(request.tenant!.id, key(request), 'profile.picture', {}, 30_000) });
});

export default router;

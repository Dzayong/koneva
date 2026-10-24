import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { mediaUrl, MEDIA_TYPES } from '../../shared/media-url';
import pool from '../../shared/database/connection';
import { mediaTypeForMime, MEDIA_LIMITS, readMedia, removeMedia, saveMedia, validMediaBytes } from '../../shared/media-storage';
import { validate } from '../middleware/validate';
import { getMessageStatus, listInboxConversations, listInboxDevices, listInboxMessages, listMessages, queueInboxReply, queueMessage, retryMessage } from '../services/message.service';

const router = Router();
export const sendSchema = z.object({
  device_key: z.string().min(1).max(32),
  to: z.union([
    z.string().regex(/^\+?[1-9]\d{6,19}$/),
    // WhatsApp uses both legacy <creation>-<creator>@g.us and newer numeric@g.us group IDs.
    z.string().regex(/^(?:\d{5,32}-\d{5,32}|\d{5,32})@g\.us$/),
  ]),
  /** The text, or the caption when media_url is given (then it may be empty). */
  message: z.string().max(4096).default(''),
  media_url: mediaUrl.optional(),
  media_id: z.string().uuid().optional(),
  media_type: z.enum(MEDIA_TYPES).default('image'),
  external_id: z.string().max(64).optional(),
  reply_to_message_id: z.string().uuid().optional(),
  priority: z.enum(['normal', 'urgent']).default('normal'),
  // Tenant-provided OTP text is not proof that KONEVA generated a transactional OTP.
  otp_code: z.never().optional(),
}).superRefine((v, ctx) => {
  if (v.media_url && v.media_id) ctx.addIssue({ code: 'custom', path: ['media_id'], message: 'Choose either media_url or media_id' });
  if (!v.media_url && !v.media_id && v.message.trim().length === 0) ctx.addIssue({ code: 'custom', path: ['message'], message: 'message is required unless media is given' });
  if (v.to.endsWith('@g.us') && !v.reply_to_message_id) ctx.addIssue({ code: 'custom', path: ['reply_to_message_id'], message: 'Group messages must reply to a recent message in that group' });
});
const listSchema = z.object({
  device_key: z.string().max(32).optional(),
  status: z.enum(['queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'blocked', 'received']).optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
  created_today: z.enum(['true']).optional(),
  search: z.string().trim().max(200).optional(),
  chat_jid: z.string().regex(/^(?:\+?[1-9]\d{6,19}|(?:\d{5,32}-\d{5,32}|\d{5,32})@g\.us)$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
const inboxConversationSchema = z.object({
  device_key: z.string().max(32).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const inboxMessagesSchema = z.object({
  device_key: z.string().min(1).max(32),
  chat_key: z.string().min(1).max(128),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

async function uploadMedia(tenantId: string, deviceKey: string, request: import('express').Request, response: import('express').Response, next: import('express').NextFunction): Promise<void> {
  try {
    const mime = (request.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const mediaType = mediaTypeForMime(mime);
    const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    const device = (await pool.query<{ id: string }>('SELECT id FROM devices WHERE tenant_id=$1 AND device_key=$2', [tenantId, deviceKey])).rows[0];
    const maxBytes = mediaType === 'image' ? MEDIA_LIMITS.image : MEDIA_LIMITS.video;
    if (!device || !mediaType || bytes.length === 0 || bytes.length > maxBytes || !validMediaBytes(bytes, mime)) {
      response.status(400).json({ success: false, error: { code: 'INVALID_MEDIA', message: 'Pilih foto JPG/PNG/WebP/GIF hingga 16 MB atau video MP4 hingga 64 MB.' } }); return;
    }
    const id = await saveMedia(bytes, mime);
    try {
      await pool.query(`INSERT INTO media_objects (id,tenant_id,device_id,content_type,byte_size,original_name,expires_at)
        SELECT $1,$2,$3,$4,$5,$6, CASE WHEN d.media_retention_days IS NULL THEN NULL
          ELSE now() + make_interval(days => d.media_retention_days) END FROM devices d WHERE d.id=$3`,
        [id, tenantId, device.id, mime, bytes.length, request.header('x-file-name')?.slice(0, 180) ?? null]);
    } catch (error) { await removeMedia(id); throw error; }
    response.status(201).json({ success: true, data: { id, type: mediaType, content_type: mime, byte_size: bytes.length } });
  } catch (error) { next(error); }
}

async function serveMedia(tenantId: string, id: string, response: import('express').Response, next: import('express').NextFunction): Promise<void> {
  try {
    const row = (await pool.query<{ content_type: string }>(
      'SELECT content_type FROM media_objects WHERE id=$1 AND tenant_id=$2 AND (expires_at IS NULL OR expires_at>now())', [id, tenantId],
    )).rows[0];
    if (!row) { response.status(404).json({ success: false, error: { code: 'MEDIA_NOT_FOUND', message: 'Media tidak ditemukan atau sudah kedaluwarsa.' } }); return; }
    response.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).type(row.content_type).send(await readMedia(id));
  } catch (error) { next(error); }
}

router.post('/inbox/media', express.raw({ type: ['image/*', 'video/*'], limit: '64mb' }), async (request, response, next) => {
  const deviceKey = typeof request.query['device_key'] === 'string' ? request.query['device_key'] : '';
  await uploadMedia(request.tenant!.id, deviceKey, request, response, next);
});
router.post('/media/upload', express.raw({ type: ['image/*', 'video/*'], limit: '64mb' }), async (request, response, next) => {
  const deviceKey = typeof request.query['device_key'] === 'string' ? request.query['device_key'] : '';
  await uploadMedia(request.tenant!.id, deviceKey, request, response, next);
});
router.get('/inbox/media/:id', async (request, response, next) => serveMedia(request.tenant!.id, request.params.id!, response, next));
router.get('/media/:id', async (request, response, next) => serveMedia(request.tenant!.id, request.params.id!, response, next));

router.post('/message/send', validate({ body: sendSchema }), async (request, response) => {
  const input = request.validated!.body as z.infer<typeof sendSchema>;
  const message = await queueMessage(request.tenant!.id, input);
  // Reports the actual queue state. Legacy subscriptions may still return quota_hold;
  // PAYG sends are queued only after their balance reservation succeeds.
  const data = { message_id: message.id, status: message.status as 'queued' | 'quota_hold' };
  response.status(202).json({ success: true, data, ...data });
});

router.get('/inbox/devices', async (request, response) => {
  response.json(await listInboxDevices(request.tenant!.id));
});

router.get('/inbox/conversations', validate({ query: inboxConversationSchema }), async (request, response) => {
  const filter = request.validated!.query as z.infer<typeof inboxConversationSchema>;
  response.json(await listInboxConversations(request.tenant!.id, {
    ...(filter.device_key ? { device_key: filter.device_key } : {}),
    ...(filter.search ? { search: filter.search } : {}),
    limit: filter.limit,
    offset: filter.offset,
  }));
});

router.get('/inbox/messages', validate({ query: inboxMessagesSchema }), async (request, response) => {
  response.json(await listInboxMessages(request.tenant!.id, request.validated!.query as z.infer<typeof inboxMessagesSchema>));
});

router.post(
  '/inbox/messages/:id/reply',
  validate({ params: z.object({ id: z.string().uuid() }), body: z.object({ message: z.string().trim().max(4096).default(''), media_id: z.string().uuid().optional(), media_type: z.enum(['image', 'video']).optional() }).strict().refine((body) => Boolean(body.message || body.media_id)) }),
  async (request, response) => {
    const { id } = request.validated!.params as { id: string };
    const body = request.validated!.body as { message: string; media_id?: string; media_type?: 'image' | 'video' };
    const queued = await queueInboxReply(request.tenant!.id, id, body.message, body.media_id, body.media_type);
    response.status(202).json({ success: true, data: { message_id: queued.id, status: queued.status } });
  },
);

router.get('/messages', validate({ query: listSchema }), async (request, response) => {
  const filter = request.validated!.query as z.infer<typeof listSchema>;
  response.json(await listMessages(request.tenant!.id, { ...filter, created_today: filter.created_today === 'true' }));
});

router.get(
  '/messages/:id',
  validate({ params: z.object({ id: z.string().uuid() }) }),
  async (request, response) => {
    const { id } = request.validated!.params as { id: string };
    response.json({ success: true, data: await getMessageStatus(request.tenant!.id, id) });
  },
);

router.post(
  '/messages/:id/retry',
  validate({ params: z.object({ id: z.string().uuid() }), body: z.object({}).strict() }),
  async (request, response) => {
    const { id } = request.validated!.params as { id: string };
    const message = await retryMessage(request.tenant!.id, id);
    response.status(202).json({ success: true, data: { message_id: message.id, status: 'queued' } });
  },
);

export default router;

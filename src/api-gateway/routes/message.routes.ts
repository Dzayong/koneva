import { Router } from 'express';
import { z } from 'zod';
import { mediaUrl, MEDIA_TYPES } from '../../shared/media-url';
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
  media_type: z.enum(MEDIA_TYPES).default('image'),
  external_id: z.string().max(64).optional(),
  reply_to_message_id: z.string().uuid().optional(),
  priority: z.enum(['normal', 'urgent']).default('normal'),
  // Tenant-provided OTP text is not proof that KONEVA generated a transactional OTP.
  otp_code: z.never().optional(),
}).superRefine((v, ctx) => {
  if (!v.media_url && v.message.trim().length === 0) ctx.addIssue({ code: 'custom', path: ['message'], message: 'message is required unless media_url is given' });
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
  validate({ params: z.object({ id: z.string().uuid() }), body: z.object({ message: z.string().trim().min(1).max(4096) }).strict() }),
  async (request, response) => {
    const { id } = request.validated!.params as { id: string };
    const { message: content } = request.validated!.body as { message: string };
    const queued = await queueInboxReply(request.tenant!.id, id, content);
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

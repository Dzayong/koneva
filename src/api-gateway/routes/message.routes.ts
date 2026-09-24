import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { getMessageStatus, listMessages, queueMessage } from '../services/message.service';

const router = Router();
const sendSchema = z.object({
  device_key: z.string().min(1).max(32),
  to: z.string().regex(/^\+?[1-9]\d{6,19}$/),
  message: z.string().min(1).max(4096),
  external_id: z.string().max(64).optional(),
});
const listSchema = z.object({
  device_key: z.string().max(32).optional(),
  status: z.enum(['queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'blocked']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

router.post('/message/send', validate({ body: sendSchema }), async (request, response) => {
  const input = request.validated!.body as z.infer<typeof sendSchema>;
  const message = await queueMessage(request.tenant!.id, input);
  response.status(202).json({ success: true, message_id: message.id, status: 'queued' });
});

router.get('/messages', validate({ query: listSchema }), async (request, response) => {
  const filter = request.validated!.query as z.infer<typeof listSchema>;
  response.json(await listMessages(request.tenant!.id, filter));
});

router.get(
  '/messages/:id',
  validate({ params: z.object({ id: z.string().uuid() }) }),
  async (request, response) => {
    const { id } = request.validated!.params as { id: string };
    response.json({ success: true, data: await getMessageStatus(request.tenant!.id, id) });
  },
);

export default router;

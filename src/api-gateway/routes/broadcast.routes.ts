import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { mediaUrl, MEDIA_TYPES } from '../../shared/media-url';
import type { TenantContext } from '../../shared/types/api';
import { validate } from '../middleware/validate';
import pool from '../../shared/database/connection';
import { assertSubscriptionActive } from '../services/billing.service';
import { queueMessage } from '../services/message.service';
import { ServiceError } from '../services/service-error';

const router = Router();
export const broadcastSchema = z.object({
  device_key: z.string().min(1).max(32),
  recipients: z.array(z.string().regex(/^\+?[1-9]\d{6,19}$/)).min(1).max(500),
  /** Text, or the caption when media_url is given. Links in the text are clickable in WhatsApp. */
  message: z.string().max(4096).default(''),
  media_url: mediaUrl.optional(),
  media_type: z.enum(MEDIA_TYPES).default('image'),
}).strict().superRefine((v, ctx) => {
  if (!v.media_url && v.message.trim().length === 0) ctx.addIssue({ code: 'custom', path: ['message'], message: 'message is required unless media_url is given' });
});

export async function createBroadcast(request: Request, response: Response): Promise<void> {
  const input = request.validated!.body as z.infer<typeof broadcastSchema>;
  // A suspended workspace queues nothing at all: one clear refusal instead of hundreds of per-recipient failures.
  await assertSubscriptionActive(pool, request.tenant!.id);
  const broadcastId = randomUUID();
  const results: Array<{ phone_number: string; message_id?: string; status: 'queued' | 'failed'; error_code?: string; error?: string }> = [];
  for (const [index, recipient] of input.recipients.entries()) {
    try {
      const message = await queueMessage(request.tenant!.id, {
        device_key: input.device_key,
        to: recipient,
        message: input.message,
        ...(input.media_url ? { media_url: input.media_url, media_type: input.media_type } : {}),
        external_id: `broadcast:${broadcastId}:${index}`,
      });
      results.push({ phone_number: recipient, message_id: message.id, status: 'queued' });
    } catch (error) {
      results.push({
        phone_number: recipient,
        status: 'failed',
        ...(error instanceof ServiceError ? { error_code: error.code } : {}),
        error: error instanceof Error ? error.message : 'Unable to queue message',
      });
    }
  }
  const queued = results.filter((result) => result.status === 'queued').length;
  response.status(202).json({
    success: true,
    data: { broadcast_id: broadcastId, total: results.length, queued, failed: results.length - queued, results },
  });
}

router.post('/broadcast', validate({ body: broadcastSchema }), createBroadcast);
export default router;

import { createHash, randomUUID } from 'node:crypto';
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
  const idempotencyKey = request.get('idempotency-key')?.trim();
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128 || !/^[\w.:-]+$/.test(idempotencyKey)) {
    throw new ServiceError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Kirim header Idempotency-Key (8–128 karakter: huruf, angka, titik, titik dua, garis bawah, atau tanda hubung)');
  }
  // A suspended workspace queues nothing at all: one clear refusal instead of hundreds of per-recipient failures.
  await assertSubscriptionActive(pool, request.tenant!.id);
  const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const candidateId = randomUUID();
  const inserted = await pool.query<{ broadcast_id: string; request_hash: string }>(
    `INSERT INTO broadcast_idempotency (tenant_id, idempotency_key, request_hash, broadcast_id)
     VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING broadcast_id, request_hash`,
    [request.tenant!.id, idempotencyKey, requestHash, candidateId],
  );
  const prior = inserted.rows[0] ?? (await pool.query<{ broadcast_id: string; request_hash: string }>(
    `SELECT broadcast_id, request_hash FROM broadcast_idempotency WHERE tenant_id=$1 AND idempotency_key=$2`,
    [request.tenant!.id, idempotencyKey],
  )).rows[0];
  if (!prior) throw new ServiceError(503, 'BROADCAST_CLAIM_UNAVAILABLE', 'Tidak dapat mengunci permintaan broadcast; coba ulang dengan kunci yang sama');
  if (prior.request_hash !== requestHash) {
    throw new ServiceError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'Idempotency-Key sudah digunakan untuk isi broadcast yang berbeda');
  }
  const broadcastId = prior.broadcast_id;
  const results: Array<{ phone_number: string; message_id?: string; status: 'queued' | 'failed'; error_code?: string; error?: string }> = [];
  for (const [index, recipient] of input.recipients.entries()) {
    try {
      const message = await queueMessage(request.tenant!.id, {
        device_key: input.device_key,
        to: recipient,
        message: input.message,
        ...(input.media_url ? { media_url: input.media_url, media_type: input.media_type } : {}),
        external_id: `broadcast:${broadcastId}:${index}`,
      }, 'broadcast');
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

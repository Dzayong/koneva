import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { TenantContext } from '../../shared/types/api';
import { validate } from '../middleware/validate';
import { queueMessage } from '../services/message.service';

const router = Router();
export const broadcastSchema = z.object({
  device_key: z.string().min(1).max(32),
  recipients: z.array(z.string().regex(/^\+?[1-9]\d{6,19}$/)).min(1).max(500),
  message: z.string().min(1).max(4096),
}).strict();

export async function createBroadcast(request: Request, response: Response): Promise<void> {
  const input = request.validated!.body as z.infer<typeof broadcastSchema>;
  const broadcastId = randomUUID();
  const results: Array<{ phone_number: string; message_id?: string; status: 'queued' | 'failed'; error?: string }> = [];
  for (const [index, recipient] of input.recipients.entries()) {
    try {
      const message = await queueMessage(request.tenant!.id, {
        device_key: input.device_key,
        to: recipient,
        message: input.message,
        external_id: `broadcast:${broadcastId}:${index}`,
      });
      results.push({ phone_number: recipient, message_id: message.id, status: 'queued' });
    } catch (error) {
      results.push({
        phone_number: recipient,
        status: 'failed',
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

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { listAudit } from '../services/audit.service';

const router = Router();
const query = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.date().optional(),
});

export async function getAudit(request: Request, response: Response): Promise<void> {
  const { limit, before } = request.validated!.query as z.infer<typeof query>;
  response.json({ success: true, data: await listAudit(request.tenant!.id, limit, before) });
}

router.get('/audit', validate({ query }), getAudit);
export default router;

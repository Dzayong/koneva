import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { KEY_SCOPES, createApiKey, listApiKeys, revokeApiKey, rotateApiKey } from '../services/apikey.service';
import { ServiceError } from '../services/service-error';

const router = Router();
const idParams = z.object({ id: z.string().uuid() });

export const createKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(KEY_SCOPES as unknown as [string, ...string[]])).min(1),
  expires_in_days: z.number().int().min(1).max(730).optional(),
}).strict();

export const rotateSchema = z.object({ overlap_hours: z.number().int().min(0).max(168).default(24) }).strict();

// Only a signed-in person creates keys: a key must not be able to mint more keys.
function person(request: Request): { userId: string; role: NonNullable<Request['actor']>['role'] } {
  const actor = request.actor;
  if (!actor || actor.kind !== 'user') {
    throw new ServiceError(403, 'FORBIDDEN', 'Keys are managed by signed-in people, not by API keys');
  }
  return { userId: actor.userId, role: actor.role };
}

export async function listKeys(request: Request, response: Response): Promise<void> {
  response.json({ success: true, data: await listApiKeys(request.tenant!.id), available_scopes: KEY_SCOPES });
}

export async function createKey(request: Request, response: Response): Promise<void> {
  const { userId, role } = person(request);
  const created = await createApiKey(request.tenant!.id, userId, role, request.validated!.body as z.infer<typeof createKeySchema>);
  response.status(201).json({ success: true, data: created, notice: 'Copy the key now. It is shown only once.' });
}

export async function rotateKey(request: Request, response: Response): Promise<void> {
  const { userId, role } = person(request);
  const { id } = request.validated!.params as { id: string };
  const { overlap_hours } = request.validated!.body as z.infer<typeof rotateSchema>;
  const created = await rotateApiKey(request.tenant!.id, id, userId, role, overlap_hours);
  response.status(201).json({
    success: true, data: created,
    notice: `The previous key keeps working for ${overlap_hours} hours. Copy the new key now; it is shown only once.`,
  });
}

export async function deleteKey(request: Request, response: Response): Promise<void> {
  await revokeApiKey(request.tenant!.id, (request.validated!.params as { id: string }).id);
  response.json({ success: true });
}

router.get('/keys', listKeys);
router.post('/keys', validate({ body: createKeySchema }), createKey);
router.post('/keys/:id/rotate', validate({ params: idParams, body: rotateSchema }), rotateKey);
router.delete('/keys/:id', validate({ params: idParams }), deleteKey);
export default router;

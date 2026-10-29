import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ASSIGNABLE_ROLES } from '../../shared/permissions';
import { validate } from '../middleware/validate';
import { requireVerifiedEmail } from '../middleware/verified-email';
import {
  setMemberDevices, changeMemberRole, createInvitation, issueLegacyRoleNotice, listTeam, removeMember, revokeInvitation,
} from '../services/team.service';
import { ServiceError } from '../services/service-error';

const router = Router();
const uuid = z.object({ id: z.string().uuid() });

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  role: z.enum(ASSIGNABLE_ROLES),
  device_keys: z.array(z.string().min(1).max(32)).max(500).optional(),
  phone: z.string().trim().min(1).max(20).optional(),
}).strict();
export const roleSchema = z.object({ role: z.enum(ASSIGNABLE_ROLES) }).strict();
export const legacyRoleNoticeSchema = z.object({ confirm: z.literal(true) }).strict();

function person(request: Request) {
  const actor = request.actor;
  if (!actor || actor.kind !== 'user') throw new ServiceError(403, 'FORBIDDEN', 'The team is managed by signed-in people, not by API keys');
  return { userId: actor.userId, role: actor.role };
}

router.get('/team', async (request: Request, response: Response) => {
  response.json({ success: true, data: await listTeam(request.tenant!.id) });
});

router.post('/team/legacy-role-notice', validate({ body: legacyRoleNoticeSchema }), async (request: Request, response: Response) => {
  const notice = await issueLegacyRoleNotice(request.tenant!.id, person(request));
  response.status(notice.created ? 201 : 200).json({ success: true, data: notice });
});

router.post('/team/invitations', requireVerifiedEmail, validate({ body: inviteSchema }), async (request: Request, response: Response) => {
  const created = await createInvitation(request.tenant!.id, person(request), request.validated!.body as z.infer<typeof inviteSchema>);
  response.status(201).json({
    success: true, data: created,
    notice: 'Share this link with the person yourself. It works once, only for that Gmail address after they confirm a code sent to it, and expires in 48 hours.',
  });
});

router.delete('/team/invitations/:id', validate({ params: uuid }), async (request: Request, response: Response) => {
  await revokeInvitation(request.tenant!.id, (request.validated!.params as { id: string }).id);
  response.json({ success: true });
});

router.patch('/team/members/:id', requireVerifiedEmail, validate({ params: uuid, body: roleSchema }), async (request: Request, response: Response) => {
  await changeMemberRole(request.tenant!.id, person(request), (request.validated!.params as { id: string }).id,
    (request.validated!.body as z.infer<typeof roleSchema>).role);
  response.json({ success: true });
});

router.delete('/team/members/:id', requireVerifiedEmail, validate({ params: uuid }), async (request: Request, response: Response) => {
  await removeMember(request.tenant!.id, person(request), (request.validated!.params as { id: string }).id);
  response.json({ success: true });
});

router.patch('/team/members/:id/devices', requireVerifiedEmail, validate({ params: uuid, body: z.object({ device_keys: z.array(z.string().min(1).max(32)).max(500) }).strict() }), async (request, response) => {
  await setMemberDevices(request.tenant!.id, person(request), (request.validated!.params as { id: string }).id,
    (request.validated!.body as { device_keys: string[] }).device_keys);
  response.json({ success: true });
});

export default router;

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import pool from '../../shared/database/connection';
import type { TenantContext } from '../../shared/types/api';
import { validate } from '../middleware/validate';
import { ServiceError } from '../services/service-error';
import { bypassWorkspaceReadiness, confirmWorkspaceMission, getWorkspaceReadiness, READINESS_COPY_VERSION, runWorkspaceTestMission } from '../services/workspace-readiness.service';

const router = Router();
const deviceParams = z.object({ key: z.string().min(1).max(32) });
const missionParams = z.object({ missionId: z.string().min(1).max(64) });
const missionConfirmBody = z.object({ status: z.literal('completed') }).strict();
const missionRunBody = z.object({ answer: z.enum(['pause_and_escalate', 'resume_worker', 'retry_queue']).optional() }).strict();
const readinessBypassBody = z.object({
  target_level: z.number().int().min(0).max(4),
  reason: z.string().trim().min(5).max(500),
  dialog_version: z.literal(READINESS_COPY_VERSION),
  idempotency_key: z.string().uuid(),
}).strict();

function signedInUser(request: Request): { userId: string; role: string } {
  if (request.actor?.kind !== 'user') throw new ServiceError(403, 'USER_SESSION_REQUIRED', 'Fitur ini hanya tersedia untuk pengguna yang masuk ke dashboard.');
  return request.actor;
}

function workspaceOwner(request: Request): { userId: string } {
  const actor = signedInUser(request);
  if (actor.role !== 'owner') throw new ServiceError(403, 'OWNER_REQUIRED', 'Hanya Owner workspace yang dapat mengonfirmasi misi atau memilih level.');
  return actor;
}

function number(value: unknown): number {
  return Number(value) || 0;
}

export async function dashboardStats(request: Request, response: Response): Promise<void> {
  const [messages, devices, contacts] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total_messages,
       COUNT(*) FILTER (WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'))::int AS messages_today,
       COUNT(*) FILTER (WHERE direction='inbound')::int AS inbound_messages,
       COUNT(*) FILTER (WHERE direction='outbound')::int AS outbound_messages,
       COUNT(*) FILTER (WHERE status IN ('delivered','read'))::int AS delivered_messages,
       COUNT(*) FILTER (WHERE status='failed')::int AS failed_messages,
       COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE direction='outbound' AND status IN ('delivered','read')) /
         NULLIF(COUNT(*) FILTER (WHERE direction='outbound' AND status IN ('sent','delivered','read','failed')), 0), 2), 0) AS delivery_rate
       FROM messages WHERE tenant_id=$1 AND system_otp=false AND system_notification=false`, [request.tenant!.id],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total_devices,
       COUNT(*) FILTER (WHERE status='online')::int AS active_devices
       FROM devices WHERE tenant_id=$1`, [request.tenant!.id],
    ),
    pool.query('SELECT COUNT(*)::int AS total_contacts FROM contacts WHERE tenant_id=$1', [request.tenant!.id]),
  ]);
  const row = { ...messages.rows[0], ...devices.rows[0], ...contacts.rows[0] } as Record<string, unknown>;
  response.json({ success: true, data: Object.fromEntries(Object.entries(row).map(([key, value]) => [key, number(value)])) });
}

export async function deviceStats(request: Request, response: Response): Promise<void> {
  const { key } = request.validated!.params as { key: string };
  const device = await pool.query(
    `SELECT id, device_key, status FROM devices WHERE tenant_id=$1 AND device_key=$2`,
    [request.tenant!.id, key],
  );
  if (!device.rows[0]) throw new ServiceError(404, 'DEVICE_NOT_FOUND', 'Device not found');
  const result = await pool.query(
    `SELECT COUNT(*)::int AS total_messages,
     COUNT(*) FILTER (WHERE direction='inbound')::int AS inbound_messages,
     COUNT(*) FILTER (WHERE direction='outbound')::int AS outbound_messages,
     COUNT(*) FILTER (WHERE status IN ('delivered','read'))::int AS delivered_messages,
     COUNT(*) FILTER (WHERE status='read')::int AS read_messages,
     COUNT(*) FILTER (WHERE status='failed')::int AS failed_messages,
     COUNT(*) FILTER (WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'))::int AS messages_today,
     COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE direction='outbound' AND status IN ('delivered','read')) /
       NULLIF(COUNT(*) FILTER (WHERE direction='outbound' AND status IN ('sent','delivered','read','failed')), 0), 2), 0) AS delivery_rate
     FROM messages WHERE tenant_id=$1 AND device_key=$2 AND system_otp=false AND system_notification=false`,
    [request.tenant!.id, key],
  );
  const metrics = Object.fromEntries(Object.entries(result.rows[0] ?? {}).map(([name, value]) => [name, number(value)]));
  response.json({ success: true, data: { ...device.rows[0], ...metrics } });
}

router.get('/dashboard/stats', dashboardStats);
router.get('/devices/:key/stats', validate({ params: deviceParams }), deviceStats);
router.get('/readiness/levels', async (request: Request, response: Response) => {
  signedInUser(request);
  response.json({ success: true, data: await getWorkspaceReadiness(request.tenant!.id) });
});
router.post('/readiness/missions/:missionId/confirm', validate({ params: missionParams, body: missionConfirmBody }), async (request: Request, response: Response) => {
  const actor = workspaceOwner(request);
  const { missionId } = request.validated!.params as z.infer<typeof missionParams>;
  await confirmWorkspaceMission({ tenantId: request.tenant!.id, actorId: actor.userId, missionId, status: 'completed' });
  response.json({ success: true, data: await getWorkspaceReadiness(request.tenant!.id) });
});
router.post('/readiness/missions/:missionId/run', validate({ params: missionParams, body: missionRunBody }), async (request: Request, response: Response) => {
  const actor = workspaceOwner(request);
  const { missionId } = request.validated!.params as z.infer<typeof missionParams>;
  const { answer } = request.validated!.body as z.infer<typeof missionRunBody>;
  const run = await runWorkspaceTestMission({ tenantId: request.tenant!.id, actorId: actor.userId, missionId, ...(answer ? { answer } : {}) });
  response.status(201).json({ success: true, data: { ...run, readiness: await getWorkspaceReadiness(request.tenant!.id) } });
});
router.post('/readiness/levels/bypass', validate({ body: readinessBypassBody }), async (request: Request, response: Response) => {
  const actor = workspaceOwner(request);
  const body = request.validated!.body as z.infer<typeof readinessBypassBody>;
  const data = await bypassWorkspaceReadiness({
    tenantId: request.tenant!.id, actorId: actor.userId,
    targetLevel: body.target_level, reason: body.reason,
    idempotencyKey: body.idempotency_key, dialogVersion: body.dialog_version,
  });
  response.status(data.idempotent_replay ? 200 : 201).json({ success: true, data: { ...data, readiness: await getWorkspaceReadiness(request.tenant!.id) } });
});
export default router;

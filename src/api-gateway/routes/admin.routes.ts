import { Router } from 'express';
import { z } from 'zod';
import { legacyBillingWrites } from '../middleware/admin-access';
import config from '../../shared/config';
import pool from '../../shared/database/connection';
import { validate } from '../middleware/validate';
import { getSiteStats } from '../services/site-stats.service';
import { ServiceError } from '../services/service-error';
import { createOwnerForTenant } from '../services/account.service';
import {
  grantPlan, listAllInvoices, listPlans, listSubscriptions, markInvoicePaid, setStudentVerified, updatePlan, voidInvoice,
} from '../services/billing.service';

const router = Router();
const createTenantSchema = z.object({
  name: z.string().min(1).max(255), email: z.string().email(),
  max_devices: z.number().int().positive().max(100).default(3),
  quota_messages: z.number().int().positive().default(10000),
});
const createDeviceSchema = z.object({
  tenant_id: z.string().uuid(), phone_number: z.string().max(20).optional(), label: z.string().max(100).optional(),
});

// No static API key is issued any more (removed 2026-10-02). Create an owner next (see /admin/tenant/owner)
// so a signed-in person can mint a scoped wgk_ key from the dashboard when the tenant needs API access.
router.post('/tenant/create', validate({ body: createTenantSchema }), async (request, response) => {
  const input = request.validated!.body as z.infer<typeof createTenantSchema>;
  const row = (await pool.query(
    `INSERT INTO tenants (name, email, max_devices, quota_messages)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.name, input.email, input.max_devices, input.quota_messages],
  )).rows[0];
  response.status(201).json({ success: true, data: row });
});

const ownerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(10).max(128),
}).strict();

router.post('/tenant/:id/owner', validate({ params: z.object({ id: z.string().uuid() }), body: ownerSchema }), async (request, response) => {
  const { id } = request.validated!.params as { id: string };
  const created = await createOwnerForTenant(id, request.validated!.body as z.infer<typeof ownerSchema>);
  response.status(201).json({ success: true, data: created });
});

// ---- Plans, subscriptions and manual payment (operator only) ----
const uuidParam = z.object({ id: z.string().uuid() });
const planPatch = z.object({
  name: z.string().min(1).max(60).optional(),
  price_month_idr: z.number().int().min(0).optional(), price_year_idr: z.number().int().min(0).optional(),
  max_devices: z.number().int().min(1).max(1000).optional(), monthly_messages: z.number().int().min(1).optional(),
  max_members: z.number().int().min(1).max(1000).optional(),
  price_is_final: z.boolean().optional(), published: z.boolean().optional(),
}).strict();

router.get('/site-stats', async (request, response) => {
  response.json({ success: true, data: await getSiteStats(Number(request.query['days'] ?? 30)) });
});
router.get('/plans', async (_request, response) => {
  response.json({ success: true, data: await listPlans(pool, { publishedOnly: false }) });
});
router.patch('/plans/:id', validate({ params: z.object({ id: z.string().min(1).max(20) }), body: planPatch }), async (request, response) => {
  const { id } = request.validated!.params as { id: string };
  response.json({ success: true, data: await updatePlan(id, request.validated!.body as z.infer<typeof planPatch>) });
});
router.get('/subscriptions', async (request, response) => {
  response.json({ success: true, data: await listSubscriptions({
    status: typeof request.query['status'] === 'string' ? request.query['status'] : undefined,
    q: typeof request.query['q'] === 'string' ? request.query['q'] : undefined,
  }) });
});
router.get('/invoices', async (request, response) => {
  response.json({ success: true, data: await listAllInvoices(typeof request.query['status'] === 'string' ? request.query['status'] : undefined) });
});
router.post('/invoices/:id/pay', legacyBillingWrites(), validate({
  params: uuidParam,
  body: z.object({ method: z.string().min(1).max(30), reference: z.string().max(80).optional(), note: z.string().max(500).optional() }).strict(),
}), async (request, response) => {
  const { id } = request.validated!.params as { id: string };
  response.json({ success: true, data: await markInvoicePaid(id, request.validated!.body as { method: string; reference?: string; note?: string }) });
});
router.post('/invoices/:id/void', validate({ params: uuidParam }), async (request, response) => {
  await voidInvoice((request.validated!.params as { id: string }).id);
  response.json({ success: true });
});
router.post('/tenant/:id/student-verify', legacyBillingWrites(), validate({
  params: uuidParam, body: z.object({ approved: z.boolean(), note: z.string().max(500).optional() }).strict(),
}), async (request, response) => {
  const body = request.validated!.body as { approved: boolean; note?: string };
  await setStudentVerified((request.validated!.params as { id: string }).id, body.approved, body.note);
  response.json({ success: true });
});
router.post('/tenant/:id/subscription', validate({
  params: uuidParam,
  body: z.object({ plan: z.string().min(1).max(20), cycle: z.enum(['monthly', 'yearly']).default('monthly'), note: z.string().min(1).max(200) }).strict(),
}), async (request, response) => {
  const body = request.validated!.body as { plan: string; cycle: 'monthly' | 'yearly'; note: string };
  response.status(201).json({ success: true, data: await grantPlan((request.validated!.params as { id: string }).id, body.plan, body.cycle, body.note) });
});

router.post('/device/create', validate({ body: createDeviceSchema }), async (request, response) => {
  const input = request.validated!.body as z.infer<typeof createDeviceSchema>;
  const managerResponse = await fetch(`${config.deviceManager.url}/devices`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': config.adminApiKey },
    body: JSON.stringify(input),
  });
  const result = await managerResponse.json();
  if (!managerResponse.ok) throw new ServiceError(502, 'DEVICE_MANAGER_ERROR', 'Device Manager rejected the request');
  response.status(201).json(result);
});

router.get('/tenants', async (_request, response) => {
  const rows = await pool.query(`
    SELECT t.id, t.name, t.email, t.status, t.max_devices, t.quota_messages, t.used_messages, t.created_at,
      COUNT(DISTINCT d.id)::int AS device_count, COUNT(DISTINCT m.id)::int AS message_count
    FROM tenants t LEFT JOIN devices d ON d.tenant_id = t.id
    LEFT JOIN messages m ON m.tenant_id = t.id GROUP BY t.id ORDER BY t.created_at DESC`);
  response.json({ success: true, data: rows.rows });
});

router.get('/devices', async (request, response) => {
  const status = typeof request.query.status === 'string' ? request.query.status : undefined;
  const rows = status
    ? await pool.query('SELECT id, tenant_id, device_key, label, status, health_score, created_at, updated_at FROM devices WHERE status = $1 ORDER BY created_at DESC', [status])
    : await pool.query('SELECT id, tenant_id, device_key, label, status, health_score, created_at, updated_at FROM devices ORDER BY created_at DESC');
  response.json({ success: true, data: rows.rows });
});

router.get('/stats', async (_request, response) => {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM tenants WHERE status = 'active') AS total_tenants,
      (SELECT COUNT(*)::int FROM devices) AS total_devices,
      (SELECT COUNT(*)::int FROM messages WHERE created_at >= CURRENT_DATE) AS messages_today,
      COALESCE((SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('sent','delivered','read')) /
        NULLIF(COUNT(*) FILTER (WHERE status NOT IN ('queued','sending')), 0), 2)
        FROM messages WHERE created_at >= CURRENT_DATE), 0) AS success_rate`);
  response.json({ success: true, data: result.rows[0] });
});

export default router;

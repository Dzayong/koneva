import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import config from '../../shared/config';
import pool from '../../shared/database/connection';
import { validate } from '../middleware/validate';
import { ServiceError } from '../services/service-error';
import { createOwnerForTenant } from '../services/account.service';

const router = Router();
const createTenantSchema = z.object({
  name: z.string().min(1).max(255), email: z.string().email(),
  max_devices: z.number().int().positive().max(100).default(3),
  quota_messages: z.number().int().positive().default(10000),
});
const createDeviceSchema = z.object({
  tenant_id: z.string().uuid(), phone_number: z.string().max(20).optional(), label: z.string().max(100).optional(),
});

router.post('/tenant/create', validate({ body: createTenantSchema }), async (request, response) => {
  const input = request.validated!.body as z.infer<typeof createTenantSchema>;
  const apiKey = `wg_${randomBytes(24).toString('hex')}`;
  const row = (await pool.query(
    `INSERT INTO tenants (name, email, api_key, max_devices, quota_messages)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [input.name, input.email, apiKey, input.max_devices, input.quota_messages],
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
    SELECT t.*, COUNT(DISTINCT d.id)::int AS device_count, COUNT(DISTINCT m.id)::int AS message_count
    FROM tenants t LEFT JOIN devices d ON d.tenant_id = t.id
    LEFT JOIN messages m ON m.tenant_id = t.id GROUP BY t.id ORDER BY t.created_at DESC`);
  response.json({ success: true, data: rows.rows });
});

router.get('/devices', async (request, response) => {
  const status = typeof request.query.status === 'string' ? request.query.status : undefined;
  const rows = status
    ? await pool.query('SELECT * FROM devices WHERE status = $1 ORDER BY created_at DESC', [status])
    : await pool.query('SELECT * FROM devices ORDER BY created_at DESC');
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

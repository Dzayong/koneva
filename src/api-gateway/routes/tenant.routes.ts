import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import pool from '../../shared/database/connection';
import { validate } from '../middleware/validate';

const router = Router();
const BLOCKED_HOSTS = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|0\.0\.0\.0|\[::1?\])$/i;
const webhookUrl = z.string()
  .regex(/^https?:\/\//i, 'Webhook URL must use http or https')
  .url()
  .refine((url) => {
    try { return !BLOCKED_HOSTS.test(new URL(url).hostname); }
    catch { return false; }
  }, 'Webhook URL must not point to a private/internal address');
export const updateTenantSchema = z.object({ webhook_url: webhookUrl.nullable() }).strict();

const tenantFields = `id, name, email, api_key, webhook_url, max_devices,
  quota_messages, used_messages, status, created_at, updated_at`;

export async function getTenant(request: Request, response: Response): Promise<void> {
  const result = await pool.query(
    `SELECT ${tenantFields} FROM tenants WHERE id = $1 LIMIT 1`,
    [request.tenant!.id],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  // A signed-in member must not receive the legacy tenant key: it would outrank their role.
  if (row && request.actor?.kind === 'user') delete row['api_key'];
  response.json({ success: true, data: row });
}

export async function updateTenant(request: Request, response: Response): Promise<void> {
  const { webhook_url } = request.validated!.body as z.infer<typeof updateTenantSchema>;
  const result = await pool.query(
    `UPDATE tenants SET webhook_url = $1, updated_at = NOW() WHERE id = $2
     RETURNING ${tenantFields}`,
    [webhook_url, request.tenant!.id],
  );
  response.json({ success: true, data: result.rows[0] });
}

router.get('/tenant', getTenant);
router.patch('/tenant', validate({ body: updateTenantSchema }), updateTenant);

export default router;

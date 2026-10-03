import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import pool from '../../shared/database/connection';
import { validate } from '../middleware/validate';
import { getWebhookLogs, getWebhookSettings, rotateWebhookSecret, testWebhook } from '../services/webhook.service';

const router = Router();
import { BLOCKED_HOSTS } from '../../shared/media-url';
const webhookUrl = z.string()
  .regex(/^https?:\/\//i, 'Webhook URL must use http or https')
  .url()
  .refine((url) => {
    try { return !BLOCKED_HOSTS.test(new URL(url).hostname); }
    catch { return false; }
  }, 'Webhook URL must not point to a private/internal address');
export const updateTenantSchema = z.object({ webhook_url: webhookUrl.nullable() }).strict();

const tenantFields = `id, name, email, webhook_url, max_devices,
  quota_messages, used_messages, status, created_at, updated_at`;

export async function getTenant(request: Request, response: Response): Promise<void> {
  const result = await pool.query(
    `SELECT ${tenantFields} FROM tenants WHERE id = $1 LIMIT 1`,
    [request.tenant!.id],
  );
  response.json({ success: true, data: result.rows[0] });
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

router.get('/tenant/webhook', async (request: Request, response: Response) => {
  response.json({ success: true, data: await getWebhookSettings(request.tenant!.id) });
});
router.post('/tenant/webhook/secret', async (request: Request, response: Response) => {
  response.json({ success: true, data: { secret: await rotateWebhookSecret(request.tenant!.id) } });
});
router.post('/tenant/webhook/test', async (request: Request, response: Response) => {
  response.json({ success: true, data: await testWebhook(request.tenant!.id) });
});
router.get('/tenant/webhook/logs', async (request: Request, response: Response) => {
  response.json({ success: true, data: await getWebhookLogs(request.tenant!.id) });
});

export default router;

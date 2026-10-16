import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import pool, { transaction } from '../../shared/database/connection';
import { mediaUrl, MEDIA_TYPES } from '../../shared/media-url';
import { validate } from '../middleware/validate';
import { assertSubscriptionActive } from '../services/billing.service';
import { queueMessage } from '../services/message.service';
import { ServiceError } from '../services/service-error';

const router = Router();
export const scheduledCampaignSchema = z.object({
  name: z.string().trim().min(1).max(100),
  group_id: z.string().uuid(),
  device_key: z.string().min(1).max(32),
  scheduled_at: z.coerce.date(),
  message: z.string().max(4096).default(''),
  media_url: mediaUrl.optional(),
  media_type: z.enum(MEDIA_TYPES).default('image'),
}).strict().superRefine((value, ctx) => {
  if (!value.media_url && !value.message.trim()) ctx.addIssue({ code: 'custom', path: ['message'], message: 'message is required unless media_url is given' });
  const delta = value.scheduled_at.getTime() - Date.now();
  if (delta < 5 * 60_000) ctx.addIssue({ code: 'custom', path: ['scheduled_at'], message: 'Schedule must be at least 5 minutes in the future' });
  if (delta > 90 * 24 * 60 * 60_000) ctx.addIssue({ code: 'custom', path: ['scheduled_at'], message: 'Schedule cannot be more than 90 days ahead' });
});
const idParams = z.object({ id: z.string().uuid() });

export async function createScheduledCampaign(request: Request, response: Response): Promise<void> {
  const input = request.validated!.body as z.infer<typeof scheduledCampaignSchema>;
  const tenantId = request.tenant!.id;
  await assertSubscriptionActive(pool, tenantId);
  const campaign = await transaction(async (client) => {
    const group = await client.query('SELECT id FROM contact_groups WHERE id = $1 AND tenant_id = $2 FOR SHARE', [input.group_id, tenantId]);
    if (!group.rows[0]) throw new ServiceError(404, 'CONTACT_GROUP_NOT_FOUND', 'Contact group not found');
    const device = await client.query<{ status: string }>(
      'SELECT status FROM devices WHERE tenant_id = $1 AND device_key = $2', [tenantId, input.device_key],
    );
    if (!device.rows[0]) throw new ServiceError(404, 'DEVICE_NOT_FOUND', 'Device not found');
    if (device.rows[0].status !== 'online') throw new ServiceError(409, 'DEVICE_OFFLINE', 'Choose an online device to schedule this campaign');

    const created = await client.query<{ id: string }>(
      `INSERT INTO scheduled_campaigns (tenant_id, group_id, device_key, name, message, media_url, media_type, scheduled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [tenantId, input.group_id, input.device_key, input.name, input.message, input.media_url ?? null, input.media_type, input.scheduled_at],
    );
    const id = created.rows[0]!.id;
    const recipients = await client.query(
      `INSERT INTO scheduled_campaign_recipients (campaign_id, tenant_id, contact_id, phone_number, name)
       SELECT $1, c.tenant_id, c.id, normalized.phone_number, COALESCE(c.name, '')
       FROM contact_group_members gm
       JOIN contacts c ON c.id = gm.contact_id AND c.tenant_id = gm.tenant_id
       CROSS JOIN LATERAL (SELECT regexp_replace(c.phone_number, '[^0-9]', '', 'g') AS phone_number) normalized
       JOIN recipient_preferences p ON p.tenant_id = c.tenant_id AND p.phone_number = normalized.phone_number AND p.status = 'opted_in'
       WHERE gm.tenant_id = $2 AND gm.group_id = $3
       ORDER BY c.created_at, c.id
       ON CONFLICT (campaign_id, phone_number) DO NOTHING`,
      [id, tenantId, input.group_id],
    );
    if (recipients.rowCount === 0) {
      throw new ServiceError(409, 'NO_CONSENTED_RECIPIENTS', 'This group has no contacts with recorded opt-in consent');
    }
    return { id, recipient_count: recipients.rowCount ?? 0 };
  });
  response.status(201).json({ success: true, data: { ...campaign, status: 'scheduled' } });
}

export async function listScheduledCampaigns(request: Request, response: Response): Promise<void> {
  const result = await pool.query(
    `SELECT c.id, c.name, c.group_id, g.name AS group_name, c.device_key, c.scheduled_at, c.status,
       c.created_at, c.completed_at,
       count(r.id)::int AS recipient_count,
       count(r.id) FILTER (WHERE r.status = 'pending')::int AS pending_count,
       count(r.id) FILTER (WHERE r.status = 'queued')::int AS queued_count,
       count(r.id) FILTER (WHERE r.status = 'quota_hold')::int AS quota_hold_count,
       count(r.id) FILTER (WHERE r.status = 'failed')::int AS failed_count
     FROM scheduled_campaigns c JOIN contact_groups g ON g.id = c.group_id AND g.tenant_id = c.tenant_id
     LEFT JOIN scheduled_campaign_recipients r ON r.campaign_id = c.id AND r.tenant_id = c.tenant_id
     WHERE c.tenant_id = $1 GROUP BY c.id, g.name ORDER BY c.created_at DESC LIMIT 100`,
    [request.tenant!.id],
  );
  response.json({ success: true, data: result.rows });
}

export async function cancelScheduledCampaign(request: Request, response: Response): Promise<void> {
  const { id } = request.validated!.params as { id: string };
  const result = await pool.query(
    `UPDATE scheduled_campaigns SET status = 'cancelled'
     WHERE id = $1 AND tenant_id = $2 AND status = 'scheduled'
     RETURNING id`, [id, request.tenant!.id],
  );
  if (!result.rows[0]) throw new ServiceError(409, 'CAMPAIGN_NOT_CANCELLABLE', 'Campaign was not found or has already started');
  response.json({ success: true, data: { id, status: 'cancelled' } });
}

let schedulerRunning = false;
/** Database-backed, restart-safe scheduler. A deterministic external_id makes a claimed recipient idempotent. */
export async function processDueCampaigns(): Promise<number> {
  if (schedulerRunning) return 0;
  schedulerRunning = true;
  let handled = 0;
  try {
    await pool.query(
      `UPDATE scheduled_campaigns c SET status = 'cancelled', claimed_at = NULL
       WHERE c.scheduled_at <= now() AND c.status IN ('scheduled', 'processing')
         AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = c.tenant_id AND t.status <> 'active')`,
    );
    for (let batch = 0; batch < 3; batch += 1) {
      const claimed = await transaction(async (client) => {
        const result = await client.query<{ id: string; tenant_id: string; device_key: string; message: string; media_url: string | null; media_type: 'image' | 'video' | 'document' }>(
          `WITH due AS (
             SELECT id FROM scheduled_campaigns
             WHERE scheduled_at <= now() AND (status = 'scheduled' OR (status = 'processing' AND claimed_at < now() - interval '5 minutes'))
               AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = scheduled_campaigns.tenant_id AND t.status = 'active')
             ORDER BY scheduled_at, id FOR UPDATE SKIP LOCKED LIMIT 1
           )
           UPDATE scheduled_campaigns c SET status = 'processing', claimed_at = now()
           FROM due WHERE c.id = due.id
           RETURNING c.id, c.tenant_id, c.device_key, c.message, c.media_url, c.media_type`,
        );
        return result.rows[0];
      });
      if (!claimed) break;
      handled += 1;
      for (;;) {
        const recipient = await pool.query<{ id: string; phone_number: string; name: string }>(
          `SELECT id, phone_number, name FROM scheduled_campaign_recipients
           WHERE campaign_id = $1 AND status = 'pending' ORDER BY created_at, id LIMIT 1`, [claimed.id],
        );
        const row = recipient.rows[0];
        if (!row) break;
        const tenantState = await pool.query<{ status: string }>('SELECT status FROM tenants WHERE id = $1', [claimed.tenant_id]);
        if (tenantState.rows[0]?.status !== 'active') {
          await pool.query("UPDATE scheduled_campaigns SET status = 'cancelled', claimed_at = NULL WHERE id = $1", [claimed.id]);
          break;
        }
        await pool.query('UPDATE scheduled_campaigns SET claimed_at = now() WHERE id = $1 AND status = \'processing\'', [claimed.id]);
        try {
          const externalId = `cmp_${createHash('sha256').update(`${claimed.id}:${row.id}`).digest('hex').slice(0, 60)}`;
          const queued = await queueMessage(claimed.tenant_id, {
            device_key: claimed.device_key,
            to: row.phone_number,
            message: claimed.message.replaceAll('{{nama}}', row.name || row.phone_number),
            ...(claimed.media_url ? { media_url: claimed.media_url, media_type: claimed.media_type } : {}),
            external_id: externalId,
          });
          if (queued.status === 'failed' || queued.status === 'blocked') {
            await pool.query(
              `UPDATE scheduled_campaign_recipients SET status = 'failed', error_code = 'MESSAGE_NOT_QUEUED',
                 error_message = 'Message was already marked failed or blocked' WHERE id = $1 AND status = 'pending'`, [row.id],
            );
            continue;
          }
          await pool.query(
            `UPDATE scheduled_campaign_recipients SET status = $1, message_id = $2 WHERE id = $3 AND status = 'pending'`,
            [queued.status === 'quota_hold' ? 'quota_hold' : 'queued', queued.id, row.id],
          );
        } catch (error) {
          await pool.query(
            `UPDATE scheduled_campaign_recipients SET status = 'failed', error_code = $1, error_message = $2 WHERE id = $3 AND status = 'pending'`,
            [error instanceof ServiceError ? error.code : 'SEND_FAILED', (error instanceof Error ? error.message : 'Unable to queue message').slice(0, 300), row.id],
          );
        }
      }
      await pool.query(
        `UPDATE scheduled_campaigns SET status = 'completed', completed_at = now(), claimed_at = NULL
         WHERE id = $1 AND status = 'processing'
           AND NOT EXISTS (SELECT 1 FROM scheduled_campaign_recipients WHERE campaign_id = $1 AND status = 'pending')`, [claimed.id],
      );
    }
    return handled;
  } finally {
    schedulerRunning = false;
  }
}

router.post('/campaigns', validate({ body: scheduledCampaignSchema }), createScheduledCampaign);
router.get('/campaigns', listScheduledCampaigns);
router.post('/campaigns/:id/cancel', validate({ params: idParams }), cancelScheduledCampaign);
export default router;

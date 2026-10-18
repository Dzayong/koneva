import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import pool from '../../shared/database/connection';
import type { TenantContext } from '../../shared/types/api';
import { validate } from '../middleware/validate';

const router = Router();
const dailySchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });

export async function analyticsOverview(request: Request, response: Response): Promise<void> {
  const [messages, devices] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total_messages,
       COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE direction='outbound' AND status IN ('delivered','read')) /
         NULLIF(COUNT(*) FILTER (WHERE direction='outbound' AND status IN ('sent','delivered','read','failed')), 0), 2), 0) AS delivery_rate,
       COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (reply.created_at - m.created_at)))::numeric, 2), 0) AS avg_response_time
       FROM messages m
       LEFT JOIN LATERAL (
         SELECT out_msg.created_at FROM messages out_msg
         WHERE m.direction='inbound' AND out_msg.tenant_id=m.tenant_id AND out_msg.direction='outbound'
           AND out_msg.device_key=m.device_key AND out_msg.to_number=m.from_number AND out_msg.created_at >= m.created_at
         ORDER BY out_msg.created_at LIMIT 1
       ) reply ON m.direction='inbound'
       WHERE m.tenant_id=$1 AND m.system_otp=false AND system_notification=false`,
      [request.tenant!.id],
    ),
    pool.query(`SELECT COUNT(*) FILTER (WHERE status='online')::int AS active_devices FROM devices WHERE tenant_id=$1`, [request.tenant!.id]),
  ]);
  const messageRow = messages.rows[0] as Record<string, unknown> | undefined;
  const deviceRow = devices.rows[0] as Record<string, unknown> | undefined;
  response.json({
    success: true,
    data: {
      total_messages: Number(messageRow?.total_messages) || 0,
      delivery_rate: Number(messageRow?.delivery_rate) || 0,
      avg_response_time: Number(messageRow?.avg_response_time) || 0,
      active_devices: Number(deviceRow?.active_devices) || 0,
    },
  });
}

export async function analyticsDaily(request: Request, response: Response): Promise<void> {
  const { days } = request.validated!.query as z.infer<typeof dailySchema>;
  const result = await pool.query(
    `SELECT series.day::date AS date,
       COUNT(m.id)::int AS total_messages,
       COUNT(m.id) FILTER (WHERE m.direction='inbound')::int AS inbound,
       COUNT(m.id) FILTER (WHERE m.direction='outbound')::int AS outbound,
       COUNT(m.id) FILTER (WHERE m.status IN ('delivered','read'))::int AS delivered,
       COUNT(m.id) FILTER (WHERE m.status='read')::int AS read
     FROM generate_series((now() AT TIME ZONE 'Asia/Jakarta')::date - ($2::int - 1), (now() AT TIME ZONE 'Asia/Jakarta')::date, INTERVAL '1 day') series(day)
     LEFT JOIN messages m ON m.tenant_id=$1 AND m.system_otp=false AND system_notification=false
       AND (m.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta' >= series.day
       AND (m.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta' < series.day + INTERVAL '1 day'
     GROUP BY series.day ORDER BY series.day`,
    [request.tenant!.id, days],
  );
  response.json({ success: true, data: result.rows });
}

router.get('/analytics/overview', analyticsOverview);
router.get('/analytics/daily', validate({ query: dailySchema }), analyticsDaily);
export default router;

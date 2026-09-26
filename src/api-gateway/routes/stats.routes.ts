import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import pool from '../../shared/database/connection';
import type { TenantContext } from '../../shared/types/api';
import { validate } from '../middleware/validate';
import { ServiceError } from '../services/service-error';
import { computeReadiness, getReadinessInputs } from '../../shared/readiness';

const router = Router();
const deviceParams = z.object({ key: z.string().min(1).max(32) });

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
       FROM messages WHERE tenant_id=$1`, [request.tenant!.id],
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
    `SELECT id, device_key, status, health_score FROM devices WHERE tenant_id=$1 AND device_key=$2`,
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
     FROM messages WHERE tenant_id=$1 AND device_key=$2`,
    [request.tenant!.id, key],
  );
  const metrics = Object.fromEntries(Object.entries(result.rows[0] ?? {}).map(([name, value]) => [name, number(value)]));
  response.json({ success: true, data: { ...device.rows[0], ...metrics } });
}

export async function deviceHealthBreakdown(request: Request, response: Response): Promise<void> {
  const { key } = request.validated!.params as { key: string };
  const deviceResult = await pool.query(
    `SELECT id, status, created_at, warmup_started_at, warmup_completed_at
     FROM devices WHERE tenant_id=$1 AND device_key=$2`,
    [request.tenant!.id, key],
  );
  const device = deviceResult.rows[0] as {
    id: string; status: string; created_at: Date; warmup_started_at: Date | null; warmup_completed_at: Date | null;
  } | undefined;
  if (!device) throw new ServiceError(404, 'DEVICE_NOT_FOUND', 'Device not found');

  const inputs = await getReadinessInputs({
    id: device.id, status: device.status, createdAt: device.created_at,
    warmupStartedAt: device.warmup_started_at, warmupCompletedAt: device.warmup_completed_at,
  }, (text, params) => pool.query(text, params));
  const report = computeReadiness(inputs);
  const rate = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
  const unproven = (id: string): boolean => !report.factors.find((f) => f.id === id)?.proven;

  response.json({
    success: true,
    data: {
      health_score: report.score,
      tier: report.tier,
      confidence: report.confidence,
      recommendations: report.recommendations,
      device_age_days: inputs.ageDays,
      warmup_completed: inputs.warmupCompleted,
      warmup_day: inputs.ageDays + 1,
      // `blocked` = sends still undelivered after 24h (possible block or invalid number);
      // `reported` = recipients who asked us to stop. WhatsApp never reveals real blocks/reports.
      metrics: {
        total_sent: inputs.maturedSent,
        delivered: inputs.maturedDelivered,
        replied: inputs.engagedRecipients,
        blocked: inputs.maturedSent - inputs.maturedDelivered,
        reported: inputs.optOuts,
      },
      rates: {
        delivery: rate(inputs.maturedDelivered, inputs.maturedSent),
        reply: rate(inputs.engagedRecipients, inputs.uniqueRecipients),
        block: rate(inputs.maturedSent - inputs.maturedDelivered, inputs.maturedSent),
        report: rate(inputs.optOuts, inputs.uniqueRecipients),
      },
      breakdown: report.factors.map(({ id, label, score, max, status, description }) => ({
        id, label, score, max, status, description,
      })),
      missions: [
        { id: 'first_reply', label: 'Percakapan Pertama', description: 'Ada penerima yang membalas', completed: inputs.engagedRecipients >= 1, requirement: 'Minta seseorang mengirim pesan ke nomor ini dan biarkan auto-reply membalas' },
        { id: 'five_conversations', label: '5 Percakapan', description: 'Bangun 5 percakapan 2 arah', completed: inputs.engagedRecipients >= 5, requirement: 'Pastikan 5 orang berbeda membalas dalam 7 hari' },
        { id: 'warmup_complete', label: 'Warmup Selesai', description: 'Selesaikan 8 hari warmup', completed: inputs.warmupCompleted, requirement: 'Gunakan nomor secara konsisten selama 8 hari' },
        { id: 'week_old', label: 'Nomor 1 Minggu', description: 'Device aktif lebih dari 7 hari', completed: inputs.ageDays > 7, requirement: 'Tunggu sampai device berumur 7+ hari' },
        { id: 'month_old', label: 'Nomor 1 Bulan', description: 'Device aktif lebih dari 30 hari', completed: inputs.ageDays > 30, requirement: 'Tunggu sampai device berumur 30+ hari' },
        { id: 'high_delivery', label: 'Delivery Rate 97%+', description: 'Minimal 97% pesan terdelivery setelah 24 jam', completed: !unproven('delivery') && inputs.maturedDelivered / inputs.maturedSent >= 0.97, requirement: 'Kirim ke nomor aktif yang terdaftar di WhatsApp' },
        { id: 'high_reply', label: 'Balasan 25%+', description: 'Minimal 25% penerima membalas', completed: !unproven('engagement') && inputs.engagedRecipients / inputs.uniqueRecipients >= 0.25, requirement: 'Kirim pesan personal yang mengundang balasan, bukan broadcast satu arah' },
        { id: 'consented', label: 'Penerima Berizin', description: 'Maksimal 20% penerima belum pernah menghubungi lebih dulu', completed: !unproven('consent') && inputs.unsolicitedRecipients / inputs.uniqueRecipients <= 0.2, requirement: 'Kirim hanya ke kontak yang sudah opt-in atau menghubungi lebih dulu' },
        { id: 'zero_optouts', label: 'Tanpa Permintaan Berhenti', description: 'Tidak ada penerima yang meminta berhenti (7 hari)', completed: !unproven('consent') && inputs.optOuts === 0, requirement: 'Kirim konten relevan dengan frekuensi wajar' },
        { id: 'perfect_score', label: 'Skor Sempurna', description: 'Capai skor kesiapan 100', completed: report.score >= 100, requirement: 'Selesaikan semua misi di atas' },
      ],
    },
  });
}

router.get('/dashboard/stats', dashboardStats);
router.get('/devices/:key/stats', validate({ params: deviceParams }), deviceStats);
router.get('/devices/:key/health', validate({ params: deviceParams }), deviceHealthBreakdown);
export default router;

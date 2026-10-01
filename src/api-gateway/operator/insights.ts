import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { otpLimits } from '../services/otp-limits';
import { lockActor, operatorTransaction, writeAudit, type Actor } from './core';

/** Owner-only snapshot. It deliberately returns aggregate and display-safe fields, never message or recipient contents. */
export async function ownerInsights(db: Pool, actor: Actor, requestId: string) {
  await operatorTransaction(db, async (client) => {
    await lockActor(client, actor, 'owner:insights', false);
    await writeAudit(client, actor, 'owner.insights.view', 'system_insights', randomUUID(), 'Ringkasan Pemilik', {}, requestId);
  });

  const [summary, devices, activity, alerts] = await Promise.all([
    db.query(`SELECT
      (SELECT count(*)::int FROM users) AS registered_accounts,
      (SELECT count(*)::int FROM tenants WHERE status='active') AS active_workspaces,
      (SELECT count(*)::int FROM tenants WHERE status='suspended') AS suspended_workspaces,
      (SELECT count(*)::int FROM messages WHERE direction='outbound' AND status IN ('sent','delivered','read') AND sent_at >= now()-interval '24 hours') AS messages_sent_24h,
      (SELECT count(*)::int FROM messages WHERE direction='outbound' AND status IN ('sent','delivered','read') AND sent_at >= now()-interval '30 days') AS messages_sent_30d,
      (SELECT count(*)::int FROM otp_rate_events WHERE dim='sender' AND at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta')) AS otp_sender_today,
      (SELECT count(*)::int FROM messages WHERE status='queued') AS queue_queued,
      (SELECT count(*)::int FROM messages WHERE status='sending') AS queue_sending,
      (SELECT count(*)::int FROM messages WHERE direction='outbound' AND status='failed' AND created_at >= now()-interval '24 hours') AS failed_messages_24h,
      (SELECT count(*)::int FROM messages WHERE direction='outbound' AND status IN ('sent','delivered','read','failed') AND created_at >= now()-interval '24 hours') AS attempted_messages_24h,
      (SELECT count(*)::int FROM recipient_consent_events WHERE status='opted_out' AND created_at >= now()-interval '1 hour') AS stop_events_1h,
      (SELECT count(*)::int FROM messages WHERE status='blocked' AND error_message IN ('recipient_opted_out','recipient_consent_required') AND created_at >= now()-interval '1 hour') AS consent_blocked_1h,
      now() AS measured_at`),
    db.query(`SELECT d.id, d.label, d.status, d.updated_at, t.name AS workspace_name
      FROM devices d LEFT JOIN tenants t ON t.id=d.tenant_id ORDER BY d.updated_at DESC NULLS LAST, d.id LIMIT 100`),
    db.query(`
      SELECT * FROM (
        SELECT u.id::text AS id, 'signup'::text AS kind, u.created_at AS at,
          'Akun baru terdaftar'::text AS title, u.name AS detail
        FROM users u WHERE u.created_at >= now()-interval '30 days'
        UNION ALL
        SELECT i.id::text, 'payment'::text, i.paid_at,
          'Pembayaran diterima'::text, t.name || ' · Rp' || to_char(i.amount_idr, 'FM999G999G999G999')
        FROM invoices i JOIN tenants t ON t.id=i.tenant_id
        WHERE i.status='paid' AND i.paid_at >= now()-interval '30 days'
        UNION ALL
        SELECT e.id::text, 'opt_out'::text, e.created_at,
          'Permintaan STOP diterima'::text, t.name
        FROM recipient_consent_events e JOIN tenants t ON t.id=e.tenant_id
        WHERE e.status='opted_out' AND e.created_at >= now()-interval '30 days'
        UNION ALL
        SELECT m.id::text, 'message_error'::text, m.created_at,
          'Pengiriman pesan gagal'::text, t.name
        FROM messages m LEFT JOIN tenants t ON t.id=m.tenant_id
        WHERE m.direction='outbound' AND m.status='failed' AND m.created_at >= now()-interval '30 days'
        UNION ALL
        SELECT w.id::text, 'webhook_error'::text, w.created_at,
          'Webhook mendapat respons gagal'::text, COALESCE(w.event_type, 'Webhook') || ' · HTTP ' || w.response_status::text
        FROM webhook_logs w WHERE w.response_status >= 500 AND w.created_at >= now()-interval '30 days'
        UNION ALL
        SELECT s.id::text, 'operator_auth_failure'::text, s.at,
          'Verifikasi MFA Operator gagal'::text, COALESCE(o.name, 'Akun Operator tidak dikenal')
        FROM operator_security_events s LEFT JOIN operators o ON o.id=s.operator_id
        WHERE s.event='mfa_failed' AND s.at >= now()-interval '30 days'
      ) events ORDER BY at DESC LIMIT 100`),
    db.query(`SELECT id, at, kind, window_count, cap FROM otp_threshold_events
      WHERE at >= now()-interval '30 days' ORDER BY at DESC LIMIT 20`),
  ]);

  const row = summary.rows[0] as Record<string, number | Date>;
  const otpCap = otpLimits().senderPerDay;
  const attempted = Number(row['attempted_messages_24h'] ?? 0);
  const failed = Number(row['failed_messages_24h'] ?? 0);
  return {
    measured_at: (row['measured_at'] as Date).toISOString(),
    kpis: {
      registered_accounts: Number(row['registered_accounts']),
      active_workspaces: Number(row['active_workspaces']),
      suspended_workspaces: Number(row['suspended_workspaces']),
      messages_sent_24h: Number(row['messages_sent_24h']),
      messages_sent_30d: Number(row['messages_sent_30d']),
      otp_sender_today: Number(row['otp_sender_today']),
      otp_sender_daily_cap: otpCap,
      otp_sender_remaining_internal: Math.max(0, otpCap - Number(row['otp_sender_today'])),
    },
    health: {
      api: 'responding',
      database: 'connected',
      queue: { queued: Number(row['queue_queued']), sending: Number(row['queue_sending']) },
      message_delivery_24h: { attempted, failed, error_rate_percent: attempted ? Math.round((failed * 10000) / attempted) / 100 : 0 },
      devices: devices.rows.map((d) => ({ id: d['id'], label: d['label'] ?? d['id'], status: d['status'], updated_at: d['updated_at'], workspace_name: d['workspace_name'] })),
    },
    activity: activity.rows,
    alerts: {
      otp_thresholds: alerts.rows,
      stop_events_last_hour: Number(row['stop_events_1h']),
      consent_blocked_messages_last_hour: Number(row['consent_blocked_1h']),
    },
    data_limits: [
      'OTP yang dihitung adalah hitungan sender KONEVA terhadap batas internal harian; ini bukan kuota Google Gmail yang sebenarnya.',
      'Login gagal yang tersedia hanya kegagalan verifikasi MFA Operator; kegagalan login pelanggan tidak disimpan sebagai event terstruktur.',
      'Riwayat perubahan status suspend workspace dan error proses API tidak disimpan pada tabel event yang tersedia.',
      'Penolakan consent sebelum pesan masuk antrean tidak tercatat; angka yang tersedia hanya pesan yang kemudian diblokir.',
    ],
  };
}

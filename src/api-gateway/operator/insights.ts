import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { otpLimits } from '../services/otp-limits';
import { lockActor, OperatorError, operatorTransaction, writeAudit, type Actor } from './core';

/** Owner-only snapshot. It deliberately returns aggregate and display-safe fields, never message or recipient contents. */
export async function ownerInsights(db: Pool, actor: Actor, requestId: string, clientIp: string) {
  await operatorTransaction(db, async (client) => {
    await lockActor(client, actor, 'owner:insights', false);
    await writeAudit(client, actor, 'owner.insights.view', 'system_insights', randomUUID(), 'Ringkasan Pemilik', {}, requestId, clientIp);
  });

  const [summary, devices, activity, alerts, breakGlass] = await Promise.all([
    db.query(`SELECT
      (SELECT count(*)::int FROM users) AS registered_accounts,
      (SELECT count(*)::int FROM tenants WHERE status='active') AS active_workspaces,
      (SELECT count(*)::int FROM tenants WHERE status='suspended') AS suspended_workspaces,
      (SELECT count(*)::int FROM messages WHERE system_otp=false AND direction='outbound' AND status IN ('sent','delivered','read') AND sent_at >= now()-interval '24 hours') AS messages_sent_24h,
      (SELECT count(*)::int FROM messages WHERE system_otp=false AND direction='outbound' AND status IN ('sent','delivered','read') AND sent_at >= now()-interval '30 days') AS messages_sent_30d,
      (SELECT count(*)::int FROM otp_rate_events WHERE dim='sender' AND at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta')) AS otp_sender_today,
      (SELECT count(*)::int FROM messages WHERE system_otp=false AND status='queued') AS queue_queued,
      (SELECT count(*)::int FROM messages WHERE system_otp=false AND status='sending') AS queue_sending,
      (SELECT count(*)::int FROM messages WHERE system_otp=false AND direction='outbound' AND status='failed' AND created_at >= now()-interval '24 hours') AS failed_messages_24h,
      (SELECT count(*)::int FROM messages WHERE system_otp=false AND direction='outbound' AND status IN ('sent','delivered','read','failed') AND created_at >= now()-interval '24 hours') AS attempted_messages_24h,
      (SELECT count(*)::int FROM recipient_consent_events WHERE status='opted_out' AND created_at >= now()-interval '1 hour') AS stop_events_1h,
      (SELECT count(*)::int FROM messages WHERE system_otp=false AND status='blocked' AND error_message IN ('recipient_opted_out','recipient_consent_required') AND created_at >= now()-interval '1 hour') AS consent_blocked_1h,
      (SELECT count(*)::int FROM devices) AS devices_total,
      (SELECT count(*)::int FROM devices WHERE status = 'online') AS devices_online,
      (SELECT count(*)::int FROM devices WHERE status = 'offline') AS devices_offline,
      (SELECT count(*)::int FROM (SELECT DISTINCT d_att.id FROM devices d_att
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE de.status = 'online' AND de.previous_status IN ('offline','error')) AS reconnects,
                 count(*) FILTER (WHERE de.status = 'error' OR de.code IN (515,503)) AS stream_errors
          FROM device_events de WHERE de.device_id = d_att.id AND de.created_at >= now() - interval '24 hours'
        ) ev ON true
        LEFT JOIN LATERAL (
          SELECT de.created_at AS offline_since FROM device_events de
          WHERE de.device_id = d_att.id ORDER BY de.created_at DESC LIMIT 1
        ) off_ev ON d_att.status = 'offline'
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE m.status = 'failed') AS failed,
                 count(*) FILTER (WHERE m.status IN ('sent','delivered','read','failed')) AS attempted
          FROM messages m WHERE m.system_otp=false AND m.device_id = d_att.id AND m.direction = 'outbound' AND m.created_at >= now() - interval '24 hours'
        ) msg ON true
        WHERE d_att.status IN ('error', 'banned')
          OR (d_att.health_score IS NOT NULL AND d_att.health_score < 70)
          OR d_att.status = 'pending_qr'
          OR (d_att.status = 'offline' AND off_ev.offline_since IS NOT NULL AND off_ev.offline_since < now() - make_interval(hours => ${OWNER_THRESHOLDS.offline_hours})
            AND (SELECT de.status FROM device_events de WHERE de.device_id = d_att.id ORDER BY de.created_at DESC LIMIT 1) = 'offline')
          OR ev.reconnects > ${OWNER_THRESHOLDS.reconnect_24h}
          OR ev.stream_errors > ${OWNER_THRESHOLDS.stream_error_24h}
          OR (msg.attempted >= ${OWNER_THRESHOLDS.fail_ratio_min_messages} AND msg.failed * 100 > msg.attempted * ${OWNER_THRESHOLDS.fail_ratio_percent})
      ) att) AS devices_attention,
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
        WHERE m.system_otp=false AND m.direction='outbound' AND m.status='failed' AND m.created_at >= now()-interval '30 days'
        UNION ALL
        SELECT w.id::text, 'webhook_error'::text, w.created_at,
          'Webhook mendapat respons gagal'::text, COALESCE(w.event_type, 'Webhook') || ' · HTTP ' || w.response_status::text
        FROM webhook_logs w WHERE w.response_status >= 500 AND w.created_at >= now()-interval '30 days'
        UNION ALL
        SELECT s.id::text, 'operator_auth_failure'::text, s.at,
          'Verifikasi MFA Operator gagal'::text, COALESCE(o.name, 'Akun Operator tidak dikenal')
        FROM operator_security_events s LEFT JOIN operators o ON o.id=s.operator_id
        WHERE s.event='mfa_failed' AND s.at >= now()-interval '30 days'
        UNION ALL
        SELECT s.id::text, 'break_glass'::text, s.at,
          CASE WHEN s.event='break_glass_login' THEN 'Akun Operator darurat digunakan' ELSE 'Notifikasi akun darurat gagal' END,
          COALESCE(o.name, 'Akun Operator darurat')
        FROM operator_security_events s LEFT JOIN operators o ON o.id=s.operator_id
        WHERE s.event IN ('break_glass_login','break_glass_alert_failed') AND s.at >= now()-interval '30 days'
      ) events ORDER BY at DESC LIMIT 100`),
    db.query(`SELECT id, at, kind, window_count, cap FROM otp_threshold_events
      WHERE at >= now()-interval '30 days' ORDER BY at DESC LIMIT 20`),
    db.query(`SELECT break_glass_validated_at,
        (COALESCE(break_glass_validated_at, created_at) < now()-interval '90 days') AS due
      FROM operators WHERE is_break_glass ORDER BY created_at LIMIT 1`),
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
    device_counts: {
      total: Number(row['devices_total']),
      online: Number(row['devices_online']),
      offline: Number(row['devices_offline']),
      attention: Number(row['devices_attention']),
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
      break_glass_validation: {
        configured: breakGlass.rowCount === 1,
        last_validated_at: (breakGlass.rows[0]?.['break_glass_validated_at'] as Date | null)?.toISOString() ?? null,
        due: breakGlass.rows[0]?.['due'] === true,
      },
    },
    data_limits: [
      'OTP yang dihitung adalah hitungan sender KONEVA terhadap batas internal harian; ini bukan kuota Google Gmail yang sebenarnya.',
      'Login gagal yang tersedia hanya kegagalan verifikasi MFA Operator; kegagalan login pelanggan tidak disimpan sebagai event terstruktur.',
      'Riwayat perubahan status suspend workspace dan error proses API tidak disimpan pada tabel event yang tersedia.',
      'Penolakan consent sebelum pesan masuk antrean tidak tercatat; angka yang tersedia hanya pesan yang kemudian diblokir.',
    ],
  };
}

// ---- Phase A: Owner Panel Extensions (approved 2026-10-08) ----

const DEVICE_STATUS_LABELS: Record<string, string> = {
  online: 'Online', offline: 'Offline', starting: 'Memulai', pending_qr: 'Menunggu QR',
  paused: 'Dijeda', banned: 'Diblokir', error: 'Error',
};
const REASON_LABELS: Record<string, string> = {
  'connection closed': 'Koneksi terputus', 'connection lost': 'Koneksi hilang',
  'logged out': 'Logout', 'stream error': 'Error stream', 'rate limited': 'Dibatasi',
  'banned': 'Diblokir', 'replaced by new session': 'Diganti sesi baru',
  'restart requested': 'Diminta restart', 'qr scan timeout': 'QR timeout',
};
const CODE_LABELS: Record<number, string> = { 515: 'Restart diperlukan', 503: 'Layanan tidak tersedia', 408: 'Timeout' };

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return '****' + phone.slice(-4);
}
function healthBadge(score: number | null): string {
  if (score === null) return '—';
  if (score >= 70) return 'OK';
  if (score >= 40) return 'Perlu Perhatian';
  return 'Bermasalah';
}
function statusLabel(status: string): string {
  return DEVICE_STATUS_LABELS[status] ?? 'Status tidak dikenal';
}
function reasonLabel(reason: string | null, code: number | null): string {
  if (code !== null && CODE_LABELS[code]) return CODE_LABELS[code]!;
  if (reason) {
    const key = reason.toLowerCase().trim();
    if (REASON_LABELS[key]) return REASON_LABELS[key]!;
  }
  return '—';
}

export const OWNER_THRESHOLDS = {
  reconnect_24h: Number(process.env['KONEVA_THRESHOLD_RECONNECT_24H']) || 5,
  stream_error_24h: Number(process.env['KONEVA_THRESHOLD_STREAM_ERROR_24H']) || 10,
  fail_ratio_percent: Number(process.env['KONEVA_THRESHOLD_FAIL_RATIO_PCT']) || 15,
  fail_ratio_min_messages: Number(process.env['KONEVA_THRESHOLD_FAIL_MIN_MSG']) || 20,
  offline_hours: Number(process.env['KONEVA_THRESHOLD_OFFLINE_HOURS']) || 24,
};

export async function ownerDeviceList(db: Pool, actor: Actor, requestId: string, clientIp: string, limit: number, offset: number, status?: string, workspaceId?: string, sort?: string, since?: string, attentionOnly = false) {
  await operatorTransaction(db, async (client) => {
    await lockActor(client, actor, 'owner:insights', false);
    await writeAudit(client, actor, 'owner.device_monitor.view', 'system_insights', randomUUID(), 'Device Monitor', {}, requestId, clientIp);
  });
  const validStatuses = ['online', 'offline', 'starting', 'pending_qr', 'paused', 'banned', 'error'];
  const filterStatus = status && validStatuses.includes(status) ? status : undefined;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const filterWorkspace = workspaceId && uuidRegex.test(workspaceId) ? workspaceId : undefined;
  const filterSince = since && /^\d{4}-\d{2}-\d{2}/.test(since) ? new Date(since) : undefined;
  const conditions: string[] = [];
  const countConditions: string[] = [];
  const params: unknown[] = [limit, offset];
  const countParams: unknown[] = [];
  let idx = 3, cIdx = 1;
  if (filterStatus) { conditions.push(`d.status = $${idx}`); countConditions.push(`status = $${cIdx}`); params.push(filterStatus); countParams.push(filterStatus); idx++; cIdx++; }
  if (filterWorkspace) { conditions.push(`d.tenant_id = $${idx}`); countConditions.push(`tenant_id = $${cIdx}`); params.push(filterWorkspace); countParams.push(filterWorkspace); idx++; cIdx++; }
  if (filterSince && !isNaN(filterSince.getTime())) { conditions.push(`d.created_at >= $${idx}`); countConditions.push(`created_at >= $${cIdx}`); params.push(filterSince); countParams.push(filterSince); idx++; cIdx++; }
  if (attentionOnly) {
    const attention = `(d.status IN ('error','banned','pending_qr') OR (d.health_score IS NOT NULL AND d.health_score < 70)
      OR (d.status = 'offline' AND EXISTS (SELECT 1 FROM device_events de WHERE de.device_id=d.id AND de.status='offline'
        AND de.created_at < now() - make_interval(hours => ${OWNER_THRESHOLDS.offline_hours})
        AND de.created_at = (SELECT max(latest.created_at) FROM device_events latest WHERE latest.device_id=d.id)))
      OR (SELECT count(*) FROM device_events de WHERE de.device_id=d.id AND de.status='online'
        AND de.previous_status IN ('offline','error') AND de.created_at >= now()-interval '24 hours') > ${OWNER_THRESHOLDS.reconnect_24h}
      OR (SELECT count(*) FROM device_events de WHERE de.device_id=d.id AND (de.status='error' OR de.code IN (515,503))
        AND de.created_at >= now()-interval '24 hours') > ${OWNER_THRESHOLDS.stream_error_24h}
      OR (SELECT count(*) FROM messages m WHERE m.system_otp=false AND m.device_id=d.id AND m.direction='outbound' AND m.status='failed'
        AND m.created_at >= now()-interval '24 hours') * 100 > ${OWNER_THRESHOLDS.fail_ratio_percent} *
        (SELECT count(*) FROM messages m WHERE m.system_otp=false AND m.device_id=d.id AND m.direction='outbound'
          AND m.status IN ('sent','delivered','read','failed') AND m.created_at >= now()-interval '24 hours')
        AND (SELECT count(*) FROM messages m WHERE m.system_otp=false AND m.device_id=d.id AND m.direction='outbound'
          AND m.status IN ('sent','delivered','read','failed') AND m.created_at >= now()-interval '24 hours') >= ${OWNER_THRESHOLDS.fail_ratio_min_messages})`;
    conditions.push(attention);
    countConditions.push(attention);
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const countWhere = countConditions.length ? ' WHERE ' + countConditions.join(' AND ') : '';
  const validSorts: Record<string, string> = {
    status: `CASE d.status WHEN 'banned' THEN 1 WHEN 'error' THEN 2 WHEN 'offline' THEN 3 WHEN 'paused' THEN 4 WHEN 'pending_qr' THEN 5 WHEN 'starting' THEN 6 WHEN 'online' THEN 8 ELSE 7 END`,
    health: 'COALESCE(d.health_score, -1)',
    label: 'd.label',
    created_at: 'd.created_at',
    workspace: 't.name',
  };
  const sortKey = sort && sort.replace(/^-/, '') in validSorts ? sort : undefined;
  const sortDir = sortKey?.startsWith('-') ? 'DESC' : 'ASC';
  const sortCol = sortKey ? validSorts[sortKey.replace(/^-/, '')]! : validSorts['status']!;
  const orderBy = sortKey
    ? `ORDER BY ${sortCol} ${sortDir} NULLS LAST, d.id`
    : `ORDER BY ${sortCol} ASC, CASE WHEN d.status='offline' AND le.event_status='offline' THEN le.status_since END ASC NULLS LAST, d.id`;
  const [countResult, rows] = await Promise.all([
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM devices d${countWhere}`, countParams),
    db.query(`SELECT d.id, d.label, d.status, d.health_score, d.phone_number, d.created_at,
        t.name AS workspace_name, t.id AS workspace_id,
        le.status_since, (le.event_status = d.status) AS status_consistent
      FROM devices d
      LEFT JOIN tenants t ON t.id = d.tenant_id
      LEFT JOIN LATERAL (
        SELECT de.created_at AS status_since, de.status AS event_status
        FROM device_events de WHERE de.device_id = d.id ORDER BY de.created_at DESC LIMIT 1
      ) le ON true
      ${where}
      ${orderBy}
      LIMIT $1 OFFSET $2`, params),
  ]);
  const total = countResult.rows[0]!.n;
  return {
    data: rows.rows.map((d: Record<string, any>) => ({
      id: d['id'], label: d['label'] ?? d['id'],
      workspace: { id: d['workspace_id'], name: d['workspace_name'] ?? 'Workspace' },
      phone_masked: maskPhone(d['phone_number']),
      status: d['status'], status_label: statusLabel(d['status']),
      status_since: d['status_consistent'] ? (d['status_since'] as Date | null)?.toISOString() ?? null : null,
      health_score: d['health_score'] as number | null, health_badge: healthBadge(d['health_score']),
      created_at: (d['created_at'] as Date | null)?.toISOString() ?? null,
    })),
    pagination: { total, limit, offset, has_more: offset + rows.rowCount! < total },
  };
}

export async function ownerDeviceDetail(db: Pool, actor: Actor, requestId: string, clientIp: string, deviceId: string) {
  await operatorTransaction(db, async (client) => {
    await lockActor(client, actor, 'owner:insights', false);
    await writeAudit(client, actor, 'owner.device_detail.view', 'device', deviceId, 'Detail Device', {}, requestId, clientIp);
  });
  const [device, reconnects, streamErrors, failRatio, events, latestEvent] = await Promise.all([
    db.query(`SELECT d.id, d.label, d.status, d.health_score, d.phone_number, d.created_at,
        t.name AS workspace_name, t.id AS workspace_id
      FROM devices d LEFT JOIN tenants t ON t.id = d.tenant_id WHERE d.id = $1`, [deviceId]),
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM device_events
      WHERE device_id = $1 AND status = 'online' AND previous_status IN ('offline','error')
        AND created_at >= now() - interval '24 hours'`, [deviceId]),
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM device_events
      WHERE device_id = $1 AND (status = 'error' OR code IN (515,503)) AND created_at >= now() - interval '24 hours'`, [deviceId]),
    db.query<{ failed: number; attempted: number }>(`SELECT
        count(*) FILTER (WHERE status = 'failed')::int AS failed,
        count(*) FILTER (WHERE status IN ('sent','delivered','read','failed'))::int AS attempted
      FROM messages WHERE system_otp=false AND device_id = $1 AND direction = 'outbound' AND created_at >= now() - interval '24 hours'`, [deviceId]),
    db.query(`SELECT id, status, previous_status, reason, code, created_at
      FROM device_events WHERE device_id = $1 ORDER BY created_at DESC LIMIT 10`, [deviceId]),
    db.query(`SELECT created_at AS status_since, status AS event_status
      FROM device_events WHERE device_id = $1 ORDER BY created_at DESC LIMIT 1`, [deviceId]),
  ]);
  const d = device.rows[0] as Record<string, any> | undefined;
  if (!d) throw new OperatorError(404, 'DEVICE_NOT_FOUND', 'Device tidak ditemukan.');
  const le = latestEvent.rows[0] as Record<string, any> | undefined;
  const statusConsistent = le?.['event_status'] === d['status'];
  const fr = failRatio.rows[0]!;
  return {
    id: d['id'], label: d['label'] ?? d['id'],
    workspace: { id: d['workspace_id'], name: d['workspace_name'] ?? 'Workspace' },
    phone_masked: maskPhone(d['phone_number']),
    status: d['status'], status_label: statusLabel(d['status']),
    status_since: statusConsistent ? (le?.['status_since'] as Date | null)?.toISOString() ?? null : null,
    health_score: d['health_score'] as number | null, health_badge: healthBadge(d['health_score']),
    created_at: (d['created_at'] as Date | null)?.toISOString() ?? null,
    reconnect_24h: reconnects.rows[0]!.n,
    stream_error_24h: streamErrors.rows[0]!.n,
    fail_ratio: { failed: fr.failed, attempted: fr.attempted, percent: fr.attempted >= 20 ? Math.round((fr.failed * 10000) / fr.attempted) / 100 : null },
    container_status: 'unavailable' as const,
    events: events.rows.map((e: Record<string, any>) => ({
      id: e['id'], status: e['status'], status_label: statusLabel(e['status']),
      previous_status: e['previous_status'], previous_status_label: e['previous_status'] ? statusLabel(e['previous_status']) : null,
      reason_label: reasonLabel(e['reason'], e['code']),
      at: (e['created_at'] as Date).toISOString(),
    })),
    thresholds: OWNER_THRESHOLDS,
  };
}

export async function ownerSystemHealth(db: Pool, actor: Actor, requestId: string, clientIp: string) {
  await operatorTransaction(db, async (client) => {
    await lockActor(client, actor, 'owner:insights', false);
    await writeAudit(client, actor, 'owner.system_health.view', 'system_insights', randomUUID(), 'Kesehatan Sistem', {}, requestId, clientIp);
  });
  const wibToday = `date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'`;
  const [queue, errors24h, errors1h, otp, otpAlertRows, thresholdDevices] = await Promise.all([
    db.query<{ queued: number; sending: number; oldest_queued_at: Date | null }>(`SELECT
      count(*) FILTER (WHERE status = 'queued')::int AS queued,
      count(*) FILTER (WHERE status = 'sending')::int AS sending,
      min(created_at) FILTER (WHERE status = 'queued') AS oldest_queued_at
      FROM messages WHERE system_otp=false AND status IN ('queued','sending')`),
    db.query<{ attempted: number; failed: number }>(`SELECT
      count(*) FILTER (WHERE status IN ('sent','delivered','read','failed'))::int AS attempted,
      count(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM messages WHERE system_otp=false AND direction = 'outbound' AND created_at >= now() - interval '24 hours'`),
    db.query<{ attempted: number; failed: number }>(`SELECT
      count(*) FILTER (WHERE status IN ('sent','delivered','read','failed'))::int AS attempted,
      count(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM messages WHERE system_otp=false AND direction = 'outbound' AND created_at >= now() - interval '1 hour'`),
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM otp_rate_events
      WHERE dim = 'sender' AND at >= (${wibToday})`),
    db.query(`SELECT id, at, kind, window_count, cap FROM otp_threshold_events
      WHERE at >= now() - interval '30 days' ORDER BY at DESC LIMIT 10`),
    db.query<{ reconnect_exceeded: number; error_exceeded: number; offline_exceeded: number }>(`SELECT
      (SELECT count(*)::int FROM (
        SELECT device_id FROM device_events WHERE status = 'online' AND previous_status IN ('offline','error')
          AND created_at >= now() - interval '24 hours' GROUP BY device_id HAVING count(*) > $1
      ) r) AS reconnect_exceeded,
      (SELECT count(*)::int FROM (
        SELECT device_id FROM device_events WHERE (status = 'error' OR code IN (515,503))
          AND created_at >= now() - interval '24 hours' GROUP BY device_id HAVING count(*) > $2
      ) e) AS error_exceeded,
      (SELECT count(*)::int FROM (
        SELECT DISTINCT ON (de.device_id) de.device_id, de.created_at
        FROM device_events de JOIN devices d ON d.id = de.device_id AND d.status = 'offline'
        WHERE de.status = 'offline'
        ORDER BY de.device_id, de.created_at DESC
      ) o WHERE o.created_at < now() - make_interval(hours => $3)
      ) AS offline_exceeded`,
      [OWNER_THRESHOLDS.reconnect_24h, OWNER_THRESHOLDS.stream_error_24h, OWNER_THRESHOLDS.offline_hours]),
  ]);
  const q = queue.rows[0]!;
  const e24 = errors24h.rows[0]!;
  const e1 = errors1h.rows[0]!;
  const otpCap = otpLimits().senderPerDay;
  const otpToday = otp.rows[0]!.n;
  const td = thresholdDevices.rows[0]!;
  return {
    measured_at: new Date().toISOString(),
    api_status: 'responding' as const,
    db_status: 'connected' as const,
    queue: { queued: q.queued, sending: q.sending, oldest_queued_at: q.oldest_queued_at?.toISOString() ?? null },
    error_rate_24h: { attempted: e24.attempted, failed: e24.failed, percent: e24.attempted ? Math.round((e24.failed * 10000) / e24.attempted) / 100 : 0 },
    error_rate_1h: { attempted: e1.attempted, failed: e1.failed, percent: e1.attempted ? Math.round((e1.failed * 10000) / e1.attempted) / 100 : 0 },
    email_transport: process.env['EMAIL_TRANSPORT'] || 'not_configured',
    otp: { today: otpToday, daily_cap: otpCap, remaining: Math.max(0, otpCap - otpToday) },
    otp_alerts: otpAlertRows.rows.map((r: Record<string, any>) => ({
      id: r['id'], at: (r['at'] as Date).toISOString(), kind: r['kind'], window_count: r['window_count'], cap: r['cap'],
    })),
    thresholds: OWNER_THRESHOLDS,
    threshold_devices: { reconnect_exceeded: td.reconnect_exceeded, error_exceeded: td.error_exceeded, offline_exceeded: td.offline_exceeded },
    container_status: 'unavailable' as const,
    downtime_history: 'unavailable' as const,
  };
}

export async function ownerWorkspaceList(db: Pool, actor: Actor, requestId: string, clientIp: string, limit: number, offset: number, q?: string, plan?: string, statusFilter?: string) {
  await operatorTransaction(db, async (client) => {
    await lockActor(client, actor, 'owner:insights', false);
    await writeAudit(client, actor, 'owner.workspace_list.view', 'system_insights', randomUUID(), 'Daftar Workspace', {}, requestId, clientIp);
  });
  const filterVals: unknown[] = [];
  function buildWhere(startIdx: number): string {
    const parts: string[] = [];
    let idx = startIdx;
    if (q) { parts.push(`(t.name ILIKE '%' || $${idx} || '%' OR owner.email ILIKE '%' || $${idx} || '%')`); idx++; }
    if (plan) { parts.push(`p.name = $${idx}`); idx++; }
    if (statusFilter) { parts.push(`t.status = $${idx}`); idx++; }
    return parts.length ? 'WHERE ' + parts.join(' AND ') : '';
  }
  if (q) filterVals.push(q);
  if (plan) filterVals.push(plan);
  if (statusFilter) filterVals.push(statusFilter);
  const [countResult, rows] = await Promise.all([
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM tenants t
      LEFT JOIN subscriptions s ON s.tenant_id = t.id
      LEFT JOIN plans p ON p.id = s.plan_id
      LEFT JOIN LATERAL (
        SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = t.id AND m.role = 'owner' ORDER BY m.created_at, u.id LIMIT 1
      ) owner ON true
      ${buildWhere(1)}`, filterVals),
    db.query(`SELECT t.id, t.name, t.status, t.created_at,
        CASE WHEN owner.name IS NULL THEN NULL ELSE json_build_object('name',owner.name,'email',owner.email) END AS owner,
        CASE WHEN s.tenant_id IS NULL THEN NULL ELSE json_build_object('plan',p.name,'status',s.status) END AS subscription,
        (SELECT count(*)::int FROM devices d WHERE d.tenant_id = t.id) AS device_count,
        (SELECT count(*)::int FROM memberships m WHERE m.tenant_id = t.id) AS member_count,
        (SELECT count(*)::int FROM messages m WHERE m.system_otp=false AND m.tenant_id = t.id AND m.direction = 'outbound'
          AND m.status IN ('sent','delivered','read') AND m.sent_at >= now() - interval '30 days') AS messages_30d,
        GREATEST(
          (SELECT max(m.created_at) FROM messages m WHERE m.system_otp=false AND m.tenant_id = t.id AND m.direction = 'outbound' AND m.status IN ('sent','delivered','read')),
          (SELECT max(de.created_at) FROM device_events de WHERE de.tenant_id = t.id),
          (SELECT max(i.created_at) FROM invoices i WHERE i.tenant_id = t.id AND i.status = 'paid')
        ) AS last_activity
      FROM tenants t
      LEFT JOIN subscriptions s ON s.tenant_id = t.id
      LEFT JOIN plans p ON p.id = s.plan_id
      LEFT JOIN LATERAL (
        SELECT u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = t.id AND m.role = 'owner' ORDER BY m.created_at, u.id LIMIT 1
      ) owner ON true
      ${buildWhere(3)}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $1 OFFSET $2`, [limit, offset, ...filterVals]),
  ]);
  const total = countResult.rows[0]!.n;
  return {
    data: rows.rows.map((r: Record<string, any>) => ({
      id: r['id'], name: r['name'], status: r['status'],
      created_at: (r['created_at'] as Date | null)?.toISOString() ?? null,
      owner: r['owner'] as { name: string; email: string } | null,
      subscription: r['subscription'] as { plan: string; status: string } | null,
      device_count: r['device_count'] as number,
      member_count: r['member_count'] as number,
      messages_30d: r['messages_30d'] as number,
      last_activity: (r['last_activity'] as Date | null)?.toISOString() ?? null,
    })),
    pagination: { total, limit, offset, has_more: offset + rows.rowCount! < total },
  };
}

export async function ownerWorkspaceDetail(db: Pool, actor: Actor, requestId: string, clientIp: string, workspaceId: string) {
  await operatorTransaction(db, async (client) => {
    await lockActor(client, actor, 'owner:insights', false);
    await writeAudit(client, actor, 'owner.workspace_detail.view', 'workspace', workspaceId, 'Detail Workspace', {}, requestId, clientIp);
  });
  const [workspace, messages30d, lastActivity, devices, members, payments] = await Promise.all([
    db.query(`SELECT t.id, t.name, t.status, t.created_at, t.quota_messages, t.max_devices, t.used_messages, t.usage_period_start,
        CASE WHEN owner.name IS NULL THEN NULL ELSE json_build_object('name',owner.name,'email',owner.email) END AS owner,
        CASE WHEN s.tenant_id IS NULL THEN NULL ELSE json_build_object('plan',json_build_object('id',p.id,'name',p.name),
          'status',s.status,'cycle',s.cycle,'period_start',s.period_start,'period_end',s.period_end) END AS subscription,
        CASE WHEN t.student_verified_at IS NOT NULL THEN json_build_object('status','approved')
          ELSE (SELECT json_build_object('status',sr.status) FROM student_requests sr WHERE sr.tenant_id = t.id ORDER BY sr.requested_at DESC, sr.id DESC LIMIT 1) END AS student,
        (SELECT count(*)::int FROM devices d WHERE d.tenant_id = t.id) AS device_count,
        (SELECT count(*)::int FROM memberships m WHERE m.tenant_id = t.id) AS member_count
      FROM tenants t
      LEFT JOIN subscriptions s ON s.tenant_id = t.id
      LEFT JOIN plans p ON p.id = s.plan_id
      LEFT JOIN LATERAL (
        SELECT u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = t.id AND m.role = 'owner' ORDER BY m.created_at, u.id LIMIT 1
      ) owner ON true
      WHERE t.id = $1`, [workspaceId]),
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM messages
      WHERE system_otp=false AND tenant_id = $1 AND direction = 'outbound' AND status IN ('sent','delivered','read')
        AND sent_at >= now() - interval '30 days'`, [workspaceId]),
    db.query<{ last_msg: Date | null; last_event: Date | null; last_payment: Date | null }>(`SELECT
      (SELECT max(m.created_at) FROM messages m WHERE m.system_otp=false AND m.tenant_id = $1 AND m.direction = 'outbound' AND m.status IN ('sent','delivered','read')) AS last_msg,
      (SELECT max(de.created_at) FROM device_events de WHERE de.tenant_id = $1) AS last_event,
      (SELECT max(i.created_at) FROM invoices i WHERE i.tenant_id = $1 AND i.status = 'paid') AS last_payment`, [workspaceId]),
    db.query(`SELECT d.id, d.label, d.status, d.health_score, d.created_at
      FROM devices d WHERE d.tenant_id = $1 ORDER BY d.created_at DESC`, [workspaceId]),
    db.query(`SELECT u.name, u.email, m.role, m.created_at
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = $1 ORDER BY m.created_at, u.id`, [workspaceId]),
    db.query(`SELECT i.id, i.number, i.amount_idr, i.status, i.created_at, i.paid_at,
        p.name AS plan_name, i.cycle
      FROM invoices i LEFT JOIN plans p ON p.id = i.plan_id
      WHERE i.tenant_id = $1 ORDER BY i.created_at DESC LIMIT 10`, [workspaceId]),
  ]);
  const w = workspace.rows[0] as Record<string, any> | undefined;
  if (!w) throw new OperatorError(404, 'WORKSPACE_NOT_FOUND', 'Workspace tidak ditemukan.');
  const la = lastActivity.rows[0]!;
  const greatest = [la.last_msg, la.last_event, la.last_payment].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
  return {
    id: w['id'], name: w['name'], status: w['status'],
    created_at: (w['created_at'] as Date | null)?.toISOString() ?? null,
    owner: w['owner'] as { name: string; email: string } | null,
    subscription: w['subscription'],
    student: w['student'],
    device_count: w['device_count'] as number,
    member_count: w['member_count'] as number,
    quota_messages: w['quota_messages'] as number,
    max_devices: w['max_devices'] as number,
    used_messages: (w['used_messages'] as number) ?? 0,
    usage_period_start: (w['usage_period_start'] as Date | null)?.toISOString() ?? null,
    messages_30d: messages30d.rows[0]!.n,
    last_activity: greatest?.toISOString() ?? null,
    devices: devices.rows.map((d: Record<string, any>) => ({
      id: d['id'], label: d['label'] ?? d['id'], status: d['status'],
      status_label: statusLabel(d['status']),
      health_score: d['health_score'] as number | null,
      health_badge: healthBadge(d['health_score']),
    })),
    members: members.rows.map((m: Record<string, any>) => ({
      name: m['name'] as string, email: m['email'] as string, role: m['role'] as string,
      joined_at: (m['created_at'] as Date | null)?.toISOString() ?? null,
    })),
    recent_payments: payments.rows.map((p: Record<string, any>) => ({
      id: p['id'] as string, number: p['number'] as string,
      amount_idr: p['amount_idr'] as number, status: p['status'] as string,
      plan_name: p['plan_name'] as string | null, cycle: p['cycle'] as string | null,
      created_at: (p['created_at'] as Date | null)?.toISOString() ?? null,
      paid_at: (p['paid_at'] as Date | null)?.toISOString() ?? null,
    })),
  };
}

// Number Readiness Score: single source of truth for the bot and the API.
//
// WhatsApp never tells a sender who blocked or reported them, so only signals
// we can actually observe are scored. Per WhatsApp's own description, quality
// is judged from recipient feedback over the past 7 days, weighted toward the
// recent past, and automated/bulk sending is detected with machine learning.
// The factors below are observable proxies for that; the thresholds are our
// heuristics, not published WhatsApp limits.

export type QueryFn = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export const OPT_OUT_PATTERN =
  '\\m(stop|berhenti|unsubscribe|unsub|jangan (kirim|chat|hubungi|spam)|hapus (nomor|kontak)|batal(kan)? langganan|spam)\\M';

export const MIN_MATURED_SENDS = 5;
export const MIN_RECIPIENTS = 10;

export type FactorId = 'stability' | 'maturity' | 'delivery' | 'engagement' | 'consent';
export type FactorStatus = 'complete' | 'partial' | 'locked' | 'danger';
export type ReadinessTier = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

export interface ReadinessInputs {
  status: string;
  ageDays: number;
  warmupCompleted: boolean;
  maturedSent: number;
  maturedDelivered: number;
  uniqueRecipients: number;
  engagedRecipients: number;
  unsolicitedRecipients: number;
  optOuts: number;
}

export interface ReadinessFactor {
  id: FactorId;
  label: string;
  score: number;
  max: number;
  status: FactorStatus;
  description: string;
  proven: boolean;
}

export interface ReadinessReport {
  score: number;
  tier: ReadinessTier;
  confidence: 'low' | 'medium' | 'high';
  factors: ReadinessFactor[];
  recommendations: string[];
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

function stability(status: string): ReadinessFactor {
  const max = 15;
  if (status === 'online') {
    return { id: 'stability', label: 'Stabilitas Koneksi', score: max, max, status: 'complete', description: 'Online', proven: true };
  }
  if (status === 'banned' || status === 'error') {
    return { id: 'stability', label: 'Stabilitas Koneksi', score: 0, max, status: 'danger', description: `Status ${status}`, proven: true };
  }
  if (status === 'paused') {
    return { id: 'stability', label: 'Stabilitas Koneksi', score: 3, max, status: 'partial', description: 'Dijeda', proven: true };
  }
  return { id: 'stability', label: 'Stabilitas Koneksi', score: 8, max, status: 'partial', description: `Belum online (${status})`, proven: true };
}

function maturity(ageDays: number, warmupCompleted: boolean): ReadinessFactor {
  const max = 20;
  const day = ageDays + 1;
  if (warmupCompleted || ageDays >= 7) {
    return { id: 'maturity', label: 'Usia Device', score: max, max, status: 'complete', description: `Device tercatat aktif selama ${ageDays + 1} hari`, proven: true };
  }
  const score = ageDays >= 4 ? 12 : ageDays >= 2 ? 6 : 0;
  return {
    id: 'maturity', label: 'Usia Device', score, max, status: score > 0 ? 'partial' : 'locked',
    description: `Device tercatat pada hari ke-${day}`, proven: true,
  };
}

function delivery(i: ReadinessInputs): ReadinessFactor {
  const max = 25;
  if (i.maturedSent < MIN_MATURED_SENDS) {
    return {
      id: 'delivery', label: 'Delivery Rate', score: 13, max, status: 'partial', proven: false,
      description: `Sampel tercatat: ${i.maturedSent} pesan berumur lebih dari 24 jam`,
    };
  }
  const rate = i.maturedDelivered / i.maturedSent;
  const score = rate >= 0.97 ? 25 : rate >= 0.93 ? 18 : rate >= 0.85 ? 10 : 0;
  return {
    id: 'delivery', label: 'Delivery Rate', score, max, proven: true,
    status: score === max ? 'complete' : score > 0 ? 'partial' : 'danger',
    description: `${i.maturedDelivered} dari ${i.maturedSent} pesan tercatat delivered setelah 24 jam (${pct(rate)})`,
  };
}

function engagement(i: ReadinessInputs): ReadinessFactor {
  const max = 20;
  if (i.uniqueRecipients < MIN_RECIPIENTS) {
    return {
      id: 'engagement', label: 'Balasan Penerima', score: 10, max, status: 'partial', proven: false,
      description: `Sampel tercatat: ${i.uniqueRecipients} penerima dalam 7 hari`,
    };
  }
  const rate = i.engagedRecipients / i.uniqueRecipients;
  const score = rate >= 0.25 ? 20 : rate >= 0.15 ? 14 : rate >= 0.08 ? 8 : rate >= 0.03 ? 4 : 0;
  return {
    id: 'engagement', label: 'Balasan Penerima', score, max, proven: true,
    status: score === max ? 'complete' : score > 0 ? 'partial' : 'locked',
    description: `${i.engagedRecipients} dari ${i.uniqueRecipients} penerima membalas dalam 7 hari (${pct(rate)})`,
  };
}

function consent(i: ReadinessInputs): ReadinessFactor {
  const max = 20;
  if (i.uniqueRecipients < MIN_RECIPIENTS) {
    return {
      id: 'consent', label: 'Izin Penerima', score: 10, max, status: 'partial', proven: false,
      description: `Sampel tercatat: ${i.uniqueRecipients} penerima dalam 7 hari`,
    };
  }
  const unsolicited = i.unsolicitedRecipients / i.uniqueRecipients;
  const optOutRate = i.optOuts / i.uniqueRecipients;
  let score = unsolicited <= 0.2 ? 20 : unsolicited <= 0.5 ? 12 : unsolicited <= 0.8 ? 5 : 0;
  const optOutHigh = optOutRate > 0.02;
  if (optOutHigh) score = Math.max(0, score - 10);
  return {
    id: 'consent', label: 'Izin Penerima', score, max, proven: true,
    status: optOutHigh ? 'danger' : score === max ? 'complete' : score > 0 ? 'partial' : 'locked',
    description: `${pct(unsolicited)} penerima belum tercatat menghubungi lebih dulu; ${i.optOuts} permintaan berhenti tercatat`,
  };
}

function tierFor(score: number): ReadinessTier {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  if (score >= 20) return 'poor';
  return 'critical';
}

function recommend(i: ReadinessInputs, factors: ReadinessFactor[]): string[] {
  const byId = Object.fromEntries(factors.map((f) => [f.id, f])) as Record<FactorId, ReadinessFactor>;
  const out: string[] = [];
  if (byId.stability.status !== 'complete') out.push(`Status device saat ini: ${i.status}. Periksa halaman Device untuk status dan event yang tercatat.`);
  if (!byId.delivery.proven || !byId.engagement.proven || !byId.consent.proven) out.push('Data historis belum cukup untuk beberapa indikator; jangan menafsirkan skor ini sebagai prediksi hasil pengiriman.');
  if (i.optOuts > 0) out.push(`${i.optOuts} permintaan berhenti tercatat. Hormati status opt-out dan jangan menghubungi penerima tersebut secara proaktif.`);
  if (out.length === 0) out.push('Periksa status dan sumber data indikator ini secara berkala. Skor tidak menunjukkan persetujuan platform atau jaminan pengiriman.');
  return out;
}

export function computeReadiness(inputs: ReadinessInputs): ReadinessReport {
  const factors = [
    stability(inputs.status),
    maturity(inputs.ageDays, inputs.warmupCompleted),
    delivery(inputs),
    engagement(inputs),
    consent(inputs),
  ];
  const raw = factors.reduce((sum, f) => sum + f.score, 0);
  const score = inputs.status === 'banned' ? 0 : Math.max(0, Math.min(100, raw));
  const proven = factors.filter((f) => ['delivery', 'engagement', 'consent'].includes(f.id) && f.proven).length;
  return {
    score,
    tier: tierFor(score),
    confidence: proven === 3 ? 'high' : proven === 0 ? 'low' : 'medium',
    factors,
    recommendations: recommend(inputs, factors),
  };
}

const INPUTS_SQL = `
  WITH sends AS (
    SELECT to_number, COALESCE(sent_at, created_at) AS at, status
    FROM messages
    WHERE device_id = $1::uuid AND direction = 'outbound' AND status IN ('sent', 'delivered', 'read')
  ),
  matured AS (
    SELECT COUNT(*)::int AS matured_sent,
           COUNT(*) FILTER (WHERE status IN ('delivered', 'read'))::int AS matured_delivered
    FROM sends
    WHERE at <= now() - interval '24 hours' AND at >= now() - interval '14 days'
  ),
  recipients AS (
    SELECT to_number,
           MIN(at) AS first_ever,
           MIN(at) FILTER (WHERE at >= now() - interval '7 days') AS first_in_window
    FROM sends GROUP BY to_number
    HAVING MAX(at) >= now() - interval '7 days'
  ),
  rec AS (
    SELECT COUNT(*)::int AS unique_recipients,
      COUNT(*) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM messages i WHERE i.device_id = $1::uuid AND i.direction = 'inbound'
          AND i.from_number = r.to_number AND i.created_at <= r.first_ever))::int AS unsolicited,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM messages i WHERE i.device_id = $1::uuid AND i.direction = 'inbound'
          AND i.from_number = r.to_number AND i.created_at >= r.first_in_window))::int AS engaged
    FROM recipients r
  ),
  optouts AS (
    SELECT COUNT(DISTINCT from_number)::int AS opt_outs FROM messages
    WHERE device_id = $1::uuid AND direction = 'inbound' AND created_at >= now() - interval '7 days'
      AND length(content) <= 200 AND content ~* $2::text
  )
  SELECT * FROM matured, rec, optouts`;

export interface ReadinessDevice {
  id: string;
  status: string;
  createdAt: Date;
  warmupStartedAt: Date | null;
  warmupCompletedAt: Date | null;
}

export async function getReadinessInputs(device: ReadinessDevice, queryFn: QueryFn): Promise<ReadinessInputs> {
  const { rows } = await queryFn(INPUTS_SQL, [device.id, OPT_OUT_PATTERN]);
  const row = rows[0] ?? {};
  const n = (key: string): number => Number(row[key] ?? 0);
  const warmupStart = device.warmupStartedAt ?? device.createdAt;
  return {
    status: device.status,
    ageDays: Math.max(0, Math.floor((Date.now() - new Date(warmupStart).getTime()) / 86_400_000)),
    warmupCompleted: device.warmupCompletedAt !== null,
    maturedSent: n('matured_sent'),
    maturedDelivered: n('matured_delivered'),
    uniqueRecipients: n('unique_recipients'),
    engagedRecipients: n('engaged'),
    unsolicitedRecipients: n('unsolicited'),
    optOuts: n('opt_outs'),
  };
}

export async function hasRecipientOptedOut(deviceId: string, recipient: string, queryFn: QueryFn): Promise<boolean> {
  const digits = recipient.replace(/\D/g, '');
  if (!digits) return false;
  const { rows } = await queryFn(
    `SELECT 1 FROM messages
     WHERE device_id = $1::uuid AND direction = 'inbound' AND from_number = $2::varchar
       AND created_at >= now() - interval '365 days'
       AND length(content) <= 200 AND content ~* $3::text
     LIMIT 1`,
    [deviceId, digits, OPT_OUT_PATTERN],
  );
  return rows.length > 0;
}

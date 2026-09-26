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

// Boundaries match the anti-ban warm-up stages (day 3, 5 and 8).
function maturity(ageDays: number, warmupCompleted: boolean): ReadinessFactor {
  const max = 20;
  const day = ageDays + 1;
  if (warmupCompleted || ageDays >= 7) {
    return { id: 'maturity', label: 'Kematangan Nomor', score: max, max, status: 'complete', description: 'Warm-up 8 hari selesai', proven: true };
  }
  const score = ageDays >= 4 ? 12 : ageDays >= 2 ? 6 : 0;
  return {
    id: 'maturity', label: 'Kematangan Nomor', score, max, status: score > 0 ? 'partial' : 'locked',
    description: `Hari ke-${day}/8 — batas kirim naik bertahap`, proven: true,
  };
}

function delivery(i: ReadinessInputs): ReadinessFactor {
  const max = 25;
  if (i.maturedSent < MIN_MATURED_SENDS) {
    return {
      id: 'delivery', label: 'Delivery Rate', score: 13, max, status: 'partial', proven: false,
      description: `Belum cukup data (${i.maturedSent}/${MIN_MATURED_SENDS} pesan berumur >24 jam)`,
    };
  }
  const rate = i.maturedDelivered / i.maturedSent;
  const score = rate >= 0.97 ? 25 : rate >= 0.93 ? 18 : rate >= 0.85 ? 10 : 0;
  return {
    id: 'delivery', label: 'Delivery Rate', score, max, proven: true,
    status: score === max ? 'complete' : score > 0 ? 'partial' : 'danger',
    description: `${pct(rate)} terdelivery setelah 24 jam — target ≥97%`,
  };
}

function engagement(i: ReadinessInputs): ReadinessFactor {
  const max = 20;
  if (i.uniqueRecipients < MIN_RECIPIENTS) {
    return {
      id: 'engagement', label: 'Balasan Penerima', score: 10, max, status: 'partial', proven: false,
      description: `Belum cukup data (${i.uniqueRecipients}/${MIN_RECIPIENTS} penerima dalam 7 hari)`,
    };
  }
  const rate = i.engagedRecipients / i.uniqueRecipients;
  const score = rate >= 0.25 ? 20 : rate >= 0.15 ? 14 : rate >= 0.08 ? 8 : rate >= 0.03 ? 4 : 0;
  return {
    id: 'engagement', label: 'Balasan Penerima', score, max, proven: true,
    status: score === max ? 'complete' : score > 0 ? 'partial' : 'locked',
    description: `${pct(rate)} penerima membalas (7 hari) — target ≥25%`,
  };
}

function consent(i: ReadinessInputs): ReadinessFactor {
  const max = 20;
  if (i.uniqueRecipients < MIN_RECIPIENTS) {
    return {
      id: 'consent', label: 'Izin Penerima', score: 10, max, status: 'partial', proven: false,
      description: `Belum cukup data (${i.uniqueRecipients}/${MIN_RECIPIENTS} penerima dalam 7 hari)`,
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
    description: `${pct(unsolicited)} penerima belum pernah menghubungi lebih dulu; ${i.optOuts} permintaan berhenti`,
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
  if (byId.stability.status !== 'complete') out.push('Pastikan device online dan tidak dijeda sebelum mengirim.');
  if (byId.maturity.status !== 'complete') out.push(`Selesaikan warm-up: hari ke-${i.ageDays + 1}/8. Jangan menaikkan volume lebih cepat dari batas harian.`);
  if (byId.delivery.proven && byId.delivery.status !== 'complete') {
    out.push('Delivery rendah: bersihkan daftar dari nomor yang tidak aktif atau tidak terdaftar di WhatsApp. Pesan yang tak pernah terkirim bisa berarti Anda diblokir.');
  }
  if (byId.engagement.proven && byId.engagement.status !== 'complete') {
    out.push('Balasan rendah: kirim pesan yang relevan dan personal kepada orang yang memang menantikannya, bukan broadcast satu arah.');
  }
  if (byId.consent.proven && i.unsolicitedRecipients / i.uniqueRecipients > 0.2) {
    out.push('Banyak penerima belum pernah menghubungi Anda. Kirim hanya ke kontak yang sudah opt-in atau menghubungi lebih dulu.');
  }
  if (i.optOuts > 0) out.push(`Ada ${i.optOuts} penerima yang meminta berhenti. Nomor mereka otomatis diblokir dari pengiriman proaktif; hentikan pesan kepada mereka.`);
  if (out.length === 0) out.push('Pertahankan pola saat ini: kirim ke kontak yang berizin dan jaga volume tetap wajar.');
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

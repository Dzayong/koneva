import pool from '../../shared/database/connection';
import { ServiceError } from './service-error';

export const READINESS_COPY_VERSION = 'level-bypass-v1';

export type MissionStatus = 'completed' | 'needs_action' | 'not_applicable';
export type MissionKind = 'automatic' | 'manual' | 'test';

export interface MissionDefinition {
  id: string;
  level: number;
  title: string;
  description: string;
  kind: MissionKind;
  source: string;
  manual: boolean;
}

export const WORKSPACE_MISSIONS: readonly MissionDefinition[] = [
  { id: 'device_registered', level: 0, title: 'Daftarkan device', description: 'Minimal satu device tercatat di workspace.', kind: 'automatic', source: 'devices', manual: false },
  { id: 'risk_reviewed', level: 0, title: 'Pahami risiko koneksi', description: 'Koneksi ini memakai jalur nonresmi dan dapat terkena pembatasan. Ketahui cara memutus sesi.', kind: 'manual', source: 'Konfirmasi Owner', manual: true },
  { id: 'webhook_simulation', level: 0, title: 'Jalankan simulasi webhook', description: 'Periksa payload sintetis secara lokal. URL webhook tidak dipanggil.', kind: 'test', source: 'Simulator lokal', manual: false },
  { id: 'webhook_configured', level: 0, title: 'Siapkan webhook (opsional)', description: 'Konfigurasikan jika aplikasi Anda perlu menerima pembaruan status; jika tidak dibutuhkan, kriteria ini tidak berlaku.', kind: 'automatic', source: 'tenants.webhook_url', manual: false },
  { id: 'consent_reviewed', level: 1, title: 'Tinjau izin penerima', description: 'Pastikan penerima memberi izin sebelum pesan proaktif dikirim.', kind: 'manual', source: 'Konfirmasi Owner', manual: true },
  { id: 'optout_reviewed', level: 1, title: 'Tinjau STOP dan MULAI', description: 'Pahami bagaimana permintaan berhenti dihormati dan bagaimana izin baru dicatat.', kind: 'manual', source: 'Konfirmasi Owner', manual: true },
  { id: 'authorized_test_reviewed', level: 1, title: 'Tinjau cara uji terbatas', description: 'Uji pesan hanya manual ke nomor sendiri atau penerima yang memberi izin eksplisit.', kind: 'manual', source: 'Konfirmasi Owner', manual: true },
  { id: 'limited_flow_simulation', level: 1, title: 'Jalankan simulasi alur terbatas', description: 'Uji keputusan consent dan opt-out dengan data sintetis; tidak ada pesan yang dikirim.', kind: 'test', source: 'Simulator lokal', manual: false },
  { id: 'optin_recorded', level: 1, title: 'Catat izin penerima', description: 'Minimal satu persetujuan penerima tercatat di workspace.', kind: 'automatic', source: 'recipient_preferences', manual: false },
  { id: 'contact_group_created', level: 2, title: 'Siapkan grup kontak', description: 'Buat grup untuk meninjau target kampanye; keanggotaan grup bukan bukti izin.', kind: 'automatic', source: 'contact_groups', manual: false },
  { id: 'campaign_controls_reviewed', level: 2, title: 'Tinjau kontrol kampanye', description: 'Pahami preview, suppression/opt-out, pembatalan, dan batas kampanye sebelum menjadwalkan.', kind: 'manual', source: 'Konfirmasi Owner', manual: true },
  { id: 'campaign_dry_run', level: 2, title: 'Jalankan dry-run kampanye', description: 'Periksa hasil preview dan pembatalan menggunakan daftar sintetis; tidak membuat atau mengirim kampanye.', kind: 'test', source: 'Simulator lokal', manual: false },
  { id: 'queue_reviewed', level: 3, title: 'Tinjau antrean dan status pesan', description: 'Pahami status queued, sending, failed, dan cara memeriksa hasil yang ambigu.', kind: 'manual', source: 'Konfirmasi Owner', manual: true },
  { id: 'retry_reviewed', level: 3, title: 'Tinjau retry dan duplikasi', description: 'Jangan mengulang pengiriman ketika hasil sebelumnya belum direkonsiliasi.', kind: 'manual', source: 'Konfirmasi Owner', manual: true },
  { id: 'rate_limit_reviewed', level: 3, title: 'Tinjau batas penggunaan', description: 'Pahami kuota dan rate limit aplikasi; level tidak menaikkan batas tersebut.', kind: 'manual', source: 'Konfirmasi Owner', manual: true },
  { id: 'notification_resilience_simulation', level: 3, title: 'Uji skenario ketahanan notifikasi', description: 'Simulasikan duplikasi, timeout ambigu, dan pemulihan worker dengan data sintetis; tidak memakai OTP atau nomor nyata.', kind: 'test', source: 'Simulator lokal', manual: false },
  { id: 'team_roles_configured', level: 4, title: 'Tinjau anggota dan peran', description: 'Periksa akses anggota workspace dan gunakan hak minimum.', kind: 'automatic', source: 'memberships dan batas paket', manual: false },
  { id: 'incident_runbook_reviewed', level: 4, title: 'Tentukan eskalasi insiden', description: 'Tetapkan PIC dan cara melaporkan gangguan atau dugaan penyalahgunaan.', kind: 'manual', source: 'Konfirmasi Owner', manual: true },
  { id: 'stop_controls_reviewed', level: 4, title: 'Ketahui cara menghentikan layanan', description: 'Ketahui cara menjeda device dan menghentikan kampanye terjadwal.', kind: 'manual', source: 'Konfirmasi Owner', manual: true },
  { id: 'incident_tabletop', level: 4, title: 'Jalankan tabletop insiden', description: 'Latih langkah eskalasi pada skenario sintetis; antrean dan pelanggan nyata tidak disentuh.', kind: 'test', source: 'Simulator lokal', manual: false },
] as const;

export const TEST_MISSION_IDS = new Set(WORKSPACE_MISSIONS.filter((mission) => mission.kind === 'test').map((mission) => mission.id));
export const MISSION_SIMULATOR_VERSION = 'workspace-simulator-v1';
export interface MissionTestRun {
  mission_id: string;
  result: 'passed' | 'failed';
  checks_passed: number;
  checks_total: number;
  simulator_version: string;
  created_at: Date | string;
}
export interface MissionTestCheck { id: string; passed: boolean }

/** Deterministic synthetic scenarios. Deliberately performs no network or message transport calls. */
export function evaluateWorkspaceTestMission(missionId: string, answer?: string): MissionTestCheck[] {
  const checks = (items: Array<[string, boolean]>): MissionTestCheck[] => items.map(([id, passed]) => ({ id, passed }));
  switch (missionId) {
    case 'webhook_simulation': {
      const payload = { event: 'message.status', data: { message_id: 'synthetic-message', status: 'delivered' } };
      return checks([['event_name_present', payload.event.length > 0], ['message_reference_present', payload.data.message_id.startsWith('synthetic-')], ['external_url_not_called', true]]);
    }
    case 'limited_flow_simulation': {
      const eligible = (consented: boolean, optedOut: boolean) => consented && !optedOut;
      return checks([['consented_fixture_allowed', eligible(true, false)], ['opted_out_fixture_blocked', !eligible(true, true)], ['no_consent_fixture_blocked', !eligible(false, false)], ['transport_not_called', true]]);
    }
    case 'campaign_dry_run': {
      const fixture = [{ consent: true, optedOut: false }, { consent: true, optedOut: true }, { consent: false, optedOut: false }];
      const selected = fixture.filter((row) => row.consent && !row.optedOut);
      return checks([['eligible_fixture_count', selected.length === 1], ['opt_out_excluded', !selected.some((row) => row.optedOut)], ['campaign_not_created', true], ['message_not_sent', true]]);
    }
    case 'notification_resilience_simulation': {
      const seen = new Set<string>();
      const process = (key: string) => !seen.has(key) && Boolean(seen.add(key));
      const first = process('synthetic-idempotency-key');
      const duplicate = process('synthetic-idempotency-key');
      return checks([['first_request_accepted', first], ['duplicate_not_processed', !duplicate], ['ambiguous_timeout_requires_reconciliation', true], ['worker_fixture_is_synthetic', true]]);
    }
    case 'incident_tabletop':
      return checks([['worker_failure_fixture_detected', true], ['pause_and_escalation_selected', answer === 'pause_and_escalate'], ['customer_queue_untouched', true], ['customer_message_not_sent', true]]);
    default: throw new ServiceError(400, 'MISSION_NOT_RUNNABLE', 'Misi ini bukan simulasi yang dapat dijalankan.');
  }
}

const LEVELS = [
  { level: 0, name: 'Siap Disiapkan' },
  { level: 1, name: 'Siap Uji Terbatas' },
  { level: 2, name: 'Siap Kelola Kampanye' },
  { level: 3, name: 'Siap untuk Notifikasi' },
  { level: 4, name: 'Siap Operasional CS' },
] as const;

export interface WorkspaceReadinessFacts {
  deviceCount: number;
  webhookConfigured: boolean;
  optedInCount: number;
  contactGroupCount: number;
  memberCount: number;
  maxMembers: number | null;
}

export interface StoredMissionState {
  mission_id: string;
  status: 'completed' | 'not_applicable';
  reason: string | null;
  copy_version: string;
  confirmed_by: string | null;
  confirmed_at: Date | string;
}

export interface MissionView extends MissionDefinition {
  status: MissionStatus;
  reason: string | null;
  confirmed_at: string | null;
  observed_at: string;
}

export function buildMissionViews(facts: WorkspaceReadinessFacts, stored: StoredMissionState[], testRuns: MissionTestRun[] = []): MissionView[] {
  const states = new Map(stored.map((state) => [state.mission_id, state]));
  const runs = new Map(testRuns.map((run) => [run.mission_id, run]));
  const observedAt = new Date().toISOString();
  return WORKSPACE_MISSIONS.map((mission) => {
    let automaticComplete: boolean | null = null;
    switch (mission.id) {
      case 'device_registered': automaticComplete = facts.deviceCount > 0; break;
      // Webhooks are optional. Their absence should never block the baseline level.
      case 'webhook_configured': automaticComplete = facts.webhookConfigured ? true : null; break;
      case 'optin_recorded': automaticComplete = facts.optedInCount > 0; break;
      case 'contact_group_created': automaticComplete = facts.contactGroupCount > 0; break;
      case 'team_roles_configured':
        automaticComplete = facts.maxMembers !== null && facts.maxMembers < 2 ? true : facts.memberCount > 1;
        break;
    }
    const state = states.get(mission.id);
    const testRun = runs.get(mission.id);
    const optionalWebhookMissing = mission.id === 'webhook_configured' && !facts.webhookConfigured;
    const status: MissionStatus = optionalWebhookMissing
      ? 'not_applicable'
      : automaticComplete === true
      ? 'completed'
      : automaticComplete === false
        ? 'needs_action'
      : mission.kind === 'test'
        ? testRun?.simulator_version === MISSION_SIMULATOR_VERSION && testRun.result === 'passed' ? 'completed' : 'needs_action'
        : state?.copy_version === READINESS_COPY_VERSION
          ? state.status
          : 'needs_action';
    return {
      ...mission,
      status,
      reason: status === 'not_applicable'
        ? (optionalWebhookMissing
          ? 'Webhook bersifat opsional dan belum dikonfigurasi.'
          : mission.id === 'team_roles_configured'
            ? 'Paket workspace membatasi jumlah anggota.'
            : state?.reason ?? null)
        : mission.kind === 'test' && testRun
          ? `Simulasi ${testRun.result === 'passed' ? 'lulus' : 'gagal'} (${testRun.checks_passed}/${testRun.checks_total}); tanpa koneksi eksternal atau pengiriman pesan.`
          : state?.reason ?? null,
      confirmed_at: mission.kind === 'test' && testRun ? new Date(testRun.created_at).toISOString() : state?.confirmed_at ? new Date(state.confirmed_at).toISOString() : null,
      observed_at: observedAt,
    };
  });
}

export function summarizeWorkspaceReadiness(missions: MissionView[], selectedLevel: number | null) {
  let recommendedLevel: number | null = null;
  for (const level of LEVELS) {
    const blocked = missions.some((mission) => mission.level <= level.level && mission.status === 'needs_action');
    if (blocked) break;
    recommendedLevel = level.level;
  }
  return {
    recommended_level: recommendedLevel,
    selected_level: selectedLevel ?? recommendedLevel,
    selected_by_owner: selectedLevel !== null,
    evaluated_at: missions[0]?.observed_at ?? new Date().toISOString(),
    levels: LEVELS.map((item) => ({
      ...item,
      missions: missions.filter((mission) => mission.level === item.level),
      completed: missions.filter((mission) => mission.level === item.level && mission.status !== 'needs_action').length,
      total: missions.filter((mission) => mission.level === item.level).length,
    })),
  };
}

export async function getWorkspaceReadiness(tenantId: string) {
  const [factsResult, statesResult, testsResult, selectionResult] = await Promise.all([
    pool.query<WorkspaceReadinessFacts & Record<string, unknown>>(
      `SELECT
         (SELECT COUNT(*)::int FROM devices d WHERE d.tenant_id = t.id) AS "deviceCount",
         (t.webhook_url IS NOT NULL AND btrim(t.webhook_url) <> '') AS "webhookConfigured",
         (SELECT COUNT(*)::int FROM recipient_preferences rp WHERE rp.tenant_id = t.id AND rp.status = 'opted_in') AS "optedInCount",
         (SELECT COUNT(*)::int FROM contact_groups cg WHERE cg.tenant_id = t.id) AS "contactGroupCount",
         (SELECT COUNT(*)::int FROM memberships m WHERE m.tenant_id = t.id) AS "memberCount",
         (SELECT p.max_members FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.tenant_id = t.id ORDER BY s.created_at DESC LIMIT 1) AS "maxMembers"
       FROM tenants t WHERE t.id = $1`, [tenantId],
    ),
    pool.query<StoredMissionState>(
      `SELECT mission_id, status, reason, copy_version, confirmed_by, confirmed_at
       FROM workspace_mission_state WHERE tenant_id = $1`, [tenantId],
    ),
    pool.query<MissionTestRun>(
      `SELECT DISTINCT ON (mission_id) mission_id, result, checks_passed, checks_total, simulator_version, created_at
       FROM workspace_mission_test_runs WHERE tenant_id = $1 ORDER BY mission_id, created_at DESC, id DESC`, [tenantId],
    ),
    pool.query<{ target_level: number }>(
      `SELECT target_level FROM workspace_level_events WHERE tenant_id = $1
       ORDER BY created_at DESC, id DESC LIMIT 1`, [tenantId],
    ),
  ]);
  const facts = factsResult.rows[0];
  if (!facts) throw new ServiceError(404, 'WORKSPACE_NOT_FOUND', 'Workspace tidak ditemukan.');
  const missions = buildMissionViews(facts, statesResult.rows, testsResult.rows);
  return summarizeWorkspaceReadiness(missions, selectionResult.rows[0]?.target_level ?? null);
}

export async function runWorkspaceTestMission(input: { tenantId: string; actorId: string; missionId: string; answer?: string }) {
  if (!TEST_MISSION_IDS.has(input.missionId)) throw new ServiceError(400, 'MISSION_NOT_RUNNABLE', 'Misi ini bukan simulasi yang dapat dijalankan.');
  const recentRuns = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM workspace_mission_test_runs WHERE tenant_id=$1 AND created_at >= now() - interval '1 minute'`, [input.tenantId],
  );
  if (Number(recentRuns.rows[0]?.count ?? 0) >= 10) throw new ServiceError(429, 'MISSION_TEST_RATE_LIMITED', 'Batas simulasi tercapai. Coba lagi sebentar.');
  const checks = evaluateWorkspaceTestMission(input.missionId, input.answer);
  const passed = checks.every((check) => check.passed);
  const result = await pool.query<{ id: string; created_at: Date }>(
    `INSERT INTO workspace_mission_test_runs (tenant_id, actor_id, mission_id, result, checks_passed, checks_total, simulator_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
    [input.tenantId, input.actorId, input.missionId, passed ? 'passed' : 'failed', checks.filter((check) => check.passed).length, checks.length, MISSION_SIMULATOR_VERSION],
  );
  return { run_id: result.rows[0]?.id, mission_id: input.missionId, result: passed ? 'passed' as const : 'failed' as const, checks, created_at: result.rows[0]?.created_at };
}

export async function confirmWorkspaceMission(input: {
  tenantId: string; actorId: string; missionId: string; status: 'completed' | 'not_applicable'; reason?: string;
}) {
  const mission = WORKSPACE_MISSIONS.find((item) => item.id === input.missionId);
  if (!mission || !mission.manual) throw new ServiceError(400, 'MISSION_NOT_CONFIRMABLE', 'Misi ini diverifikasi otomatis atau tidak dikenal.');
  if (input.status === 'not_applicable') throw new ServiceError(400, 'MISSION_NOT_APPLICABLE', 'Misi manual ini tidak dapat dilewati.');
  await pool.query(
    `INSERT INTO workspace_mission_state (tenant_id, mission_id, status, copy_version, confirmed_by)
     VALUES ($1, $2, 'completed', $3, $4)
     ON CONFLICT (tenant_id, mission_id) DO UPDATE SET status='completed', reason=NULL,
       copy_version=EXCLUDED.copy_version, confirmed_by=EXCLUDED.confirmed_by, confirmed_at=now()`,
    [input.tenantId, input.missionId, READINESS_COPY_VERSION, input.actorId],
  );
}

export async function bypassWorkspaceReadiness(input: {
  tenantId: string; actorId: string; targetLevel: number; reason: string; idempotencyKey: string; dialogVersion: string;
}) {
  const previous = await pool.query<{ id: string; target_level: number; reason: string; dialog_version: string }>(
    `SELECT id, target_level, reason, dialog_version FROM workspace_level_events WHERE tenant_id=$1 AND idempotency_key=$2`,
    [input.tenantId, input.idempotencyKey],
  );
  const previousEvent = previous.rows[0];
  if (previousEvent) {
    if (previousEvent.target_level !== input.targetLevel || previousEvent.reason !== input.reason.trim() || previousEvent.dialog_version !== input.dialogVersion) {
      throw new ServiceError(409, 'IDEMPOTENCY_KEY_REUSED', 'Kunci idempotensi sudah digunakan dengan pilihan berbeda.');
    }
    return { event_id: previousEvent.id, target_level: previousEvent.target_level, idempotent_replay: true };
  }
  const current = await getWorkspaceReadiness(input.tenantId);
  if (current.recommended_level === null) {
    throw new ServiceError(409, 'NO_RECOMMENDED_LEVEL', 'Belum ada level yang direkomendasikan untuk workspace ini.');
  }
  if (input.targetLevel <= current.recommended_level) {
    throw new ServiceError(409, 'BYPASS_NOT_REQUIRED', 'Level tujuan sudah dicapai berdasarkan kriteria saat ini.');
  }
  const unmet = current.levels
    .filter((level) => level.level <= input.targetLevel)
    .flatMap((level) => level.missions.filter((mission) => mission.status === 'needs_action').map((mission) => mission.id));
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO workspace_level_events
       (tenant_id, actor_id, recommended_level, target_level, unmet_mission_codes, reason, dialog_version, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [input.tenantId, input.actorId, current.recommended_level, input.targetLevel, unmet, input.reason.trim(), input.dialogVersion, input.idempotencyKey],
  );
  if (inserted.rows[0]) return { event_id: inserted.rows[0].id, target_level: input.targetLevel, idempotent_replay: false };
  const replay = await pool.query<{ id: string; target_level: number; reason: string; dialog_version: string }>(
    `SELECT id, target_level, reason, dialog_version FROM workspace_level_events WHERE tenant_id=$1 AND idempotency_key=$2`,
    [input.tenantId, input.idempotencyKey],
  );
  const event = replay.rows[0];
  if (!event || event.target_level !== input.targetLevel || event.reason !== input.reason.trim() || event.dialog_version !== input.dialogVersion) {
    throw new ServiceError(409, 'IDEMPOTENCY_KEY_REUSED', 'Kunci idempotensi sudah digunakan dengan pilihan berbeda.');
  }
  return { event_id: event.id, target_level: event.target_level, idempotent_replay: true };
}

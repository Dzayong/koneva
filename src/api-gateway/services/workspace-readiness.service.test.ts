import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMissionViews, evaluateWorkspaceTestMission, MISSION_SIMULATOR_VERSION, summarizeWorkspaceReadiness, TEST_MISSION_IDS, type MissionTestRun, type WorkspaceReadinessFacts } from './workspace-readiness.service';

const facts = (overrides: Partial<WorkspaceReadinessFacts> = {}): WorkspaceReadinessFacts => ({
  deviceCount: 0,
  webhookConfigured: false,
  optedInCount: 0,
  contactGroupCount: 0,
  memberCount: 1,
  maxMembers: 3,
  ...overrides,
});

test('empty workspace has no recommended level; optional webhook absence is not a blocker', () => {
  const missions = buildMissionViews(facts(), []);
  const readiness = summarizeWorkspaceReadiness(missions, null);
  assert.equal(readiness.recommended_level, null);
  assert.equal(readiness.selected_level, null);
  assert.equal(readiness.levels[0]?.missions.find((mission) => mission.id === 'webhook_configured')?.status, 'not_applicable');
  assert.equal(readiness.levels[0]?.missions.find((mission) => mission.id === 'webhook_configured')?.reason, 'Webhook bersifat opsional dan belum dikonfigurasi.');
});

test('Level 0 is recommended only after its device and Owner review criteria are met', () => {
  const pending = buildMissionViews(facts({ deviceCount: 1 }), []);
  assert.equal(summarizeWorkspaceReadiness(pending, null).recommended_level, null);

  const reviewed = buildMissionViews(facts({ deviceCount: 1 }), [{
    mission_id: 'risk_reviewed', status: 'completed', reason: null,
    copy_version: 'level-bypass-v1', confirmed_by: 'owner-1', confirmed_at: new Date('2026-10-17T00:00:00Z'),
  }], [{
    mission_id: 'webhook_simulation', result: 'passed', checks_passed: 3, checks_total: 3,
    simulator_version: MISSION_SIMULATOR_VERSION, created_at: new Date('2026-10-17T00:00:00Z'),
  }]);
  assert.equal(summarizeWorkspaceReadiness(reviewed, null).recommended_level, 0);
});

test('automatic evidence overrides old manual state and unmet earlier missions block higher levels', () => {
  const missions = buildMissionViews(facts({ deviceCount: 1, optedInCount: 2 }), [{
    mission_id: 'optin_recorded', status: 'not_applicable', reason: 'stale',
    copy_version: 'level-bypass-v1', confirmed_by: 'owner-1', confirmed_at: new Date('2026-10-17T00:00:00Z'),
  }]);
  assert.equal(missions.find((mission) => mission.id === 'optin_recorded')?.status, 'completed');
  assert.equal(summarizeWorkspaceReadiness(missions, 4).recommended_level, null);
  assert.equal(summarizeWorkspaceReadiness(missions, 4).selected_level, 4);
});

test('each test mission runs deterministic synthetic checks only', () => {
  assert.equal(TEST_MISSION_IDS.size, 5);
  for (const missionId of TEST_MISSION_IDS) {
    const checks = evaluateWorkspaceTestMission(missionId, missionId === 'incident_tabletop' ? 'pause_and_escalate' : undefined);
    assert.ok(checks.length > 0, `${missionId} has checks`);
    assert.ok(checks.every((check) => check.passed), `${missionId} passes its synthetic scenario`);
  }
  assert.equal(evaluateWorkspaceTestMission('incident_tabletop').some((check) => !check.passed), true);
  assert.equal(evaluateWorkspaceTestMission('incident_tabletop', 'resume_worker').some((check) => !check.passed), true);
  assert.throws(() => evaluateWorkspaceTestMission('risk_reviewed'), /bukan simulasi/);
});

test('a passed current-version simulation completes only its own mission', () => {
  const run: MissionTestRun = {
    mission_id: 'limited_flow_simulation', result: 'passed', checks_passed: 4, checks_total: 4,
    simulator_version: MISSION_SIMULATOR_VERSION, created_at: new Date('2026-10-17T00:00:00Z'),
  };
  const missions = buildMissionViews(facts(), [], [run]);
  assert.equal(missions.find((mission) => mission.id === run.mission_id)?.status, 'completed');
  assert.equal(missions.find((mission) => mission.id === 'campaign_dry_run')?.status, 'needs_action');
  assert.match(missions.find((mission) => mission.id === run.mission_id)?.reason ?? '', /tanpa koneksi eksternal atau pengiriman pesan/);
});

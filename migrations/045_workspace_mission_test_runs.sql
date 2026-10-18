-- Aggregate-only history for in-app synthetic mission simulations.
-- No payloads, contact details, URLs, OTP values or message content are stored.
CREATE TABLE workspace_mission_test_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  mission_id VARCHAR(64) NOT NULL CHECK (mission_id IN (
    'webhook_simulation', 'limited_flow_simulation', 'campaign_dry_run',
    'notification_resilience_simulation', 'incident_tabletop'
  )),
  result VARCHAR(12) NOT NULL CHECK (result IN ('passed', 'failed')),
  checks_passed SMALLINT NOT NULL CHECK (checks_passed >= 0),
  checks_total SMALLINT NOT NULL CHECK (checks_total > 0 AND checks_passed <= checks_total),
  simulator_version VARCHAR(40) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workspace_mission_test_runs_latest_idx
  ON workspace_mission_test_runs (tenant_id, mission_id, created_at DESC, id DESC);

GRANT SELECT, INSERT ON workspace_mission_test_runs TO koneva_application;

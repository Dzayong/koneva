-- Workspace-scoped operational readiness checklist. This state never grants plan
-- entitlements or bypasses messaging/consent/rate-limit enforcement.
CREATE TABLE workspace_mission_state (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mission_id VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('completed', 'not_applicable')),
  reason VARCHAR(500),
  copy_version VARCHAR(40) NOT NULL,
  confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, mission_id),
  CHECK (status <> 'not_applicable' OR (reason IS NOT NULL AND length(btrim(reason)) > 0))
);

CREATE TABLE workspace_level_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  recommended_level SMALLINT NOT NULL CHECK (recommended_level BETWEEN 0 AND 4),
  target_level SMALLINT NOT NULL CHECK (target_level BETWEEN 0 AND 4),
  unmet_mission_codes TEXT[] NOT NULL DEFAULT '{}',
  reason VARCHAR(500) NOT NULL CHECK (length(btrim(reason)) > 0),
  dialog_version VARCHAR(40) NOT NULL,
  idempotency_key UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX workspace_level_events_latest_idx
  ON workspace_level_events (tenant_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_mission_state TO koneva_application;
GRANT SELECT, INSERT ON workspace_level_events TO koneva_application;

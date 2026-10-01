-- A legacy-role clock starts only after an Owner deliberately issues a formal notice.
-- No membership role or permission changes as a side effect of this migration.
CREATE TABLE IF NOT EXISTS legacy_role_notices (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  notice_sent_at TIMESTAMPTZ NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL,
  issued_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT legacy_role_notice_deadline CHECK (deadline_at = notice_sent_at + INTERVAL '1440 hours')
);

CREATE INDEX IF NOT EXISTS legacy_role_notices_deadline_idx
  ON legacy_role_notices (deadline_at, tenant_id);

COMMENT ON TABLE legacy_role_notices IS
  'One explicit workspace-level formal notice starts the 60-day legacy admin/viewer transition; no notice means no deadline.';

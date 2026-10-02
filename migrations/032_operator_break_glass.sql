ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS is_break_glass BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS break_glass_validated_at TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='operators_break_glass_scope_check') THEN
    ALTER TABLE operators ADD CONSTRAINT operators_break_glass_scope_check
      CHECK (NOT is_break_glass OR permissions = ARRAY['audit:read']::text[]);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS operators_single_break_glass_idx ON operators ((is_break_glass)) WHERE is_break_glass;
GRANT UPDATE (break_glass_validated_at) ON operators TO koneva_application;

ALTER TABLE operator_security_events DROP CONSTRAINT IF EXISTS operator_security_events_event_check;
ALTER TABLE operator_security_events ADD CONSTRAINT operator_security_events_event_check CHECK (event IN (
  'operator_provisioned','break_glass_provisioned','break_glass_login','break_glass_alert_failed',
  'mfa_enrollment_started','mfa_enrolled','mfa_verified','mfa_failed','recovery_code_used','mfa_reset','mfa_key_rotated'
));

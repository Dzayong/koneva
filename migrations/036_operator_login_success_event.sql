-- Allow the 'login_success' security event now that MFA has been removed and
-- every successful operator login records this event directly.
ALTER TABLE operator_security_events DROP CONSTRAINT IF EXISTS operator_security_events_event_check;
ALTER TABLE operator_security_events ADD CONSTRAINT operator_security_events_event_check CHECK (event IN (
  'login_success',
  'operator_provisioned','break_glass_provisioned','break_glass_login','break_glass_alert_failed',
  'mfa_enrollment_started','mfa_enrolled','mfa_verified','mfa_failed','recovery_code_used','mfa_reset','mfa_key_rotated'
));

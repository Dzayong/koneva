-- Append-only security log for the operator sign-in path. Separate from operator_audit on purpose: operator_audit records
-- business actions by an identified operator; these events may have NO identifiable operator (unknown/expired challenge,
-- offline administration), and must never be forced into a fake identity.
-- No credential, code, secret, raw email or raw IP is stored: `ip_hash` is a one-way hash, `reason` is a fixed vocabulary.
CREATE TABLE operator_security_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  event TEXT NOT NULL CHECK (event IN (
    'operator_provisioned', 'mfa_enrollment_started', 'mfa_enrolled', 'mfa_verified', 'mfa_failed',
    'recovery_code_used', 'mfa_reset', 'mfa_key_rotated')),
  operator_id UUID REFERENCES operators(id),
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'offline')),
  reason TEXT CHECK (reason IN (
    'challenge_invalid', 'code_invalid', 'recovery_code_invalid', 'enrollment_code_invalid', 'totp', 'recovery_code')),
  ip_hash TEXT,
  actor_label VARCHAR(60),
  request_id UUID,
  -- Offline operations must name who ran them; web events must not carry a label.
  CONSTRAINT operator_security_events_offline_actor CHECK (source = 'web' OR actor_label IS NOT NULL)
);
CREATE INDEX operator_security_events_at_idx ON operator_security_events(at DESC, id DESC);
CREATE INDEX operator_security_events_operator_idx ON operator_security_events(operator_id, at DESC) WHERE operator_id IS NOT NULL;
CREATE FUNCTION immutable_operator_security_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'operator security events are append only'; END $$;
CREATE TRIGGER operator_security_events_immutable BEFORE UPDATE OR DELETE ON operator_security_events
FOR EACH ROW EXECUTE FUNCTION immutable_operator_security_events();

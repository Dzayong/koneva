-- Operator MFA (TOTP) and one-time enrollment. Secrets are stored encrypted (AES-256-GCM, key from OPERATOR_MFA_ENC_KEY),
-- recovery codes and enrollment codes only as hashes. Sessions are created only after MFA succeeds.
ALTER TABLE operators
  ADD COLUMN mfa_secret_enc TEXT,
  ADD COLUMN mfa_enrolled_at TIMESTAMPTZ,
  ADD COLUMN mfa_last_step BIGINT,
  ADD COLUMN enrollment_code_hash TEXT,
  ADD COLUMN enrollment_code_expires_at TIMESTAMPTZ;

CREATE TABLE operator_recovery_codes (
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  PRIMARY KEY (operator_id, code_hash)
);

-- A short-lived, single-purpose credential returned after the password step. It is NOT a session.
CREATE TABLE operator_challenges (
  token_hash TEXT PRIMARY KEY,
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'enroll')),
  pending_secret_enc TEXT,
  enrollment_code_ok BOOLEAN NOT NULL DEFAULT false,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '5 minutes',
  consumed_at TIMESTAMPTZ
);
CREATE INDEX operator_challenges_operator_idx ON operator_challenges(operator_id);

-- Also revoke sessions when the second factor changes (reset or re-enrollment).
CREATE OR REPLACE FUNCTION revoke_operator_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash OR NEW.disabled_at IS DISTINCT FROM OLD.disabled_at
     OR NEW.mfa_secret_enc IS DISTINCT FROM OLD.mfa_secret_enc THEN
    UPDATE operator_sessions SET revoked_at = now() WHERE operator_id = NEW.id AND revoked_at IS NULL;
    UPDATE operator_challenges SET consumed_at = now() WHERE operator_id = NEW.id AND consumed_at IS NULL;
  END IF;
  RETURN NEW;
END $$;

-- Self-service "forgot password". Only a hash of the token is stored; the token itself is emailed once
-- and never logged. Single-use (consumed_at), short-lived, and scoped to one user.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_hash_uq ON password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens (user_id, created_at DESC);

COMMENT ON TABLE password_reset_tokens IS
  'One-time password reset tokens. A successful reset also revokes every existing user_sessions row for that user.';

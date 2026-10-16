-- WhatsApp proof for a new signup is distinct from proof of mailbox ownership.
ALTER TABLE users
  ADD COLUMN phone_number VARCHAR(20),
  ADD COLUMN phone_verified_at TIMESTAMPTZ,
  ADD COLUMN pending_signup_phone_number VARCHAR(20),
  ADD COLUMN pending_signup_verification_method VARCHAR(12) NOT NULL DEFAULT 'email'
    CHECK (pending_signup_verification_method IN ('email', 'whatsapp'));

CREATE TABLE signup_phone_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash CHAR(64) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX signup_phone_verifications_user_idx ON signup_phone_verifications(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON signup_phone_verifications TO koneva_application;

-- Transient platform OTP messages travel through the regular device worker, but are hidden from tenant message APIs.
ALTER TABLE messages ADD COLUMN system_otp BOOLEAN NOT NULL DEFAULT false;

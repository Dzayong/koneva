-- Keep a privacy-safe link from signup OTP proofs to the platform message row so
-- operators can distinguish queued, sent, delivered, read, and failed requests.
ALTER TABLE signup_phone_verifications
  ADD COLUMN phone_last4 CHAR(4),
  ADD COLUMN message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN send_status VARCHAR(12) NOT NULL DEFAULT 'pending'
    CHECK (send_status IN ('pending', 'queued', 'failed')),
  ADD COLUMN send_error_code VARCHAR(50);

CREATE INDEX signup_phone_verifications_message_idx
  ON signup_phone_verifications(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX signup_phone_verifications_created_idx
  ON signup_phone_verifications(created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON signup_phone_verifications TO koneva_application;

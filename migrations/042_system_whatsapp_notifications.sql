-- Platform notifications share the system-owned WhatsApp sender, but are delivered
-- to the operator's separately configured number and run at normal queue priority.
ALTER TABLE system_whatsapp_otp_sender
  ADD COLUMN notification_recipient_phone VARCHAR(20),
  ADD COLUMN notifications_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN notification_test_queued_at TIMESTAMPTZ;

ALTER TABLE messages ADD COLUMN system_notification BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX messages_system_notification_external_id_idx
  ON messages(external_id) WHERE system_notification = true AND external_id IS NOT NULL;

CREATE TABLE system_notification_outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_key VARCHAR(160) NOT NULL UNIQUE,
  event_type VARCHAR(50) NOT NULL,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_until TIMESTAMPTZ,
  queued_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  queued_at TIMESTAMPTZ,
  last_error VARCHAR(120)
);
CREATE INDEX system_notification_outbox_pending_idx
  ON system_notification_outbox(next_attempt_at, created_at) WHERE queued_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON system_notification_outbox TO koneva_application;

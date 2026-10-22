-- Claim inbound Baileys message IDs atomically before persistence/auto-reply.
-- This closes the race where two concurrent handlers both passed NOT EXISTS.
CREATE TABLE IF NOT EXISTS inbound_message_dedup (
  device_key VARCHAR(32) NOT NULL,
  whatsapp_message_id VARCHAR(64) NOT NULL,
  claimed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_key, whatsapp_message_id)
);

CREATE INDEX IF NOT EXISTS idx_inbound_message_dedup_claimed_at
  ON inbound_message_dedup (claimed_at);

-- A durable claim prevents BullMQ retries from resending after WhatsApp accepted
-- a message but the worker failed before persisting the final status.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS send_started_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_messages_stuck_sending
  ON messages (device_key, send_started_at)
  WHERE direction = 'outbound' AND status = 'sending';

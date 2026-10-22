-- Separate enqueue eligibility time from message creation/scheduling time.
-- Existing messages retain their original age; quota-held messages are reset when released.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS queue_started_at TIMESTAMP;

UPDATE messages
SET queue_started_at = COALESCE(created_at, NOW())
WHERE queue_started_at IS NULL;

ALTER TABLE messages ALTER COLUMN queue_started_at SET DEFAULT NOW();
ALTER TABLE messages ALTER COLUMN queue_started_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_queue_expiry
  ON messages (device_key, queue_started_at)
  WHERE direction = 'outbound' AND status = 'queued';

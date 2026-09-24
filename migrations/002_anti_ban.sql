ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS warmup_started_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS warmup_completed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS paused_until TIMESTAMP;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS reported_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_messages_device_id_created ON messages(device_id, created_at DESC);

-- Store explicit, one-message customer approval so the worker can honor it after queueing.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS allow_warmup_override BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN messages.allow_warmup_override IS
  'Per-message user approval to bypass only proactive/media warm-up checks; other send safeguards remain active.';

GRANT SELECT, INSERT, UPDATE ON messages TO koneva_application;

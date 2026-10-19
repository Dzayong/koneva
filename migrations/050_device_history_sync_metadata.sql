-- Keep only a privacy-minimal summary of WhatsApp's recent history sync.
-- Message bodies, contacts, and chat identifiers are never stored by this feature.
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS history_sync_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (history_sync_status IN ('not_started', 'syncing', 'paused', 'completed')),
  ADD COLUMN IF NOT EXISTS history_sync_progress SMALLINT
    CHECK (history_sync_progress IS NULL OR history_sync_progress BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS history_sync_completion_explicit BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS history_latest_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS history_synced_at TIMESTAMPTZ;

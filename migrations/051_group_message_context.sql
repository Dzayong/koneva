-- Group JIDs are longer than a phone number. Preserve the originating chat so
-- an inbound group message can be displayed and replied to in that same group.
ALTER TABLE messages ALTER COLUMN to_number TYPE VARCHAR(128);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS chat_jid VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_messages_chat_context
  ON messages (tenant_id, device_id, chat_jid, created_at DESC)
  WHERE chat_jid IS NOT NULL;

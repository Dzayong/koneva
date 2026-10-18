ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS messages_reply_context_idx
  ON messages (tenant_id, reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;

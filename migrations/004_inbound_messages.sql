ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS direction VARCHAR(10) NOT NULL DEFAULT 'outbound',
  ADD COLUMN IF NOT EXISTS from_number VARCHAR(20);

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_direction_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_direction_check CHECK (direction IN ('inbound', 'outbound'));

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_status_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_status_check CHECK (
    status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'blocked', 'received')
  );

CREATE INDEX IF NOT EXISTS idx_messages_tenant_direction_created
  ON messages (tenant_id, direction, created_at DESC);

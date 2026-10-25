-- Record group messages that were checked against active auto-reply rules but did not match.
ALTER TABLE auto_reply_logs DROP CONSTRAINT IF EXISTS auto_reply_logs_status_check;
ALTER TABLE auto_reply_logs
  ADD CONSTRAINT auto_reply_logs_status_check
  CHECK (status IN ('sent', 'blocked', 'failed', 'ignored'));

ALTER TABLE auto_reply_logs ADD COLUMN IF NOT EXISTS stage VARCHAR(20) NOT NULL DEFAULT 'send';
ALTER TABLE auto_reply_logs DROP CONSTRAINT IF EXISTS auto_reply_logs_stage_check;
ALTER TABLE auto_reply_logs
  ADD CONSTRAINT auto_reply_logs_stage_check
  CHECK (stage IN ('match', 'ai', 'policy', 'presence', 'billing', 'send', 'persist'));

CREATE INDEX IF NOT EXISTS auto_reply_logs_tenant_recent_idx
  ON auto_reply_logs (tenant_id, created_at DESC, id DESC);

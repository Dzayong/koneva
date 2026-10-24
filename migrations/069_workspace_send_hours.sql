CREATE TABLE workspace_send_hours (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  start_time TIME NOT NULL DEFAULT '08:00',
  end_time TIME NOT NULL DEFAULT '22:00',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_time < end_time)
);

ALTER TABLE messages
  ADD COLUMN send_context TEXT NOT NULL DEFAULT 'api'
  CHECK (send_context IN ('api', 'broadcast'));

GRANT SELECT, INSERT, UPDATE ON workspace_send_hours TO koneva_application;

-- `paused_until` previously represented an automatic pause triggered by the
-- readiness score. Manual pauses are stored in `status` and remain untouched.
UPDATE devices
SET status = 'offline', paused_until = NULL, updated_at = now()
WHERE paused_until IS NOT NULL AND status = 'paused';

UPDATE devices
SET paused_until = NULL, updated_at = now()
WHERE paused_until IS NOT NULL;

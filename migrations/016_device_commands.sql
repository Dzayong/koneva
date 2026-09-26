-- Commands the API gateway hands to a number's bot container: WhatsApp status posts, catalog and
-- business-profile operations. The bot claims queued rows, runs them on its own socket and writes the result.
CREATE TABLE IF NOT EXISTS device_commands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  device_key VARCHAR(32) NOT NULL,
  type VARCHAR(40) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(12) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  result JSONB,
  error TEXT,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS device_commands_queue_idx ON device_commands (device_key, status, run_at);
CREATE INDEX IF NOT EXISTS device_commands_device_type_idx ON device_commands (device_id, type, created_at DESC);

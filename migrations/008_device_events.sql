-- Timeline of meaningful device status changes (online, offline, banned, logged_out, error).
CREATE TABLE IF NOT EXISTS device_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  device_key VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL,
  previous_status VARCHAR(20),
  reason VARCHAR(120),
  code INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_device_events_device_time ON device_events (device_id, created_at DESC);

-- Latest per-device storage and queue snapshot observed in each hour.
-- Queue counts are metadata only; no job contents or message payloads are read.
CREATE TABLE device_usage_hourly (
  bucket_start TIMESTAMPTZ NOT NULL,
  resource_key TEXT NOT NULL,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  session_storage_bytes BIGINT CHECK (session_storage_bytes >= 0),
  queue_waiting_count INTEGER CHECK (queue_waiting_count >= 0),
  queue_active_count INTEGER CHECK (queue_active_count >= 0),
  queue_delayed_count INTEGER CHECK (queue_delayed_count >= 0),
  queue_failed_count INTEGER CHECK (queue_failed_count >= 0),
  dead_letter_count INTEGER CHECK (dead_letter_count >= 0),
  sampled_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_start, resource_key),
  CHECK (resource_key LIKE 'device:%')
);

CREATE INDEX device_usage_hourly_tenant_idx
  ON device_usage_hourly (tenant_id, bucket_start DESC) WHERE tenant_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON device_usage_hourly TO koneva_application;

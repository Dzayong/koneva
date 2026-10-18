-- Coarse hourly resource rollups only; no phone numbers, message content, or raw container IDs.
CREATE TABLE resource_usage_hourly (
  bucket_start TIMESTAMPTZ NOT NULL,
  resource_key TEXT NOT NULL,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('device', 'shared')),
  service TEXT,
  cpu_percent_sum NUMERIC(18, 4) NOT NULL CHECK (cpu_percent_sum >= 0),
  memory_usage_bytes_sum NUMERIC(24, 0) NOT NULL CHECK (memory_usage_bytes_sum >= 0),
  memory_usage_bytes_max BIGINT NOT NULL CHECK (memory_usage_bytes_max >= 0),
  memory_limit_bytes_max BIGINT NOT NULL CHECK (memory_limit_bytes_max >= 0),
  sample_count INTEGER NOT NULL CHECK (sample_count > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_start, resource_key),
  CHECK ((kind = 'device' AND device_id IS NOT NULL AND service IS NULL)
      OR (kind = 'shared' AND device_id IS NULL AND tenant_id IS NULL AND service IS NOT NULL))
);

CREATE INDEX resource_usage_hourly_tenant_idx
  ON resource_usage_hourly (tenant_id, bucket_start DESC) WHERE tenant_id IS NOT NULL;
CREATE INDEX resource_usage_hourly_kind_idx
  ON resource_usage_hourly (kind, service, bucket_start DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON resource_usage_hourly TO koneva_application;

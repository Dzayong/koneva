ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS device_key VARCHAR(32) REFERENCES devices(device_key) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS api_keys_device_idx
  ON api_keys (tenant_id, device_key, created_at DESC)
  WHERE device_key IS NOT NULL;

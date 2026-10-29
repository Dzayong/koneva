-- Enforce at most one active (non-revoked) API key per device per workspace.
-- Expired keys are cleaned separately; revoked_at IS NULL is the active filter.
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_one_active_per_device
  ON api_keys (tenant_id, device_key)
  WHERE device_key IS NOT NULL AND revoked_at IS NULL;

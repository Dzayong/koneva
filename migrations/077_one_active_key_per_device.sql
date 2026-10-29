-- Enforce at most one active (non-revoked) API key per device per workspace.
-- First revoke older duplicates so the unique index can be created cleanly.
WITH duplicates AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY tenant_id, device_key ORDER BY created_at DESC
  ) AS rn
  FROM api_keys
  WHERE device_key IS NOT NULL AND revoked_at IS NULL
)
UPDATE api_keys SET revoked_at = now()
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS api_keys_one_active_per_device
  ON api_keys (tenant_id, device_key)
  WHERE device_key IS NOT NULL AND revoked_at IS NULL;

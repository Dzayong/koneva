-- Step 1 of 2 for removing the legacy static tenant API key (owner decision 2026-10-02: no grace
-- period, full removal). Makes the column nullable so new tenants are created without one and a
-- migrated tenant's value can be cleared; the UNIQUE constraint is kept (multiple NULLs are allowed
-- under UNIQUE in Postgres). Step 2, scripts/drop-legacy-api-key-column.ts, is a deliberate owner-run
-- script, NOT a numbered migration — it must only run after every tenant is confirmed cut over.
ALTER TABLE tenants ALTER COLUMN api_key DROP NOT NULL;

COMMENT ON COLUMN tenants.api_key IS
  'Deprecated legacy static API key, no longer issued or authenticated. Cleared (NULL) by '
  'scripts/migrate-legacy-api-keys.ts during cutover; dropped entirely by scripts/drop-legacy-api-key-column.ts '
  'once every tenant is migrated to a scoped api_keys (wgk_) row.';

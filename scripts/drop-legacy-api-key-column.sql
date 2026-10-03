-- Step 2 of 2: drop the legacy static tenant API key column entirely. Run only via
-- scripts/drop-legacy-api-key-column.ts (NOT part of the automatic migrations/ sweep). Self-guarding:
-- refuses (whole statement batch rolls back) if ANY tenant still has a non-null api_key, so this can
-- never silently cut a tenant off in production. Run scripts/migrate-legacy-api-keys.ts cutover
-- --execute for every remaining tenant first; it clears a tenant's api_key only once it already has a
-- scoped key. On a fresh/disposable database with no tenants yet, the guard is trivially satisfied.
DO $$
DECLARE remaining INT;
BEGIN
  SELECT count(*) INTO remaining FROM tenants WHERE api_key IS NOT NULL;
  IF remaining > 0 THEN
    RAISE EXCEPTION 'Refusing to drop tenants.api_key: % tenant(s) still have a static key. Run scripts/migrate-legacy-api-keys.ts cutover --execute for all of them first.', remaining;
  END IF;
END $$;

ALTER TABLE tenants DROP COLUMN IF EXISTS api_key;

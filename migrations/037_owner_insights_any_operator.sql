-- Replace the hard-coded email gate on owner:insights with a proper is_owner flag.
-- Any operator provisioned with owner:insights is marked as Owner; staff cannot hold that permission.
ALTER TABLE operators ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT false;

-- Migrate the existing hard-coded owner (if present) to the flag.
UPDATE operators SET is_owner = true
WHERE email = 'koneva.id26@gmail.com' AND 'owner:insights' = ANY(permissions)
  AND NOT is_owner;

ALTER TABLE operators DROP CONSTRAINT IF EXISTS operators_permissions_check;
ALTER TABLE operators ADD CONSTRAINT operators_permissions_check CHECK (
  permissions <@ ARRAY[
    'payments:read','payments:confirm','students:read','students:decide',
    'workspaces:read','audit:read','owner:insights'
  ]::text[]
  AND ('owner:insights' <> ALL(permissions) OR is_owner)
);

-- Add a read-only, owner-only permission to the existing Operator permission set.
ALTER TABLE operators DROP CONSTRAINT operators_permissions_check;
ALTER TABLE operators ADD CONSTRAINT operators_permissions_check CHECK (
  permissions <@ ARRAY[
    'payments:read','payments:confirm','students:read','students:decide',
    'workspaces:read','audit:read','owner:insights'
  ]::text[]
  AND ('owner:insights' <> ALL(permissions) OR email = 'koneva.id26@gmail.com')
  AND (email <> 'koneva.id26@gmail.com' OR permissions @> ARRAY[
    'payments:read','payments:confirm','students:read','students:decide',
    'workspaces:read','audit:read','owner:insights'
  ]::text[])
) NOT VALID;

-- The account provisioned for the system owner is the only account automatically granted platform insights.
-- Staff operators remain on their existing operational permissions.
UPDATE operators
SET permissions = ARRAY(
  SELECT DISTINCT permission
  FROM unnest(operators.permissions || ARRAY[
    'payments:read','payments:confirm','students:read','students:decide',
    'workspaces:read','audit:read','owner:insights'
  ]::text[]) AS permission
  ORDER BY permission
)
WHERE email = 'koneva.id26@gmail.com';

ALTER TABLE operators VALIDATE CONSTRAINT operators_permissions_check;

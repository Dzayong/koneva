-- Access model: Owner + Developer for customers. Legacy `admin`/`viewer` memberships keep working (nothing is silently
-- upgraded or downgraded) but cannot be created any more. Invitations are Gmail-only and need an emailed OTP to accept.

-- 1. One owner per workspace. Fails with a readable message if old data already has two, so the owner can decide which one stays.
DO $$
DECLARE dup RECORD;
BEGIN
  SELECT tenant_id, count(*) AS n INTO dup FROM memberships WHERE role = 'owner' GROUP BY tenant_id HAVING count(*) > 1 LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Workspace % has % owners; resolve manually (see docs/ROLES.md) before migrating', dup.tenant_id, dup.n;
  END IF;
END $$;
CREATE UNIQUE INDEX memberships_one_owner_idx ON memberships (tenant_id) WHERE role = 'owner';

-- 2. No NEW legacy memberships. Existing rows are untouched; a no-op update of a legacy row is still allowed.
CREATE FUNCTION forbid_new_legacy_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role IN ('admin', 'viewer') AND (TG_OP = 'INSERT' OR NEW.role IS DISTINCT FROM OLD.role) THEN
    RAISE EXCEPTION 'role % can no longer be assigned; use owner or developer', NEW.role USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER memberships_no_new_legacy_role BEFORE INSERT OR UPDATE OF role ON memberships
FOR EACH ROW EXECUTE FUNCTION forbid_new_legacy_membership();

-- 3. Invitations: pending legacy-role invitations are revoked (they would create legacy memberships); new ones must be
--    developer + a normalised gmail.com address. Old accepted/revoked rows are left as they are.
UPDATE invitations SET revoked_at = now() WHERE role IN ('admin', 'viewer') AND accepted_at IS NULL AND revoked_at IS NULL;
-- Pending invitations to non-Gmail addresses cannot pass the new rule either.
UPDATE invitations SET revoked_at = now() WHERE email NOT LIKE '%@gmail.com' AND accepted_at IS NULL AND revoked_at IS NULL;
CREATE FUNCTION check_new_invitation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role <> 'developer' THEN RAISE EXCEPTION 'invitations can only grant the developer role' USING ERRCODE = '23514'; END IF;
  IF NEW.email <> lower(btrim(NEW.email)) OR NEW.email !~ '^[^@\s]+@gmail\.com$' THEN
    RAISE EXCEPTION 'invitations are limited to normalised gmail.com addresses' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invitations_new_rules BEFORE INSERT ON invitations FOR EACH ROW EXECUTE FUNCTION check_new_invitation();

-- 4. Proof of mailbox ownership before an invitation can be accepted. Only a keyed hash of the code is stored.
CREATE TABLE invitation_otps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invitation_id UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  code_hash CHAR(64) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX invitation_otps_invitation_idx ON invitation_otps (invitation_id, created_at DESC);

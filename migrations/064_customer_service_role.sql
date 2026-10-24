-- Customer service accounts are intentionally restricted to Inbox access.
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check
  CHECK (role IN ('owner', 'admin', 'developer', 'viewer', 'cs'));

ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_role_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_role_check
  CHECK (role IN ('admin', 'developer', 'viewer', 'cs'));

CREATE OR REPLACE FUNCTION check_new_invitation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role NOT IN ('developer', 'cs') THEN
    RAISE EXCEPTION 'invitations can only grant developer or cs roles' USING ERRCODE = '23514';
  END IF;
  IF NEW.email <> lower(btrim(NEW.email)) OR NEW.email !~ '^[^@\s]+@gmail\.com$' THEN
    RAISE EXCEPTION 'invitations are limited to normalised gmail.com addresses' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

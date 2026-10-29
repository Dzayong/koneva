-- CS access is explicit; existing CS accounts start with no assigned devices.
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS device_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS device_ids uuid[] NOT NULL DEFAULT '{}';

-- Private media retention is chosen independently for each linked WhatsApp device.
-- NULL means keep media until the user removes the device/workspace; allowed day values keep the UI simple.
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS media_retention_days INTEGER DEFAULT 30;

ALTER TABLE devices
  DROP CONSTRAINT IF EXISTS devices_media_retention_days_check;

ALTER TABLE devices
  ADD CONSTRAINT devices_media_retention_days_check
  CHECK (media_retention_days IS NULL OR media_retention_days IN (1, 7, 30, 90));

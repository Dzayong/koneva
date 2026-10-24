-- Let each device opt in or out of the visible WhatsApp composing indicator.
-- Keep the existing behavior for all devices when this migration is applied.
ALTER TABLE device_personas
  ADD COLUMN IF NOT EXISTS typing_enabled BOOLEAN NOT NULL DEFAULT true;

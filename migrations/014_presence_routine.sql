-- Presence routine: the number "opens WhatsApp" when a message arrives (random 1-200 s), reads it
-- after another random pause, then goes offline again. Bounds are per number.
ALTER TABLE device_personas ADD COLUMN IF NOT EXISTS presence_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE device_personas ADD COLUMN IF NOT EXISTS presence_min_ms INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE device_personas ADD COLUMN IF NOT EXISTS presence_max_ms INTEGER NOT NULL DEFAULT 200000;

-- 'urgent' messages (e.g. OTP) bypass pacing and use their own queue; always_on lets a
-- number send and reply at any hour instead of keeping human active hours.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS priority VARCHAR(10) NOT NULL DEFAULT 'normal';
DO $$ BEGIN
  ALTER TABLE messages ADD CONSTRAINT messages_priority_chk CHECK (priority IN ('normal', 'urgent'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE device_personas ADD COLUMN IF NOT EXISTS always_on BOOLEAN NOT NULL DEFAULT false;

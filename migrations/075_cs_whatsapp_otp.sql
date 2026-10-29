-- CS invitations verify identity via WhatsApp OTP instead of email.
-- The phone column stores the CS's WhatsApp number for OTP delivery.
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS phone varchar(20);

-- Relax the Gmail-only constraint: CS invitations accept any email + require phone.
CREATE OR REPLACE FUNCTION check_new_invitation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role NOT IN ('developer', 'cs') THEN
    RAISE EXCEPTION 'invitations can only grant developer or cs roles' USING ERRCODE = '23514';
  END IF;
  IF NEW.role = 'cs' THEN
    IF NEW.phone IS NULL OR NEW.phone = '' THEN
      RAISE EXCEPTION 'CS invitations require a WhatsApp phone number' USING ERRCODE = '23514';
    END IF;
    IF NEW.email <> lower(btrim(NEW.email)) OR NEW.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'invitations require a valid email address' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.email <> lower(btrim(NEW.email)) OR NEW.email !~ '^[^@\s]+@gmail\.com$' THEN
      RAISE EXCEPTION 'invitations are limited to normalised gmail.com addresses' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

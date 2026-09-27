-- 1. Rolling-window counters for emailed OTPs, shared by all API processes. Keys are HMACs (never an email, IP or id in clear).
--    One row per accepted send (recipient / invitation / workspace / sender) or per accepted OTP request (ip).
CREATE TABLE otp_rate_events (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dim TEXT NOT NULL CHECK (dim IN ('recipient', 'invitation', 'workspace', 'sender', 'ip')),
  key CHAR(64) NOT NULL
);
CREATE INDEX otp_rate_events_lookup_idx ON otp_rate_events (dim, key, at DESC);
CREATE INDEX otp_rate_events_at_idx ON otp_rate_events (at);

-- 2. What is actually recorded when the sender budget gets tight. No email, no person, no address: counts and the cap only.
--    There is no alerting system yet: these rows (and one application log line each) are the whole signal.
CREATE TABLE otp_threshold_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL CHECK (kind IN ('sender_70_percent', 'sender_cap_reached')),
  window_count INTEGER NOT NULL,
  cap INTEGER NOT NULL
);
CREATE INDEX otp_threshold_events_idx ON otp_threshold_events (kind, at DESC);
CREATE FUNCTION immutable_otp_threshold_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'otp threshold events are append only'; END $$;
CREATE TRIGGER otp_threshold_events_immutable BEFORE UPDATE ON otp_threshold_events
FOR EACH ROW EXECUTE FUNCTION immutable_otp_threshold_events();

-- 3. Proof of mailbox ownership for workspace Owners (any email domain), needed before inviting or paying.
CREATE TABLE email_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash CHAR(64) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX email_verifications_user_idx ON email_verifications (user_id, created_at DESC);

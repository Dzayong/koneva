-- User communication preferences: operational/security notices are always sent,
-- product updates and marketing are optional and default to opted-in at signup.
CREATE TABLE IF NOT EXISTS user_comm_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  product_updates BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Record every change for audit trail.
CREATE TABLE IF NOT EXISTS user_comm_preference_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_updates BOOLEAN NOT NULL,
  source VARCHAR(20) NOT NULL CHECK (source IN ('signup', 'settings', 'opt_out_reply')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_comm_pref_events_user_idx
  ON user_comm_preference_events (user_id, created_at DESC);

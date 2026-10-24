ALTER TABLE auto_reply_rules
  ADD COLUMN IF NOT EXISTS response_config JSONB NOT NULL
  DEFAULT '{"skill_ids": [], "variables": {}}'::jsonb;

ALTER TABLE auto_reply_rules
  ADD CONSTRAINT auto_reply_rules_response_config_object_chk
  CHECK (jsonb_typeof(response_config) = 'object');

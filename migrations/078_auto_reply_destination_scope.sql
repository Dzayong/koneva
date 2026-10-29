-- Allow auto-reply rules to target specific chat types.
-- Default 'group' preserves existing behaviour (only group chats trigger auto-replies).
ALTER TABLE auto_reply_rules
  ADD COLUMN IF NOT EXISTS destination_scope VARCHAR(10) NOT NULL DEFAULT 'group';

ALTER TABLE auto_reply_rules
  DROP CONSTRAINT IF EXISTS auto_reply_rules_destination_scope_check;
ALTER TABLE auto_reply_rules
  ADD CONSTRAINT auto_reply_rules_destination_scope_check
  CHECK (destination_scope IN ('group', 'private', 'all'));

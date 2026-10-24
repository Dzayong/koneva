ALTER TABLE auto_reply_rules
  DROP CONSTRAINT IF EXISTS auto_reply_rules_response_type_check;

ALTER TABLE auto_reply_rules
  ADD CONSTRAINT auto_reply_rules_response_type_check
  CHECK (response_type IN ('text', 'template', 'ai', 'ai_general'));

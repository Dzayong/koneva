-- A customer may record WhatsApp opt-in captured by their own signup/checkout integration.
-- The API key holder attests to the displayed consent wording and supplies a durable evidence ID.
ALTER TABLE recipient_preferences
  DROP CONSTRAINT IF EXISTS recipient_preferences_source_check;
ALTER TABLE recipient_preferences
  ADD CONSTRAINT recipient_preferences_source_check
  CHECK (source IN ('manual', 'inbound_keyword', 'legacy_history', 'signup_api'));

ALTER TABLE recipient_consent_events
  DROP CONSTRAINT IF EXISTS recipient_consent_events_source_check;
ALTER TABLE recipient_consent_events
  ADD CONSTRAINT recipient_consent_events_source_check
  CHECK (source IN ('manual', 'inbound_keyword', 'legacy_history', 'signup_api'));

ALTER TABLE recipient_consent_events
  DROP CONSTRAINT IF EXISTS recipient_consent_events_actor_kind_check;
ALTER TABLE recipient_consent_events
  ADD CONSTRAINT recipient_consent_events_actor_kind_check
  CHECK (actor_kind IN ('user', 'system', 'api_key'));

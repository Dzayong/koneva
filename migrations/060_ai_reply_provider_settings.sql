CREATE TABLE IF NOT EXISTS ai_reply_provider_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  settings_enc TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES operators(id) ON DELETE SET NULL
);

COMMENT ON TABLE ai_reply_provider_settings IS 'Owner-managed OpenAI-compatible AI provider settings; API key is AES-GCM encrypted by the application.';
GRANT SELECT, INSERT, UPDATE ON ai_reply_provider_settings TO koneva_application;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON ai_reply_provider_settings FROM koneva_application;

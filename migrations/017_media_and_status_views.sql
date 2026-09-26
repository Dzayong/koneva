-- Outbound media: the URL to fetch; `content` then holds the caption, `type` the media kind.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;

-- Who viewed a WhatsApp Status we posted, from the read receipts WhatsApp sends back.
-- Only people whose own "read receipts" setting is on show up, so a count is a lower bound.
CREATE TABLE IF NOT EXISTS status_views (
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  status_message_id VARCHAR(64) NOT NULL,
  viewer VARCHAR(40) NOT NULL,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, status_message_id, viewer)
);

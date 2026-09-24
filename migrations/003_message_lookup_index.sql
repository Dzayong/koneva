-- Speeds up the receipt listener's lookup by WhatsApp message id
-- (bot-container/queue.ts handleReceiptUpdate), which runs on every
-- delivery/read ack. Partial index since most rows have no wamid yet
-- (queued/failed messages never get one).
CREATE INDEX IF NOT EXISTS idx_messages_whatsapp_message_id
  ON messages (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

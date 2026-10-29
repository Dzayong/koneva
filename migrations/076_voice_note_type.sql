-- Voice notes (WhatsApp push-to-talk audio) are stored as type 'ptt' to
-- distinguish them from generic audio files.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check
  CHECK (type IN ('text', 'image', 'document', 'video', 'audio', 'ptt'));

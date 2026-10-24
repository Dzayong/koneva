-- PAYG queue settlement and worker guards use retry_count to associate a
-- reservation with the current manual retry attempt. Older personal databases
-- may predate the column even though migration 061 installed its trigger.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

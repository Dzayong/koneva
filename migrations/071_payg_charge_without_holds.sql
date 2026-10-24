-- PAYG now charges at enqueue time. A definite send failure refunds the debit;
-- an ambiguous outcome remains charged and is never silently re-sent.
LOCK TABLE wallet_accounts, message_wallet_reservations, wallet_ledger IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM wallet_accounts a
    LEFT JOIN (
      SELECT tenant_id, sum(amount_idr)::bigint AS outstanding_idr
      FROM message_wallet_reservations
      WHERE state IN ('reserved', 'uncertain')
      GROUP BY tenant_id
    ) r ON r.tenant_id = a.tenant_id
    WHERE a.reserved_idr <> COALESCE(r.outstanding_idr, 0)
  ) THEN
    RAISE EXCEPTION 'PAYG reserve totals do not reconcile; refusing to drop held balances';
  END IF;
END $$;

-- Convert existing holds into charges without touching available balance again.
INSERT INTO wallet_ledger(tenant_id,event_type,amount_idr,available_delta_idr,reserved_delta_idr,idempotency_key,message_id,attempt_no)
SELECT tenant_id,'charge',amount_idr,0,-amount_idr,
       'message:'||message_id||':'||attempt_no||':charge',message_id,attempt_no
FROM message_wallet_reservations
WHERE state IN ('reserved','uncertain')
ON CONFLICT (tenant_id,idempotency_key) DO NOTHING;

ALTER TABLE message_wallet_reservations DROP CONSTRAINT message_wallet_reservations_state_check;
UPDATE message_wallet_reservations
SET state='debited', resolved_at=NULL
WHERE state IN ('reserved','uncertain');
ALTER TABLE message_wallet_reservations
  ADD CONSTRAINT message_wallet_reservations_state_check CHECK (state IN ('debited','captured','released'));

UPDATE wallet_accounts SET reserved_idr=0, updated_at=now() WHERE reserved_idr <> 0;

DROP TRIGGER IF EXISTS messages_settle_wallet ON messages;
DROP FUNCTION IF EXISTS settle_message_wallet_reservation();

ALTER TABLE wallet_accounts DROP COLUMN reserved_idr;

CREATE FUNCTION settle_message_wallet_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r message_wallet_reservations%ROWTYPE;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.error_message IS NOT DISTINCT FROM NEW.error_message THEN
    RETURN NEW;
  END IF;

  SELECT * INTO r FROM message_wallet_reservations
    WHERE message_id=NEW.id AND attempt_no=COALESCE(NEW.retry_count,0)
    FOR UPDATE;
  IF NOT FOUND OR r.state <> 'debited' THEN RETURN NEW; END IF;

  IF NEW.status IN ('sent','delivered','read') THEN
    UPDATE message_wallet_reservations SET state='captured',resolved_at=now()
      WHERE message_id=NEW.id AND attempt_no=r.attempt_no;
  ELSIF NEW.status IN ('failed','blocked') AND NEW.error_message='delivery_uncertain' THEN
    -- Already charged at enqueue; retain the debit while the outcome is ambiguous.
    NULL;
  ELSIF NEW.status IN ('failed','blocked') THEN
    UPDATE message_wallet_reservations SET state='released',resolved_at=now()
      WHERE message_id=NEW.id AND attempt_no=r.attempt_no;
    UPDATE wallet_accounts SET available_idr=available_idr+r.amount_idr,updated_at=now()
      WHERE tenant_id=r.tenant_id;
    INSERT INTO wallet_ledger(tenant_id,event_type,amount_idr,available_delta_idr,reserved_delta_idr,idempotency_key,message_id,attempt_no)
      VALUES(r.tenant_id,'adjustment',r.amount_idr,r.amount_idr,0,
        'message:'||NEW.id||':'||r.attempt_no||':refund',NEW.id,r.attempt_no)
      ON CONFLICT(tenant_id,idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER messages_settle_wallet AFTER UPDATE OF status ON messages
  FOR EACH ROW EXECUTE FUNCTION settle_message_wallet_reservation();

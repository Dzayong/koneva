-- Immutable PAYG price snapshots and cumulative paid usage.
-- The tier used by a message is decided while its tenant wallet row is locked.
LOCK TABLE wallet_accounts, message_wallet_reservations, wallet_ledger IN ACCESS EXCLUSIVE MODE;

ALTER TABLE wallet_accounts
  ADD COLUMN lifetime_spent_idr bigint NOT NULL DEFAULT 0 CHECK (lifetime_spent_idr >= 0),
  ADD COLUMN lifetime_messages_charged bigint NOT NULL DEFAULT 0 CHECK (lifetime_messages_charged >= 0);

ALTER TABLE message_wallet_reservations
  ADD COLUMN billing_category varchar(24),
  ADD COLUMN unit_price_idr bigint,
  ADD COLUMN pricing_tier_code varchar(24),
  ADD COLUMN usage_before_idr bigint;

UPDATE message_wallet_reservations
SET billing_category='api',
    unit_price_idr=amount_idr,
    pricing_tier_code='legacy',
    usage_before_idr=0;

ALTER TABLE message_wallet_reservations
  ALTER COLUMN billing_category SET NOT NULL,
  ALTER COLUMN unit_price_idr SET NOT NULL,
  ALTER COLUMN pricing_tier_code SET NOT NULL,
  ALTER COLUMN usage_before_idr SET NOT NULL,
  ADD CONSTRAINT message_wallet_reservations_billing_category_check
    CHECK (billing_category IN ('api','auto_reply','ai_reply')),
  ADD CONSTRAINT message_wallet_reservations_unit_price_check CHECK (unit_price_idr >= 0),
  ADD CONSTRAINT message_wallet_reservations_usage_before_check CHECK (usage_before_idr >= 0);

ALTER TABLE wallet_ledger
  ADD COLUMN billing_category varchar(24),
  ADD COLUMN unit_price_idr bigint,
  ADD COLUMN pricing_tier_code varchar(24),
  ADD COLUMN usage_before_idr bigint,
  ADD CONSTRAINT wallet_ledger_billing_category_check
    CHECK (billing_category IS NULL OR billing_category IN ('api','auto_reply','ai_reply')),
  ADD CONSTRAINT wallet_ledger_unit_price_check CHECK (unit_price_idr IS NULL OR unit_price_idr >= 0),
  ADD CONSTRAINT wallet_ledger_usage_before_check CHECK (usage_before_idr IS NULL OR usage_before_idr >= 0);

UPDATE wallet_ledger l
SET billing_category=r.billing_category,
    unit_price_idr=r.unit_price_idr,
    pricing_tier_code=r.pricing_tier_code,
    usage_before_idr=r.usage_before_idr
FROM message_wallet_reservations r
WHERE l.message_id=r.message_id AND l.attempt_no=r.attempt_no;

UPDATE wallet_accounts a
SET lifetime_spent_idr=s.spent_idr,
    lifetime_messages_charged=s.messages_charged
FROM (
  SELECT tenant_id,COALESCE(sum(amount_idr),0)::bigint AS spent_idr,count(*)::bigint AS messages_charged
  FROM message_wallet_reservations
  WHERE state='captured'
  GROUP BY tenant_id
) s
WHERE s.tenant_id=a.tenant_id;

DROP TRIGGER IF EXISTS messages_settle_wallet ON messages;
DROP FUNCTION IF EXISTS settle_message_wallet_reservation();

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
      WHERE message_id=NEW.id AND attempt_no=r.attempt_no AND state='debited';
    IF FOUND THEN
      UPDATE wallet_accounts
      SET lifetime_spent_idr=lifetime_spent_idr+r.amount_idr,
          lifetime_messages_charged=lifetime_messages_charged+1,
          updated_at=now()
      WHERE tenant_id=r.tenant_id;
    END IF;
  ELSIF NEW.status IN ('failed','blocked') AND NEW.error_message='delivery_uncertain' THEN
    NULL;
  ELSIF NEW.status IN ('failed','blocked') THEN
    UPDATE message_wallet_reservations SET state='released',resolved_at=now()
      WHERE message_id=NEW.id AND attempt_no=r.attempt_no AND state='debited';
    IF FOUND THEN
      UPDATE wallet_accounts SET available_idr=available_idr+r.amount_idr,updated_at=now()
        WHERE tenant_id=r.tenant_id;
      INSERT INTO wallet_ledger(
        tenant_id,event_type,amount_idr,available_delta_idr,reserved_delta_idr,idempotency_key,message_id,attempt_no,
        billing_category,unit_price_idr,pricing_tier_code,usage_before_idr)
      VALUES(r.tenant_id,'adjustment',r.amount_idr,r.amount_idr,0,
        'message:'||NEW.id||':'||r.attempt_no||':refund',NEW.id,r.attempt_no,
        r.billing_category,r.unit_price_idr,r.pricing_tier_code,r.usage_before_idr)
      ON CONFLICT(tenant_id,idempotency_key) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER messages_settle_wallet AFTER UPDATE OF status ON messages
  FOR EACH ROW EXECUTE FUNCTION settle_message_wallet_reservation();

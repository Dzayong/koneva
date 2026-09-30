-- T1.5: explicit retention bookkeeping and database-enforced destructive-job boundaries.

-- This NOLOGIN role owns the SECURITY DEFINER deletion procedures below. The application
-- login must not be granted membership; a separately provisioned retention runner may be.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koneva_retention_executor') THEN
    CREATE ROLE koneva_retention_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSIF (SELECT rolcanlogin OR rolsuper FROM pg_roles WHERE rolname = 'koneva_retention_executor') THEN
    RAISE EXCEPTION 'koneva_retention_executor must remain NOLOGIN and NOSUPERUSER';
  END IF;
END $$;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS retention_purged_at TIMESTAMPTZ;
-- Existing deleted tenants start their policy clock at migration time; do not infer an old close date and delete early.
UPDATE tenants SET closed_at = now() WHERE status = 'deleted' AND closed_at IS NULL;
CREATE INDEX IF NOT EXISTS tenants_retention_close_idx
  ON tenants (closed_at, id) WHERE status = 'deleted' AND retention_purged_at IS NULL;
CREATE INDEX IF NOT EXISTS messages_retention_idx ON messages (created_at, id);
CREATE INDEX IF NOT EXISTS webhook_logs_retention_idx ON webhook_logs (created_at, id);
CREATE INDEX IF NOT EXISTS auto_reply_logs_retention_idx ON auto_reply_logs (created_at, id);
CREATE INDEX IF NOT EXISTS status_views_retention_idx ON status_views (viewed_at, device_id);
CREATE INDEX IF NOT EXISTS audit_log_retention_idx ON audit_log (created_at, id);

CREATE OR REPLACE FUNCTION stamp_tenant_closed_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.retention_purged_at IS NOT NULL AND current_user <> 'koneva_retention_executor' THEN
      RAISE EXCEPTION 'retention_purged_at is system-managed';
    END IF;
    IF NEW.status = 'deleted' THEN
      NEW.closed_at := now();
      NEW.retention_purged_at := NULL;
    ELSE
      NEW.closed_at := NULL;
      NEW.retention_purged_at := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.retention_purged_at IS DISTINCT FROM OLD.retention_purged_at
    AND current_user <> 'koneva_retention_executor' THEN
    RAISE EXCEPTION 'retention_purged_at is system-managed';
  END IF;
  IF NEW.status = 'deleted' AND OLD.status IS DISTINCT FROM 'deleted' THEN
    NEW.closed_at := now();
    NEW.retention_purged_at := NULL;
  ELSIF NEW.status IS DISTINCT FROM 'deleted' THEN
    NEW.closed_at := NULL;
    NEW.retention_purged_at := NULL;
  ELSIF NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
    RAISE EXCEPTION 'closed_at cannot be changed while a tenant remains deleted';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tenants_closed_at_stamp ON tenants;
CREATE TRIGGER tenants_closed_at_stamp BEFORE INSERT OR UPDATE OF status, closed_at, retention_purged_at ON tenants
FOR EACH ROW EXECUTE FUNCTION stamp_tenant_closed_at();

-- Snapshot invoice identity before workspace PII is removed. These are invoice records and follow the 10-year period.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_name_snapshot VARCHAR(255);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_email_snapshot VARCHAR(255);
UPDATE invoices i SET
  billing_name_snapshot = COALESCE(i.billing_name_snapshot, t.name),
  billing_email_snapshot = COALESCE(i.billing_email_snapshot, t.email)
FROM tenants t WHERE t.id = i.tenant_id
  AND (i.billing_name_snapshot IS NULL OR i.billing_email_snapshot IS NULL);

-- Invoice retention remains report-only in T1.5; no path is allowed to delete an invoice.
CREATE OR REPLACE FUNCTION guard_invoice_retention_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'invoice deletion is disabled; T1.5 is report-only for invoices';
END $$;
DROP TRIGGER IF EXISTS invoices_retention_delete_guard ON invoices;
CREATE TRIGGER invoices_retention_delete_guard BEFORE DELETE ON invoices
FOR EACH ROW EXECUTE FUNCTION guard_invoice_retention_delete();

-- Preserve append-only audit history during its 12-month retention window; only the named expiry job may remove old rows.
CREATE OR REPLACE FUNCTION immutable_operator_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_user = 'koneva_retention_executor'
    AND current_setting('koneva.retention_job', true) = 'security_logs_12mo'
    AND OLD.at < now() - interval '12 months' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'operator audit is append only except expired security_logs_12mo retention';
END $$;

CREATE OR REPLACE FUNCTION immutable_operator_security_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_user = 'koneva_retention_executor'
    AND current_setting('koneva.retention_job', true) = 'security_logs_12mo'
    AND OLD.at < now() - interval '12 months' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'operator security events are append only except expired security_logs_12mo retention';
END $$;

CREATE TABLE IF NOT EXISTS retention_job_runs (
  id BIGSERIAL PRIMARY KEY,
  job TEXT NOT NULL CHECK (job IN (
    'messages_90d','webhook_logs_30d','security_logs_12mo','closed_accounts_30d','invoices_10y')),
  mode TEXT NOT NULL CHECK (mode IN ('dry_run','execute')),
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','partial','failed')),
  cutoff_at TIMESTAMPTZ NOT NULL,
  candidate_counts JSONB NOT NULL DEFAULT '{}',
  oldest_eligible JSONB NOT NULL DEFAULT '{}',
  affected_counts JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error_code TEXT
);
CREATE INDEX IF NOT EXISTS retention_job_runs_job_time_idx ON retention_job_runs (job, started_at DESC);

-- Aggregate-only, read-only preview. No row identifiers or customer values leave the DB.
CREATE OR REPLACE FUNCTION retention_dry_run(p_job TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  utc_now TIMESTAMP := timezone('UTC', statement_timestamp());
  counts JSONB;
  cutoff_at TIMESTAMP WITH TIME ZONE;
BEGIN
  CASE p_job
    WHEN 'messages_90d' THEN
      cutoff_at := statement_timestamp() - interval '90 days';
      SELECT jsonb_build_object(
        'messages', (SELECT count(*) FROM public.messages WHERE created_at < cutoff_at AT TIME ZONE 'UTC'),
        'auto_reply_logs', (SELECT count(*) FROM public.auto_reply_logs WHERE created_at < cutoff_at AT TIME ZONE 'UTC'),
        'status_views', (SELECT count(*) FROM public.status_views WHERE viewed_at < statement_timestamp() - interval '90 days'),
        'unresolved_active_messages', (SELECT count(*) FROM public.messages WHERE created_at < cutoff_at AT TIME ZONE 'UTC' AND status IN ('queued','sending','quota_hold')),
        'oldest_message_utc', (SELECT to_char(min(created_at), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM public.messages WHERE created_at < cutoff_at AT TIME ZONE 'UTC'),
        'oldest_auto_reply_log_utc', (SELECT to_char(min(created_at), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM public.auto_reply_logs WHERE created_at < cutoff_at AT TIME ZONE 'UTC'),
        'oldest_status_view_utc', (SELECT to_char(min(viewed_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM public.status_views WHERE viewed_at < statement_timestamp() - interval '90 days')
      ) INTO counts;
    WHEN 'webhook_logs_30d' THEN
      cutoff_at := statement_timestamp() - interval '30 days';
      SELECT jsonb_build_object(
        'webhook_logs', (SELECT count(*) FROM public.webhook_logs WHERE created_at < (cutoff_at AT TIME ZONE 'UTC')),
        'oldest_webhook_log_utc', (SELECT to_char(min(created_at), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM public.webhook_logs WHERE created_at < (cutoff_at AT TIME ZONE 'UTC'))
      ) INTO counts;
    WHEN 'security_logs_12mo' THEN
      cutoff_at := statement_timestamp() - interval '12 months';
      SELECT jsonb_build_object(
        'operator_audit', (SELECT count(*) FROM public.operator_audit WHERE at < cutoff_at),
        'operator_security_events', (SELECT count(*) FROM public.operator_security_events WHERE at < cutoff_at),
        'audit_log', (SELECT count(*) FROM public.audit_log WHERE created_at < timezone('UTC', cutoff_at)),
        'oldest_utc', (SELECT to_char(min(event_at), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM (
          SELECT at AT TIME ZONE 'UTC' AS event_at FROM public.operator_audit WHERE at < cutoff_at
          UNION ALL SELECT at AT TIME ZONE 'UTC' FROM public.operator_security_events WHERE at < cutoff_at
          UNION ALL SELECT created_at AS event_at FROM public.audit_log WHERE created_at < timezone('UTC', cutoff_at)
        ) AS logs)
      ) INTO counts;
    WHEN 'closed_accounts_30d' THEN
      cutoff_at := statement_timestamp() - interval '30 days';
      SELECT jsonb_build_object(
        'closed_accounts', (SELECT count(*) FROM public.tenants WHERE status='deleted' AND closed_at <= cutoff_at AND retention_purged_at IS NULL),
        'accounts_with_active_messages', (SELECT count(DISTINCT t.id) FROM public.tenants t JOIN public.messages m ON m.tenant_id=t.id WHERE t.status='deleted' AND t.closed_at <= cutoff_at AND t.retention_purged_at IS NULL AND m.status IN ('queued','sending','quota_hold')),
        'accounts_with_active_commands', (SELECT count(DISTINCT t.id) FROM public.tenants t JOIN public.device_commands c ON c.tenant_id=t.id WHERE t.status='deleted' AND t.closed_at <= cutoff_at AND t.retention_purged_at IS NULL AND c.status IN ('queued','running')),
        'oldest_closed_utc', (SELECT to_char(min(closed_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM public.tenants WHERE status='deleted' AND closed_at <= cutoff_at AND retention_purged_at IS NULL)
      ) INTO counts;
    WHEN 'invoices_10y' THEN
      cutoff_at := statement_timestamp() - interval '10 years';
      SELECT jsonb_build_object(
        'invoices', (SELECT count(*) FROM public.invoices WHERE created_at < timezone('UTC', cutoff_at)),
        'oldest_invoice_utc', (SELECT to_char(min(created_at), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM public.invoices WHERE created_at < timezone('UTC', cutoff_at))
      ) INTO counts;
    ELSE
      RAISE EXCEPTION 'unknown retention dry-run job';
  END CASE;
  RETURN jsonb_build_object(
    'job', p_job,
    'generated_at_utc', to_char(utc_now, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'cutoff_utc', to_char(cutoff_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'counts', counts,
    'protected_invoice_candidates', (SELECT count(*) FROM public.invoices WHERE created_at < timezone('UTC', statement_timestamp() - interval '10 years'))
  );
END $$;

GRANT SELECT ON messages, auto_reply_logs, status_views, webhook_logs, operator_audit,
  operator_security_events, audit_log, tenants, invoices TO koneva_retention_executor;
GRANT DELETE ON operator_audit, operator_security_events, audit_log TO koneva_retention_executor;
REVOKE TRUNCATE ON invoices, operator_audit, operator_security_events, audit_log FROM PUBLIC;

CREATE OR REPLACE FUNCTION retention_delete_messages_90d(p_cutoff TIMESTAMPTZ, p_batch_size INTEGER DEFAULT 500) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE reply_n INTEGER; view_n INTEGER; message_n INTEGER; unresolved_n INTEGER;
BEGIN
  IF p_batch_size < 1 OR p_batch_size > 5000 THEN RAISE EXCEPTION 'batch size outside 1..5000'; END IF;
  IF p_cutoff < transaction_timestamp() - interval '90 days' - interval '1 minute'
    OR p_cutoff > transaction_timestamp() - interval '90 days' + interval '1 minute' THEN
    RAISE EXCEPTION 'messages_90d cutoff outside policy window';
  END IF;
  PERFORM pg_advisory_xact_lock(18192390, 1);
  PERFORM set_config('koneva.retention_job', 'messages_90d', true);
  DELETE FROM public.auto_reply_logs WHERE ctid IN (
    SELECT ctid FROM public.auto_reply_logs WHERE created_at < timezone('UTC', p_cutoff) ORDER BY created_at, ctid LIMIT p_batch_size
  );
  GET DIAGNOSTICS reply_n = ROW_COUNT;
  DELETE FROM public.status_views WHERE ctid IN (
    SELECT ctid FROM public.status_views WHERE viewed_at < p_cutoff ORDER BY viewed_at, ctid LIMIT p_batch_size
  );
  GET DIAGNOSTICS view_n = ROW_COUNT;
  DELETE FROM public.messages WHERE id IN (
    SELECT id FROM public.messages WHERE created_at < timezone('UTC', p_cutoff)
      AND status NOT IN ('queued','sending','quota_hold')
    ORDER BY created_at, id LIMIT p_batch_size
  );
  GET DIAGNOSTICS message_n = ROW_COUNT;
  SELECT count(*) INTO unresolved_n FROM public.messages
    WHERE created_at < timezone('UTC', p_cutoff) AND status IN ('queued','sending','quota_hold');
  RETURN jsonb_build_object('auto_reply_logs', reply_n, 'status_views', view_n, 'messages', message_n,
    'unresolved_active_messages', unresolved_n, 'status', CASE WHEN unresolved_n > 0 THEN 'partial' ELSE 'succeeded' END);
END $$;
ALTER FUNCTION retention_delete_messages_90d(TIMESTAMPTZ, INTEGER) OWNER TO koneva_retention_executor;
REVOKE ALL ON FUNCTION retention_delete_messages_90d(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retention_delete_messages_90d(TIMESTAMPTZ, INTEGER) TO koneva_retention_executor;

CREATE OR REPLACE FUNCTION retention_delete_webhook_logs_30d(p_cutoff TIMESTAMPTZ, p_batch_size INTEGER DEFAULT 500) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE deleted_n INTEGER;
BEGIN
  IF p_batch_size < 1 OR p_batch_size > 5000 THEN RAISE EXCEPTION 'batch size outside 1..5000'; END IF;
  IF p_cutoff < transaction_timestamp() - interval '30 days' - interval '1 minute'
    OR p_cutoff > transaction_timestamp() - interval '30 days' + interval '1 minute' THEN
    RAISE EXCEPTION 'webhook_logs_30d cutoff outside policy window';
  END IF;
  PERFORM pg_advisory_xact_lock(18192390, 2);
  DELETE FROM public.webhook_logs WHERE id IN (
    SELECT id FROM public.webhook_logs WHERE created_at < timezone('UTC', p_cutoff) ORDER BY created_at, id LIMIT p_batch_size
  );
  GET DIAGNOSTICS deleted_n = ROW_COUNT;
  RETURN jsonb_build_object('webhook_logs', deleted_n, 'status', 'succeeded');
END $$;
ALTER FUNCTION retention_delete_webhook_logs_30d(TIMESTAMPTZ, INTEGER) OWNER TO koneva_retention_executor;
REVOKE ALL ON FUNCTION retention_delete_webhook_logs_30d(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retention_delete_webhook_logs_30d(TIMESTAMPTZ, INTEGER) TO koneva_retention_executor;

CREATE OR REPLACE FUNCTION retention_delete_security_logs_12mo(p_cutoff TIMESTAMPTZ, p_batch_size INTEGER DEFAULT 500) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE audit_n INTEGER; security_n INTEGER; workspace_n INTEGER; run_n INTEGER;
BEGIN
  IF p_batch_size < 1 OR p_batch_size > 5000 THEN RAISE EXCEPTION 'batch size outside 1..5000'; END IF;
  IF p_cutoff < transaction_timestamp() - interval '12 months' - interval '1 minute'
    OR p_cutoff > transaction_timestamp() - interval '12 months' + interval '1 minute' THEN
    RAISE EXCEPTION 'security_logs_12mo cutoff outside policy window';
  END IF;
  PERFORM pg_advisory_xact_lock(18192390, 3);
  PERFORM set_config('koneva.retention_job', 'security_logs_12mo', true);
  DELETE FROM public.operator_audit WHERE id IN (
    SELECT id FROM public.operator_audit WHERE at < p_cutoff ORDER BY at, id LIMIT p_batch_size
  );
  GET DIAGNOSTICS audit_n = ROW_COUNT;
  DELETE FROM public.operator_security_events WHERE id IN (
    SELECT id FROM public.operator_security_events WHERE at < p_cutoff ORDER BY at, id LIMIT p_batch_size
  );
  GET DIAGNOSTICS security_n = ROW_COUNT;
  DELETE FROM public.audit_log WHERE id IN (
    SELECT id FROM public.audit_log WHERE created_at < timezone('UTC', p_cutoff) ORDER BY created_at, id LIMIT p_batch_size
  );
  GET DIAGNOSTICS workspace_n = ROW_COUNT;
  DELETE FROM public.retention_job_runs WHERE id IN (
    SELECT id FROM public.retention_job_runs WHERE started_at < p_cutoff ORDER BY started_at, id LIMIT p_batch_size
  );
  GET DIAGNOSTICS run_n = ROW_COUNT;
  RETURN jsonb_build_object('operator_audit', audit_n, 'operator_security_events', security_n,
    'audit_log', workspace_n, 'retention_job_runs', run_n, 'status', 'succeeded');
END $$;
ALTER FUNCTION retention_delete_security_logs_12mo(TIMESTAMPTZ, INTEGER) OWNER TO koneva_retention_executor;
REVOKE ALL ON FUNCTION retention_delete_security_logs_12mo(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retention_delete_security_logs_12mo(TIMESTAMPTZ, INTEGER) TO koneva_retention_executor;

CREATE OR REPLACE FUNCTION retention_delete_closed_accounts_30d(p_cutoff TIMESTAMPTZ, p_batch_size INTEGER DEFAULT 100) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE account RECORD; user_ids UUID[]; deleted_n INTEGER := 0; blocked_messages INTEGER := 0; blocked_commands INTEGER := 0;
BEGIN
  IF p_batch_size < 1 OR p_batch_size > 500 THEN RAISE EXCEPTION 'batch size outside 1..500'; END IF;
  IF p_cutoff < transaction_timestamp() - interval '30 days' - interval '1 minute'
    OR p_cutoff > transaction_timestamp() - interval '30 days' + interval '1 minute' THEN
    RAISE EXCEPTION 'closed_accounts_30d cutoff outside policy window';
  END IF;
  PERFORM pg_advisory_xact_lock(18192390, 4);
  PERFORM set_config('koneva.retention_job', 'closed_accounts_30d', true);
  SELECT count(DISTINCT t.id) INTO blocked_messages FROM public.tenants t
    WHERE t.status='deleted' AND t.closed_at <= p_cutoff AND t.retention_purged_at IS NULL
      AND EXISTS (SELECT 1 FROM public.messages m WHERE m.tenant_id=t.id AND m.status IN ('queued','sending','quota_hold'));
  SELECT count(DISTINCT t.id) INTO blocked_commands FROM public.tenants t
    WHERE t.status='deleted' AND t.closed_at <= p_cutoff AND t.retention_purged_at IS NULL
      AND EXISTS (SELECT 1 FROM public.device_commands c WHERE c.tenant_id=t.id AND c.status IN ('queued','running'));
  FOR account IN
    SELECT t.id FROM public.tenants t WHERE t.status='deleted' AND t.closed_at <= p_cutoff AND t.retention_purged_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.tenant_id=t.id AND m.status IN ('queued','sending','quota_hold'))
      AND NOT EXISTS (SELECT 1 FROM public.device_commands c WHERE c.tenant_id=t.id AND c.status IN ('queued','running'))
    ORDER BY t.closed_at, t.id LIMIT p_batch_size FOR UPDATE
  LOOP
    SELECT array_agg(user_id) INTO user_ids FROM public.memberships WHERE tenant_id=account.id;
    DELETE FROM public.student_email_outbox WHERE tenant_id=account.id;
    DELETE FROM public.student_requests WHERE tenant_id=account.id;
    DELETE FROM public.invitations WHERE tenant_id=account.id;
    DELETE FROM public.api_keys WHERE tenant_id=account.id;
    DELETE FROM public.recipient_consent_events WHERE tenant_id=account.id;
    DELETE FROM public.recipient_preferences WHERE tenant_id=account.id;
    DELETE FROM public.auto_reply_logs WHERE tenant_id=account.id;
    DELETE FROM public.messages WHERE tenant_id=account.id;
    DELETE FROM public.webhook_logs WHERE tenant_id=account.id;
    DELETE FROM public.device_commands WHERE tenant_id=account.id;
    DELETE FROM public.contacts WHERE tenant_id=account.id;
    DELETE FROM public.message_templates WHERE tenant_id=account.id;
    DELETE FROM public.auto_reply_rules WHERE tenant_id=account.id;
    DELETE FROM public.devices WHERE tenant_id=account.id;
    DELETE FROM public.subscriptions WHERE tenant_id=account.id;
    DELETE FROM public.memberships WHERE tenant_id=account.id;
    IF user_ids IS NOT NULL THEN
      DELETE FROM public.users u WHERE u.id = ANY(user_ids)
        AND NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id=u.id);
    END IF;
    UPDATE public.audit_log SET actor_id=NULL, actor_label='[account closed]', target_id=NULL, ip=NULL
      WHERE tenant_id=account.id;
    UPDATE public.tenants SET
      name = 'Closed workspace ' || left(id::text, 8), email = NULL,
      api_key = 'retired_' || uuid_generate_v4()::text,
      webhook_url = NULL, webhook_secret = NULL, student_note = NULL,
      retention_purged_at = statement_timestamp()
    WHERE id=account.id;
    deleted_n := deleted_n + 1;
  END LOOP;
  RETURN jsonb_build_object('closed_accounts_purged', deleted_n, 'blocked_active_messages', blocked_messages,
    'blocked_active_commands', blocked_commands,
    'status', CASE WHEN blocked_messages + blocked_commands > 0 THEN 'partial' ELSE 'succeeded' END);
END $$;
ALTER FUNCTION retention_delete_closed_accounts_30d(TIMESTAMPTZ, INTEGER) OWNER TO koneva_retention_executor;
REVOKE ALL ON FUNCTION retention_delete_closed_accounts_30d(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retention_delete_closed_accounts_30d(TIMESTAMPTZ, INTEGER) TO koneva_retention_executor;

GRANT SELECT ON messages, auto_reply_logs, status_views, webhook_logs, operator_audit,
  operator_security_events, audit_log, tenants, invoices, device_commands, memberships, users,
  student_email_outbox, student_requests, invitations, api_keys, recipient_consent_events,
  recipient_preferences, contacts, message_templates, auto_reply_rules, devices, subscriptions,
  retention_job_runs TO koneva_retention_executor;
GRANT INSERT, UPDATE ON retention_job_runs TO koneva_retention_executor;
GRANT USAGE, SELECT ON SEQUENCE retention_job_runs_id_seq TO koneva_retention_executor;
GRANT DELETE ON operator_audit, operator_security_events, audit_log, retention_job_runs,
  auto_reply_logs, status_views, messages, webhook_logs, student_email_outbox, student_requests,
  invitations, api_keys, recipient_consent_events, recipient_preferences, device_commands,
  contacts, message_templates, auto_reply_rules, devices, subscriptions, memberships, users TO koneva_retention_executor;
GRANT UPDATE (actor_id, actor_label, target_id, ip) ON audit_log TO koneva_retention_executor;
GRANT UPDATE (name, email, api_key, webhook_url, webhook_secret, student_note, retention_purged_at)
  ON tenants TO koneva_retention_executor;
REVOKE TRUNCATE ON invoices, operator_audit, operator_security_events, audit_log FROM PUBLIC;
ALTER FUNCTION retention_dry_run(TEXT) OWNER TO koneva_retention_executor;
REVOKE ALL ON FUNCTION retention_dry_run(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retention_dry_run(TEXT) TO koneva_retention_executor;

-- Each scheduler preview is stored atomically with aggregate counts only. Timestamp
-- fields are separated from counts so the report remains useful without storing PII.
CREATE OR REPLACE FUNCTION retention_persist_dry_run(p_job TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE report JSONB; counts JSONB; count_fields JSONB := '{}'::jsonb; oldest_fields JSONB := '{}'::jsonb;
  item RECORD; run_id BIGINT; started TIMESTAMPTZ := clock_timestamp(); run_status TEXT := 'succeeded';
BEGIN
  IF NOT pg_has_role(session_user, 'koneva_retention_executor', 'member') THEN
    RAISE EXCEPTION 'retention executor membership required';
  END IF;
  report := public.retention_dry_run(p_job);
  counts := report->'counts';
  FOR item IN SELECT key, value FROM jsonb_each(counts) LOOP
    IF jsonb_typeof(item.value) = 'number' THEN
      count_fields := count_fields || jsonb_build_object(item.key, item.value);
      IF item.value::text::numeric > 0 AND item.key LIKE 'unresolved_%' THEN run_status := 'partial'; END IF;
      IF item.value::text::numeric > 0 AND item.key LIKE 'accounts_with_%' THEN run_status := 'partial'; END IF;
    ELSIF item.key LIKE 'oldest_%' AND jsonb_typeof(item.value) IN ('string','null') THEN
      IF jsonb_typeof(item.value) = 'null' THEN CONTINUE; END IF;
      oldest_fields := oldest_fields || jsonb_build_object(item.key, item.value);
    ELSE
      RAISE EXCEPTION 'unexpected retention report field';
    END IF;
  END LOOP;
  count_fields := count_fields || jsonb_build_object('protected_invoice_candidates', report->'protected_invoice_candidates');
  INSERT INTO public.retention_job_runs(job,mode,status,cutoff_at,candidate_counts,oldest_eligible,started_at)
    VALUES (p_job,'dry_run','running',(report->>'cutoff_utc')::timestamptz,count_fields,oldest_fields,started)
    RETURNING id INTO run_id;
  UPDATE public.retention_job_runs SET status=run_status, completed_at=clock_timestamp(),
    duration_ms=LEAST(2147483647, GREATEST(0, (extract(epoch FROM (clock_timestamp()-started))*1000)::bigint))
    WHERE id=run_id;
  RETURN jsonb_build_object('run_id',run_id,'status',run_status,'report',report);
END $$;
ALTER FUNCTION retention_persist_dry_run(TEXT) OWNER TO koneva_retention_executor;
REVOKE ALL ON FUNCTION retention_persist_dry_run(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retention_persist_dry_run(TEXT) TO koneva_retention_executor;

COMMENT ON TABLE retention_job_runs IS 'Aggregate-only persisted database retention run history; backup rotation reports are persisted separately in a private local JSONL ledger.';
COMMENT ON FUNCTION guard_invoice_retention_delete() IS 'Invoice deletion is disabled in T1.5; invoices are dry-run/report-only pending a separate owner decision.';
COMMENT ON FUNCTION retention_dry_run(TEXT) IS 'Read-only, aggregate-only retention preview. Never returns row-level identifiers or PII.';

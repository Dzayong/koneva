# T1.5 — Data retention and deletion design

**Status:** Implementation complete locally and disposable tests pass on 2026-10-01. This is evidence for owner review, not production activation. No live scheduler or deletion job is installed.
**Owner-set periods:** message content/status 90 days; webhooks 30 days; security logs 12 months; closed-account data 30 days; invoices 10 years; backups 30 days.

## Goal and safety rules

Apply each retention period with an independently named job and explicit table allowlist. There must be no generic “delete old data” query, tenant-wide cascade, or job whose broad scope can include invoices by accident. All periods use UTC timestamps and are measured from the row's original event/creation/closure time, not from the day a cleanup first notices it.

`invoices` are a protected financial record. Only the dedicated invoice-retention job may consider them, and it may delete only invoices older than ten years. Message, webhook, security-log, backup, and closed-account jobs must not issue `DELETE` or cascading deletion against invoices. Every dry-run report must show invoice candidates as a separate protected count; the first implementation should report the ten-year candidates but leave invoice deletion disabled until the invoice/FK design has its own migration test and explicit review.

## Implementation result and remaining operational gaps

- Migration `026_data_retention.sql` defines isolated message/status/autoreply, webhook, security-log, and closed-account jobs. Message status history follows its FK cascade; old auto-reply records are deleted by their own creation time. Active queued/sending/quota-held messages and active device commands block their respective purge and remain visible as a `partial` run.
- Existing scheduled cleanup is narrowly scoped: operator sessions/challenges/login buckets/idempotency and OTP tables. Operator audit and security events are deliberately append-only and excluded. Device-command history has separate one-day / 30-day purges.
- The backup scripts are being updated in this T1.5 batch to a 30-day default dry-run. They archive PostgreSQL, Redis, and bot sessions; the personal backup also contains the local personal environment file. Local deletion is gated by an explicit `--execute` and operator-set environment attestations. S3/GCS rotation is refused because object versions, retention locks, soft-delete windows, and replication copies are not verified. Current cron without `--execute` reports candidates and does not delete them.
- Loki is configured for seven days. Whether Loki/runtime output counts as “security logs” is not yet defined. It cannot be described as a 12-month security log unless its retention and the events sent to it are changed and verified.
- `operator_audit` and `operator_security_events` retain append-only guards for ordinary roles; only narrowly scoped `SECURITY DEFINER` routines owned by the `NOLOGIN` executor can remove expired rows. `invoices.tenant_id` keeps the tenant tombstone, so account cleanup never deletes the tenant or invoices.
- Migration 026 stamps `closed_at` at the actual deleted-status transition; reopen clears it and a later close starts a new window. Direct rewriting while closed is rejected.
- No production cloud bucket/provider, object versioning, object lock, soft-delete, or replication configuration has been verified. Backup permanence is therefore a design requirement, not a currently proven property.

## Proposed independent jobs

| Job | Data scope and cutoff | Safety boundary |
|---|---|---|
| `messages_90d` | `messages` older than 90 days; `message_status_history` follows the message FK cascade; explicitly remove old `auto_reply_logs` by their own `created_at` because the FK otherwise preserves their recipient/response text; delete `status_views` older than 90 days. | Old `queued`, `sending`, or `quota_hold` work must first be cancelled/blocked in both DB and queue so stale content can never be sent after expiry. Report unresolved active rows and fail/alert rather than silently retaining or sending them. Never touch `invoices`. |
| `webhook_logs_30d` | `webhook_logs` older than 30 days, including request payload and response body. | Its own table and cutoff only. Do not delete webhook configuration/secrets as a side effect. Never touch `invoices`. |
| `security_logs_12mo` | Proposed DB audit scope: `operator_security_events`, `operator_audit`, and workspace `audit_log`, older than 12 months. | Preserve append-only behavior for normal roles. Retention deletion needs an explicitly privileged, audited mechanism; do not disable/drop immutable triggers as a shortcut. Decide whether `device_events` belongs here or in operational telemetry before implementation. Never touch `invoices`. |
| `closed_accounts_30d` | Account/workspace records whose closure timestamp is at least 30 days old, including user identity/authentication, sessions, memberships, contacts, devices, webhook credentials/configuration, student evidence, and consent data, subject to the approved legal record boundary. | Proposed approach: remove identifying and operational account data, revoke credentials, and retain only a non-identifying tenant tombstone as required by 10-year invoices/FKs and unexpired audit records. Do not hard-delete `tenants` while it would cascade into invoices. The precise minimum invoice identity fields to keep must be reviewed. |
| `invoices_10y` | Dedicated, separately scheduled job; candidates are invoices older than 10 years. | No shared helper or account cleanup may execute invoice deletion. Dry-run only by default; enable deletion only after the invoice archival/FK design and explicit review are proven in disposable migration tests. Retain invoice history for the full ten years. |
| `backup_rotation_30d` | Individual completed backup snapshots and all associated copies older than 30 days, including database dump, Redis/session archives, checksums, and provider-side historical versions. | Require a verified storage lifecycle that purges versions, replicas, and soft-deleted copies, with no object-lock/legal-hold period beyond 30 days. If the configured destination cannot prove permanent purge, backup execution or retention completion must fail visibly; a delete marker alone is not proof. Never delete a newer snapshot to satisfy rotation. |

Each execute invocation runs exactly one job through its fixed routine, with bounded 500-row passes and a per-job transaction advisory lock. Large jobs repeat passes up to 100 times and mark the run partial if work remains at the cap. The standalone runner refuses superusers and logins without membership in `koneva_retention_executor`; it never falls back to `DATABASE_URL`. The daily 03:00 UTC scheduler invokes all database jobs in dry-run mode only.

## Backup guarantee and privacy wording

Database snapshots contain copies of data that is still within its primary retention period. When a message is removed from the primary database at day 90, a snapshot made shortly before that deletion can still contain it. The proposed guarantee is: **that residual copy is permanently purged from every backup/version/replica no later than 30 days after the primary deletion**. This is a maximum 30-day backup residue after primary cleanup (up to roughly 120 days from message creation), not another 90-day retention period. Privacy wording must disclose the backup-residue window.

The 30-day permanent-purge wording is a future, conditional guarantee; it is not currently proven for any live storage destination. The local `BACKUP_LOCAL_PURGE_VERIFIED=true` gate is an operator attestation, not an automated volume-snapshot/replica check. Before enabling the 30-day production guarantee, verify actual provider settings: versioning and noncurrent-version deletion; object lock/retention holds; soft-delete/recycle retention; replication destinations; lifecycle execution lag; and whether restore copies reintroduce expired rows. A restore must run the same dry-run/retention cleanup before restored data becomes accessible or outbound workers start. If permanent purge cannot be established for a provider, do not claim the guarantee for that provider.

## Dry-run and activation gate

1. Each default invocation is dry-run and reports UTC cutoff, aggregate candidate counts, oldest eligible event time, protected invoice candidate count, and unresolved active work. The runner persists sanitized counts/timestamps/status/duration in `retention_job_runs`; private backup ledgers record backup counts/mode/status without paths or filenames.
2. Database reports store no identifiers or customer values. `security_logs_12mo` separately ages out report rows after 12 months. Backup JSONL ledgers are owner-only files and are rotated separately after 90 days.
3. Execute mode requires one explicit job, `--execute`, and both `RETENTION_DELETE_ENABLED=true` and `RETENTION_LIVE_DELETE_APPROVED=true`. The scheduler rejects execute mode and always runs dry-run. These gates are not configured for production by this task.
4. Dry-run and execute use the same cutoff/query builder so their candidate counts are comparable. Execute reports attempted, deleted, skipped, and failed counts. Any unexpected table, schema, or provider setting causes a fail-closed result.
5. Invoice dry-run is shown separately and cannot be included in an “all cleanup” execute command.

## Monitoring and acceptance evidence

Per job, record last start/success, duration, cutoff, candidate/deleted/skipped/error counts, and oldest eligible row. Alert when a scheduled job misses two intervals, a dry-run shows an unexpected spike, eligible rows continue to age beyond the policy, active expired messages cannot be cancelled, backup versions remain past 30 days, or an invoice appears in any non-invoice job's affected-row count. Monitor storage lifecycle lag and verify an expired backup is absent from current and historical object versions. Alerts must not include row PII.

Acceptance requires disposable-PostgreSQL tests for cutoff boundaries, tenant isolation, batch/idempotence, every table allowlist, account closure with invoices preserved, append-only audit retention, and “invoice never deleted by non-invoice jobs”; backup tests must verify removal of object versions/replicas or report provider-specific limits. Run dry-run twice against seeded synthetic data and compare counts before any destructive mode is enabled. No production DB or real customer data is part of T1.5 verification.

## Review gates found during implementation

- The `koneva.retention_job` setting is caller-settable, so it is not an authority by itself. Migration 026 now requires both the internal marker and `current_user = 'koneva_retention_executor'`; only narrowly scoped `SECURITY DEFINER` routines owned by this `NOLOGIN` role can set that context. `retention_dry_run` is also restricted to that role. A separate runner login must be explicitly granted membership; the application login must not be a member, table owner, or superuser. Disposable tests prove an ordinary role with direct `DELETE` grants cannot forge the marker or invoke these routines. Production execution remains disabled until deployment role ownership/membership is verified.
- The closure timestamp is protected from direct rewrites while a tenant remains deleted. Closure starts only on the status transition; reopening clears the clock and a later close starts a new period. These transitions and attempts to rewrite the timestamp are tested in disposable PostgreSQL.
- The new closure timestamp is `TIMESTAMPTZ`; legacy business timestamps are `TIMESTAMP WITHOUT TIME ZONE`. UTC cutoffs/oldest timestamps were checked under PostgreSQL sessions in `America/Los_Angeles` and `Asia/Jakarta`, with the scheduler clock also tested under `TZ=Asia/Jakarta`.
- DB dry-runs for all five categories are durably persisted. Backup dry-run/blocked/execute attempts use private, fsynced JSONL records with aggregate counts and no paths or filenames.
- Disposable tests run the separate runner login and execute message, webhook, and closed-account jobs against synthetic rows. Security-log cleanup is also exercised. Invoice deletion is always blocked.

## Approved implementation boundaries

1. For this implementation, “security logs” means the three DB tables `operator_security_events`, `operator_audit`, and `audit_log`. `device_events` and Loki/runtime output remain operational telemetry and are not claimed to meet the 12-month security-log policy. Loki's current seven-day setting is documented as a gap to reconcile before making a broader claim.
2. After 30 days, remove identifying and operational account data while preserving a tenant tombstone needed by invoice foreign keys and unexpired audit rows. Invoice billing name/email snapshots are the only customer identity retained with the invoice record; current invoices are not deleted by this task.
3. Backup wording targets a maximum 30-day residue after a primary row is deleted (up to about 120 days from message creation under the 90-day message policy). Local file rotation is implemented behind dry-run and explicit gates, but its backing-volume snapshot/replica proof remains an operator attestation. Cloud rotation remains fail-closed until provider version/replica/hold/soft-delete purge is verified.
4. The ten-year invoice job is report-only. No invoice rows are deleted in T1.5; any future proposal needs a separate explicit owner decision and dedicated deletion review.

## Verification and next gates

`bash scripts/test-data-retention.sh` applies migrations 001-026 from scratch to a fresh labelled disposable PostgreSQL container. It verifies privilege boundaries, marker forgery denial, `closed_at`, timezone behavior, scheduler time calculation, persisted aggregate-only reports, disabled-gate refusal, synthetic deletes, active/fresh-data protection, account anonymization, audit scrubbing, and invoice snapshot/FK preservation. `bash scripts/test-backup-retention.sh` covers default dry-run, private persistence, concurrent append, blocked execute, incomplete snapshots, and cloud fail-closed behavior.

After owner review and explicit approval, the next operational step is a multi-day synthetic retention exercise in the sandbox at `:13200`. That test must continue to use disposable data and must not point at production credentials. Only after its evidence is reviewed may the owner decide whether to discuss a separate `:13000` deployment gate. T1.5 completion itself does not activate any production deletion.

## Separate rough estimates

- Table-specific database deletion and safe account/tombstone/FK handling: **implemented and locally verified**.
- Backup 30-day lifecycle and permanent-generation purge verification: **local rotation implemented; provider/volume permanence remains unverified and cloud stays blocked**.
- Dry-run report, execute gate, and comparable counts: **implemented locally**.
- Monitoring alerts/dashboard, deployed scheduler wiring, live sandbox exercise, and runbook acceptance: **remaining operational work**.

Estimates exclude production rollout, legal review, and provider onboarding. Database/backup code paths are complete locally; operational proof remains a separate approval-gated task. Production deletion stays disabled.

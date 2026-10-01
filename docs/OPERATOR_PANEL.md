# Operator panel: backend contract review and local implementation

Reviewed 2026-09-26 against `dashboard/docs/operator-panel-contract.md`, revision 2, and the owner's follow-up decisions.
The frontend proposal and all existing dashboard files were preserved. This document records the backend decisions.

Status: implemented and tested for **isolated local use** (unit + STACK-local + real-entrypoint + browser). After the operational hardening stage this is a **candidate ready for owner review**, not permission to enable it. Disabled by default. MFA (TOTP) is
implemented and mandatory for every operator sign-in. **Local-tested is not production-ready**: production still needs the
checklist under "Remaining operational work". No deployment, production migration, real account provisioning, WhatsApp activity, DOKU integration, or
commit was performed. Manual payment confirmation only records an operator's decision; it does not contact a payment provider.

## Contract decisions

| Topic | Accepted backend behavior |
|---|---|
| Login | Option A: exact configured Origin, `Sec-Fetch-Site: same-origin` when present, JSON and `X-Requested-With: koneva-operator`. No operator CORS. |
| Identity | Separate `operators` and `operator_sessions`; tenant bearer/API keys and `ADMIN_API_KEY` cannot authenticate `/operator`. No automatic operator accounts. |
| Cookies | Default `__Host-koneva_op`, Secure, HttpOnly, Strict, Path=/, no Domain. Weak local cookies require explicit non-production opt-in. |
| Sessions | Hash-only stored session credential; 30-minute idle, touch at most once/minute, eight-hour absolute cap. Login rotates the supplied old operator session. CSRF derived from the session credential; not persisted in browser storage. |
| Revocation | Logout, revoke-all, password change and account disablement. Credential/disable updates revoke sessions with a DB trigger. Permissions are read fresh and checked again within sensitive transactions. |
| MFA | TOTP (RFC 6238, SHA-1, 6 digits, 30 s, ±1 step) is required at every sign-in, in every environment; there is no switch to disable it. The password step returns only a short-lived (5 min) challenge, never a session. A code step already used is refused (`mfa_last_step`). See "MFA" below. |
| Reauthentication | Required after 15 minutes for payment/student decisions. `REAUTH_REQUIRED` is returned before side effects. Sign in again (password **and** MFA) via `/auth/login`; existing idempotency scope is operator identity, not session. |
| Login throttling | Durable 15-minute buckets: five attempts/email, 30/IP (including successful attempts), then `429` with `Retry-After`. Bucket values are hashed; no raw IP/email in the throttle table. |
| Idempotency | Required UUID v4 key for **both** mutations. Scoped by operator/operation/target/key, canonical payload hash, exact stored successful response. Same payload replay has `Idempotent-Replay: true`; changed payload is `409`. In-flight lock returns `REQUEST_IN_PROGRESS` with `Retry-After: 2`. Retained indefinitely for now (at least 72 hours). |
| Pending/unknown result | Timeouts, aborts and proxy/redirect errors cannot establish the outcome. Retry identical key + payload or re-read the invoice/request. Server never intentionally redirects. |
| Audit failure | `500 AUDIT_FAILED` includes `details: {rolled_back:true}` **only after successful rollback before COMMIT**. Failed COMMIT or failed rollback returns `503 OUTCOME_UNKNOWN`, never a definite failure marker. |
| References | Unique among paid invoices by `(lower(btrim(method)), lower(btrim(reference)))`. `btrim` removes ordinary edge spaces, not internal whitespace. Empty reference becomes null. No punctuation stripping. Conflict returns `DUPLICATE_REFERENCE` with the existing invoice number. |
| Payment methods | `transfer`, `ewallet`, `qris`, `tunai`, `lainnya`, matching the current frontend. These are labels for manual payments only. |
| Versions/concurrency | Expected amount/version checked while locked. DB trigger bumps invoice version for legacy writes too. Workspace lock serializes subscription changes across different invoices; only one pending decision can win. |
| Student data | List: masked email/domain/hint/status/workspace/version/time only. Full requester email, submitted note and decision reason only in detail. No uploads. Academic domain is a hint, never proof. New submissions supersede old pending records and retain history. Reject does not revoke prior approved entitlement. |
| Audit privacy | Only server writes immutable audit, within the business transaction. Status/method/version changes are allowlisted. Student notes, decision reason free text, payment note/reference, emails and secrets are not copied into audit. The optional audit `reason` field is null in this MVP. |
| Dates | API accepts explicit-zone ISO timestamps: `at >= from AND at < to`, maximum 90 days. Default end now/start 30 days earlier. WIB dates must be converted by the frontend to UTC midnight boundaries. Legacy billing timestamps are serialized with an explicit UTC zone, including nested DTOs. |
| Pagination | Stable descending timestamp + id, default 25, max 100, offset 0..1,000,000. Count/page share a read-only repeatable-read snapshot; pages requested at different times can change. Mutations always use ID/version. |
| Response privacy | Explicit columns; no-store + Vary Cookie on all operator responses, including errors. Operator parser and errors do not enter generic request-error logging. Admin tenant/device lists also use explicit safe columns. |

## Endpoints

The request and response DTOs in the frontend proposal apply, with the decisions above. Success is
`{success:true,data,pagination?}`, errors are `{success:false,error:{code,message,details?}}`; `204` has no body.

| Method/path (backend) | Permission |
|---|---|
| `POST /operator/auth/login` | Bootstrap Origin/JSON/custom-header checks. Returns `{status:"mfa_required"\|"mfa_enrollment_required", challenge_id, expires_in}`; never a cookie |
| `POST /operator/auth/mfa/verify` | Same bootstrap checks. `{challenge_id, code}` or `{challenge_id, recovery_code}`; success sets the cookie and returns `{status:"authenticated", operator, permissions, csrf_token, session, recovery_codes_remaining}` |
| `POST /operator/auth/mfa/enroll/start` | `{challenge_id, enrollment_code?}` (code needed for first enrollment); returns `{secret, otpauth_uri}` |
| `POST /operator/auth/mfa/enroll/confirm` | `{challenge_id, code}`; success sets the cookie and returns the session plus 10 `recovery_codes` (shown once) |
| `GET /operator/me` | Operator session |
| `POST /operator/auth/logout` | Operator session + Origin + CSRF; 204 |
| `POST /operator/auth/sessions/revoke-all` | Same; revokes all own sessions, 204 |
| `POST /operator/auth/password` | Same + `{current_password,new_password}`; revokes all own sessions, 204 |
| `GET /operator/invoices`, `GET /operator/invoices/:id` | `payments:read` |
| `POST /operator/invoices/:id/confirm-payment` | `payments:confirm` + recent login + Origin + CSRF + idempotency |
| `GET /operator/student-requests`, `GET /operator/student-requests/:id` | `students:read` |
| `POST /operator/student-requests/:id/decision` | `students:decide` + recent login + Origin + CSRF + idempotency |
| `GET /operator/workspaces`, `GET /operator/workspaces/:id` | `workspaces:read` |
| `GET /operator/audit` | `audit:read` |
| `GET /operator/alerts/otp` | `audit:read` (OTP sender-budget alerts, read only, see "OTP sender-budget alerts") |
| `GET /operator/insights` | `owner:insights` (owner-only aggregate snapshot; every successful view is recorded in `operator_audit`; read-only, see [OWNER_INSIGHTS.md](OWNER_INSIGHTS.md)) |

Audit actions: `invoice.confirm_payment`, `student_request.decision`. Audit target types: `invoice`, `student_request`.
Student/workspace missing errors: `REQUEST_NOT_FOUND`, `WORKSPACE_NOT_FOUND`. Disabled module: `404 OPERATOR_DISABLED`.
Invalid JSON/IDs/filters/body/key: `400 VALIDATION_ERROR` with a generic message, never the submitted values.

The existing dashboard rewrite `/api/operator/* -> /operator/*` is unchanged. There is no separate reauth endpoint:
reauthentication is a full login (password + MFA). No refund, void or student entitlement revocation endpoint is added.

## MFA

- **Secret storage:** TOTP secret encrypted at rest with AES-256-GCM (`OPERATOR_MFA_ENC_KEY`, base64 of exactly 32 random
  bytes; AAD = operator id). Recovery codes (10, `XXXXX-XXXXX`, single use) and the enrollment code are stored only as
  hashes. Any change of `mfa_secret_enc` revokes all sessions and open challenges (DB trigger).
- **Sign-in:** `login` (password, throttled) -> challenge -> `mfa/verify`. A wrong code counts before it is checked; a
  challenge dies after 5 wrong attempts; per-operator and per-IP buckets also apply. Old sessions stay valid until MFA succeeds
  and are rotated only then. Nothing before MFA creates a session or a cookie.
- **Enrollment (first sign-in):** operator has no MFA yet -> `mfa_enrollment_required`. They must present the one-time
  **enrollment code** given out-of-band by whoever provisioned them (24 h validity), then scan the secret/QR and confirm a
  first code. The password alone can never enroll a factor. Recovery codes appear once, and the UI requires an acknowledgement.
- **Lost authenticator:** use a recovery code. **Lost authenticator and recovery codes:** an administrator with database access
  runs `scripts/reset-operator-mfa.ts` (stdin `{"email":...}`, local/disposable DB only): clears MFA, revokes sessions, prints
  a new enrollment code. There is no self-service reset by design.
- **Security log:** `operator_security_events` (append-only, migration 020) records enrollment started/completed, MFA verified,
  MFA failed (fixed reason vocabulary: `challenge_invalid`, `code_invalid`, `recovery_code_invalid`, `enrollment_code_invalid`),
  recovery-code use, and the offline operations `operator_provisioned`, `mfa_reset`, `mfa_key_rotated`. It is separate from
  `operator_audit` on purpose: failures can have **no identifiable operator** (unknown/expired challenge) and are stored with
  `operator_id NULL`, never with an invented identity. No code, secret, raw email or raw IP is stored (`ip_hash` is a one-way hash).
  Success events commit in the same transaction as the sign-in; failure events are best-effort (a broken log never changes what
  the caller sees). Throttled requests (429) are not logged one by one, to keep the table from being a flood target.
  Read it with SQL (there is no UI): `SELECT at,event,reason,source,actor_label FROM operator_security_events ORDER BY at DESC LIMIT 100;`
  Retention of this table and of `operator_audit` is an owner decision; nothing deletes them automatically.
- **Not implemented:** WebAuthn/passkeys; alerting on repeated failures.

## Offline provisioning and reset (owner-run)

The initial accountable person is the **project owner**. There is **no bootstrap account, no default password and no web
sign-up** for operators. Scripts run by someone with database access; each one requires `OPERATOR_ADMIN_LABEL` (who is
running it, e.g. `pemilik-proyek`) and writes it into `operator_security_events`.

| Step | Command (stdin is JSON, never shell arguments) |
|---|---|
| Provision staff | `create-local-operator.ts` with `{email,name,password(>=12),permissions[]}`; accepts operational scopes only and prints a one-time enrollment code (24 h). Give the code out-of-band, separately from the password. |
| Reset one operator | `reset-operator-mfa.ts` with `{"email":...}`: deletes recovery codes, clears the factor, **revokes sessions and open challenges**, forces re-enrollment with a new code. |
| Reset everyone (lost key) | `reset-operator-mfa.ts` with `{"all":true}`. |
| List legacy student requests | `report-legacy-student-requests.ts` (read-only; ids and dates only). |

Safety gates (`scripts/lib/operator-admin.ts`): either `OPERATOR_PROVISION_LOCAL=true` on a loopback database with `NODE_ENV`
development/test, **or** `OPERATOR_PROVISION_OFFLINE=true` together with `OPERATOR_PROVISION_CONFIRM_DATABASE=<host>/<database>`
typed by the person, which must equal the target of `DATABASE_URL`. A mistyped confirmation refuses. Take a database backup before
running against a real database. Invoke with `node --require ts-node/register scripts/<name>.ts`. These procedures were only
exercised with synthetic identities on a disposable database.

`owner:insights` is reserved to `koneva.id26@gmail.com` by the database constraint and cannot be granted through the staff
provisioner. The owner-run provisioning path must grant the complete operational permission set plus `owner:insights`.

## OPERATOR_MFA_ENC_KEY management

- **Generate:** `head -c 32 /dev/urandom | base64` on a trusted machine; pipe straight into the secret manager. Never put a real value in the
  repository, `memory.md`, chat, shell history or an `.env.example` (the examples contain only a placeholder; audited).
- **Store:** in the deployment's secret store, injected as an environment variable. **Back up separately from database backups**
  (sealed offline copy, two custodians if possible): a database backup without the key is useless for MFA by design, and the key
  alone is useless without the database.
- **Missing or malformed:** the API refuses to start when the panel is enabled (`OPERATOR_MFA_ENC_KEY must be base64 of exactly 32 random bytes`).
- **Valid but wrong** (other environment, restored database, half-done rotation): the router samples stored secrets and answers
  `503 OPERATOR_KEY_INVALID` to every operator request; nothing signs in, nothing is created, an error is logged. A secret that
  fails to open during MFA answers `503 MFA_UNAVAILABLE`, never a session. The rest of the API keeps running.
- **Rotate:** with a fresh backup, run `rotate-operator-mfa-key.ts` with `OPERATOR_MFA_ENC_KEY_OLD` and `OPERATOR_MFA_ENC_KEY_NEW` in the
  environment. It re-seals every secret in **one transaction** (nothing changes if the old key is wrong), closes challenges, ends **all
  operator sessions** (everyone signs in again) and logs `mfa_key_rotated`. Then deploy with the NEW key. Keep the old key until
  the new deployment is verified; restoring the old key + a pre-rotation backup is the rollback.
- **Lost key, no backup:** secrets cannot be recovered. Run `reset-operator-mfa.ts` with `{"all":true}` and have every operator enroll again.

## Legacy `/admin` interface

Inventory of who uses the gateway `/admin` routes (all authenticated with `x-admin-key` only): the owner's `curl` (workspace creation,
plans, invoices, stats, site stats, device creation), `scripts/verify-personal.mjs` and `scripts/integration-test.ts` (tenant/device creation),
and `docs/PERSONAL_SETUP.md` (loopback). The reverse-proxy template already returns 404 for `/admin`. The Device Manager has its own
key-protected interface that the gateway calls; it is **not** the gateway `/admin` and is unchanged.

Restrictions now in the API itself (`middleware/admin-access.ts`):
1. **Network:** `ADMIN_ALLOWED_NETWORKS` (IPs/CIDRs plus `loopback`, `private`, `any`). Default in production `loopback,private`; elsewhere `any`.
   Set `TRUST_PROXY_HOPS` so the client address is real; a public client is refused (`403 ADMIN_NETWORK_FORBIDDEN`) before the key is checked.
2. **Credential:** only `x-admin-key`. The operator cookie is not an admin credential and the admin key is not an operator credential (tested through the real entrypoint).
3. **Legacy money/identity writes:** `POST /admin/invoices/:id/pay` and `POST /admin/tenant/:id/student-verify` are replaced by the panel (identity, MFA,
   audit, idempotency). While `OPERATOR_ENABLED=true` they answer `403 LEGACY_ENDPOINT_DISABLED` unless `ADMIN_LEGACY_BILLING_WRITES=true`.
   With the panel off (today) nothing changes. `void` and the manual `subscription` grant have **no replacement yet** and stay available.
   Migration order for the owner: enable the panel, stop using those two `curl` commands, keep the override off.

## Cleanup and retention

Hourly when the panel is enabled (first run one minute after start), and callable as `cleanupOperatorData()`:
- sessions ended (revoked or expired) more than a day ago; challenges expired/consumed more than a day ago; expired login/MFA throttle buckets;
- **idempotency rows older than `OPERATOR_IDEMPOTENCY_RETENTION_DAYS` (default 7, minimum 3 = the 72-hour replay promise; smaller values stop startup).**
  After that a retry with the same key is processed as a new request. It still cannot double-apply: payments check invoice state/version under lock
  (`409 INVOICE_NOT_PAYABLE`), decisions check the request state (`409 REQUEST_NOT_PENDING`). Tested.
- **Never touched:** `operator_audit` (payments, student decisions), `operator_security_events`, invoices, student requests.

## Legacy pending student requests

Approvals made before the panel stay valid. A request made before the panel has no `student_requests` row (nobody can decide it, and the
requester's identity was never stored, so none is guessed). The workspace's billing state now reports `student.needs_resubmission=true` and the
dashboard billing page tells the owner of that workspace to submit again (rejected/superseded requests are not affected). No notification is sent to anyone.
`report-legacy-student-requests.ts` lists the affected workspace ids and dates read-only. Whether and how to contact them is an owner decision.

## CI

`.github/workflows/operator-checks.yml` runs the same local scripts (backend suite, real-entrypoint tests, dashboard tsc/eslint, UI tests, STACK browser
tests) on pull requests and manually. It was only written and syntax-checked here; it has **not** run (nothing was pushed and no external account is connected).

## Configuration and local provisioning

No environment file was changed. Before starting an **isolated local** API, explicitly set:

```text
OPERATOR_ENABLED=true
OPERATOR_ALLOWED_ORIGIN=http://localhost:13000
OPERATOR_MFA_ENC_KEY=<base64 of 32 random bytes, e.g. `head -c 32 /dev/urandom | base64`; placeholder only, never commit a real value>
# Either strict cookies (default: __Host-koneva_op, Secure; works on http://localhost in Chromium/Firefox) ...
OPERATOR_COOKIE_NAME=__Host-koneva_op
OPERATOR_COOKIE_SECURE=true
# ... or explicitly weak local cookies:
# OPERATOR_INSECURE_DEV_COOKIES=true
# OPERATOR_COOKIE_NAME=koneva_op_dev
# OPERATOR_COOKIE_SECURE=false
# Production only, after the checklist below (also needs https origin and strict cookies):
# OPERATOR_ALLOW_PRODUCTION=true
# TRUST_PROXY_HOPS=1   # number of proxies in front of the API, so per-IP throttling sees the client, not the proxy
```

The development origin must match the browser exactly. HTTP is allowed only for loopback origins. The default secure
cookie configuration can instead be used with HTTPS. In production, weak cookie settings fail startup even if the
operator module is disabled. Enabling the module in production additionally requires `OPERATOR_ALLOW_PRODUCTION=true`, an
https origin, `__Host-` Secure cookies and a valid `OPERATOR_MFA_ENC_KEY`; otherwise startup fails.

Migrations `018_operator_panel.sql`, `019_operator_mfa.sql` and `020_operator_security_events.sql` add the required schema (each needs the previous). Use the repository migration runner **only against an
explicitly selected disposable/local database** for this phase. Do not run the ordinary migration command against a
default `.env` connection. The test script below manages its own disposable container and migrations.

`scripts/create-local-operator.ts` accepts JSON on stdin (`email`, `name`, `password`, `permissions`) and prints a one-time
enrollment code (hand it over out-of-band, not in the same channel as the password). It requires
`OPERATOR_ADMIN_LABEL` plus the gates described in "Offline provisioning and reset", an explicit `DATABASE_URL` and the ordinary
required API configuration. Invoke with `node --require ts-node/register scripts/create-local-operator.ts`.
It never overwrites an existing identity and never prints the password. Recovery: `scripts/reset-operator-mfa.ts` (see MFA). Use synthetic identities for local testing;
do not store actual operator credentials in scripts, shell history or repository files. This helper is not production provisioning.

## Gmail sender for invitation OTP

`EMAIL_TRANSPORT=none` remains the default. Local `dev-outbox` writes only to a mode-0600 file; it never sends mail.
`gmail-api` uses the Gmail API with the single scope `https://www.googleapis.com/auth/gmail.send`. It does not use SMTP or an
App Password. Keep `GMAIL_OAUTH_CLIENT_SECRET` and `GMAIL_OAUTH_REFRESH_TOKEN` in local ignored configuration/secret storage;
never paste them into chat, commit them, or record them in `memory.md`. The sender configured in `GMAIL_SENDER_EMAIL` must be
the same Google account that consented, or a Gmail send-as alias already configured on that account.

For a local, low-volume test:

1. Use a dedicated Gmail sender account, turn on Google's 2-Step Verification for account recovery, and sign in to
   [Google Cloud Console](https://console.cloud.google.com/) with that account.
2. Create a project for KONEVA OTP; enable **Gmail API**.
3. Configure Google Auth Platform's branding and audience. For an external app in Testing, add the sender account as a test
   user. Create a **Web application** OAuth client with this exact redirect URI:
   `http://localhost:45678/oauth2callback`.
4. Store the OAuth client ID and client secret in the ignored local `.env` (not the checked-in examples). In WSL run
   `node --require ts-node/register scripts/get-gmail-oauth-token.ts`; open the one-time URL in a browser signed into the
   sender account, review `gmail.send`, and approve. Store the one-time refresh-token output securely and do not share it.
5. Set `EMAIL_TRANSPORT=gmail-api`, `GMAIL_SENDER_EMAIL`, `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, and
   `GMAIL_OAUTH_REFRESH_TOKEN` in the local API process environment. Restart only the API and send an invitation OTP to a
   mailbox you control. If consent is revoked or the refresh token stops working, OTP requests fail closed and logs contain
   no token, OTP, recipient email or Google response body.

Google classifies `gmail.send` as a sensitive scope and the OAuth app may need verification before general production use.
OAuth consent left in Testing can issue refresh tokens that expire after seven days; this setup is for local testing and
will require a production OAuth review/publishing plan before it can reliably serve customers. See Google's
[Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) and
[OAuth refresh-token rules](https://developers.google.com/identity/protocols/oauth2). Do not activate this sender for
production until the Google consent status and token lifetime are confirmed.

## OTP sender-budget alerts (local implementation, not deployed)

The OTP limiter (see [ROLES.md](ROLES.md)) records `otp_threshold_events` when the whole-system sender count reaches **70 %** of its rolling 24 h cap and again when the **cap** is reached, at most once per kind per 24 h. The Panel Operator now **shows** those events:

- **Where:** `GET /operator/alerts/otp` and the dashboard page `/operator/alerts` ("Peringatan", menu item), plus a banner on the summary page while an alert is active. **Access:** operators with `audit:read` (same trust as the audit trail; a dedicated permission would need a migration of the operator permission list and re-provisioning, and was not added). Others get no menu item, a refused page, and `403` from the API.
- **What is shown:** time of the event; scope (sender OTP email, whole system, 24 h rolling); event (70 % reached / cap reached with requests refused); usage at the moment of the event and the cap at that moment (**a snapshot, not today's usage**); status (active = inside the 24 h deduplication window, otherwise history); plus "current usage" measured when the page loads, against the cap configured now (the two caps can differ if `OTP_SENDER_DAILY_CAP` changed). Last 30 days, at most 50 events, newest first.
- **What is never shown or returned:** email addresses, IPs, OTP codes, limiter keys, invitation/workspace/user ids. The API returns an allowlisted set of fields and the page only renders known fields.
- **Deduplication:** the limiter inserts a row only when none of that kind exists in the last 24 h, so more sends after the threshold do not repeat the alert; the panel does not create alerts itself and reading never writes.
- **Limitation (accepted for this stage):** the alert is visible **only to an operator who opens the panel**. There is no email, WhatsApp, push, webhook or any other channel, and no acknowledgement or muting. Someone has to look. Delivering it elsewhere is future work and needs an owner decision on channel and recipients.
- **Storage/retention:** no new table or column. `otp_threshold_events` grows by at most about two small rows a day (counts only) and is not deleted automatically (owner decision); the current-usage figure is a count over `otp_rate_events`, which is already cleaned after two days.
- **Status: implemented locally and tested against temporary databases; not deployed, not migrated on the local panel database, not exercised with real traffic.**

## Migration compatibility and remaining integration work

- Existing paid references that collide after normalization deliberately block migration. Review duplicates read-only
  before any future deployment and resolve them through a separately authorized financial review. No history is rewritten.
- The old tenant student fields did not record requester identity. Migration does not invent it from the workspace
  email. Old approved entitlements remain valid; old pending requests need a fresh submission through the existing
  tenant billing endpoint before they appear in the operator queue. This needs communication before deployment.
- Legacy `/admin` billing mutations remain an independent maintenance interface, protected by the existing admin key;
  they are not exposed by the operator router and do not create operator audit. Restrict this maintenance interface
  before production rollout. They share invoice version/reference constraints and payment workspace locking.
- Session/idempotency/login-bucket/challenge cleanup is not scheduled yet. Idempotency retention never drops below 72 hours;
  future cleanup must preserve replay promises.
- The frontend now implements the deadlines, unknown-outcome handling, rollback-marker rule, reload reconciliation and WIB date
  conversion (see `dashboard/docs/operator-panel-contract.md`).

## Remaining operational work (before any production enablement)

Done in the hardening stage: MFA security log, offline provisioning/reset/rotation procedures, key-mismatch fail-safe, `/admin` restrictions,
cleanup job, CI definition, legacy-student handling, real-entrypoint and real-limit tests. Still open:
1. The owner runs the offline procedures once on the real database (with backup) and confirms them; only synthetic runs exist.
2. Real secret-manager storage, custodians and backup of `OPERATOR_MFA_ENC_KEY`.
3. Set `TRUST_PROXY_HOPS` for the real proxy chain and `ADMIN_ALLOWED_NETWORKS` for real maintenance hosts; verify with the real proxy.
4. Decide retention of `operator_audit` / `operator_security_events` / `otp_threshold_events`. Alerting: the OTP sender-budget alert is now **shown in the panel only** (no push channel); alerting on repeated `mfa_failed` / `recovery_code_used` still does not exist.
5. Legacy data: paid-reference collisions block migration 018; contact plan for workspaces with legacy pending student requests.
6. First CI run (never executed), Firefox/Safari cookie behaviour (`__Host-` on http://localhost) and screen-reader/keyboard review are unverified.
7. Readiness: `/ready` hangs instead of answering 503 when Redis is unreachable (Redis client retries forever). Existing behaviour, not changed here.

## Evidence levels

- **UI**: Playwright with the API faked in the browser (`dashboard/tests`, `npm run test:ui`). Proves rendering and client rules only.
- **STACK-local**: real PostgreSQL 15 (disposable container), real operator router, real Next proxy and real cookies in Chromium
  (`scripts/test-operator-stack.sh`, `dashboard/tests-stack`). Not `src/api-gateway/index.ts`: the harness mounts the same router and
  config reader without Redis/bot; it lifts only the per-IP router ceiling (120/min) and resets login buckets between tests.
  Faults (lost response after COMMIT, 502 HTML, redirect) are injected by the harness after the handler committed; audit failure is a
  temporary trigger on `operator_audit`.
- **Real entrypoint** (`scripts/test-operator-entry.sh`, `src/api-gateway/operator-entry.test.ts`): `src/api-gateway/index.ts` as a child process against a
  disposable PostgreSQL **and Redis**, no bot/device manager. Covers startup refusals, helmet/CORS/error handlers, cookie attributes, trust-proxy behaviour,
  `/admin` restrictions, and the login/MFA/router rate limits with the **real** configuration (no raised limits, no bucket deletion). Window recovery is shown
  by shortening the stored window to 2 s in SQL and waiting, because 15 real minutes are impractical; the server's own expiry logic runs for real.
- **LIVE**: none. Nothing here touched production, real WhatsApp sessions, or a payment gateway.

## Validation

```bash
# Typecheck + targeted backend/unit/HTTP/PostgreSQL tests; creates and removes its own PostgreSQL container.
bash scripts/test-operator-local.sh

# Full existing backend suite plus operator integration tests against the same disposable DB.
bash scripts/test-operator-local.sh --all

# Real index.ts entrypoint + PostgreSQL + Redis (startup failures, cookies, proxy config, real rate limits).
bash scripts/test-operator-entry.sh

# Browser + real backend (STACK-local). Own container, harness on :13210/:13211, Next dev on :13200. Extra args go to Playwright.
bash scripts/test-operator-stack.sh
# UI-with-mock suite (own Next dev server on :13100; needs Chromium libs, see dashboard/playwright.config.ts)
cd dashboard && npx playwright test
```

Requires the existing `postgres:15-alpine` Docker image and installed Node dependencies. The script uses a dynamically
assigned loopback port, no mounted data volume, synthetic secrets/identities, and no Redis/bot/payment service. Its EXIT
trap removes only the container it created. The API process used in the tests mounts the real operator router without
starting the gateway's background sweepers or listening on production ports.

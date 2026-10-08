# DOKU payment integration — sandbox spec and implementation status

**Status (updated 2026-10-08): backend (checkout + webhook + idempotency + atomicity) and dashboard UI are
both implemented. The billing page now shows a "Bayar dengan DOKU" button for unpaid invoices, calls `POST
/api/v1/billing/doku/checkout`, and redirects the browser to DOKU's `payment_url`. After returning from
DOKU, the page refreshes billing data and shows "menunggu konfirmasi" if the invoice is still unpaid (only
the verified webhook marks it paid — the browser redirect is never treated as proof). Sandbox credentials
(`DOKU_CLIENT_ID`/`DOKU_SHARED_KEY`) are configured in `.env.doku-sandbox` (mode 0600, gitignored); a
Cloudflare Tunnel has been used successfully for webhook testing. All tests green: 9/9 STACK, 8/8 signature,
7/7 Playwright checkout UI, 92/92 full dashboard suite.**

Source: official DOKU developer docs, read 2026-10-04 (`developers.doku.com`, `jokul.doku.com`). Owner
decision: DOKU registration is the owner's own task; Claude must not contact DOKU, create an account, or
send any data to DOKU. Real sandbox credentials and an explicit owner go-ahead are still required before
the checkout route can ever be exercised against the real DOKU sandbox.

## 1. Credentials and where they live

| Name (exact) | Maps to DOKU's own term | Used for |
|---|---|---|
| `DOKU_CLIENT_ID` | "Client ID" (DOKU Back Office) | Identifies the merchant account in every request/response header |
| `DOKU_SHARED_KEY` | "Secret Key" (DOKU Back Office) | HMAC-SHA256 signing key for outgoing requests and verifying incoming notifications |

Both are secrets. Target: `.env.personal` (mode 0600, already gitignored). Done in this batch (no values
read or written, only names/config wiring):

1. **Done**: `DOKU_CLIENT_ID`/`DOKU_SHARED_KEY` added to the `ALLOWLIST` array in `scripts/inject-secrets.sh`.
2. **Still the owner's step**: add both lines directly to `.env.personal` themselves, in a private session
   (`nano .env.personal` or similar — the file is already mode 0600, already gitignored) — **never paste
   the Shared Key into chat, a commit, a log line, or an agent prompt.**
3. **Done**: `scripts/inject-secrets.sh --from .env.personal --out <dir> DOKU_CLIENT_ID DOKU_SHARED_KEY`
   now accepts both names and stages them as individual 0400 files, exactly like every other secret this
   script handles — same documented `docker inspect` limitation applies (no `*_FILE` fallback in
   `src/shared/config.ts` yet; the value still also reaches the container via `environment:`, visible via
   `docker inspect` to anyone who can run it on that host — pre-existing, accepted gap, unrelated to DOKU).
4. **Done**: `docker-compose.personal.yml`'s `api-gateway` service now passes through
   `DOKU_CLIENT_ID`/`DOKU_SHARED_KEY`/`APP_PUBLIC_URL` (the last one is not a secret — see §2).
5. **Done**: `src/shared/config.ts` reads both into `config.doku.{clientId,sharedKey,configured}`. With
   either blank, `config.doku.configured` is `false` and both the checkout and webhook routes answer `503
   DOKU_NOT_CONFIGURED` — fail-safe, same pattern as this repo's other optional integrations (Gmail, Owner
   MFA). This is the current live state: both routes exist but reject every call.

**Owner's private secret-entry procedure** (when DOKU registration is done): open `.env.personal` directly
on the host, add the two lines, save, then re-run `scripts/inject-secrets.sh` if the Compose `secrets:`
file-based mount is in use. Do not send the Shared Key to Claude, Codex, or Kimi in any form — none of them
need to see the value to implement or review this feature; code review works from the field *names*, never
the values.

## 2. API surface (Non-SNAP Checkout, sandbox)

| Purpose | Method | Path |
|---|---|---|
| Create a checkout session | POST | `/checkout/v1/payment` |
| Check a transaction's status (resolve an uncertain outcome) | GET | `/orders/v1/status/{invoice_number}` |

Sandbox base URL: `https://api-sandbox.doku.com`. Production: `https://api.doku.com` (not relevant until
Gerbang 4+; this spec is sandbox-only, matching the owner's registration-in-progress status).

### Checkout request (minimum fields KONEVA would send)
```json
{
  "order": {
    "amount": 29000,
    "invoice_number": "INV-<koneva invoice number>",
    "currency": "IDR",
    "callback_url": "https://<koneva dashboard>/billing?doku=success",
    "callback_url_cancel": "https://<koneva dashboard>/billing?doku=cancel",
    "callback_url_result": "https://<koneva dashboard>/billing?doku=result",
    "auto_redirect": true
  },
  "payment": { "payment_due_date": 60 },
  "customer": { "id": "<tenant id>", "name": "<owner name>", "email": "<billing email>" }
}
```
Per the official request-body reference (`developers.doku.com`, Backend Integration guide, re-checked
2026-10-07 against a real working third-party implementation): `order.auto_redirect` is **required**
(`true` → redirect to `callback_url` after payment; `false` → DOKU's own result page) — implemented now in
`doku.service.ts`, missing from an earlier draft of this spec/code. `order.line_items` and
`payment.payment_method_types` are each conditional — only mandatory for specific payment methods
(Akulaku/Kredivo/Indodana/Allobank/Jenius for `line_items`; omitting `payment_method_types` just shows every
method enabled on the account) — neither is sent by `createDokuCheckout` today, which is correct for the
general case but would need revisiting if those specific methods are enabled later.

`amount` is IDR without decimals; `invoice_number` must stay unique per attempt (max 64 chars). Success
response carries `response.payment.token_id` and `response.payment.url` — the owner's browser is
redirected to that URL to complete payment; KONEVA's checkout page itself never collects card/bank
details directly (DOKU hosts that page).

### Notification (webhook) DOKU sends to KONEVA
DOKU POSTs to a merchant-configured Notification URL per payment method; shape varies slightly but always
includes:
```json
{
  "order": { "invoice_number": "INV-...", "amount": 150000 },
  "transaction": { "status": "SUCCESS", "date": "2026-10-04T03:24:23Z", "original_request_id": "..." },
  "service": { "id": "VIRTUAL_ACCOUNT" },
  "acquirer": { "id": "BCA" },
  "channel": { "id": "VIRTUAL_ACCOUNT_BCA" }
}
```
`transaction.status` ∈ `PENDING | SUCCESS | FAILED | EXPIRED | REFUNDED | TIMEOUT | REDIRECT`. DOKU's own
guidance: parse non-strictly, since new fields can appear. Respond `200 OK` once the notification is
durably recorded (DOKU retries on anything else).

## 3. Signature (Non-SNAP HMAC-SHA256) — implemented and tested now

String-to-sign, one component per line, `\n` separated, **no trailing newline**:
```
Client-Id:{DOKU_CLIENT_ID}
Request-Id:{request id}
Request-Timestamp:{ISO8601 UTC, e.g. 2026-10-04T03:24:23Z}
Request-Target:{request path, e.g. /checkout/v1/payment or the configured notification path}
Digest:{base64(sha256(raw json body))}
```
`Digest` line is **omitted** for requests with no body (the status-check GET). `Signature` header value is
`HMACSHA256=` + base64(HMAC-SHA256(string-to-sign, DOKU_SHARED_KEY)). Incoming notifications carry the same
four/five headers (`Client-Id`, `Request-Id`, `Request-Timestamp`, `Signature`, and effectively a body to
digest) — verifying one is the same computation run in reverse, comparing against the `Signature` header
DOKU sent, timing-safe.

**Implemented now** (`src/api-gateway/services/doku-signature.ts`, pure, no network, no DOKU account
needed): `computeDokuSignature`, `verifyDokuSignature`, `dokuDigest`. Tested
(`doku-signature.test.ts`) against self-consistent round trips (sign then verify matches; a flipped byte
in the body, a replayed/mismatched `Request-Id`, or a stale `Request-Timestamp` component must all fail
verification) using synthetic client id/secret — never a real DOKU credential, since none exists yet.

## 4. Idempotency — implemented (`migrations/035_doku_notification_events.sql`)

```sql
CREATE TABLE doku_notification_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id VARCHAR(128) NOT NULL UNIQUE,     -- DOKU's own Request-Id header
  invoice_number VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL,                  -- transaction.status as received
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ                        -- set once KONEVA's own billing effect is applied
);
```
Handler flow (`src/api-gateway/services/doku.service.ts`, `handleDokuNotification`): verify signature →
reject a stale `Request-Timestamp` (see §6a) → **everything else runs inside one database transaction**
(`transaction()` from `shared/database/connection.ts`): lock/insert the `doku_notification_events` row →
on `transaction.status === 'SUCCESS'`, look up the invoice by `order.invoice_number`, cross-check
`order.amount`/`order.currency` against the stored invoice (§6b) → `billing.service.markInvoicePaidWithClient`
(the transaction-aware core of `markInvoicePaid`, extracted so this handler and the existing admin
confirm-payment endpoint share one implementation) → mark `applied_at`.

**Why one transaction, not an insert-then-call-elsewhere (the earlier, fixed design):** if activation
throws for *any* reason, the whole transaction rolls back, **including the idempotency row**. A retry
with the same `Request-Id` then starts completely fresh — the row doesn't exist, so it is *not* mistaken
for an already-handled replay, and activation is actually retried. The earlier design inserted the
idempotency row via a separate `pool.query` call before invoking `markInvoicePaid` (which opened its own,
later transaction): a failure between those two steps left a row with no `applied_at`, and a retry's
`ON CONFLICT DO NOTHING` matched that row and reported `{ applied: false, reason: 'replay' }` with a
`200` — **even though the invoice had never actually been activated.** This is fixed now and covered by a
dedicated test (§7) that engineers a real mid-transaction failure, confirms nothing persists, then retries
the same `Request-Id` and confirms it actually activates.

`markInvoicePaidWithClient`'s own guard — refusing any invoice that is not currently `'unpaid'`
(`409 INVOICE_NOT_PAYABLE`) — remains a second, independent safety net: even a replay under a *different*
`Request-Id` for the same invoice cannot double-activate the workspace. This migration has only ever run
against disposable test Postgres instances (`scripts/test-doku-sandbox.sh`), never against
`wa-personal/wagateway`.

## 5. Checkout endpoint — implemented, untestable without real credentials

`POST /api/v1/billing/doku/checkout` (`billing.routes.ts`, tenant-authenticated, `billing:manage`
permission — owner only, same as the rest of `/billing/*`): looks up the tenant's one open unpaid invoice
(`getLatestUnpaidInvoice`, same invoice an existing `POST /billing/orders` call creates), builds the
checkout request in §2 server-side via `doku.service.createDokuCheckout` (so the Shared Key never reaches
the browser), and returns `{ invoice_number, payment_url }`. Answers `503 DOKU_NOT_CONFIGURED` with no
credentials set, `404 NO_UNPAID_INVOICE` with nothing to pay, `502 DOKU_CHECKOUT_FAILED` if DOKU's sandbox
rejects the request.

**Dashboard UI (implemented):** the billing page (`dashboard/src/app/(dashboard)/billing/page.tsx`) now
shows a "Bayar dengan DOKU" button inside the unpaid invoice card. Clicking it calls this endpoint (via
`api.createDokuCheckout()` → `useDokuCheckout()` React Query mutation), disables the button while pending
(double-click prevention), and on success sets `window.location.href = payment_url` to redirect the browser
to DOKU's hosted checkout page. On failure, a clear inline error is shown:
- `DOKU_NOT_CONFIGURED` → "Pembayaran online belum tersedia di server ini."
- `APP_PUBLIC_URL_NOT_CONFIGURED` → "Konfigurasi server belum lengkap untuk pembayaran online."
- `DOKU_CHECKOUT_FAILED` → "DOKU menolak permintaan checkout. Coba lagi nanti."

The manual transfer instructions remain visible below a "atau transfer manual" separator — both paths
coexist. On return from DOKU (`?doku=success|cancel|result` query param), the page:
- cleans the URL (removes the query param via `history.replaceState`),
- shows "Menunggu konfirmasi pembayaran" if the invoice is still unpaid,
- shows "Pembayaran dibatalkan" if the user cancelled on DOKU's page,
- shows "Pembayaran dikonfirmasi" if the webhook already processed before the redirect landed.

**The browser redirect itself is never treated as proof of payment** — only the signed webhook (§4/§6)
marks the invoice paid, matching this project's existing "pembayaran dikonfirmasi manual/async, bukan
instan" pattern already used for manual transfer invoices.

## 6. Webhook handler — implemented and proven synthetically

`POST /billing/doku/notify` (`src/api-gateway/routes/doku-webhook.routes.ts`) — mounted at the top level,
**not** under `/api/v1`/`tenantAuth`, since DOKU calls this directly with its own Signature header, not a
KONEVA apikey. Reads the raw request body (`req.rawBody`, captured by a `verify` hook added to
`express.json()` in `index.ts` — needed because a re-serialised parsed body would not match the Digest DOKU
signed) → `doku.service.handleDokuNotification` → always `200` once durably recorded (a replay or a
non-`SUCCESS` status still answers `200`, so DOKU does not keep retrying something already stored); a bad
signature answers `401` and touches no billing data at all.

### 6a. Request-Timestamp freshness — our own policy, not a documented DOKU limit

Checked `developers.doku.com` and `jokul.doku.com` again on 2026-10-04 (signature-component pages,
notification setup, "HTTP Notification Best Practice") specifically looking for a stated tolerance window
for `Request-Timestamp` age: **none of them specify one.** A bad signature is already rejected regardless
(the signature covers `Request-Timestamp`, so tampering with it breaks verification), but that alone does
not stop a *validly-signed-at-the-time* notification from being replayed much later with its original,
still-mathematically-valid signature. `handleDokuNotification` therefore rejects (`401 STALE_TIMESTAMP`)
any notification whose `Request-Timestamp` is more than **5 minutes** from server time
(`REQUEST_TIMESTAMP_MAX_AGE_MS` in `doku.service.ts`) — a conservative default of our own choosing (the
same order of magnitude other HMAC-webhook providers commonly use), not a value DOKU's documentation
requires. If DOKU support later states an official window, update that one constant to match.

### 6b. Amount and currency cross-check

Before activating anything, the handler compares the notification's `order.amount` against the stored
invoice's `amount_idr`, and requires `order.currency === 'IDR'` (the schema has no currency column —
every invoice is implicitly IDR, so any other value is rejected outright). A mismatch answers
`{ applied: false, reason: 'amount_mismatch' | 'currency_mismatch' }` (still `200` — durably recorded,
never retried by DOKU) and never touches the invoice or workspace.

## 7. Synthetic STACK proof (done) vs. real sandbox proof (still needs owner credentials)

**Done now** (`scripts/test-doku-sandbox.sh` + `src/api-gateway/doku-sandbox.stack.ts`, **9/9 passing**):
spins a disposable Postgres, applies migrations 001-035, sets `DOKU_SHARED_KEY=synthetic-doku-shared-key-not-real`
(never a real credential), then calls the *exact* `handleDokuNotification` function the real route calls:
- a validly-signed `SUCCESS` notification confirms the invoice (`status='paid'`) and activates the
  subscription (`status='active'`, correct `plan_id`) — the full "webhook valid → invoice terkonfirmasi →
  workspace aktif" chain, proven against disposable data;
- replaying the exact same notification (same Request-Id) is a no-op (`reason: 'replay'`), not re-applied;
- a second `SUCCESS` notification for the same invoice under a *different* Request-Id is refused by
  `markInvoicePaidWithClient`'s own `'unpaid'` guard (`reason: 'already_paid'`) — the second safety net
  from §4;
- a tampered body (one byte changed) fails signature verification (`401 INVALID_SIGNATURE`) and never
  touches the invoice;
- a non-`SUCCESS` status (e.g. `PENDING`) is recorded but never activates anything;
- a notification for an unknown `invoice_number` is recorded but safely ignored;
- an `order.amount` that doesn't match the stored invoice is rejected (`amount_mismatch`), invoice untouched;
- an `order.currency` other than `IDR` is rejected (`currency_mismatch`), invoice untouched;
- a `Request-Timestamp` 10 minutes old, with a signature correctly computed *for that old timestamp*, is
  rejected (`401 STALE_TIMESTAMP`) — proves the age check is independent of signature correctness (§6a);
- **the atomicity/retry invariant** (§4): a real mid-transaction failure is engineered (a decoy paid
  invoice is made to collide with the real one's `(method, reference)` unique constraint), the call
  rejects, and the test asserts **zero trace** of it in `doku_notification_events` — then, after the
  decoy is cleared, a retry with the identical `Request-Id`/signature actually activates the workspace,
  not a false `'replay'`.

This is what "unit/STACK tests sepenuhnya sintetis" (per the task brief) means here, and it is as far as
testing can go **without** a real DOKU sandbox account: `doku-signature.test.ts` (8/8, pure math) and this
STACK test together prove the signing, verification, staleness, idempotency, atomicity, and
billing-activation logic is correct.

**What is still unproven, and cannot be proven without owner-provided real sandbox credentials:** that
`createDokuCheckout`'s actual HTTP call to `https://api-sandbox.doku.com/checkout/v1/payment` succeeds and
returns a real `payment.url`, and that a real DOKU-sent notification (not one this repo constructed) matches
the signature format assumed here byte-for-byte — including whatever actual `Request-Timestamp` tolerance
DOKU's live system enforces, if any, which its documentation does not state (§6a). Both require the owner
to finish DOKU registration first.

## 7a. Isolated sandbox runtime — `scripts/doku-sandbox.sh` (implemented)

A standing, restartable runtime for real HTTP-level testing (not just the direct function calls §7's
STACK test makes), completely separate from `wa-personal`/`:13000`:

| | Sandbox | Live `wa-personal` |
|---|---|---|
| API | `http://127.0.0.1:18200` (plain `node`/ts-node process, this script's own PID) | `:18000` (loopback) / `:13000` (LAN HTTPS), inside Docker |
| Postgres | disposable container `koneva-doku-sandbox-postgres`, `127.0.0.1:15433`, db `doku_sandbox` | `wa-personal-postgres-1`, `127.0.0.1:55432`, db `wagateway` |
| Redis | disposable container `koneva-doku-sandbox-redis`, `127.0.0.1:16380` | `wa-personal-redis-1`, `127.0.0.1:56379` |
| Device-manager / bot / WhatsApp | **not started at all** | running |
| Email | not configured (signup OTP has nowhere to go — fine, this runtime is for the DOKU flow, not email) | Gmail API |

Both sandbox containers carry `--label koneva.purpose=doku-sandbox` and are not on the
`wa-gateway-personal` Docker network at all. `ADMIN_API_KEY`/`JWT_SECRET` are freshly auto-generated
random throwaway values every `start`/`restart-api` — they protect nothing real, so there is no reason to
keep them stable or hand them to the owner.

**Commands:**
```bash
scripts/doku-sandbox.sh start         # idempotent — safe to re-run; creates .env.doku-sandbox template
                                       # on first run (mode 0600, gitignored) if it doesn't exist yet
scripts/doku-sandbox.sh restart-api   # after filling .env.doku-sandbox: reloads DOKU_CLIENT_ID /
                                       # DOKU_SHARED_KEY / APP_PUBLIC_URL WITHOUT touching Postgres/Redis
                                       # or any data already created in them
scripts/doku-sandbox.sh status        # containers + API /ready
scripts/doku-sandbox.sh stop          # tears down everything, incl. disposable DB/Redis data
scripts/doku-sandbox.sh logs [N]      # tail the API's own stdout/stderr
```

**Owner's private credential step**: open `.env.doku-sandbox` directly (`nano .env.doku-sandbox`, already
mode 0600) and fill in `DOKU_CLIENT_ID`, `DOKU_SHARED_KEY`, and `APP_PUBLIC_URL` (the current tunnel URL,
§8) — never paste these into chat, a commit, a log line, or an agent prompt. Then run
`scripts/doku-sandbox.sh restart-api`. The script only ever `source`s this file (never `cat`s/echoes it)
and only ever prints whether each name is non-empty, never the value — verified: `grep -qE
'^DOKU_CLIENT_ID=.+$'` style boolean checks, nothing else touches the file's content.

**Fail-safe without credentials** (current, verified state): `curl -X POST
http://127.0.0.1:18200/billing/doku/notify ...` → `503 {"error":{"code":"DOKU_NOT_CONFIGURED"}}`;
`/health` and `/ready` both answer `200` regardless.

**Isolation evidence gathered this batch**: `SELECT current_database()` on the sandbox container returns
`doku_sandbox`, not `wagateway`; the sandbox containers do not appear in `docker network inspect
wa-gateway-personal`; the running API process's own `/proc/<pid>/environ` shows `DATABASE_URL` pointed at
`127.0.0.1:15433` and `REDIS_URL` at `127.0.0.1:16380`, never `55432`/`56379`; `wa-personal-*` containers
were re-checked healthy and untouched throughout.

## 8. Dev-only webhook tunnel (for once real sandbox testing starts)

`POST /billing/doku/notify` must be reachable from the public internet for DOKU to call it; the sandbox
above (`127.0.0.1:18200`) is not. DOKU's own documentation is explicit here
([Setup Notification URL](https://developers.doku.com/get-started-with-doku-api/notification/setup-notification-url)):
**"DOKU no longer supports URLs that use the ngrok domain, as they do not meet our security standards"** —
do not use ngrok for this. The same page names **localhost.run** as DOKU's own recommended option for local
development, and states the general requirement that the URL "must be able to be reached from the Public
Internet" (not localhost, not behind auth/VPN, HTTPS encouraged).

**Recommended: `localhost.run`** (explicitly named by DOKU's own docs) — no account needed for a quick
tunnel, run only when the owner is actively testing, closed right after:
```bash
ssh -R 80:localhost:18200 localhost.run
```
This prints a public `https://<random>.lhr.life` URL. Set that as `APP_PUBLIC_URL` in
`.env.doku-sandbox`, run `scripts/doku-sandbox.sh restart-api` so the checkout callback URLs match it,
then register `https://<random>.lhr.life/billing/doku/notify` as the Notification URL in DOKU's sandbox
Back Office. **`APP_PUBLIC_URL` and the tunnel URL must match for that session** — `localhost.run` gives a
new random subdomain every time it reconnects, so this is a value to update per test session, not once.
Close the SSH session when the test session ends — the tunnel dies with it, nothing stays exposed.

**Untested alternative: Cloudflare Tunnel** (`cloudflared tunnel --url http://localhost:18200`) — DOKU's
docs don't explicitly bless or block `*.trycloudflare.com`; their stated objection to ngrok is about ngrok
specifically ("do not meet our security standards"), not a general tunnel-provider denylist, but this has
not been verified against a real DOKU sandbox account. If `localhost.run` ever proves unreliable, try this
and register the URL the same way — but confirm DOKU actually accepts a notification at that URL before
relying on it.

**Hard rule, either way**: the tunnel target is `127.0.0.1:18200` (§7a's sandbox, never `:18000`/`:13000`,
which run the live personal stack's old code against live data) — and the tunnel exposes only the one
webhook path conceptually (DOKU only ever calls `/billing/doku/notify`; nothing stops someone else from
probing other paths on the same tunnel URL, which is exactly why this points at the sandbox and never the
personal stack). Close the tunnel (kill the `ssh`/`cloudflared` process) as soon as the test session ends
— it is a manual, owner-supervised step, never a long-running background service. No tunnel has been
opened and no request has been sent to any DOKU host as part of this batch.

## 9. Guided owner end-to-end flow (once real sandbox credentials exist)

None of this runs until the owner has finished DOKU sandbox registration and explicitly says to start. All
steps use synthetic data — no production email/phone number, no `wa-personal/wagateway` database.

1. **Owner private input needed before step 1 can run:**
   - `scripts/doku-sandbox.sh start` (§7a) — already runnable today, no credentials needed yet.
   - `DOKU_CLIENT_ID` / `DOKU_SHARED_KEY` from the DOKU sandbox Back Office, added to `.env.doku-sandbox`
     directly by the owner (§7a) — never typed into chat.
   - `APP_PUBLIC_URL` in the same file, set to whatever the §8 tunnel prints for that session (changes
     every time `localhost.run` restarts, so this gets updated each test session, not once).
   - `scripts/doku-sandbox.sh restart-api` after filling both in.
2. Sign up a test account (`POST /auth/signup` against `http://127.0.0.1:18200`, a synthetic address like
   `doku-test@example.test` — never a real email) on the sandbox from §7a. Its `EMAIL_TRANSPORT=dev-outbox`
   is already wired (`scripts/.doku-sandbox-state/email-outbox.jsonl`, file-based, local only), so the
   verification OTP never leaves the machine — read it from that file, not a real inbox. **Verified working
   this batch** end-to-end through step 4 below (synthetic tenant, invoice `INV-202610-0001`,
   `amount_idr: 59000`) — only step 5 onward needs real DOKU credentials.
3. Confirm signup (`POST /auth/signup/verification/confirm`), creating the workspace.
4. Create an order (`POST /api/v1/billing/orders {"plan":"asisten","cycle":"monthly"}`) — produces an
   unpaid invoice.
5. Checkout (`POST /api/v1/billing/doku/checkout`) — returns `payment_url`. Open it in a browser; DOKU's
   sandbox checkout page has its own test payment instruments (card numbers, VA simulators, etc. — see
   DOKU's own sandbox documentation for current test instrument numbers, not reproduced here since they
   are DOKU's own content and may change).
6. Complete the sandbox payment on DOKU's hosted page. DOKU sends the notification to the §8 tunnel URL.
7. Confirm in the dashboard (or `GET /api/v1/billing`) that the invoice is `paid` and the workspace/
   subscription is active — this is the actual proof, not the browser redirect in step 6.
8. Tear down: close the tunnel, `scripts/doku-sandbox.sh stop`, and note in `docs/HANDOFF.md`
   that a real sandbox transaction was completed end-to-end (with the DOKU sandbox invoice/transaction id,
   never a card/VA number).

## 10. Manual invoice vs DOKU checkout — two paths, one invoice

Both paths operate on the same invoice row. They are **not** competing flows; they coexist on the billing
page (DOKU button above, manual transfer instructions below):

| | Manual transfer | DOKU checkout |
|---|---|---|
| **How invoice is created** | `POST /api/v1/billing/orders` — same for both | same |
| **How user pays** | Bank transfer outside the system, then sends proof + invoice number to the operator | Click "Bayar dengan DOKU" → redirected to DOKU's hosted checkout page |
| **How invoice is confirmed** | Operator clicks "Konfirmasi pembayaran" in the operator dashboard (`POST /operator/invoices/:id/confirm-payment`) | DOKU sends a signed webhook to `POST /billing/doku/notify` — fully automatic, no operator action |
| **When workspace activates** | After operator confirmation | After webhook processes `SUCCESS` status |
| **Double-payment guard** | `markInvoicePaid` refuses any invoice not `'unpaid'` (`409 INVOICE_NOT_PAYABLE`) | Same guard, plus DOKU's own `Request-Id` idempotency (§4) |

If a user pays via DOKU but the webhook hasn't arrived yet, the operator could also manually confirm —
`markInvoicePaid`'s guard ensures it only happens once regardless of which path confirms first.

## 11. SNAP Token URL is NOT used by this integration

DOKU's Back Office has a "Pengaturan SNAP / Edit Token URL" page that asks for a Token URL. This is for
DOKU's **SNAP API scheme** — a different, newer API that uses an OAuth-like B2B token exchange (`POST
/authorization/v1/access-token/b2b`). **This project uses the Non-SNAP Checkout API** (`POST
/checkout/v1/payment` with HMAC-SHA256 signature), which has no token exchange step and does not use
Token URL at all.

If you see the SNAP Token URL field in the Back Office: **leave it blank** (or ignore it). The only DOKU
Back Office configuration needed for this integration is the **Notification URL** (§12 below).

## 12. Notification URL setup per channel

DOKU requires a Notification URL registered in the Back Office for each payment channel/method. The URL
is the same for all channels: `https://<APP_PUBLIC_URL>/billing/doku/notify`.

**How to register:**
1. Log in to DOKU's sandbox Back Office (sandbox.doku.com)
2. Navigate to **Channels** → select a channel (e.g. Virtual Account BCA, QRIS, etc.)
3. Find the **Notification URL** field
4. Enter `https://<your-tunnel-url>/billing/doku/notify` (e.g. `https://parking-diversity-warcraft-drag.trycloudflare.com/billing/doku/notify`)
5. Save
6. Repeat for each enabled channel

**Important:** the Notification URL must match `APP_PUBLIC_URL` in `.env.doku-sandbox` — both must point to
the same tunnel. If the tunnel URL changes (Cloudflare quick tunnels give a new subdomain each time), update
**both** the `.env.doku-sandbox` value and the DOKU Back Office Notification URLs, then
`scripts/doku-sandbox.sh restart-api`.

## 13. Alternative: DOKU Payment Link (manual, no code)

DOKU's Back Office also offers **Payment Link**, a manually-generated payment URL with no integration code
at all — useful as a fallback if the API integration above is delayed, but **verify in the owner's own DOKU
Back Office account whether Payment Link has a sandbox/test mode before using it this way**. If the Back
Office does not clearly offer a test/sandbox mode for Payment Link, **treat every Payment Link as capable
of charging real money** and do not use it for a "sandbox" test — generate one only when the owner intends
a real charge. Claude does not generate or share a Payment Link on the owner's behalf; this is strictly a
manual owner action in DOKU's own Back Office UI, documented here only so the owner knows the option exists
and the risk if it turns out to be live-only.

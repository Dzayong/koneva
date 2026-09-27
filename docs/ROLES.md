# Access model: Owner, Developer, KONEVA system admin

Decision (owner discussion, implemented locally on 2026-09-26; follow-up decisions 2026-09-27 below). Local-tested only; **not** enabled anywhere.

## The three roles

| | What it is | Where it lives |
|---|---|---|
| **Owner** | The customer who owns a workspace. Buys the plan, handles billing, manages the team and every device/integration. Holds every Developer permission itself: the owner is never invited as a Developer and never has a second membership. | `memberships.role='owner'`, exactly one per workspace (partial unique index) |
| **Developer** | A workspace member for technical integration: add, configure, connect, pause and **delete** devices, use the API within key scopes, webhooks, content, API keys. **Not** billing, **not** the team (no invite/remove/promote), cannot give themself Owner powers. | `memberships.role='developer'` |
| **KONEVA system admin** | Internal operator account, separate from customers, not a workspace member. Cross-workspace service management per the Operator Panel. No new access to message contents or customer secrets. | `operators` tables, see [OPERATOR_PANEL.md](OPERATOR_PANEL.md) |

Owner and Developer are **memberships**, not account types: one account may be Owner of workspace A and Developer of workspace B (unique `(user, workspace)`; permissions follow the selected workspace). The database refuses roles such as `operator`, `system_admin`.

## Legacy `admin` and `viewer` (migration 021)

Existing rows keep their historical access exactly (nothing is upgraded or downgraded silently):
`admin` = everything except billing (including reading the team and removing developers/viewers); `viewer` = read devices/messages only.
What is blocked from now on: creating, inviting and assigning them (service layer **and** database triggers), and pending invitations with those roles were revoked by the migration.
A legacy admin can no longer invite (owner only). The dashboard labels them "Admin (lama)" / "Viewer (lama)" and offers the owner one explicit action, **Jadikan Developer**. The old tenant API key login keeps its historical admin-level access (labelled "Kunci tenant (lama)").

Migration impact and follow-up decisions for the owner are at the end of this file.

## Invitations and email OTP

1. Only the owner invites, only as Developer, only to an **@gmail.com** address. Whitespace and letter case are normalised; nothing else is (dots and `+tags` are kept as typed, `googlemail.com` is refused), so the invited address, the OTP address and the address the person signs up/in with are identical. Non-Gmail is refused (`400 GMAIL_REQUIRED`), also by a database trigger.
2. The link (48 h, single use, stored hashed) is bound to that address. A different address cannot accept (`403 EMAIL_MISMATCH`, checked before any code attempt so a stranger cannot burn the recipient's tries).
3. To accept, the recipient must prove they own the mailbox: request a 6-digit OTP (emailed to the invited address only), then submit it with the acceptance. Codes: 10 minutes, 5 wrong attempts (counted atomically), 60 s between sends, 5 sends per hour per invitation, only a keyed hash is stored, a new code replaces the old one, a code is single use. Accepting marks the account's email as verified.
4. An existing account must be signed in as the invited address; otherwise `ACCOUNT_EXISTS` (never silently merged).

### Email sender: state (updated 2026-09-27)

- `EMAIL_TRANSPORT` unset/`none` (default): **OTP cannot be sent** and invitations cannot be accepted. The API answers `503 EMAIL_NOT_CONFIGURED`, creates nothing, and there is no path around verification.
- `EMAIL_TRANSPORT=dev-outbox` + `DEV_EMAIL_OUTBOX_FILE=/absolute/path.jsonl`: development/test only, local file mode 600, nothing leaves the machine, OTP not in the application log. Refused in production.
- `EMAIL_TRANSPORT=gmail-api` (added by Codex, see [OPERATOR_PANEL.md](OPERATOR_PANEL.md) "Gmail sender for invitation OTP"): sends through the Gmail API with the `gmail.send` scope and an OAuth refresh token. Startup refuses it unless `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REFRESH_TOKEN` and a valid `GMAIL_SENDER_EMAIL` are set. A send that may or may not have been delivered (timeout) answers `502 EMAIL_DELIVERY_UNCERTAIN`; the OTP is invalidated and a new code must be requested.
- **Local Gmail credentials now exist in the developer's `.env`** (values were never read, printed or copied by Claude). The `gmail-api` transport has **not been exercised by Claude**: no real send, token refresh, quota behaviour, send-as alias or 401-retry has been verified.
- **The tests can no longer use it.** `shared/config` loads `.env`, so an unpinned test run *would* have picked up `gmail-api` and the credentials (verified 2026-09-27 with a boolean-only check). `scripts/test-operator-{local,entry,stack}.sh` now export `EMAIL_TRANSPORT=none` (stack: `dev-outbox` on a temp file) and blank `GMAIL_*` variables (dotenv never overrides existing variables, even empty), and `roles-access.test.ts` / `operator-entry.test.ts` refuse to run if a Gmail token is present.
- A locally running process keeps the environment it was started with; a `dev-outbox` process does not see later `.env` changes. Switch a local API to Gmail only by restarting it deliberately.
- **Registered Gmail vs sender Gmail are two different things.** The *registered* address is the invitee's own Gmail: it receives the OTP and becomes their KONEVA login. The *sender* is the single KONEVA-controlled Google account that sends the OTP mail (`GMAIL_SENDER_EMAIL`).
- Production caveats (owner): an OAuth app left in *Testing* issues refresh tokens that expire after about 7 days; `gmail.send` is a sensitive scope that may need Google verification before general use; Gmail has daily sending limits (see the proposal below); secrets belong in a secret manager, not a plain `.env`.

## Migration and data impact (021_roles_and_invitation_otp.sql)

| Item | Effect |
|---|---|
| One owner per workspace | Unique partial index. **The migration stops with a readable error if any workspace already has two owners** (none can be created by current code). Check first: `SELECT tenant_id, count(*) FROM memberships WHERE role='owner' GROUP BY 1 HAVING count(*)>1;` and decide which owner stays. |
| Legacy members | Untouched. No automatic promotion or demotion. |
| Pending admin/viewer invitations and pending invitations to non-Gmail addresses | Revoked by the migration (they cannot pass the new rules). Owners must re-invite as Developer with a Gmail address. |
| Existing pending Developer invitations to Gmail | Still valid but now need the emailed OTP to be accepted, so they cannot be accepted until an email sender exists. |
| Developer power | Gains `devices:delete`. API keys created by developers may now carry that scope. |
| New tables/triggers | `invitation_otps`; triggers on `memberships` and `invitations`. |
| Plans | Existing plan limits still apply: the Trial and Pelajar plans allow 1 member (the owner), so their owners cannot invite a Developer until they move to a plan with more members. This is unchanged plan policy. |

## Owner decisions (2026-09-27)

| Topic | Decision | Status |
|---|---|---|
| Legacy `admin`/`viewer` | **Option C**: 60-day transition that starts only after the Owner has been given a **formal notice**. Until the deadline nothing is upgraded or revoked automatically, and `team:manage` is **not** removed from legacy admins now. | Design below; not implemented |
| Trial and Pelajar | Stay at **one member (the Owner)**. No Developer invitations there. | Already the behaviour; unchanged |
| Owner transfer | **Manual, recorded procedure first**; self-service later. | Procedure design below; not built |
| Owner email verification | Required **before inviting or before important actions such as payment**. Sign-up keeps accepting non-Gmail addresses. | **Implemented locally** (below) |
| OTP limits across invitations | Numbers approved (recipient 3/h + 6/24 h, invitation 3/h + 60 s pause, workspace 10/24 h, sender 200/24 h, IP 20/15 min) with Gmail alias folding for the limiter key only. | **Implemented locally** (below) |
| Production data | No production query is run in the local stage. The counts of legacy members and duplicate owners must be obtained later by the owner under separate authorisation. | Open |

### Legacy members: 60-day transition (design)

1. **Notice.** A workspace-level record `legacy_role_notice(tenant_id, notice_sent_at, deadline_at = notice_sent_at + 60 days)` is created only when the notice is formally issued (dashboard banner for the Owner, and email once Owner email verification and an approved template exist). No notice, no clock. Sending to real users needs the owner's explicit go-ahead.
2. **Until the deadline:** nothing changes automatically. Owners see who is legacy (already labelled "(lama)") and can, at any time, make a legacy member a Developer or remove them. Legacy admins keep their current access, including `team:manage`.
3. **Day 30:** reminder to the Owner. **Day 60:** legacy roles that were not converted are **suspended** (fail closed: sign-in to that workspace answers "menunggu keputusan Owner"), never converted automatically. Memberships are kept for 90 more days so the Owner can still convert or remove; afterwards cleanup is an Owner action.
4. **Never:** automatic promotion of a Viewer or Admin to Developer (it raises rights without the Owner's decision).
5. Open sub-decisions: what the notice says exactly, whether the legacy tenant-API-key login gets the same clock.

### Owner email verification (implemented locally, migration 022)

- **Gate** (`403 EMAIL_NOT_VERIFIED`, only for signed-in people whose `users.email_verified_at` is empty): `POST /team/invitations`, `PATCH`/`DELETE /team/members/:id`, `POST /billing/orders`. Everything else, including devices, messaging, keys, reading billing and the team, works unverified. Existing Owners are asked at their next gated action.
- **Flow:** `POST /auth/email-verification/request` (session) mails a 6-digit code to the account's own address (any domain; 10 minutes, 5 attempts, 60 s pause), `POST /auth/email-verification/confirm {code}` verifies it (a wrong code is `422 OTP_INVALID`, not 401, so the session is not treated as expired). No sender configured: `503 EMAIL_NOT_CONFIGURED`, nothing counted. People who join by invitation are verified by that invitation's OTP. `/auth/me` returns `user.email_verified`.
- **Dashboard:** when an invite or order answers `EMAIL_NOT_VERIFIED`, a "Verifikasi email Anda" dialog opens (send code, enter code); the form the person was filling stays open.
- Sign-up still accepts any address; a campus address (`.ac.id`) works and can verify.

### OTP limits (implemented locally, migration 022, `services/otp-limits.ts`)

| Scope | Limit | Notes |
|---|---|---|
| Recipient (all invitations, workspaces and purposes) | 3 per rolling hour **and** 6 per rolling 24 h | Gmail aliases share one bucket |
| Invitation | 3 per rolling hour, plus the existing 60 s pause | |
| Workspace | 10 per rolling 24 h | |
| Sender (whole system) | 200 per rolling 24 h (`OTP_SENDER_DAILY_CAP`, 1..100000, validated at startup) | over the cap: `503 OTP_CAPACITY_REACHED` + `Retry-After`, never bypassed |
| Source IP | 20 OTP requests per rolling 15 min, checked before any invitation lookup | in the database, so it holds across API processes (the older in-process limiter stays as a first filter) |

- **Rolling windows and concurrency:** counters are rows in `otp_rate_events`; a slot frees exactly when its event leaves the window, and `Retry-After` is the exact time until then. Each check-and-record runs in one transaction holding PostgreSQL advisory locks on every key involved (sorted, so no deadlocks), so concurrent requests cannot both take the last slot. A refused request records nothing; an attempt that reached the provider counts (including an uncertain delivery). The over-limit answer is one generic message that says nothing about other sends.
- **Gmail alias folding is for the limiter key only:** for `gmail.com`/`googlemail.com`, dots and everything after `+` are ignored, so `a.b+x@gmail.com`, `ab@gmail.com` and `ab@googlemail.com` share a bucket. The invitation keeps the address as typed, the mail goes to that address, and the limiter never touches either. Other domains are not folded. Limiter keys are HMAC-SHA256 (keyed from the server secret with a fixed label): no raw email, alias, IP, invitation id or workspace id is stored. Rotating the server secret resets the counters.
- **The 70 % threshold: what is really recorded.** When the sender count reaches 70 % of the cap (140 of 200) one row goes into `otp_threshold_events` (`sender_70_percent`, count, cap), once per 24 h, and one WARN line is written to the application log (`OTP sender budget threshold`, kind/count/cap only). Reaching the cap records `sender_cap_reached` the same way. Rows hold counts only: no email, address, IP or person. **Nothing is sent to anyone.** Since 2026-09-27 the Panel Operator also displays these events (page `/operator/alerts`, banner on the summary; operators with `audit:read`; see [OPERATOR_PANEL.md](OPERATOR_PANEL.md) "OTP sender-budget alerts"), but an operator must open the panel to see them: **push delivery (email, WhatsApp, other channel) remains open work.** Query: `SELECT at, kind, window_count, cap FROM otp_threshold_events ORDER BY at DESC;`
- Housekeeping: counters older than two days are deleted by the operator cleanup job and opportunistically; threshold rows are kept.

### OTP tables: atomic consumption and retention (2026-09-27)

- **Atomic:** consuming a code and the state it proves change together. Owner verification: attempt count, comparison, `consumed_at` and `users.email_verified_at` are one transaction (a wrong guess commits only its attempt; a failure while verifying rolls the consumption back, so the code stays usable). Invitations: the wrong-guess attempt is committed first, but the code is consumed **inside** the acceptance transaction together with the membership/account, `email_verified_at` and `accepted_at`, so a failed acceptance no longer burns the code (it still costs one of the 5 attempts). Parallel accepts or confirms with the right code: exactly one wins.
- **Verification email** no longer contains a "Workspace" line at all (it never belonged there); invitation emails keep it.
- **Scheduled cleanup** (`services/otp-maintenance.ts`, hourly, first run 90 s after start, **independent of whether the operator panel is enabled**):

| Table | Deleted when | Why / impact |
|---|---|---|
| `invitation_otps` | expired or consumed more than **1 day** ago | Nothing reads a dead code. One day of slack keeps rows (keyed hash and counts only) for support. The 60 s pause uses a row from the last minute; the hourly limit is counted in `otp_rate_events`, so neither is weakened. Live codes are never deleted. |
| `email_verifications` | expired or consumed more than **1 day** ago | Same. A user with no live code simply requests a new one. |
| `otp_rate_events` | older than **2 days** | Longest window is 24 h. Deleting earlier would loosen a limit; later only costs space. |
| `otp_threshold_events` | **never** by this job | Counts only, at most a couple of rows a day; retention is an owner decision. |
| `operator_audit`, `operator_security_events`, invoices, student requests | never | Unchanged. |

Expected volume is tiny (at most 200 OTP mails a day system-wide), so without cleanup the tables would grow by hundreds of rows a day, harmless but unbounded.

### Owner transfer: manual recorded procedure (design, not built)

Until self-service exists, a transfer is done only by the project owner (or the accountable operator) with database access, never by hand-written SQL: a script `transfer-workspace-owner.ts`, following the same rules as the other offline scripts (`OPERATOR_ADMIN_LABEL`, explicit database confirmation, backup first), taking workspace id, the current Developer who becomes Owner (must already be a member with a verified email), a **reference to the written request** and the previous owner's consent (or the documented lost-access evidence). In one transaction: previous owner becomes Developer (or is removed, by flag), the target becomes Owner (the one-owner unique index makes the order matter, demote first), a record is written to the workspace audit log and to a security event (`workspace_owner_transferred`, needs a small migration), and the previous owner's sessions for that workspace are not touched but their rights change immediately. Two-person confirmation recommended. Self-service (Owner initiates, target confirms by OTP, re-login, 48 h delay, notices) stays for later.

## Evidence

- **STACK-local** (real PostgreSQL, real routers, fake device manager, temp-file outbox): `roles-access.test.ts` (roles, invitations, aliases end to end, Owner verification), `otp-limits.test.ts` (rolling windows, per-recipient/invitation/workspace/IP/sender limits, alias folding, concurrency, opaque keys, cleanup, threshold records), `dashboard/tests-stack/roles.spec.ts` (browser, including the verification dialog). **Real entrypoint**: `operator-entry.test.ts` runs two `index.ts` processes against one database and shows the OTP limit is shared across processes and answers 429 with `Retry-After` through the real error handler. **UI mock**: operator suite only. **LIVE: none.** No real WhatsApp number, device or message and **no email** was sent: the scripts pin `EMAIL_TRANSPORT=none` (stack: `dev-outbox`) and blank every `GMAIL_*` variable, and a test refuses to run if a Gmail token is present.
- **Not proven:** the `gmail-api` transport (real send, token refresh, quota, send-as, 401 retry); the 200/day cap against Google's actual limits for the chosen account type; operational alerting (none exists); legacy transition, owner transfer (designs only); behaviour with real production data.

# Outbound controls: suspension, pause, and what reaches WhatsApp

Audit and fix of 2026-09-27. **Evidence level: STACK-local** (real PostgreSQL and Redis in disposable containers, a *fake* WhatsApp transport that only records calls). **Nothing here was exercised against real WhatsApp**: no real number, no real message, no Baileys socket. Not deployed; no migration was needed.

## 1. Every path that writes to WhatsApp (actual state, from the code)

| Path | Where it enters | Suspended workspace: BEFORE | AFTER | Paused/banned number: BEFORE | AFTER |
|---|---|---|---|---|---|
| `POST /message/send` (normal and `priority: urgent`) | `message.service.queueMessage` | Refused at enqueue (`402 PLAN_INACTIVE`) | same | Refused unless device `online` (`503 DEVICE_OFFLINE`) | same |
| The job already in the queue (normal queue, urgent queue) | `queue.ts` worker | **Sent anyway**: the worker never looked at the workspace | **Cancelled** at execution (first check) **and** again right before `sendMessage` | Checked once at the start only (pause during the pacing delay was missed) | Checked at the start **and** at the last check |
| `POST /broadcast` | `broadcast.routes` → `queueMessage` per recipient | Up to 500 separate 402 failures | One refusal, nothing queued | as above | as above |
| `POST /messages/:id/retry` | `message.service.retryMessage` | **Accepted**: a suspended workspace could re-queue failed messages | `402 PLAN_INACTIVE`; also `503 DEVICE_OFFLINE` for a paused/offline number | accepted | refused |
| Automatic retry after a send error | BullMQ (3 tries, urgent 2) | Retried **any** error, including timeouts: a message WhatsApp had already accepted could go twice | Retried only when nothing left the socket (`Connection Closed`); a timeout/unknown error is **not** retried (see 3) | same | same |
| Auto-reply | `auto-reply.ts` | **Replied** (documented gap) | Blocked (logged `blocked`) at decision time and again right before `sendMessage` | Checked at decision time only | both checks |
| Device commands that write: `status.post` (also scheduled with `run_at`), `profile.update`, `profile.picture` | `command.service.enqueueCommand` → `command-runner` → `commands.ts` | Accepted and executed | Refused at the API (`402`, `409 DEVICE_PAUSED`); if queued earlier, **cancelled** by the runner (`WORKSPACE_SUSPENDED` / `DEVICE_PAUSED`) and re-checked right before the write | Not checked | Refused / cancelled |
| `profile.get` (a read) | same | allowed | still allowed (a suspended workspace keeps access to its numbers and data) | allowed | allowed |
| Bot HTTP `POST /send` (internal, key-protected) | `bot-container/api.ts` → `enqueueMessage` | Enqueued without plan check | Still enqueued (internal admin path) but **stopped by the worker guard** | pause checked by worker | worker guard |
| Presence updates (`online/offline/composing`) and read receipts | `presence.ts`, typing simulation | not gated | **not gated** (signals, no message content) | not gated | not gated: recommended follow-up |
| Webhooks to the tenant's own URL | `webhook.ts` | not WhatsApp; unchanged | unchanged | | |
| Scheduler | There is **no scheduler for messages**. The only scheduled WhatsApp write is a `status.post` with `run_at` (covered above). | | | | |

Guard implementation: `src/bot-container/send-guard.ts` (`checkTransmission`), one query joining the number, its workspace and its plan; plan rules are the existing ones in `src/shared/billing.ts` (`trial`, `active` and `past_due` inside the 7-day grace can send; expired, suspended and cancelled cannot; a `tenants.status` of `suspended`/`deleted` blocks). A number with no workspace (standalone bot) has no workspace rules.

## 2. What happens in each state

| Situation | Behaviour |
|---|---|
| New send while suspended | **Refused** at the API (402). |
| Job queued, workspace then suspended | **Cancelled**: status `failed`, `error_message = workspace_suspended`, `message.failed` webhook with `reason`, no automatic retry. Not held for later: a late campaign or OTP does more harm than a clear failure. |
| Same, urgent queue (OTP) | **Cancelled** the same way. Urgent traffic skips pacing, never the administrative guard. |
| Job queued, number banned | **Cancelled** (`device_banned`), as before. |
| Number paused (admin or auto-pause), normal message | **Deferred**: stays `queued` (`device_paused`), one delayed job (5 min), goes out **once** after the number is resumed. There is no maximum deferral age (existing behaviour, see limits). |
| Number paused, urgent message | **Cancelled** (`device_paused`), never held. |
| Workspace suspended or number paused *during* the pacing delay / typing simulation | Caught by the **last check** immediately before `sendMessage`; same outcomes as above. |
| Recovery of a workspace | Cancelled messages are **not** re-sent automatically and nothing reappears in the queue. The tenant may retry a message by hand (`/retry`, needs an active plan and an online number); one retry makes one job, a second click is refused, and an already-sent message is skipped if a job runs twice. |
| Recovery of a paused number | Deferred messages continue once; cancelled urgent ones stay cancelled. |
| Auto-reply while blocked | Not sent, logged `blocked`; nothing answers those inbound messages retroactively. |
| Device command while blocked | Cancelled (`failed` with a code); a person issues a new command after recovery. |

## 3. Uncertain outcomes and the in-flight limit

- If `sendMessage` throws, only a **closed connection** proves nothing left the socket (Baileys `Connection Closed`, 428): that keeps the ordinary retry. Any other error, timeouts above all, may follow a message WhatsApp already accepted, so the outcome is **uncertain**: the message is marked `failed` with `error_message = delivery_uncertain`, the tenant gets `message.failed` (`reason: delivery_uncertain`), the job goes to the dead-letter queue for inspection, and **nothing is resent automatically**. A person may retry by hand and accepts the risk of a duplicate; the API does not force an acknowledgement yet.
- **In-flight limit:** the guard is a read followed immediately by the send. A suspension or pause that lands in the few milliseconds between them, or while `sendMessage` is already running, cannot be stopped or recalled; that message is delivered and recorded `sent`. Making it airtight would need a lock held across the network call, which was deliberately not done.
- `failStuckMessages` (existing) still fails queued rows without a live job after 15 min (2 min urgent) and never resends them.

## 4. Tests (STACK-local, fake transport, email pinned off)

`bash scripts/test-outbound-local.sh` runs `src/bot-container/outbound-guards.test.ts` (13 tests): suspended after enqueue for normal and urgent, and through the bot's own enqueue path; which plan states count as suspended; device paused before execution, deferral leaves exactly one delayed job, urgent cancelled, resume sends once and a second run sends nothing; the last check catches a suspension or pause during the pacing delay; isolation between two workspaces; uncertain vs definite send errors; recovery without duplication including manual retry rules; broadcast; write commands at the API, at the runner and at the last check inside the command; auto-reply (suspended, last check, paused, isolation, no retroactive reply). Older unit tests were adapted (auto-reply tests inject the guard; the retry test mocks the new plan and device queries). Wired into the CI workflow (never run).

## 5. Remaining limits and follow-ups

- No proof against real WhatsApp; behaviour of `sendMessage` errors was classified from Baileys' documented `Connection Closed` and by treating everything else as uncertain.
- Paused-number deferral has **no maximum age**: a message can go out days later after a resume (a daily-cap deferral legitimately spans days, so a blanket cap was not added). Owner decision: cap deferral for administrative pauses?
- Presence and read receipts are not gated (see matrix). Bot `POST /send` still enqueues for a suspended workspace and relies on the worker guard.
- The 5-minute re-check granularity for paused numbers and the fact that suspension is derived from plan dates (the hourly sweeper only records) are unchanged.
- **Idempotency of the send API is missing**: `external_id` is stored but not unique, so a repeated request creates a second message. See [CONSENT_OPTOUT_DESIGN.md](CONSENT_OPTOUT_DESIGN.md) section 3 for the design and estimate.
- Webhook contract vs WAHA/Stripe patterns: HMAC signature and in-process retries exist; there is **no stable event id, no signed timestamp header and no replay endpoint** (gap, estimated there too).

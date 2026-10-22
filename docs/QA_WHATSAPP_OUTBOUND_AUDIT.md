# QA inventory: WhatsApp outbound safety and delivery

**Audit date:** 2026-10-20
**Scope:** outbound API, queue/worker, anti-ban guards, OTP classification, auto-reply and its user-defined regex triggers, inbound de-duplication, group composer validation, scheduled campaigns/broadcasts, and existing load-test coverage.
**Method:** static source review plus selected unit/route tests. This is a bounded audit of message delivery paths, not a certification of the whole product or of a running deployment.

## Findings

### QA-WA-001 — A database error after a successful WhatsApp send can make the queue resend the same message

**Severity:** P1 · **Status:** Fixed in source and deployed to the local personal stack; migration 054 is applied there. VPS status is unverified.

`processJobBody` calls `sock.sendMessage()` and, after it returns successfully, writes `status='sent'` to PostgreSQL. That status write is outside the transport error handler. If the database write fails, the worker sees a failed job; the database row can still be `queued`, so a later BullMQ attempt passes the queued-status check and can call WhatsApp again. There is no persisted `sending`/uncertain claim before the transport call.

**Impact:** duplicate delivery is possible during a database interruption at precisely this boundary. This is a plausible route to unexpectedly clustered sends, but it does not establish the cause of any particular WhatsApp ban.

**Evidence:** `src/bot-container/queue.ts:610-679`; worker retry policy in `src/bot-container/queue.ts:755-760` and enqueue options in `src/api-gateway/services/message.service.ts:31-46`.

**Fix:** the worker now claims the row atomically (`queued` → `sending`) immediately before transport. Retry jobs skip any row that is no longer queued. A stale `sending` claim is later closed as `delivery_uncertain`, notified, and never retried automatically. The retry API now also refuses `delivery_uncertain` rows with `DELIVERY_UNCERTAIN_MANUAL_REVIEW_REQUIRED`; the operator must check the chat and compose a new message if needed. This chooses at-most-once behavior: a crash after claiming but before transport can require human review, because the system cannot prove whether WhatsApp accepted the message. Integration tests cover both automatic retry suppression and refusal of a manual retry on an uncertain outcome.

### QA-WA-002 — A tenant API caller can self-declare an ordinary message as an OTP

**Severity:** P1 · **Status:** Fixed in source; tenant API rejects `otp_code`, and only platform-internal verification sends retain special handling.

Before the fix, the public send schema accepted `otp_code`. If a 4–10 digit value appeared in a short text message, the service could treat it as transactional and exempt it from normal quota/consent and assign urgent priority, without proving KONEVA generated the code.

**Impact:** before the fix, a tenant could get messages through a more permissive path without a server-created OTP event. The special handling now requires an internal platform flow. Tenant-generated OTPs use ordinary consent, quota, and pacing.

**Evidence:** prior code path in `src/api-gateway/routes/message.routes.ts` and `src/api-gateway/services/message.service.ts`; current validation is in `src/api-gateway/routes/message.routes.ts`, and tenant exemption classification has been removed from `src/api-gateway/services/message.service.ts`.

**Fix:** `otp_code` now fails request validation and is no longer consulted by the tenant send service. Tests assert request rejection and that tenant-provided legacy `otp_code` cannot bypass quota in the service path. The internal signup-verification sender remains separate; the obsolete tenant exemption helper was removed.

### QA-WA-003 — Per-device anti-ban limits were check-then-send, not an atomic shared reservation

**Severity:** P1 · **Status:** Mitigated in source; PostgreSQL lease behavior is integration-tested. Deployment topology is unverified.

Before the fix, the anti-ban check counted only messages already recorded as `sent`, `delivered`, or `read`, then approved based on that count. It did not reserve a minute/day slot before sending. Each device can have one normal worker and four urgent workers, and auto-replies are sent directly rather than through either queue. Incoming events are launched independently, so several auto-replies could evaluate the same count, wait, and send concurrently. Auto-reply did not run `canSendMessage` again just before its transport call.

**Impact before the fix:** overlapping sends could exceed intended per-minute or warm-up/day caps. The check also undercounted `delivery_uncertain` messages that WhatsApp may actually have accepted.

**Evidence:** `src/bot-container/anti-ban.ts`; `src/bot-container/queue.ts`; `src/bot-container/auto-reply.ts`; `src/bot-container/incoming.ts`.

**Fix:** normal and urgent queue workers plus direct auto-replies share a per-device send lock in the bot process. The final anti-ban check happens while holding that lock; successful messages are persisted before releasing it, so the next decision sees the prior send. Persisted `sending` rows and `failed/delivery_uncertain` rows count toward minute/day caps. An uncertain row keeps its `send_started_at`, since the transport may have accepted it.

**Limits and verification:** normal/urgent/auto-reply serialization is still process-local, while a PostgreSQL session-level advisory lease now guarantees only one bot process can own a given `BOT_ID`; a duplicate exits before starting Redis queues or a WhatsApp socket. The lease is held on a dedicated database connection and released at shutdown (or by PostgreSQL if the process/connection dies). Unit tests cover same-device rejection, release/reacquire, and cross-device independence; the disposable PostgreSQL/Redis integration suite exercises the real advisory-lock SQL. Tests also confirm reservation counting and final gates. A separate isolated burst test passed 100 concurrent authenticated API requests across 100 synthetic tenant/device fixtures, followed by 100 fake-transport deliveries in bounded worker waves. This is not a sustained load test or verification of real WhatsApp behavior.

### QA-WA-004 — Replaying a send or broadcast could create another outbound message

**Severity:** P2 · **Status:** Fixed in source and deployed to the local personal stack; migration 056 is applied there. VPS status is unverified.

Ordinary sends use tenant-scoped `external_id` as an idempotency key. Broadcasts now require `Idempotency-Key`, persist its request hash and broadcast ID per tenant, and derive recipient message IDs from that stable broadcast ID. Replays with the same body reuse message rows; changed bodies return 409.

**Impact:** before the fix, API retries could create duplicate queued messages. The dashboard's broadcast page sends per-recipient ordinary message requests and is independently paced; this endpoint protection applies to direct broadcast API callers.

**Evidence:** `src/api-gateway/routes/message.routes.ts`; `src/api-gateway/services/message.service.ts`; `src/api-gateway/routes/broadcast.routes.ts`; `migrations/056_broadcast_idempotency.sql`.

**Verification:** disposable Postgres/Redis integration test confirms a broadcast replay preserves its ID and recipient message count, while a changed body using the same key conflicts. Ordinary-message external-ID replay has a separate database integration test.

### QA-WA-005 — Duplicate inbound events can race the current de-duplication check and trigger duplicate auto-replies

**Severity:** P2 · **Status:** Fixed in source and deployed to the local personal stack; migration 055 is applied there. VPS status is unverified. Production database concurrency remains unverified.

Inbound persistence uses `INSERT ... WHERE NOT EXISTS` to suppress a previously stored WhatsApp message. There is no unique constraint on `(device_key, whatsapp_message_id, direction)` in the migrations reviewed. The event listener starts each incoming handler without awaiting the prior one. If the same inbound event is delivered twice concurrently, both checks can observe no row, insert, and invoke auto-reply.

**Impact:** one customer message can cause two automatic replies, consuming send budget and appearing spam-like.

**Evidence:** `src/bot-container/incoming.ts:150-181,347-371`; `migrations/001_initial.sql:44-71`; `migrations/003_message_lookup_index.sql:1-7`.

**Fix:** inbound handling now atomically claims `(device_key, whatsapp_message_id)` in `inbound_message_dedup` before inserting the message. The losing handler stops before webhooks or auto-reply hooks. The new concurrency test asserts one stored event and one webhook callback.

### QA-WA-006 — Group-send validation errors surface as a generic message in the UI

**Severity:** P3 · **Status:** Fixed in current source. Composer requires selecting a recent inbound message; error responses display the API's specific message, including stale/invalid reply context.

The API allows a group send only when it references an inbound message from that group within the last 24 hours. This is a deliberate guard, and a rejected 400 does not enter the send service or WhatsApp queue. The group composer submits the selected message ID; when the reference is missing, stale, or otherwise invalid, the user receives a generic `Invalid request body` instead of a clear explanation of the required reply context.

**Impact:** users may repeatedly retry a request that cannot pass validation. A 400 rejected this way is not itself a sent message and cannot explain a ban.

**Evidence:** `src/api-gateway/routes/message.routes.ts:23-25,38-45`; `src/api-gateway/services/message.service.ts:169-188`; `dashboard/src/app/(dashboard)/groups/page.tsx:117`.

**Verification:** source review confirms the composer is disabled without a selected inbound reply and surfaces the server response in its toast. Browser verification remains outstanding.

### QA-WA-007 — The auto-reply regex complexity filter can be bypassed by a catastrophic-backtracking pattern

**Severity:** P2 · **Status:** Fixed in source; route/runtime use a 128-character regex subset with no groups, alternation, or backreferences and a 512-character input cap. Existing stored complex rules safely stop matching.

Regex triggers previously passed a syntax check and a hand-written complexity heuristic, then synchronously called JavaScript `RegExp.test()` on up to 2,000 characters. A pattern such as `^(a|a?)+$` bypassed the heuristic and could take exponentially longer on a long run of `a` characters followed by a non-matching character.

**Impact:** a tenant-configured rule can stall that device's bot while inbound messages are being processed. It is not a direct explanation for an account ban, but can cause a device to stop responding and delay other work in the same process.

**Evidence:** `src/api-gateway/routes/auto-reply.routes.ts:12-34`; `src/bot-container/auto-reply.ts:103-114`.

**Fix:** one shared validator now runs both when creating/updating a rule and again at runtime, so legacy stored rules are bounded too. Tests reject the reported pathological expression and accept a simple anchored order-code pattern.

## Release and verification gaps

### QA-WA-GAP-001 — Sustained 100-user and production capacity remain unverified

`scripts/load/send-message.js` tests only the API validation/database/BullMQ enqueue path. It explicitly does not test real worker throughput or WhatsApp transport; its default target is about 1,000 API requests/minute to a test device that may be offline. There is no evidence in that script for 100 tenants concurrently sending through 100 live devices, per-device pacing under mixed traffic, or WhatsApp behavior. Do not treat a successful run of this script as proof that real sends cannot crash or get accounts restricted.

**Burst test completed:** an isolated integration test uses authenticated API requests, disposable PostgreSQL/Redis, 100 test tenant/device fixtures, and a fake WhatsApp transport. All 100 concurrent requests were accepted, then all 100 queued messages were processed exactly once in bounded worker waves. Mixed normal/urgent/auto-reply budget behavior is also covered separately.

**Sustained API + worker test completed:** `bash scripts/test-outbound-sustained.sh` sent 180 authenticated requests from 10 synthetic tenants over 102.2 seconds (10 concurrent requests every six seconds), below the shared-IP limiter of 120/minute. All 180 requests were accepted and all 180 BullMQ jobs reached the fake transport exactly once; API enqueue p95 was 139 ms. It uses disposable PostgreSQL/Redis and never opens a WhatsApp connection.

**Synthetic worker load completed:** `QUEUE_MESSAGES=1000 bash scripts/benchmark-device-sizing.sh` processed 1,000 queued messages on one bot (58.96 fake sends/s, zero failures) and 5,000 messages across five bot containers (about 17.1 fake sends/s per bot, zero failures). Health probes had no failures; p95 RAM was 149.8 MiB for one active bot and 160.4 MiB per bot with five active. Restart returned to HTTP 200 in 10.37 seconds. This covers worker/DB/Redis behavior and synthetic container resource use, not the API enqueue path, real WhatsApp transport, or 100 devices.

**Still required:** a larger synthetic fleet scenario and sustained soak with explicit latency/error budgets. These tests do not prove production capacity or behavior across 100 real bot containers. Any real WhatsApp test must be a separately controlled low-volume test, not a load test.

### QA-WA-GAP-002 — Queue-age, send-claim, inbound de-duplication and broadcast idempotency needed deployment verification

**Local verification completed on 2026-10-20:** the personal stack was backed up, rebuilt, and updated. Migrations `053_message_queue_expiry.sql` through `056_broadcast_idempotency.sql` are recorded in its `_migrations` table. API health and readiness return 200; dashboard page `/groups` returns 200; API, dashboard, device manager, and both bot containers report healthy. Both running bots use the freshly built bot image and retain their session directories.

This only verifies the local personal stack. VPS deployment and behavior under a real WhatsApp session remain unverified. The isolated integration test separately verifies an expired message does not reach the fake transport.

## Test run

- `bash scripts/test-outbound-local.sh`: **27 passed, 0 failed**, using disposable PostgreSQL/Redis and fake WhatsApp transport. Includes post-send DB failure/no duplicate, uncertain-send budget counting, mixed per-device send budget, and the 100-request/100-fake-delivery burst test.
- `bash scripts/test-bot-process-lease.sh`: **passed**; duplicate `BOT_ID` exits before socket startup while a different device ID runs concurrently.
- `node --require ts-node/register --test src/shared/device-send-lock.test.ts src/bot-container/anti-ban.test.ts src/bot-container/auto-reply.test.ts src/bot-container/incoming.test.ts src/bot-container/queue.test.ts src/api-gateway/media-send.test.ts`: **55 passed, 0 failed**.
- `npm run build`: TypeScript build passed.

The duplicate full-container startup check passes in an isolated Docker test: the first synthetic bot stays healthy, a second with the same `BOT_ID` exits on the lease error, and a third with a different `BOT_ID` becomes healthy concurrently. It runs with disposable PostgreSQL/Redis, an internal Docker network, and `KONEVA_SANDBOX=1`; it does not mount a WhatsApp session or open a real socket.

The remaining open items are larger synthetic fleet/soak testing, browser interaction verification for QA-WA-006, and VPS build/migration verification if that environment is brought online.

The findings are based on local source, selected tests, and the local personal-stack health/migration checks above. They do not establish the cause of the earlier WhatsApp account block or verify any VPS deployment.

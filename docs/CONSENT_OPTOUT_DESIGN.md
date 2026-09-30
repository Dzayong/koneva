# Consent / opt-out: owner-review specification

Separate from the outbound-controls fix (see [OUTBOUND_CONTROLS.md](OUTBOUND_CONTROLS.md)). **Owner approved staged implementation on 2026-09-30. Enforcement point 1 is implemented and awaiting review; points 2–4 remain gated on that review.** Estimates are engineering effort in person-days for one developer, before review, and should be rechecked after the first spike. A consent flow reduces complaints and misuse; it is **not** WhatsApp's permission and not an anti-ban measure.

## 1. What already exists (inventory)

| Capability | Where | Behaviour today |
|---|---|---|
| Detect an opt-out from the recipient | `shared/readiness.ts` `OPT_OUT_PATTERN` + `hasRecipientOptedOut` | A recipient counts as opted out if **any inbound message from them in the last 365 days, at most 200 characters, matches** stop / berhenti / unsubscribe / jangan kirim/chat/hubungi/spam / hapus nomor/kontak / batal langganan / spam. Derived at send time from stored message history. |
| Enforce it | `anti-ban.ts` `canSendMessage` | Only for **proactive, non-urgent** messages (someone who has not written in the last 24 h): denial `recipient_opted_out`, the message fails at execution. Replies, auto-replies and urgent (OTP) messages are not blocked by it. |
| Show it | `stats.routes.ts`, readiness factors | Counts of opt-outs and "unsolicited recipient" share feed the readiness score and advice text. |
| Explicit opt-in evidence | none | Not stored. Only the derived "recipient wrote first" signal. |
| Manual opt-out list, import, per-contact flag | none | `contacts` has no consent column; no API or UI to add/remove an opt-out. |

## 2. Gaps

1. **Late feedback:** `POST /message/send` and `/broadcast` accept a message to an opted-out number; it fails later in the worker. The developer learns only from a `message.failed` webhook.
2. **Derived, not durable:** the opt-out lives in message history. If inbound rows are deleted, retention is shortened, or a number is re-added under another device, the opt-out disappears. It is also per device (`device_id`), not per workspace.
3. **False positives/negatives:** a short chat line containing "stop" or "spam" ("spam??") counts as a permanent opt-out for a year; localisation is limited to a fixed word list; no way to undo, no "mulai/start" opt back in.
4. **No proof of consent** to show a customer, support or an authority; no record of source (form, import, chat).
5. **Auto-reply and urgent paths ignore it** by design; the policy for them is not written down.
6. **No audit** of who changed a preference, and no operator view.

## 3. Proposed design

### 3.1 Consent record and definition
Consent is explicit permission for promotional/proactive messages to one normalized recipient number in one workspace. A phone number in Contacts, an import, an existing customer relationship, an API-supplied declaration, or an inbound message that is not an opt-in command is **not** proof of consent. No consent row means promotional/proactive sends are denied. Consent is workspace-wide across devices and tied to a canonical phone number; use the project's existing normalization and reject values that cannot be normalized rather than creating ambiguous duplicates.

Proposed storage: current-state `recipient_preferences` keyed uniquely by `(tenant_id, normalized_phone_number)` with `status=opted_in|opted_out`, `source=inbound_keyword|manual`, `evidence_ref` (inbound message ID or operator evidence reference, never message body), `terms_version`, `decided_at`, and `decided_by`. Also append an immutable `recipient_consent_events` audit row for each grant/revoke, with tenant, normalized number, event, source, evidence reference, terms version, actor, timestamp. Cascading tenant deletion and account-close retention follow the existing workspace deletion/retention policy. Do not store message text in either table. Manual/import tools may set opt-out; manual opt-in must include an evidence reference and actor. Bulk import is not itself evidence of opt-in.

### 3.2 Inbound commands and state changes (owner-approved)
Recognize a standalone `STOP` or `BERHENTI` as opt-out and a standalone `START` or `MULAI` as explicit inbound opt-in. Matching is case-insensitive; ignore terminal punctuation and surrounding whitespace. Do not trigger on a keyword embedded in ordinary prose. Process the inbound event idempotently. Opt-out takes effect immediately and remains until a later explicit opt-in; `START`/`MULAI` records timestamp, normalized number and inbound-message evidence. A contact import, API claim, prior reply, or purchase never clears opt-out.

Workspace operators may manually record per-contact opt-in only with a required source note (for example, “offline store form”); store the actor, timestamp, normalized number, and note as evidence. Without the note, reject the operation. This is audit-only backend/database capability in T1.4; a management UI is a separate task. Contact import alone does not grant consent.

At STOP: persist the opt-out, suppress all queued promotional/proactive jobs for that workspace+recipient before transport, and send exactly one immediate non-promotional confirmation (for example, “Anda sudah berhenti menerima pesan promosi KONEVA.”). Deduplicate acknowledgement by inbound message/event ID so webhook retries do not send it more than once. Then send no further promotions until explicit re-opt-in. On re-opt-in, only future sends may resume; do not resurrect old queued jobs.

### 3.3 Four enforcement points
1. **API admission (estimate separately):** `queueMessage`, `/messages/:id/retry`, and each broadcast recipient check current consent before enqueue. Broadcast results carry a per-recipient `error_code`. Denials are synchronous (`RECIPIENT_CONSENT_REQUIRED` for no recorded opt-in, `RECIPIENT_OPTED_OUT` for revoked consent). A caller-supplied consent declaration or `priority: urgent` is not evidence and cannot bypass this check. Only an OTP verified by existing server-side code/rate limits skips this first gate.
2. **Queue worker / final send guard:** worker checks the workspace-wide consent state when claiming a job and again immediately before transport, covering already queued jobs, retries, and internal send paths. A STOP that arrives after enqueue must still prevent delivery. The existing 365-day per-device history rule is used only to seed migration/backfill and as a bounded compatibility fallback, not as the long-term source of truth.
3. **Inbound / auto-reply path:** inbound handler recognizes and persists STOP before any auto-reply decision. STOP receives no promotional auto-reply; other inbound messages do not create marketing consent. The transaction should prevent races between STOP processing and queued promotional sends; implementation must define locking/order and test it.
4. **Transactional exception (owner decision already locked):** necessary transactional messages, including OTP and payment confirmation, remain allowed after STOP; promotional messages stop fully. Only trusted server-side classification may use the exception. Client `priority: urgent`, a caller-supplied `purpose`, or a consent field is not proof. Preserve existing server-verified OTP rules (`otp_code` must be in message and pass current limits). Payment confirmations must use an internal server-owned send path; if no such path exists yet, do not invent a public bypass—record it as unavailable until added. Label “urgent” is restricted to service-necessary transactional messages; misuse is reviewed and may result in workspace suspension.

### 3.4 Migration, privacy and rollout
Create the schema and index idempotently. Backfill opted-out state from the existing 365-day rule, preserving conservative behavior without copying message text. Treat backfilled records as opted out, not as evidence of opted-in consent. Existing customers with no explicit consent remain blocked for promotional/proactive traffic until opt-in is collected. Roll out fail-closed for promo sends; transaction exception is narrowly server-controlled. Tenant isolation must be tested for state reads, writes, backfill, and worker checks. Keep preference/event records while the workspace exists, export/delete with the workspace, and align account-close deletion with the retention commitments. Do not touch production data during the task.

### 3.5 Estimate (one developer, rough person-days)
| Scope | Includes | Estimate |
|---|---|---:|
| **Enforcement point 1 only** | Schema/current-state model and safe legacy backfill; API send + per-recipient broadcast admission; outcomes, tenant isolation and targeted migration/API tests. Worker, STOP ingestion, transaction exception wiring, and UI are explicitly not covered, so queued/internal paths remain a known bypass until the rest is complete. | **2–3 days** |
| **All four enforcement points** | Point 1 plus queue claim/final pre-transport checks, STOP/START ingestion and queue suppression, auto-reply behavior, server-trusted transaction exception, concurrency/race handling, migration/tenant-isolation/regression tests and docs. No management UI/import included. | **5–7 days total** |
| Optional management surface | Workspace API/audit controls plus dashboard list and manual changes, with evidence requirement and tests. | **+2–4 days** |

Owner approved the spec decisions on 2026-09-30: standalone case-insensitive `STOP`/`BERHENTI` and `START`/`MULAI`; one non-promotional STOP confirmation; manual per-contact opt-in only with a source note and timestamp/number audit; management UI in a separate task; and no recorded consent means promotional sends are denied. Workspace-wide scope and transactional exception are approved. Work is explicitly staged: implement enforcement point 1 (API pre-enqueue) first, report evidence for review, then continue with points 2–4 only after that layer is reviewed. Keep server-trusted classification for the transactional exception; do not accept caller-provided `priority: urgent` as proof. The manual audit/read API is included in the first enforcement layer, without a dashboard UI.

## 4. Other patterns worth adopting from the research (selective)

| Pattern | Current state | Gap | Estimate |
|---|---|---|---|
| **Send idempotency** (Stripe style `Idempotency-Key`) | `external_id` is stored, **not unique**: a repeated request creates a second message | Header on `POST /message/send` and `/broadcast`; store `(tenant, key)` → response + payload hash; same key + same payload replays the response, different payload `409`; concurrent duplicates serialised by a unique constraint; retention ≥ 24 h. Must not promise exactly-once *delivery*. | 3 days |
| **Webhook contract** (WAHA/Stripe) | HMAC-SHA256 signature (`X-Webhook-Signature`), 3 in-process retries, `webhook_logs` | No stable **event id**, no signed **timestamp**, no replay/redeliver endpoint, retries are in-process (lost on restart) | 4 days (event id + timestamp in signature + persisted retries + redeliver endpoint) |
| **Failure diagnosis** | `error_message` holds a code (`workspace_suspended`, `device_paused`, `delivery_uncertain`, `recipient_opted_out`, `daily_cap_reached`, …) | No mapping to category / retryable / next step in the API or dashboard | 2 days (a table in `shared/`, exposed as `failure: {code, category, retryable, safe_to_retry, next_step}` and used by the dashboard) |
| **Sandbox / demo without a real number** | none | Onboarding P1 from the research; would need a fake transport mode clearly labelled as simulation | 4-5 days, later |
| **Cost meter** (RAM/CPU/queue/storage/support per device) | Prometheus metrics exist in the bot | Aggregation and a cost model; the research brief for it is separate | separate stage |

Not adopted: any claim of "anti-ban", library or license changes, price changes (prices in the research remain hypotheses), copying code from Evolution API (license terms need review first).

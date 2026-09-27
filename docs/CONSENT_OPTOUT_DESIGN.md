# Consent / opt-out: what exists, gaps, design and estimate

Separate from the outbound-controls fix (see [OUTBOUND_CONTROLS.md](OUTBOUND_CONTROLS.md)). **Design and estimates only; nothing in this file is implemented.** Estimates are engineering effort in person-days for one developer, before review, and are guesses to be re-checked after the first spike. Related research: `docs/research/2026-09-27-koneva/product-references.md` (P0 Produk + Trust; P0 Backend + QA). A consent flow reduces complaints and misuse; it is **not** WhatsApp's permission and not an anti-ban measure.

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

### 3.1 Consent model (`recipient_preferences`)
`(tenant_id, phone_number normalised, status: opted_in | opted_out, source: inbound_keyword | manual | api | import, evidence_ref (message id or free label, no message body), decided_at, decided_by user id or null, note ≤ 200 chars)`, unique `(tenant_id, phone_number)`, workspace-wide. Hash-at-rest is optional; the number is already stored in `contacts`/`messages`.

### 3.2 Writers
- Inbound keyword detection writes `opted_out` (source `inbound_keyword`, evidence = inbound message id) at reception, instead of re-deriving from history. A short "mulai/start" sets `opted_in`. The pattern gets a stricter mode (message consisting mainly of the keyword) to cut false positives.
- Owner/Developer API + dashboard: list, add, remove, import CSV; every change audited in the workspace audit log.
- `POST /message/send` and `/broadcast` accept an optional `consent: { basis: "opted_in"|"existing_customer"|"replied", ref? }` that is recorded (not verified).

### 3.3 Enforcement points (all four, so nothing bypasses)
1. API: `queueMessage` and each broadcast recipient answer `409 RECIPIENT_OPTED_OUT` immediately (broadcast reports per-recipient `status: "opted_out"`), for proactive traffic.
2. Worker: existing guard becomes a lookup in `recipient_preferences` (with the old history rule kept as a fallback during migration).
3. Auto-reply: never answers a message that is itself an opt-out; otherwise replies remain allowed (a reply to someone who wrote first).
4. Urgent/OTP: **policy decision needed**: an opt-out from marketing should not silence a user's own OTP. Proposal: urgent is exempt only when the caller marks it `purpose: "transactional"`, and this is logged.

### 3.4 Migration / privacy
Backfill from history with the current rule, marking `source = inbound_keyword`, so behaviour does not loosen. Retention: preferences kept while the workspace exists; export/delete with the workspace. Message text is never copied into the preference row.

### 3.5 Estimate
| Piece | Days |
|---|---|
| Migration + model + backfill | 1.0 |
| Inbound detection (stricter pattern, opt-in words) + tests | 1.5 |
| API enforcement in send/broadcast + worker + auto-reply + tests | 2.0 |
| Management API + audit + import | 1.5 |
| Dashboard page (list, add/remove, import, explanations) | 2.0 |
| Docs, review, edge cases (groups, `@lid` numbers, number formats) | 1.0 |
| **Total** | **about 9 days** (7 without the dashboard page) |

Decisions for the owner: workspace-wide vs per-number scope; urgent/OTP policy; whether the API should *require* a consent declaration for broadcasts (fits the "consented recipient" positioning, adds friction).

## 4. Other patterns worth adopting from the research (selective)

| Pattern | Current state | Gap | Estimate |
|---|---|---|---|
| **Send idempotency** (Stripe style `Idempotency-Key`) | `external_id` is stored, **not unique**: a repeated request creates a second message | Header on `POST /message/send` and `/broadcast`; store `(tenant, key)` → response + payload hash; same key + same payload replays the response, different payload `409`; concurrent duplicates serialised by a unique constraint; retention ≥ 24 h. Must not promise exactly-once *delivery*. | 3 days |
| **Webhook contract** (WAHA/Stripe) | HMAC-SHA256 signature (`X-Webhook-Signature`), 3 in-process retries, `webhook_logs` | No stable **event id**, no signed **timestamp**, no replay/redeliver endpoint, retries are in-process (lost on restart) | 4 days (event id + timestamp in signature + persisted retries + redeliver endpoint) |
| **Failure diagnosis** | `error_message` holds a code (`workspace_suspended`, `device_paused`, `delivery_uncertain`, `recipient_opted_out`, `daily_cap_reached`, …) | No mapping to category / retryable / next step in the API or dashboard | 2 days (a table in `shared/`, exposed as `failure: {code, category, retryable, safe_to_retry, next_step}` and used by the dashboard) |
| **Sandbox / demo without a real number** | none | Onboarding P1 from the research; would need a fake transport mode clearly labelled as simulation | 4-5 days, later |
| **Cost meter** (RAM/CPU/queue/storage/support per device) | Prometheus metrics exist in the bot | Aggregation and a cost model; the research brief for it is separate | separate stage |

Not adopted: any claim of "anti-ban", library or license changes, price changes (prices in the research remain hypotheses), copying code from Evolution API (license terms need review first).

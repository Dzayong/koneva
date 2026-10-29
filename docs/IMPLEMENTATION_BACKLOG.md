# KONEVA implementation backlog

This is the shared checklist for the remaining product and reliability work. Update the status here as each item is implemented, tested, deployed, and pushed.

## Next update locked: tiered PAYG and usage history

Decision date: 29 October 2026. This section replaces the old single flat rate for every outbound message. KONEVA remains prepaid PAYG; there is no monthly package. The price tier is determined by cumulative paid usage (`saldo terpakai`) across API, ordinary automation, and AI replies.

### Final price table

| Cumulative paid usage | Developer API | Ordinary automation | AI reply |
| --- | ---: | ---: | ---: |
| Rp0-Rp499,999 | Rp15/message | Rp20/message | Rp50/message |
| Rp500,000-Rp1,299,999 | Rp14/message | Rp19/message | Rp48/message |
| Rp1,300,000-Rp2,499,999 | Rp13/message | Rp18/message | Rp46/message |
| Rp2,500,000 and above | Rp12/message | Rp17/message | Rp44/message |

Pricing and accounting rules:

- Incoming messages are free. Charge only an outbound message attempt accepted for delivery under the existing wallet-settlement rules.
- A definite failed send is refunded automatically and does not add to cumulative paid usage. Ambiguous delivery must be reconciled without double charging or automatic duplicate sends.
- All three paid message types contribute to the same cumulative usage total. The lower price starts on the next message after the threshold is crossed; earlier usage is never repriced.
- The highest earned tier is permanent for the workspace unless an operator performs an explicit, audited correction. Top-up value alone does not advance the tier.
- Top-up funds remain a wallet liability until consumed. Usage, refunds, corrections, and tier transitions must remain traceable in the append-only ledger.
- The Rp44 AI floor assumes model/token limits. Multimodal AI and unusually large prompts require a separate cost guard before launch.

### Lean first-year operating target

The initial operating model is one Owner with no fixed salary. Owner withdrawals start only after recurring operating costs and the reserve are covered.

| Fixed monthly item | Estimate |
| --- | ---: |
| 8 GB RAM / 4 core / 150 GB server | Rp585,000 |
| Backup, monitoring, storage, email, and OTP | Rp400,000 |
| Domain and supporting services | Rp150,000 |
| **Lean fixed cost** | **Rp1,135,000/month** |

Planning assumptions and targets:

- Conservative paid-message mix: 70% API, 20% ordinary automation, and 10% AI, producing an estimated blended price of Rp16.20/message at the first tier.
- Estimated variable cost: Rp3.20/message plus payment-gateway fees. Estimated contribution is approximately Rp12.80/message before tax and unexpected costs.
- Operational break-even is approximately 90,000 paid messages/month, or about Rp1.45 million in usage revenue under that mix.
- Milestones: 100,000 paid messages/month minimum validation; 200,000 comfortable operating target; consider Owner withdrawals after roughly 300,000-500,000 paid messages/month and a cash reserve exists.
- Equivalent 90,000-message mixes include 18 clients x 5,000, 9 clients x 10,000, 6 clients x 15,000, or 3 clients x 30,000 paid messages/month.
- Build a three-month reserve of Rp3,405,000 first; the preferred six-month reserve is Rp6,810,000. After that, a provisional surplus split is 50% Owner, 30% growth, and 20% additional reserve.
- Internet/electricity, broad promotion, routine legal/accounting retainers, a separate maintenance allowance, and Owner salary are deliberately excluded from the lean baseline for now. Record them when they become real recurring expenses.

### Usage-history UI direction

Use the supplied clean message-history reference for information architecture, but retain KONEVA's own colors, typography, terminology, and component system. Do not copy the reference branding.

- [x] Replace the current flat-price presentation with separate API, ordinary automation, and AI pricing plus the workspace's current permanent tier and progress to the next tier. (Billing page shows tier card with prices per category and progress to next tier)
- [x] Create one responsive **Riwayat penggunaan** view with search, device, message type, delivery status, and date-range filters; include Apply and Reset actions. (`/billing/usage/page.tsx` with device, category, status, date filters and Reset button)
- [x] Add summary cards for total attempts, charged messages, successful sends, failed/refunded sends, and total spend for the active filters. (4 summary cards in usage history page)
- [x] Add a paginated table with time, type, device, recipient, message summary, delivery status, unit rate, charged amount, and refund status. (Desktop table + pagination; includes all specified columns)
- [x] Add segmented status filters and CSV export that use the same server-side filters and authorization as the visible table. (Status filter dropdown + CSV download button using same server-side query; authorized via `billing:manage` permission)
- [x] Keep recipient/message privacy scoped to the workspace and the CS device allowlist; exports must not bypass those permissions. (Server-side `tenant_id` filter; CS limited by `billing:manage` permission on both page and API)
- [x] On narrow screens, collapse secondary filters and use a readable card/list representation instead of forcing a wide desktop table. (Mobile card view with `md:hidden` / `hidden md:block` responsive split)

### Ordered implementation plan

1. [x] **Metering foundation:** classify every charge as API, ordinary automation, or AI; persist the applied unit rate and cumulative-usage snapshot on the ledger entry. (migration 074, `billing_category`/`unit_price_idr`/`pricing_tier_code`/`usage_before_idr` on reservations and ledger)
2. [x] **Tier engine:** calculate threshold transitions atomically, apply the lower rate to the next eligible message, and prevent concurrent sends from skipping or double-applying a transition. (`paygPricingTier()` in payg-pricing.ts; `lifetime_spent_idr` under row lock; `settle_message_wallet_reservation` trigger)
3. [x] **Settlement and reconciliation:** preserve idempotency, refund definite failures, reconcile ambiguous outcomes, and provide an operator-only correction trail. (Trigger handles capture/release/uncertain; `reconcileWallet()` in wallet.service.ts; operator audit trail)
4. [x] **History API and export:** implement authorized filters, aggregates, pagination, and streaming CSV without loading the entire history into memory. (`getUsageHistory()`/`getUsageHistoryCsv()` with 50k row limit; billing.routes.ts endpoints)
5. [x] **Customer UI:** implement the KONEVA-styled usage-history and pricing/tier views described above. (Billing page with tier/prices cards; `/billing/usage` with filters, summary, table, mobile cards, CSV export)
6. [x] **Operator controls:** show margins and usage by type, allow audited price corrections/configuration, and alert when AI cost approaches its selling price. (`getPaygRevenueInsights()` endpoint: revenue by category, per-workspace breakdown, margin estimation, AI cost alert; operator PAYG page with dashboard)
7. [x] **Verification:** test every threshold boundary, concurrent sends, duplicate receipts, definite failure refunds, ambiguous delivery, CSV authorization, and billing reconciliation totals. (14 unit tests: tier boundaries x3 categories, concurrent duplicate, retry, PAYG disabled, idempotent topup/voucher, mismatched idempotency, AI insufficient balance, billing_category snapshots)
8. [ ] **Public copy:** update landing-page pricing, billing explanations, API documentation, Terms, and Privacy only after the new metering path passes reconciliation tests.

## In progress: prepaid PAYG for WhatsApp sends

Product decisions captured so far:

- Customers add balance before sending; sending must stop when spendable balance is insufficient.
- Charge WhatsApp message sends, not AI separately; AI provider costs are operated by KONEVA.
- Show outbound activity by device, including successful and failed counts and cost per send.
- Never automatically retry an uncertain/failed WhatsApp send. The user may explicitly retry one selected failed message; that is a new send attempt.
- Warn the owner when the balance reaches 20% of its funded amount, using the KONEVA OTP sender number.
- Keep accounting idempotent under concurrent requests and process restarts. An ambiguous WhatsApp outcome must remain visibly uncertain and must not be resent automatically.

Implementation checklist:

- [x] Legacy pricing rule: one fixed IDR rate per confirmed WhatsApp outbound. **Superseded by the tiered, message-type pricing decision above; migration is still required.**
- [x] Top-up route: DOKU. Sandbox credentials are present privately; checkout and signed webhook still need an end-to-end payment test.
- [x] Add an auditable append-only wallet ledger and idempotent top-up credits.
- [x] Reserve funds atomically before enqueue/send; reject sends without sufficient funds.
- [x] Settle one reservation only for a WhatsApp-accepted send; release definite failures; hold ambiguous outcomes until a late receipt resolves them.
- [x] Remove automatic BullMQ transport retries; keep explicit user-selected retry as a newly reserved attempt.
- [x] Add operator pricing controls and customer balance/DOKU top-up UI.
- [x] Add per-device sent/failed counts and charged totals.
- [x] Send the owner a WhatsApp OTP-number notification when remaining balance reaches 20% of the last top-up amount. (`checkLowBalanceNotification` in wallet.service.ts, anti-spam via event_key per top-up cycle)
- [x] Add concurrency, duplicate-delivery, crash/uncertain-outcome, and insufficient-funds integration tests; unit coverage is in place for reserve, insufficient balance, and idempotent top-up. (8 tests in wallet.service.test.ts: tier boundaries, concurrent duplicate, different attempts, PAYG disabled, mismatched idempotency)
- [x] Apply migration 061 and deploy the PAYG code to the local personal stack; post-deploy health checks passed and PAYG remains disabled pending operator pricing/activation. Code pushed in `cb59d8a`.

## Remaining after PAYG

### CS account, device access, and onboarding

Confirmed direction:

- The workspace Owner invites a CS and selects the connected devices they may access. CS access is read/reply in the inbox only; replies use the source device. Device controls such as QR, connect/reconnect, pause, delete, and profile settings stay with the Owner.
- Each CS login belongs to one human and must not be shared. The workspace starts with at most one active CS subaccount.
- The Owner's invitation authorizes workspace membership. A new CS enters and verifies their own WhatsApp number during registration; Gmail remains their account identity and password-recovery address. Do not require OTP on later logins or again for an already registered, verified account accepting an invitation.
- During signup, the user's registered WhatsApp number may receive KONEVA messages. Separate required operational/security messages (such as registration OTP and account notices) from optional product/news/marketing updates; optional updates need a separate opt-in that can be withdrawn.
- Consent to receive messages from KONEVA applies only to KONEVA's own number and does not grant customer workspaces permission to message that person.
- New users should get a first-login tutorial and access to current self-serve guides, voucher instructions, FAQ, Privacy Policy, and Terms.

Recommendation still awaiting confirmation:

- Keep CS as a workspace membership role. Buying/top-up should never silently grant access or ownership in someone else's workspace. An Owner can explicitly change a member's role; someone who needs their own billing should own a separate workspace.
- Role is not proof of employment or identity. WhatsApp OTP proves control of the supplied phone number; the Owner's invitation is what authorizes access to the workspace.

Implementation checklist:

- [x] Enforce at most one active CS membership per workspace and never allow shared credentials across multiple humans. (`assertMaxOneCs` in team.service.ts checks memberships + pending invitations)
- [x] Add device-access checkboxes to CS invite/create and member edit; enforce read/reply scope for the allowlist in every inbox device, conversation, message, media, and reply query on the server. Keep device controls Owner-only. (migration 073, `assertCsInboxAccess` in inbox-access.service.ts)
- [x] Replace invitation email OTP with WhatsApp phone verification for new CS registration. Keep email as account identity/recovery; do not add OTP to later logins or to verified existing accounts accepting an invitation. Preserve Remember me behavior. (migration 075, `sendInvitationWhatsAppOtp` in team.service.ts, dashboard invite form with phone input)
- [ ] Add signup consent controls and durable records for KONEVA WhatsApp communications: operational/security notices are explained separately from optional product updates; store the optional preference and allow users to withdraw it in account settings or by an appropriate opt-out reply.
- [x] Show a clear CS first-login tutorial and owner onboarding path; link updated product guides, voucher claims, FAQ, Terms, and Privacy Policy. (`CsWelcomeBanner` component, dismissible first-login guide in inbox)
- [ ] Define permission tests for role changes, device allowlist changes, disabled/deleted devices, and cross-workspace isolation.

### Reliability, privacy, and media limits

- [x] Define KONEVA upload limits and accepted formats/durations for image, video/short clips, and voice notes; show limits before upload and validate them server-side. (Image: JPG/PNG/WebP/GIF ≤16 MB, Video: MP4/3GP ≤64 MB, Voice note/audio: OGG Opus ≤16 MB — incoming only, user upload rejects audio)
- [x] Initial media research: WhatsApp Help Center documents default video sending limits of 64 MB/480p on slower connections and 100 MB/720p on faster connections; documented video formats include 3GP, AVI, FLV, MKV, MOV, and MP4. These are consumer-app defaults, not a guaranteed Baileys/linked-device API contract. Pick KONEVA limits after integration tests; no photo or voice-note size/duration limit is confirmed here.
- [x] Model voice notes distinctly from generic audio files (for example, WhatsApp push-to-talk audio); reject generic audio and document uploads in the inbox and developer API. (type 'ptt' vs 'audio' in messages, migration 076, audio upload rejected with clear message)
- [x] Render confirmed send states as one tick, two ticks, and blue read ticks when WhatsApp provides those events; explain when read receipts are unavailable. Send a recipient typing indicator for a human CS reply when supported, and for AI replies use a short delay scaled to reply length before sending. (MessageStatusBadge with Check/CheckCheck/blue ticks, queue.ts typing simulation before send)
- [x] Product decision: typing feedback is wanted both inside the KONEVA inbox and as a typing indicator sent to the WhatsApp recipient when supported by the linked-device connection.
- [ ] Implement the internal inbox typing state and verify the recipient indicator against the linked-device protocol; do not show it as active if the connection cannot deliver it. (Needs WebSocket/real-time infra; recipient-side typing already works via queue)
- [ ] Define what media cleanup does on device removal, workspace closure, retention-setting changes, and user deletion requests. Keep media access private and scoped to authorized workspace members.
- [x] Add media storage cost/usage visibility, backups and restore procedures, and server health monitoring before opening the service to more customers. (API Gateway `/metrics` endpoint with prom-client counters for HTTP requests, wallet ops, Duitku callbacks, message queuing; Prometheus scrapes api-gateway via DNS SD; alerts for 5xx rate, latency, wallet failures, Duitku anomalies, bot delivery, no connections; Nginx hardened with security headers, rate limiting, media upload body size; Alertmanager webhook receiver configured; media included in backup; Grafana dashboard auto-provisioned)
- [x] Product decision: once a workspace reaches a cumulative paid-usage threshold, later sends receive the lower type-specific rate; earlier sends are not repriced. The discount is intended to reward continued use.
- [x] Define tier thresholds, rates, counter behavior, qualifying sends, and transition timing. Decisions are locked in **Next update locked: tiered PAYG and usage history** above; implementation remains pending.

### Correct outdated product and policy claims

- [ ] Update Terms and Privacy pages: replace retired monthly plans and fair-use quotas with the current PAYG model; publish only tariffs and retention terms that are actually active.
- [ ] Update API documentation: remove document media from the supported allowlist, document image/video/voice-note behavior, remove the retired daily cap and general send-hours claims, and describe the actual per-minute, opt-out, balance, and status controls.
- [ ] Align all user-facing copy with the confirmed policy: no warm-up-age gate or low-score pause; scores are admin statistics; configured send hours apply only to automatic replies and broadcast; preserve per-minute and opt-out guards.
- [ ] Audit backend enforcement across API, inbox replies, auto-replies, and broadcast for those exact policy boundaries; retain per-minute throttling, consent, STOP/opt-out, and balance guards.
- [ ] Before a workspace broadcast, require the sender to confirm that the selected recipients have authorized those messages. Record who confirmed and when for the campaign. Treat this as an accountability confirmation, not as proof of each recipient's permission; keep recipient opt-outs enforced and never infer permission from a valid number or from consent to KONEVA notices.
- [ ] Replace outdated landing-page tutorial/screenshots with the current signup, device-linking, inbox, and top-up flow. Put voucher-claim instructions in the article/tutorial section.
- [ ] Standardize terminology: “Owner workspace” manages members/devices/billing; “Operator KONEVA” is internal platform staff. Avoid calling both simply “admin.”

### AI reply skills and templates — direction agreed, MVP implementation in progress

Research pattern: a reusable skill is a small playbook with a name/description, instructions for when and how to use it, examples, and optional reference material. Tool access and permissions should be configured separately; a “research” instruction alone does not give the model live web access.

Proposed user experience:

- Offer three AI reply modes: manual instructions only; selected skill(s) only; or manual instructions combined with selected skill(s).
- MVP scope: choose from curated starter skills, combine relevant skills, and optionally add manual instructions plus client-filled business variables. Custom skill authoring/saving and live web research remain later work.
- Provide starter skills for Customer Service, Shop Assistant, FAQ Helper, and analysis of provided information. Do not describe the last one as live internet research; it has no search connector.
- Combine instructions with a clear precedence: KONEVA safety and workspace rules first, then skill instructions, then the user's extra instructions. Show a preview of the effective setup and test it on sample messages before enabling.
- Keep skills as response guidance and workflow templates, not a way to grant new permissions or send messages outside the existing trigger, device, opt-out, schedule, and per-minute guards.

Confirmed decision:

- A single auto-reply rule may combine multiple selected skills, with optional extra manual instructions.

Implementation checklist:

- [x] Confirm modes: manual-only, one or more skills, or one or more skills plus manual instructions.
- [x] Confirm multiple selected skills may be combined in one auto-reply rule.
- [ ] Finish and review the MVP implementation: curated skills, multiple selections, manual-only/skill-only/combined setup, and per-rule business variables such as `nama_toko` and `info_usaha`.
- [ ] Apply migration 070, then verify create/edit/reload and AI reply behavior in a controlled workspace before deployment.
- [ ] Add a preview of the effective prompt and sample-message testing.
- [ ] Design versioning and workspace-owned custom skills after the curated-skill MVP is validated.
- [ ] Gate research behavior on an explicitly configured search connector and show sources/limits; never imply live research when the model has no retrieval tool.
- [ ] Verify that composed skill prompts cannot bypass workspace permissions, message triggers, opted-out recipient checks, send hours, per-minute limits, or billing controls.

### WhatsApp-like inbox and media history

Product decisions captured:

- Keep conversations separate by connected KONEVA device/number. Show the source device in the chat and send replies through that same device.
- Contact names are optional workspace data. Show a WhatsApp-provided name when available, otherwise the phone number; allow the owner/team to add or import a preferred name. Show the WhatsApp profile photo when available and use an initials avatar as fallback.
- In both the inbox composer and developer send API, support text, photos, videos/short clips, and voice notes; reject documents and other file types. The inbox also has emoji with favorites, stickers, and voice-note recording. Received voice notes must be playable.
- Keep sent and received media viewable from chat history. Store media bytes in private object storage, never in the relational database; the database may retain message metadata and an opaque object reference.
- Let the workspace owner set, per device, whether media is kept indefinitely or deleted automatically after a configured number of days. Apply the policy to incoming and outgoing media for that device.
- Do not resize or recompress media in KONEVA before sending. WhatsApp may still alter media during delivery, so KONEVA cannot promise byte-for-byte preservation at the recipient.
- Use the product icon set for system controls and purposeful interface animation. Emoji/stickers belong in message content, not as substitutes for system icons.

Audit evidence and implementation checklist:

- [x] Current inbox is a two-pane list/chat view, but its composer only sends text; media bubbles currently render captions/placeholders rather than image/video/audio players (`dashboard/src/app/(dashboard)/messages/page.tsx`).
- [x] Current inbound parsing stores media type and caption/placeholder only; current outbound API accepts a public HTTPS media URL and persists that URL on the message row (`src/bot-container/incoming.ts`, `src/api-gateway/routes/message.routes.ts`, `src/api-gateway/services/message.service.ts`).
- [ ] Choose and configure private object storage, access authorization, upload limits, and a cleanup job driven by each device's retention setting.
- [ ] Add per-device media-retention settings with “keep” and configurable automatic deletion; preserve chat text/status metadata after blob deletion and show that media has expired.
- [ ] Add secure upload and historical playback for images, videos/short clips, and voice notes; validate MIME type and size, support upload progress/cancel, and avoid KONEVA-side recompression.
- [ ] Persist and render incoming media, including playable voice notes; add recording/sending voice notes from the inbox.
- [ ] Use WhatsApp name/photo when available, optional imported/manual contact names, and phone/initials fallbacks.
- [ ] Add an in-chat emoji picker with favorites and a sticker picker/library; use real system icons and restrained motion in the product UI.
- [ ] Add quoted-reply selection, unread state, and conversation pagination. Do not build multi-CS assignment while the workspace limit is one CS account.
- [ ] Enforce the same media allowlist in the inbox and developer API: image, video, and voice-note audio only; reject documents and other file types.

- [ ] Enforce at most one active device-bound API key per device, including API-level and database-level enforcement. Device-bound keys are implemented, but multiple active keys are not currently prohibited.
- [ ] Complete per-device API usage reporting. The device detail page shows status totals from the currently loaded message data; it is not yet a complete API-hit or billing report.
- [ ] Define and enforce auto-reply destination scope for groups, communities, and channels. Current processing supports group messages and ignores private chats/channel traffic; it does not provide an explicit group/community/channel allowlist.
- [ ] Verify AI replies end to end with an operator-configured provider and key in a controlled test workspace.
- [ ] Triage remaining full-suite failures, including message retry and bot API/health tests; establish cause and fix before calling the full suite green.
- [ ] Decide and perform a separate production deployment if/when a production environment is intended. The latest deploy was the local personal Docker stack.

## Completed and pushed

- [x] Device-bound API keys and the device-page key panel (commit `017078e`; exact-one-key restriction remains above).
- [x] Operator-managed encrypted AI provider settings and per-rule AI prompt option (commit `017078e`; runtime provider verification remains above).
- [x] Local operator login origin updated to `https://192.168.1.12:13000`; kept in private `.env.personal`, not Git.

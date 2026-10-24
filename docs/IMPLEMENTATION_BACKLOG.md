# KONEVA implementation backlog

This is the shared checklist for the remaining product and reliability work. Update the status here as each item is implemented, tested, deployed, and pushed.

## In progress: prepaid PAYG for WhatsApp sends

Product decisions captured so far:

- Customers add balance before sending; sending must stop when spendable balance is insufficient.
- Charge WhatsApp message sends, not AI separately; AI provider costs are operated by KONEVA.
- Show outbound activity by device, including successful and failed counts and cost per send.
- Never automatically retry an uncertain/failed WhatsApp send. The user may explicitly retry one selected failed message; that is a new send attempt.
- Warn the owner when the balance reaches 20% of its funded amount, using the KONEVA OTP sender number.
- Keep accounting idempotent under concurrent requests and process restarts. An ambiguous WhatsApp outcome must remain visibly uncertain and must not be resent automatically.

Implementation checklist:

- [x] Pricing rule: one fixed IDR rate per confirmed WhatsApp outbound; AI replies use the same rate, with AI cost absorbed by KONEVA. Superadmin sets the actual rate after choosing a provider/model.
- [x] Top-up route: DOKU. Sandbox credentials are present privately; checkout and signed webhook still need an end-to-end payment test.
- [x] Add an auditable append-only wallet ledger and idempotent top-up credits.
- [x] Reserve funds atomically before enqueue/send; reject sends without sufficient funds.
- [x] Settle one reservation only for a WhatsApp-accepted send; release definite failures; hold ambiguous outcomes until a late receipt resolves them.
- [x] Remove automatic BullMQ transport retries; keep explicit user-selected retry as a newly reserved attempt.
- [x] Add operator pricing controls and customer balance/DOKU top-up UI.
- [x] Add per-device sent/failed counts and charged totals.
- [ ] Send the owner a WhatsApp OTP-number notification when remaining balance reaches 20% of the last top-up amount. This threshold needs to be defined against top-up amount now that package balances are retired.
- [ ] Add concurrency, duplicate-delivery, crash/uncertain-outcome, and insufficient-funds integration tests; unit coverage is in place for reserve, insufficient balance, and idempotent top-up.
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

- [ ] Enforce at most one active CS membership per workspace and never allow shared credentials across multiple humans.
- [ ] Add device-access checkboxes to CS invite/create and member edit; enforce read/reply scope for the allowlist in every inbox device, conversation, message, media, and reply query on the server. Keep device controls Owner-only.
- [ ] Replace invitation email OTP with WhatsApp phone verification for new CS registration. Keep email as account identity/recovery; do not add OTP to later logins or to verified existing accounts accepting an invitation. Preserve Remember me behavior.
- [ ] Add signup consent controls and durable records for KONEVA WhatsApp communications: operational/security notices are explained separately from optional product updates; store the optional preference and allow users to withdraw it in account settings or by an appropriate opt-out reply.
- [ ] Show a clear CS first-login tutorial and owner onboarding path; link updated product guides, voucher claims, FAQ, Terms, and Privacy Policy.
- [ ] Define permission tests for role changes, device allowlist changes, disabled/deleted devices, and cross-workspace isolation.

### Reliability, privacy, and media limits

- [ ] Define KONEVA upload limits and accepted formats/durations for image, video/short clips, and voice notes; show limits before upload and validate them server-side.
- [ ] Initial media research: WhatsApp Help Center documents default video sending limits of 64 MB/480p on slower connections and 100 MB/720p on faster connections; documented video formats include 3GP, AVI, FLV, MKV, MOV, and MP4. These are consumer-app defaults, not a guaranteed Baileys/linked-device API contract. Pick KONEVA limits after integration tests; no photo or voice-note size/duration limit is confirmed here.
- [ ] Model voice notes distinctly from generic audio files (for example, WhatsApp push-to-talk audio); reject generic audio and document uploads in the inbox and developer API.
- [ ] Render confirmed send states as one tick, two ticks, and blue read ticks when WhatsApp provides those events; explain when read receipts are unavailable. Send a recipient typing indicator for a human CS reply when supported, and for AI replies use a short delay scaled to reply length before sending.
- [x] Product decision: typing feedback is wanted both inside the KONEVA inbox and as a typing indicator sent to the WhatsApp recipient when supported by the linked-device connection.
- [ ] Implement the internal inbox typing state and verify the recipient indicator against the linked-device protocol; do not show it as active if the connection cannot deliver it.
- [ ] Define what media cleanup does on device removal, workspace closure, retention-setting changes, and user deletion requests. Keep media access private and scoped to authorized workspace members.
- [ ] Add media storage cost/usage visibility, backups and restore procedures, and server health monitoring before opening the service to more customers.
- [x] Product decision: once a workspace reaches an admin-configured usage threshold, later sends should receive the lower per-message rate; earlier sends are not repriced. The discount is intended to reward continued use/top-ups.
- [ ] Define tier thresholds and rates, the usage counter/reset period, which successful sends count, and whether the lower rate starts immediately after crossing the threshold or only after the next top-up. Apply the tier to future message charges, not to the top-up amount itself.

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

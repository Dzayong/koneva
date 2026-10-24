# API Reference

Two APIs exist. Tenants and admin tooling talk to the **API Gateway**; only
Device Manager and API Gateway talk to a **Bot Container** directly.

## API Gateway (public)

`src/api-gateway`, port `8000`. Full OpenAPI spec: [`openapi.yaml`](./openapi.yaml)
— every endpoint and response shape in it was verified against a running
instance (`scripts/integration-test.ts`), not written from a spec alone.

**Auth**: tenant routes (`/api/v1/*`) take an `apikey` header (the tenant's
own key); admin routes (`/admin/*`) take an `x-admin-key` header
(`ADMIN_API_KEY`) — these are two different secrets, don't mix them up.

**Response envelope**: successful single-resource responses use
`{ success: true, data }`. Paginated lists use
`{ success: true, data, pagination: { total, limit, offset, has_more } }`.
Errors use `{ success: false, error: { code, message } }`. Legacy top-level
fields on send and QR responses remain temporarily for frontend compatibility.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/v1/message/send` | tenant | requires recipient opt-in for promotional sends; missing/opted-out consent returns 409 |
| GET | `/api/v1/messages` | tenant | filters: `device_key`, `status`, `direction`, `search` |
| GET | `/api/v1/messages/:id` | tenant | includes `status_history` |
| POST | `/api/v1/messages/:id/retry` | tenant | retry failed/blocked messages; `delivery_uncertain` is refused with `DELIVERY_UNCERTAIN_MANUAL_REVIEW_REQUIRED` because WhatsApp may already have accepted it |
| GET | `/api/v1/inbox/devices` | signed-in user | minimal device list for Inbox; requires `inbox:read` |
| GET | `/api/v1/inbox/conversations` | signed-in user | grouped by device and WhatsApp chat; requires `inbox:read` |
| GET | `/api/v1/inbox/messages` | signed-in user | requires `device_key` and exact `chat_key`; requires `inbox:read` |
| POST | `/api/v1/inbox/messages/:id/reply` | signed-in user | recipient/device are derived from the inbound message; requires `messages:reply` |
| POST | `/api/v1/broadcast` | tenant | queue up to 500 recipients |
| GET | `/api/v1/contacts/:id/consent` | tenant | read consent and its audit events |
| PUT | `/api/v1/contacts/:id/consent` | signed-in workspace user | manual changes require `source_note`; API keys cannot record consent |
| GET | `/api/v1/devices` | tenant | |
| POST | `/api/v1/devices` | tenant | create a device for the authenticated tenant; 429 at `max_devices` |
| GET | `/api/v1/devices/:key` | tenant | includes `qr_code` |
| GET | `/api/v1/devices/:key/qr` | tenant | always 200 for an owned device; includes status and nullable QR |
| POST | `/api/v1/devices/:key/pause` | tenant | sets `status='paused'`, actually blocks sending |
| POST | `/api/v1/devices/:key/resume` | tenant | sets `status='offline'`, not `'online'` |
| DELETE | `/api/v1/devices/:key` | tenant | delete the authenticated tenant's device workload |
| GET | `/api/v1/devices/:key/activity` | tenant | daily sent/received, active hours, streak, today's window, fatigue |
| GET/PATCH | `/api/v1/devices/:key/persona` | tenant | per-number pacing: 24-hour mode, fixed or random delay |
| GET | `/api/v1/devices/:key/events` | tenant | timeline of status changes (online, offline, banned, logged_out, error) |
| GET | `/api/v1/devices/:key/health` | tenant | readiness score (0-100) with per-factor breakdown and recommendations |
| GET/POST | `/api/v1/devices/:key/whatsapp-groups` | tenant | list groups/communities or create a group |
| PATCH/DELETE | `/api/v1/devices/:key/whatsapp-groups/:jid` | tenant | edit group name/description or leave from this linked number |
| POST | `/api/v1/devices/:key/whatsapp-groups/:jid/members` | tenant | add, remove, promote, or demote members; WhatsApp checks admin rights |
| GET | `/api/v1/devices/:key/whatsapp-groups/:jid/details` | tenant | group info and participant names/roles |
| GET/POST | `/api/v1/devices/:key/whatsapp-groups/:jid/invite[/revoke]` | tenant | retrieve the current invite link or replace it (old link stops working) |
| POST | `/api/v1/devices/:key/whatsapp-groups/:jid/picture` | tenant | upload a resized group profile photo as base64 |
| PATCH | `/api/v1/devices/:key/whatsapp-groups/:jid/settings` | tenant | update posting/info permissions, member-add mode, join approval, or disappearing-message duration |
| GET/POST | `/api/v1/devices/:key/whatsapp-groups/:jid/join-requests` | tenant | list pending membership requests and approve/reject selected participants |
| POST | `/api/v1/devices/:key/whatsapp-communities` | tenant | enqueue community creation; returns `202` and a `command_id` to poll at `/api/v1/devices/:key/commands/:id` |
| PATCH/DELETE | `/api/v1/devices/:key/whatsapp-communities/:jid` | tenant | edit community or leave it from this linked number |
| POST | `/api/v1/devices/:key/whatsapp-communities/:jid/groups` | tenant | link or unlink an existing group |
| GET | `/api/v1/devices/:key/whatsapp-channel?link=...` | tenant | look up channel metadata from its invite URL |
| GET/POST | `/api/v1/devices/:key/whatsapp-channels` | tenant | list channels recorded by KONEVA or create a channel |
| POST | `/api/v1/devices/:key/whatsapp-channels/follow` | tenant | follow a channel using its invite URL or newsletter JID |
| PATCH/DELETE | `/api/v1/devices/:key/whatsapp-channels/:jid` | tenant | update an owned channel or unfollow it |
| GET | `/api/v1/tenant` | tenant | authenticated tenant profile and quota usage |
| PATCH | `/api/v1/tenant` | tenant | update the tenant webhook URL |
| POST/GET | `/api/v1/contacts` | tenant | create or list tenant contacts |
| GET/PATCH/DELETE | `/api/v1/contacts/:id` | tenant | contact CRUD, tenant scoped |
| POST | `/api/v1/contacts/import` | tenant | CSV import/upsert (`{ "csv": "..." }`) |
| POST/GET | `/api/v1/templates` | tenant | create or list message templates |
| GET/PATCH/DELETE | `/api/v1/templates/:id` | tenant | template CRUD, tenant scoped |
| POST | `/api/v1/templates/:id/render` | tenant | resolve spintax and variables |
| GET | `/api/v1/analytics/overview` | tenant | message, delivery, response-time and device summary |
| GET | `/api/v1/analytics/daily` | tenant | daily series; `days` is 1–90, default 30 |
| GET | `/api/v1/dashboard/stats` | tenant | homepage aggregate statistics |
| GET | `/api/v1/devices/:key/stats` | tenant | per-device message statistics |
| GET/POST | `/api/v1/auto-reply-rules` | tenant | list or create auto-reply rules |
| GET/PATCH/DELETE | `/api/v1/auto-reply-rules/:id` | tenant | rule CRUD, tenant scoped |
| POST | `/api/v1/auto-reply-rules/:id/toggle` | tenant | toggle a rule's active state |

### WhatsApp groups and communities

Group and community writes run on the linked WhatsApp number. The number must be online,
the workspace plan must be active, and WhatsApp must grant that number permission for the
requested admin action. `DELETE` means the linked number leaves; it does not erase the group
for everyone. JIDs in path segments should be URL-encoded (`@` as `%40`).

```bash
curl "https://<host>/api/v1/devices/<DEVICE_KEY>/whatsapp-groups" \\
  -H "apikey: <API_KEY>"

curl -X POST "https://<host>/api/v1/devices/<DEVICE_KEY>/whatsapp-groups" \\
  -H "apikey: <API_KEY>" -H "Content-Type: application/json" \\
  -d '{"name":"Tim Toko","participants":["6281234567890"]}'

curl -X POST "https://<host>/api/v1/message/send" \\
  -H "apikey: <API_KEY>" -H "Content-Type: application/json" \\
  -d '{"device_key":"<DEVICE_KEY>","to":"120363000000-123456@g.us","message":"Siap, saya bantu.","reply_to_message_id":"<INBOUND_MESSAGE_UUID>"}'
```

To reply in a group, first read `GET /api/v1/messages?device_key=<DEVICE_KEY>&direction=inbound`.
Use the selected inbound message's `id` as `reply_to_message_id` and its `chat_jid` as `to`.
The API accepts group sends only when they quote a recent inbound message from that same group;
this protects the reply from being silently sent as a one-to-one message. Replies are restricted
to the recent-message window and still honor an opt-out from the participant whose message is
being answered. The inbox displays the group JID as its label until group names are synchronized
into the message record.

### WhatsApp channels

Channels followed or created through KONEVA are listed per device. This registry does not discover
channels followed directly in the WhatsApp app. `DELETE` unfollows a channel; it does not delete
the channel itself. Only a channel's owner can update its name or description. Channels are
broadcast-only, so followers cannot reply in chat.

```bash
curl -X POST "https://<host>/api/v1/devices/<DEVICE_KEY>/whatsapp-channels/follow" \\
  -H "apikey: <API_KEY>" -H "Content-Type: application/json" \\
  -d '{"link":"https://whatsapp.com/channel/<INVITE_CODE>"}'

curl -X POST "https://<host>/api/v1/devices/<DEVICE_KEY>/whatsapp-channels" \\
  -H "apikey: <API_KEY>" -H "Content-Type: application/json" \\
  -d '{"name":"Info Toko","description":"Pengumuman resmi toko"}'
```
| POST | `/admin/tenant/create` | admin | returns the new `api_key` |
| POST | `/admin/device/create` | admin | proxies to Device Manager's `docker run` |
| GET | `/admin/tenants` | admin | with device/message counts |
| GET | `/admin/devices` | admin | optional `?status=` filter |
| GET | `/admin/stats` | admin | |

### Tenant self-service devices

`POST /api/v1/devices`

- Auth: `apikey` (tenant)
- Body: `{ "phone_number"?: string, "label"?: string }`
- Response (`201`): `{ "success": true, "data": { "device_key": string, "status": "starting" } }`
- Returns `429` when the tenant has reached `max_devices`.

`DELETE /api/v1/devices/:deviceKey`

- Auth: `apikey` (tenant)
- Response: `{ "success": true }`
- Returns `404` when the device does not exist or belongs to another tenant.

`GET /api/v1/devices/:deviceKey/qr`

- Auth: `apikey` (tenant)
- Response: `{ "success": true, "device_key": string, "status": string, "qr_code": string | null, "has_qr": boolean }`
- Returns `200` for every status when the device belongs to the tenant. A QR code that is not currently available is represented by `qr_code: null` and `has_qr: false`.

### Tenant profile

`GET /api/v1/tenant`

- Auth: `apikey` (tenant)
- Response: `{ "success": true, "data": { "id", "name", "email", "api_key", "webhook_url", "max_devices", "quota_messages", "used_messages", "status", "created_at", "updated_at" } }`
- The webhook secret is not returned.

`PATCH /api/v1/tenant`

- Auth: `apikey` (tenant)
- Body: `{ "webhook_url": string | null }`
- Only HTTP and HTTPS URLs are accepted; `null` clears the webhook URL.
- Response uses the same `{ "success": true, "data": tenant }` envelope as the GET endpoint.

### Contacts

Contacts are isolated by the authenticated tenant. `POST /api/v1/contacts` accepts
`phone_number`, optional `name`, `tags` and `notes`. `GET /api/v1/contacts`
supports `search`, `limit`, and `offset`. CSV import is JSON-based and accepts a
`csv` string whose header contains `phone_number` (also accepts `phone` or
`number`); optional columns are `name`, `tags`, and `notes`. Tags use `|` or `;`
inside the CSV cell. Existing phone numbers are updated during import.

### Message templates

Templates contain `name`, `content`, and optional `is_active`. Content supports
spintax (`{Halo|Hi|Hey}`) and named variables (`{nama}`, `{tanggal}`). Responses
include the detected `variables`. `POST /api/v1/templates/:id/render` accepts
`{ "variables": { "nama": "Ayu" } }` and returns rendered content.

### Analytics

`GET /api/v1/analytics/overview` returns `total_messages`, percentage
`delivery_rate`, `avg_response_time` in seconds, and `active_devices`.
`GET /api/v1/analytics/daily?days=30` returns zero-filled daily totals with
inbound, outbound, delivered, and read counts.

### Auto-reply

Bot containers load active `auto_reply_rules` for their device at startup.
Trigger types are case-insensitive `keyword`, `regex`, and `all`. Responses may
be fixed text/templates, general AI (`ai_general`), or AI with the rule's single
role/instructions description (`ai`). General AI receives only the triggering
message and is instructed not to invent missing details. AI needs an enabled
system provider; credentials stay in the API gateway. Replies use the rule delay
together with anti-ban controls and are recorded in `messages` plus `auto_reply_logs` (`sent`, `blocked`, or
`failed`). CRUD changes publish a device-specific Redis signal, so the relevant
bot reloads active rules without a restart. Rule creation verifies that the
target device belongs to the authenticated tenant; update, toggle, and deletion
are also tenant scoped.



## Accounts, sessions and roles

People sign in to the console with an account; systems call the API with a key. The two are separate
credentials. Both reach the same `/api/v1` routes, and every route checks a permission.

**Sign up** reserves a pending account and sends a one-time code to the required Indonesian WhatsApp
number. Confirming the WhatsApp code verifies that number and activates the account/workspace, but
does not verify the email; email verification remains required for actions such as inviting teammates
or billing, and password recovery uses the registered email. Until the WhatsApp code is confirmed,
the account cannot log in and has no workspace, trial,
membership, or session. A new workspace is a trial (1 number, 200 messages) until an operator raises
the limits.

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/signup` | `{ email, password (10+ chars), name, workspace_name?, verification_method?: "whatsapp", phone_number, accept_terms: true }`; WhatsApp number is required. Returns `202 { verification_required, verification_method, email, resend_after }`. Terms include that this service connects through an unofficial channel. 10 per hour per IP. |
| POST | `/auth/signup/verification/request` | `{ email, channel?: "email"|"whatsapp" }`; resends a pending signup OTP subject to cooldown/rate limits. |
| POST | `/auth/signup/verification/confirm` | `{ email, code, channel?: "email"|"whatsapp" }`; consumes the selected OTP, activates the account and returns the first session/workspace. WhatsApp confirmation leaves `email_verified_at` unset. |
| POST | `/auth/login` | `{ email, password }`. Five wrong attempts lock that email and IP for 15 minutes. |
| POST | `/auth/password-reset/request` | `{ email }`; sends a 6-digit reset code by email if the account exists. Response shape is identical for unknown addresses. Code expires in 30 minutes; resend is rate limited. |
| POST | `/auth/password-reset/confirm` | `{ email, code, new_password (10+ chars) }`; consumes the code once, updates the password, and revokes all existing sessions for that account. |
| POST | `/auth/logout` | Revokes the session in the `Authorization` header. |
| GET | `/auth/me` | Current user, workspace, role and permission list. |

A session token (`wgs_...`) goes in `Authorization: Bearer <token>`. The dashboard's “Remember me”
keeps it for 14 days when selected; otherwise it uses browser-session storage. If you belong to several
workspaces, select one with the `x-workspace` header (workspace id).
`GET /api/v1/tenant` never returns the legacy tenant key to a signed-in person.

**Roles**

| Role | Can do |
|---|---|
| `owner` | The customer who owns the workspace (one per workspace). Everything, including billing, the team, and every Developer power, without a second membership |
| `developer` | Technical integration: add, configure, connect, pause and **delete** numbers, send messages, webhooks, content, API keys. Cannot touch billing or the team, and cannot invite, remove or promote anyone |
| `cs` | Reads and replies to conversations from all workspace devices through Inbox only. Cannot send arbitrary messages, broadcast, run campaigns, or access settings |
| `admin` (legacy) | Existing memberships only: everything except billing. Can no longer be assigned or invite |
| `viewer` (legacy) | Existing memberships only: read numbers and messages, no QR. Can no longer be assigned |

Inviting, changing the team and ordering (`POST /billing/orders`) answer `403 EMAIL_NOT_VERIFIED` until the Owner has verified their email. `/auth/me` returns `user.email_verified`.

Workspace roles are memberships, not account types: one account can hold different roles across workspaces. The KONEVA system administrator is a separate operator account (Operator Panel), not a role here.
See [ROLES.md](ROLES.md).

A route with no permission rule is denied. The QR code counts as a write-level permission because whoever
scans it controls the number.


### API keys with limited access

Create keys for your systems instead of sharing a person's access. Manage them signed in (`keys:manage`):
developers and owners can (legacy admins too); a key cannot create keys.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/keys` | Lists keys (name, prefix, scopes, last used). Never returns the key itself. |
| POST | `/api/v1/keys` | `{ name, scopes: [...], expires_in_days? }`. The key (`wgk_...`) is shown **once**. |
| POST | `/api/v1/keys/:id/rotate` | `{ overlap_hours? }` (default 24). Issues a new key; the old one keeps working for the overlap so you can redeploy without downtime. |
| DELETE | `/api/v1/keys/:id` | Revokes immediately. |

Send a key as `apikey: wgk_...` or `Authorization: Bearer wgk_...`. Available scopes: `devices:read`,
`devices:write`, `devices:delete`, `messages:read`, `messages:send`, `content:write`, `webhooks:manage`. You
can only grant scopes your own role has, and at most 20 keys can be active. A key that only sends OTP needs
only `messages:send`.

### Team and invitations

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/api/v1/team` | owner (legacy admin: read) | Members and pending invitations. |
| POST | `/api/v1/team/invitations` | owner | `{ email, role: "developer" }`. The address must be `@gmail.com` (whitespace/case normalised, nothing else folded). Returns a link (`/invite/wgi_...`) to share yourself. Works once, only for that address after an emailed OTP, and expires in 48 hours. `400 GMAIL_REQUIRED`, `400` for any other role. |
| DELETE | `/api/v1/team/invitations/:id` | owner | Revokes a pending link. |
| PATCH | `/api/v1/team/members/:id` | owner | `{ role: "developer" }`: the only change possible (turns a legacy admin/viewer into a Developer, by explicit decision). Not for yourself or the owner. |
| DELETE | `/api/v1/team/members/:id` | owner (legacy admin: developers/viewers) | Removes someone from the workspace. |
| GET | `/auth/invitations/:token` | public | Workspace, role, masked email, `requires_otp`, `otp_available`. |
| POST | `/auth/invitations/:token/otp` | public | Emails a 6-digit code (10 minutes, 5 wrong tries, 60 s between sends) to the invited address. Limits: 3/hour per invitation, 3/hour and 6/24 h per recipient inbox (Gmail aliases share a bucket), 10/24 h per workspace, 200/24 h overall, 20 requests/15 min per IP; over a limit `429 OTP_RATE_LIMITED` (overall: `503 OTP_CAPACITY_REACHED`) with `Retry-After`. `503 EMAIL_NOT_CONFIGURED` while no sender is configured: nothing is counted or created and there is no bypass. |
| POST | `/auth/email-verification/request` | session | Mails a code to the account's own address (any domain). Same mailer and limits. `{ already_verified: true }` if done. |
| POST | `/auth/email-verification/confirm` | session | `{ code }`. `422 OTP_INVALID` for a wrong/expired/used code. Sets `email_verified_at`. |
| POST | `/auth/invitations/:token/accept` | public | `{ otp, name, password, accept_terms: true }` for a new person; someone with an account signs in first, sends their session token and `{ otp }`. The signed-in address must equal the invited one (`403 EMAIL_MISMATCH`, checked before the code is tried). `401 OTP_INVALID` covers wrong, expired, used and exhausted codes. |

### Audit log

`GET /api/v1/audit?limit=50&before=<time>` (owner, admin) lists who did what: number created, paused or
deleted, pacing changed, webhook changed, keys created, rotated or revoked, team changes, broadcasts and
auto-reply changes. Message sends are not listed; use the message log for those.


### Roles for a number (presets)

Instead of tuning delays by hand, pick what a number is for: `GET /api/v1/presets` lists them and
`POST /api/v1/devices/:key/preset` with `{ "preset": "customer_service" | "notifications" | "careful_marketing" }`
applies one. Each number keeps small variations of its own, so two numbers on the same preset do not share
one rhythm. Editing pacing by hand afterwards makes the number `custom`.

| Preset | For | Behaviour |
|---|---|---|
| `customer_service` | Answering customers | 24 hours, random delay 5-60 s |
| `notifications` | Reminders and notices | 24 hours, delay 1-5 s, long runs. Tenant OTP messages use the ordinary consent, quota, and pacing rules |
| `careful_marketing` | Messages to opted-in contacts | About 08:00-20:00, delay 20-90 s, frequent rests |

### New numbers and replies

A connected online number can start conversations and send media immediately; no send block is based
on device age. Recent inbound messages do not create marketing consent; promotional sends and
automated replies still require recorded opt-in. A message that has to wait stays `queued`; the
message status and error explain the delay. Device status, health-based daily caps, send-rate limits,
consent, active hours, and content checks still apply.

### Consent and transactional sends

Promotional/proactive sends require a recorded recipient opt-in. The recipient can send a standalone
`START`/`MULAI` message to opt in and `STOP`/`BERHENTI` to opt out. Missing consent returns HTTP 409
`RECIPIENT_CONSENT_REQUIRED`; an opted-out recipient returns HTTP 409 `RECIPIENT_OPTED_OUT`.
Broadcast still responds 202 overall and reports each refused recipient with `status: "failed"` and
the corresponding `error_code`. A STOP blocks pending promotional messages and receives one
non-promotional confirmation. Manual consent changes are available only to a signed-in workspace
user and require a source note; an API key cannot claim consent.

`priority: "urgent"` is not a trust signal and cannot bypass consent, quota, or pacing. Tenant API
requests cannot classify a message as an OTP: `otp_code` is rejected. Tenant-sent OTPs therefore use
the ordinary queue and rules. Only OTPs generated by KONEVA's internal verification flow receive the
platform-managed transactional handling.

There is no device-age delay before sending. Health-based daily caps and general sending controls
still apply from the start. Tenant-sent OTP text follows the same consent and sending rules as other
messages. Templated, high-volume OTP sending to many strangers may be treated as automated; volume
and risk on your own numbers are your responsibility.

### OTP messages

Tenant API sends are ordinary messages even when their text contains a one-time code. The public send
endpoint rejects `otp_code`; caller-provided text is not proof that KONEVA generated or verified the
code. These sends require the same recipient consent, plan quota, and per-device pacing as other
tenant messages. KONEVA-generated account-verification OTPs use an internal platform-only path.

### Pacing per number (persona)

Every number has its own habits, drawn once and kept: active hours, delay between messages, how long
a burst of sends lasts before it rests, and typing speed. Change them with `PATCH /api/v1/devices/:key/persona`:

| Field | Meaning |
|---|---|
| `always_on` | `true` keeps the number active 24 hours. When `false`, replies outside active hours are refused and logged as blocked. |
| `delay_ms` | Fixed delay, e.g. `5000` for exactly 5 seconds. Cannot be combined with min/max. |
| `delay_min_ms` / `delay_max_ms` | Random delay between the two, e.g. `5000` and `100000`. Range 1 s to 10 min. |
| `burst_size`, `rest_min_ms`, `rest_max_ms` | Sends in one run before resting, and how long the rest lasts (1-120 min). |
| `wake_hour`, `sleep_hour`, `timezone` | Active hours when `always_on` is `false`. |

The delay is the total time to send, including reading and typing. Rests apply to proactive sends only;
replies to people who wrote first are never held back.

### Device status webhook

When a number's state settles, a `device.status_changed` webhook is sent and the change is stored
(see `GET /api/v1/devices/:key/events`):

```json
{ "event": "device.status_changed", "device_key": "WAPI-XXX", "status": "banned",
  "previous_status": "online", "reason": "forbidden_403", "code": 403,
  "timestamp": "2026-09-25T17:42:55.254Z" }
```

| `status` | Meaning | What to do |
|---|---|---|
| `online` | Connected | Nothing |
| `offline` | Could not reconnect after several attempts | Check the phone's internet, then resume the device |
| `logged_out` | Unlinked from the phone or invalidated (401) | Scan a new QR |
| `banned` | WhatsApp refused the account (403), likely banned or restricted | Stop sending; messages to this number fail immediately with `device_banned` |
| `error` | Session unusable (`connection_replaced`, `bad_session`, `multidevice_mismatch`) | Close other sessions using the same number, or re-pair |

WhatsApp does not tell us why an account is refused, so `banned` means "suspected". This service uses an
unofficial connection; WhatsApp states that unofficial apps can lead to a temporary or permanent ban.

## Plans and billing

The separate session-authenticated operator API is documented in [OPERATOR_PANEL.md](OPERATOR_PANEL.md).
It is disabled by default and currently limited to isolated development/testing pending MFA. The legacy `/admin`
maintenance endpoints below remain separate; their admin key never authenticates `/operator`.

Legacy package billing supports manual confirmation and DOKU checkout.

**PAYG (feature-gated):** When the superadmin enables PAYG in `/operator/system/payg`, package checkout is retired
for customer workspaces. Owners top up Rp10.000–Rp10.000.000 through the Duitku POP sandbox checkout below. The configured
fixed IDR tariff is reserved atomically before a message enters the queue, charged only on a WhatsApp send/delivery/read
receipt, returned for a definite failure, and held for an ambiguous result until a late receipt resolves it. AI replies
use the same per-message tariff; KONEVA absorbs the AI provider cost. Unreserved old queue rows are stopped at cutover
and marked for review. Devices are not restricted by plan tiers under PAYG; send rate and safety guards still apply.

**Catalog (T1.1):** Pelajar (`pelajar`, Rp29.000/1 device/1.000 pesan/1 anggota, needs student verification),
Asisten Pribadi (`asisten`, Rp59.000/1/5.000/1), Tim UKM (`umkm`, Rp99.000/3/10.000/3 — id kept stable from the
older "UMKM" plan), Bisnis CS (`tim`, Rp199.000/5 device/10 anggota). Bisnis CS's real enforced monthly cap is
20.000 messages (fair-use); `GET /public/plans` and `GET /api/v1/billing` expose this as `quota_headline`
("Unlimited pesan*") and `quota_note` (the fair-use figure) alongside the plain `monthly_messages` number — every
surface (pricing, Syarat, Privasi, dashboard) shows the same two strings, never a separately hand-written copy.

**Annual checkout is closed for new orders.** `POST /api/v1/billing/orders` only accepts `"cycle": "monthly"`;
`"cycle": "yearly"` now answers `400 ANNUAL_CHECKOUT_CLOSED` before any other validation. Existing yearly
subscriptions and their invoice history are unaffected and remain fully readable.

**Grandfathered pricing.** A subscription created before the 2026-09-29 price change keeps paying its original
rate on every renewal for as long as it stays on the same plan (internally: a `price_override_idr` snapshot on
the subscription row, never rewritten by a renewal, never applied if the plan is changed). Past invoice amounts
are historical records and are never rewritten by a later price change either way.

| Endpoint | Who | What |
|---|---|---|
| `GET /public/plans` | anyone | Published plans, with `quota_headline`/`quota_note`. Prices are `null` until the operator marks them final. |
| `GET /api/v1/billing` | owner | Subscription, usage (messages held/exempt included, numbers, members), invoices, payment instructions. |
| `POST /api/v1/billing/orders` `{plan, cycle: "monthly"}` | owner | Creates an invoice. Replaces the previous unpaid one. `cycle: "yearly"` is refused (see above). |
| `POST /api/v1/billing/payg/topup-checkout` `{amount_idr}` | verified owner | Creates a Duitku POP sandbox checkout for a PAYG wallet top-up (available only when PAYG is enabled and Duitku credentials are configured). |
| `POST /api/v1/billing/student-request` `{note}` | owner | Asks for student verification (campus/school email required). |
| `GET /auth/me` | any member | Includes `subscription` (status, days left) for the banner. |

Order errors: `400 ANNUAL_CHECKOUT_CLOSED`, `409 PRICE_NOT_FINAL`, `409 STUDENT_NOT_VERIFIED`, `400 INVALID_PLAN`.

**Quota enforcement holds, it does not drop.** Once the monthly message quota is spent, a send is accepted
(`202`) but comes back with `"status": "quota_hold"` instead of `"queued"` — the message is kept, never
dropped or silently failed, and `GET /api/v1/billing`'s `usage.messages_held` reports how many are waiting.
Held messages are released automatically, oldest first, the moment the workspace has headroom again (a new
billing window, an upgrade, or another message finishing this period) — checked on every send and swept every
few minutes server-side, so a hold never outlives the quota that caused it for long. KONEVA-generated
platform verification messages are managed internally and are outside tenant API usage. Other enforcement: `402 PLAN_INACTIVE` (send / add number),
`402 PLAN_MEMBER_LIMIT` (invite). A late payment keeps working for a 7-day grace period, then sending stops;
reading data still works.

Operator (admin key): `GET/PATCH /plans`, `GET /subscriptions`, `GET /invoices`,
`POST /invoices/:id/pay|void`, `POST /tenant/:id/student-verify`,
`POST /tenant/:id/subscription` (grant a plan).

## Media in messages and broadcasts

`POST /api/v1/message/send` and `POST /api/v1/broadcast` accept `media_url` (public `https` address; private
addresses are rejected) and `media_type` (`image` default, `video`, `document`). `message` then becomes the
caption and may be empty. For private uploads, send the raw file bytes as `image/jpeg`, `image/png`,
`image/webp`, `image/gif`, or `video/mp4` to `POST /api/v1/media/upload?device_key=<device_key>` with that
device's API key and `content:write` permission. The response contains a `media_id`; pass it with `media_type`
and `message` to `/message/send`. Images are limited to 16 MiB and videos to 64 MiB. Inbox replies use
`POST /api/v1/inbox/messages/:id/reply` with `{message, media_id, media_type}`. Incoming image/video webhook
events include `type` and, when the media was downloaded successfully, `media_id`; fetch bytes from
`GET /api/v1/media/:id` using the same tenant API key. The inbox displays received and sent image/video.

Each device has a media retention policy available at `GET/PATCH /api/v1/devices/:device_key/media-retention`
(`devices:read` / `content:write`). `media_retention_days` may be `1`, `7`, `30`, `90`, or `null` for no
automatic expiry. New uploads use the selected policy, and changing it recalculates expiry for existing media.
Files live in private filesystem storage; the database holds metadata only. Expired files are removed by the
API's periodic cleanup job. Keep the configured media volume persistent and backed up according to your policy.

Links written in `message` are clickable for the recipient; no link preview card is generated. A device may
send media as soon as it is connected and online; general sending controls still apply.

`POST /api/v1/broadcast` requires an `Idempotency-Key` header (8–128 letters, digits, `.`, `:`, `_`, or `-`).
Retry a request with the same key and identical body after a timeout; KONEVA reuses the same broadcast and
recipient message IDs. Reusing that key with a different body returns `409 IDEMPOTENCY_KEY_CONFLICT`.
Use a new key for a deliberately new broadcast. Broadcast idempotency records are tenant-scoped.

## Status and device profile

These run on the device itself (the WhatsApp number), so it must be online. They are asynchronous commands
stored in `device_commands`; the bot claims and runs them, and the API either waits for the answer (profile
calls, up to 22-40 s: `504 DEVICE_NOT_RESPONDING`, or `504 WA_TIMEOUT` when WhatsApp itself stays silent) or
returns `202` (status posts).

**Status (WhatsApp Story)**

| Endpoint | Permission | What |
|---|---|---|
| `POST /api/v1/devices/:key/status` | `content:write` | `{kind: text\|image\|video, text?, media_url?, caption?, background?, audience: chatted\|list, numbers?, send_at?}` → `202 {command_id, status, run_at}` |
| `GET /api/v1/devices/:key/status` | `devices:read` | last 30 status posts with state (`queued`, `running`, `done`, `failed`, `cancelled`) and `views` |
| `GET /api/v1/devices/:key/commands/:id` | `devices:read` | one command and its result |
| `GET /api/v1/devices/:key/commands/:id/viewers` | `devices:read` | who opened a status: `{viewers: [{number, viewed_at}], total}` |
| `POST /api/v1/devices/:key/commands/:id/cancel` | `content:write` | cancel while still `queued` |

- Media is fetched by the bot: `media_url` must be a public `https` address (private addresses are rejected).
- WhatsApp needs to know who may see a status. `audience: "chatted"` uses people this device has exchanged
  messages with in the last 90 days (max 500); `"list"` uses the given numbers. With nobody to show it to the
  post fails with `NO_AUDIENCE`.
- A post outside the device's active hours waits until it "wakes up" (plus 0-20 random minutes).
- At most **3 posts per device per day** (`429 STATUS_LIMIT`). A caution, not a measured WhatsApp limit.
- `send_at` schedules up to 7 days ahead.
- **Views:** counted from the read receipts WhatsApp sends back. Only people whose own "read receipts" setting
  is on are reported, so it is a lower bound. Recorded by the bot from `message-receipt.update` events;
  **not yet confirmed against a real posted status**.

**Profile**

| Endpoint | Permission | What |
|---|---|---|
| `GET /api/v1/devices/:key/profile` | `devices:read` | `{jid, phone, name, about, picture_url, is_business, business}` |
| `PATCH /api/v1/devices/:key/profile` | `content:write` | `{name? (<=25), about? (<=139), business?: {description?, address?, email?, websites?, hours?}}`; `business` needs a WhatsApp Business number (`409 NOT_BUSINESS`) |
| `POST /api/v1/devices/:key/profile/picture` | `content:write` | exactly one of `image_url` (public https) or `image_base64` (<= ~300 KB; the dashboard resizes to 640 px) |
| `DELETE /api/v1/devices/:key/profile/picture` | `content:write` | remove the photo |

`hours.days[]` is `{day: mon..sun, mode: specific_hours|open_24h|appointment_only, open?, close?}` (`HH:MM`).
Verified live on a real Business number: `GET profile` (read only). **Not yet verified live:** changing the
name, About, photo or business profile (they alter a real number, so they were only unit-tested).

**Catalog was removed.** WhatsApp did not answer catalog queries from a linked device (8 stanza variants tried on
a Business number that has a catalog; matches an upstream Baileys report), so the feature was dropped instead of
shipping something that shows "empty catalog" falsely. Revisit if Baileys or WhatsApp changes.

## Bot Container (internal)

Each running `bot-container` process exposes a small HTTP API on
`BOT_CONTAINER_PORT` (default `9000`). One instance == one WhatsApp device.
This is an **internal** API: Device Manager and API Gateway are its callers,
not end users. Its own queue worker is what actually drains the messages
API Gateway enqueues — this section is about the HTTP surface only.

## Authentication

Every route except `GET /health` and `GET /ready` requires an API key, sent
as either header:

```
x-api-key: <key>
Authorization: Bearer <key>
```

Valid keys come from `BOT_API_KEYS` (comma-separated, for zero-downtime
rotation — add the new key, redeploy, remove the old one) and fall back to
`ADMIN_API_KEY` if `BOT_API_KEYS` is unset. An invalid or missing key returns:

```json
{ "error": { "code": "unauthorized", "message": "Invalid or missing API key" } }
```

## Error format

Every error response has this shape:

```json
{ "error": { "code": "validation_error", "message": "...", "details": { } } }
```

| Status | code | When |
|---|---|---|
| 400 | `validation_error` | Bad request body (missing/invalid fields, malformed JSON) |
| 401 | `unauthorized` | Missing or invalid API key |
| 404 | `not_found` | Unknown route |
| 429 | `rate_limited` | Too many `POST /send` calls (60/min) |
| 500 | `internal_error` | Unhandled server error (logged with request context) |

## Endpoints

### `GET /health`

No auth required. For liveness probes — checks Postgres/Redis/WhatsApp.

```json
{
  "status": "degraded",
  "device_key": "WAPI-TEST01",
  "uptime": 123.4,
  "dependencies": { "db": true, "redis": true, "whatsapp": false },
  "detail": { "whatsapp": "connection status is 'qr_pending'" }
}
```

`status`: `healthy` (200) | `degraded` (200 — WhatsApp not connected, e.g.
mid-QR/reconnect, this is normal) | `unhealthy` (503 — Postgres or Redis
unreachable, this is not normal). `detail` is only present for failing
dependencies.

### `GET /ready`

No auth required. For readiness probes — returns `503` until the WhatsApp
socket is actually `online`. Use this, not `/health`, to gate traffic —
`/health` intentionally stays `200` while merely disconnected.

```json
{ "ready": true, "status": "online" }
```

### `GET /metrics`

No auth required (same convention as `/health`/`/ready` — protect at the
network layer, e.g. don't expose the port publicly). Prometheus exposition
format. Key series: `wa_bot_messages_sent_total`,
`wa_bot_messages_failed_total{reason}`, `wa_bot_message_duration_seconds`,
`wa_bot_active_connections`, `wa_bot_anti_ban_denials_total{reason}`,
`wa_bot_webhook_dispatch_total{event,outcome}`,
`wa_bot_queue_job_duration_seconds`, plus prom-client's default Node
process/event-loop metrics under the `wa_bot_` prefix.

### `GET /status`

Full device status: connection state + the device's row from the database
(health score and pause state). The device row is served from a 3s
Redis cache — display-only, never used for anti-ban decisions.

```json
{
  "device_key": "WAPI-TEST01",
  "connection": {
    "status": "online",
    "reconnectAttempt": 0,
    "lastConnectedAt": "2026-09-24T10:00:00.000Z",
    "lastDisconnectReason": null
  },
  "hasSession": true,
  "device": {
    "id": "3fb1ebdb-...",
    "tenantId": "8fca6485-...",
    "status": "online",
    "healthScore": 72,
    "pausedUntil": null
  },
  "uptimeSeconds": 3600.2
}
```

### `POST /send`

Queues a message (BullMQ) for this device. Actual sending is gated by
`anti-ban.ts` (health-based daily caps, rate limits, sending window, content rules) —
`202` means "accepted into the queue", not "delivered". Rate-limited to 60
requests/minute per bot-container.

Request:

```json
{ "to": "6281234567890", "type": "text", "content": "Halo Budi" }
```

- `to`: digits only, 8–15 characters (country code + number, no `+` or `@s.whatsapp.net`)
- `type`: `text` (default) | `image` | `video` | `audio` | `document` — for
  non-text types, `content` is the media URL (there's no separate
  caption field in the schema yet)
- `content`: 1–4096 characters

Response (`202`):

```json
{ "messageId": "9380ccc2-9098-...", "status": "queued" }
```

Poll `GET /status` or watch for the `message.sent` / `message.delivered` /
`message.read` / `message.failed` webhook events (see below) for the outcome.

## Webhooks

A webhook is a call from us to your server when something happens: a message is sent, delivered,
read, fails, someone writes to your number, or the number's state changes. It saves you from polling.

### Set up

1. Save an `http(s)` URL (`PATCH /api/v1/tenant {"webhook_url": "..."}` or Dashboard → Webhook).
   Private and local addresses are rejected.
2. Create a signing secret: `POST /api/v1/tenant/webhook/secret` → `{"data":{"secret":"whsec_..."}}`.
   It is shown **once**; creating a new one replaces the old one immediately. `GET /api/v1/tenant/webhook`
   returns `{url, secret_set, secret_hint}` (last 4 characters only).
3. Send a test: `POST /api/v1/tenant/webhook/test` → `{success, status, detail, duration_ms}`. It posts a
   signed `webhook.test` event and reports your server's answer.
4. Recent deliveries: `GET /api/v1/tenant/webhook/logs` (event, response status, attempts, time).

All four need the `webhooks:manage` permission (owner, admin, developer).

### Request we send

`POST` with a JSON body and these headers:

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-Webhook-Event` | the event name, e.g. `message.delivered` |
| `X-Webhook-Signature` | `sha256=<hex>`, HMAC-SHA256 of the **raw body** with your secret |
| `X-Webhook-Secret` | the same hex digest without the prefix (older name, kept for compatibility; it is the signature, not the secret) |

Without a secret no signature headers are sent, so create one before going live.

### Verify the signature

Compute `HMAC_SHA256(secret, raw_body)` as hex, compare with the header in constant time, and reject on
mismatch. Use the raw bytes: parsing and re-serialising the JSON changes them and breaks the match.

```js
const expected = crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
const received = (req.get("X-Webhook-Signature") || "").replace("sha256=", "");
const ok = received.length === expected.length &&
  crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
```

```python
expected = hmac.new(SECRET, raw, hashlib.sha256).hexdigest()
ok = hmac.compare_digest(header.removeprefix("sha256="), expected)
```

```php
$ok = hash_equals(hash_hmac('sha256', $raw, $secret), str_replace('sha256=', '', $sig));
```

The dashboard page `/developers/webhooks` has complete Express, Flask and PHP receivers to copy.

### Delivery rules

- Answer with a **2xx within 10 seconds**. Anything else (or a timeout) is a failure.
- Failures are retried 3 times, after 1, 5 and 15 seconds. After that the event is logged as failed and
  is not sent again.
- Redirects are not followed; give the final URL.
- **At-least-once**: an event can arrive twice. Make handlers idempotent, e.g. remember processed
  `message_id` + `event` pairs.
- **No ordering guarantee**: `message.read` can arrive before `message.delivered`. Use `timestamp`.
- Do the heavy work after you answer, so slow processing does not trigger retries.

### Events

| Event | When | Typical use |
|---|---|---|
| `message.sent` | Left your number | Mark as sent |
| `message.delivered` | Reached the recipient's phone | Treat an OTP/notification as delivered |
| `message.read` | Recipient opened it | Stop follow-up reminders |
| `message.failed` | Failed after retries | Tell the user or fall back to SMS/email |
| `message.received` | Someone wrote to your number | Store, reply, or route to support |
| `device.status_changed` | Number state changed (see the status table above) | Stop sending and alert your team on `banned` / `logged_out` |
| `webhook.test` | You pressed "Kirim tes" | Answer 200 |

Outbound message events:

```json
{
  "event": "message.delivered",
  "device_key": "WAPI-XXXXXXXX",
  "message_id": "uuid",
  "whatsapp_message_id": "3EB0C767D0A1",
  "to": "6281234567890",
  "status": "delivered",
  "timestamp": "2026-09-26T10:30:00.000Z"
}
```

Inbound (`message.received`) adds `from`, `content` and `direction: "inbound"` instead of `to`:

```json
{
  "event": "message.received",
  "device_key": "WAPI-XXXXXXXX",
  "message_id": "uuid",
  "whatsapp_message_id": "A5C1...",
  "from": "6281234567890",
  "content": "Halo, pesanan saya sudah sampai?",
  "direction": "inbound",
  "status": "received",
  "timestamp": "2026-09-26T10:31:12.000Z"
}
```

`device.status_changed` carries `status`, `previous_status`, `reason` and `code`; see
[Device status webhook](#device-status-webhook). Inbound messages are also stored and returned by
`GET /api/v1/messages`.

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| Test says "tidak bisa dihubungi" | URL not reachable from the internet (localhost, firewall, wrong port) |
| Test shows 401/403 | Your receiver rejects the request; check signature verification uses the **raw body** and the newest secret |
| Test shows 3xx | Redirects are not followed; use the final URL |
| Signature never matches | Body was parsed and re-serialised, or an old secret is still deployed after rotating |
| Events arrive twice | Normal (at-least-once); deduplicate |

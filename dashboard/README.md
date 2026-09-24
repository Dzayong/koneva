# WA Gateway Dashboard

Tenant-facing Next.js dashboard for WA Gateway: manage WhatsApp devices, browse
message history, and configure webhooks. Talks to `src/api-gateway` (repo
root) over `/api/v1/*`, authenticated with the tenant's `apikey` header.

## Stack

Next.js 16 (App Router, Turbopack), TypeScript strict, Tailwind CSS v4,
shadcn/ui (Radix), TanStack Query, Axios, React Hook Form + Zod, Recharts,
date-fns, next-themes, sonner.

## Quick start

```bash
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL, defaults to :8000
npm install
npm run dev
```

Requires the API Gateway running (`npm run dev` from the repo root) and a
seeded tenant (`npm run seed` from the repo root creates
`test_api_key_123`). Log in with that key.

## Verified against the real backend

Every endpoint this dashboard calls was checked against a running
api-gateway + seeded database in this session (not just typed against a
spec): `GET/POST /api/v1/devices`, `GET /api/v1/devices/:key`,
`GET /api/v1/devices/:key/qr`, `POST /api/v1/devices/:key/{pause,resume}`,
`POST /api/v1/message/send`, `GET /api/v1/messages`. Response envelopes are
faithful to what api-gateway actually returns, including its one
inconsistency: `GET /api/v1/messages` returns `{ data, pagination }` with no
`success` field, while every other route wraps `{ success, data }`.

## Known gaps (backend endpoints this UI expects but api-gateway doesn't have yet)

These are wired up in `lib/api.ts` (each marked with a comment) against the
endpoint api-gateway *should* expose, and degrade gracefully in the UI
(a "not available yet" notice, not a crash) rather than being left unwired:

| UI feature | Expected endpoint | Why it's missing |
|---|---|---|
| Settings → tenant name/email/quota, Dashboard quota card | `GET /api/v1/tenant` | `TenantContext` is only attached server-side by `tenantAuth` middleware; nothing returns it to the client. |
| Settings → webhook URL save | `PATCH /api/v1/tenant` | Same as above — no tenant self-update route. |
| Settings → regenerate API key | `POST /api/v1/tenant/api-key/regenerate` | Doesn't exist. |
| Settings → test webhook | (any) | No webhook test route. |
| Add Device (tenant self-service) | `POST /api/v1/devices` | Only `POST /admin/device/create` exists, and it requires the operator's `x-admin-key` — a tenant's `apikey` can't call it. A tenant-scoped route that proxies to Device Manager server-side (like the admin one does) is the right shape, so the tenant never sees the admin key. |
| Delete Device | `DELETE /api/v1/devices/:deviceKey` | Doesn't exist. |
| Dashboard → Messages Today / Success Rate | none | No date-range or aggregate endpoint; approximated client-side from the latest 100 messages (labeled as such in the UI). |
| Messages page → phone number search | none | `GET /api/v1/messages` has no search param; filtered client-side on the current page only. |

None of these block the dashboard from running — they render an inline
"not available yet" notice (Settings) or a toast (Add Device, Restart,
Test Webhook) instead of failing silently or crashing.

## Enterprise features added

- **Broadcast** (`/broadcast`) — send a spintax-templated message to
  multiple recipients (from Contacts or pasted numbers), one
  `POST /api/v1/message/send` per recipient with per-recipient status
  tracking. Doesn't bypass anti-ban — every message still goes through the
  normal server-side gate.
- **Contacts** (`/contacts`) — CSV import (`name,phone` header), stored in
  **this browser's `localStorage` only** — there's no `contacts` table or
  endpoint in the backend. Real and useful for single-device use; doesn't
  sync across devices/browsers or between a tenant's team members (see
  "Team Management" gap below).
- **Analytics** (`/analytics`) — status breakdown, delivery rate by device,
  health score grid. Same "sampled from latest 100 messages" caveat as the
  main dashboard chart.
- **Notification center** — bell icon in the header, same at-risk-device
  logic as the dashboard's "Alerts" card, as a persistent dropdown instead
  of only being visible on `/`.
- **Real-time updates**: *not implemented as WebSocket/SSE.* There is no
  push endpoint on API Gateway to connect to (that's `src/api-gateway`,
  Codex's side per `docs/PROJECT_VISION.md`'s team split). TanStack Query
  polling (10-30s intervals depending on the resource) is what's here
  instead — a real fix needs a backend change first.
- **Team management / Billing**: not built. Both need real backend work
  (an actual users/roles table; a billing provider integration) that
  doesn't exist — Settings has honest placeholder cards explaining why,
  not a fake CRUD UI that saves nowhere.

## Fixed in bot-container while building this

Two real bugs surfaced by working backwards from what this dashboard needed
to be true, fixed in `src/bot-container/index.ts` (not this app):

- The QR code Baileys generates was never persisted to `devices.qr_code` —
  `connection.ts` had an `onQr` callback that `index.ts` never wired up, so
  `GET /api/v1/devices/:key/qr` could never have returned anything.
- `devices.status` was never synced from the bot's actual connection state
  after Device Manager set the initial `pending_qr` — so a device that
  successfully connected would still show `pending_qr`/`offline` forever.
  Both are now synced on every connection state change (guarded so it never
  overwrites an administrative `paused`/`banned` status).

## Auth model

Simple, matching the spec: paste a tenant API key on `/login`, it's stored in
`localStorage`, and every request carries it as the `apikey` header. There's
no key-validation endpoint, so a wrong key is only discovered on the first
real request (401 → key cleared, bounced back to `/login`). Route protection
is client-side only (`AuthGuard`, `useSyncExternalStore` over the stored
key) — there's no middleware/proxy checking a cookie, since the key lives in
`localStorage`, not a cookie a server could read.

## What wasn't verified

No GUI browser was available while building this — `next build`, `next
lint`, `tsc --noEmit`, and `curl` against a live api-gateway all passed, and
every page server-renders its shell successfully, but actual in-browser
behavior (the responsive mobile drawer, dark mode toggle, toast rendering,
QR scanning) needs a manual pass in a real browser.

# KONEVA Dashboard

Customer-facing Next.js dashboard for KONEVA. People sign in with their own
account, connect WhatsApp numbers, send a first message, manage API keys and
their team, and watch what happens. It talks to `src/api-gateway` (repo root)
through same-origin `/api/v1/*` and `/auth/*`, which Next proxies to the API
(`INTERNAL_API_URL`, see `next.config.ts`).

The interface is in Indonesian.

## Stack

Next.js 16 (App Router, Turbopack), TypeScript strict, Tailwind CSS v4,
shadcn/ui (Radix), TanStack Query, Axios, React Hook Form + Zod, Recharts,
framer-motion, date-fns, next-themes, sonner.

Next.js 16 differs from older versions; read `node_modules/next/dist/docs/`
before changing framework-level code (see `AGENTS.md`).

## Quick start

```bash
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL; empty = same origin + proxy
npm install
npm run dev
```

Needs the API Gateway running (`npm run dev` from the repo root, or the
personal stack: `make start` from the repo root). Open `/signup` to create an
account, or `/login`.

## Screens

| Route | What it does | Needs |
|---|---|---|
| `/signup`, `/login`, `/invite/[token]` | Account creation (terms must be accepted), sign-in, accepting a team invitation | public |
| `/` | Summary and the "Mulai di sini" setup checklist | signed in |
| `/devices`, `/devices/[key]` | Numbers, connecting with the QR code, and per-number tabs: summary, sending behaviour (presets, 24-hour mode, fixed or random delay, fatigue and streak), status history | `devices:read`, `devices:write` to change |
| `/developers/quickstart` | Send a live test message and copy code (cURL, Node.js, Python) | `messages:send` |
| `/developers/keys` | Create, rotate and revoke scoped API keys; a key is shown once | `keys:manage` |
| `/team` | Members, roles, invitation links | `team:manage` |
| `/billing` | Owner only: plan, usage, ordering, payment instructions, student verification, invoices | `billing:manage` |
| `/activity` | Audit log of who changed what | `audit:read` |
| `/messages`, `/broadcast`, `/contacts`, `/analytics`, `/settings/auto-reply`, `/settings` | History, templated sends, contacts, charts, auto-reply rules, webhook and usage | see role table in `docs/API.md` |

The sidebar and header use the signed-in person's real workspace and role. Items
a role cannot use are hidden. The server is the real gate; the UI only avoids
showing dead ends.

## Auth model

Signed-in people get an opaque session token (`wgs_...`) stored in
`localStorage` and sent as `Authorization: Bearer`. A workspace is selected with
the `x-workspace` header. The old way, pasting a tenant API key on `/login`, still
works (folded away on the login page) and is treated as admin-level access.

Route protection is client-side (`AuthGuard`); the API enforces permissions.
`localStorage` is readable by any script on the page, so an XSS bug would expose
the session. Moving the token to an httpOnly cookie is the known upgrade.

## Known gaps

- No "test webhook" button and no "restart number" action; the API has neither.
- Dashboard "messages today" and "success rate" are estimated from the latest
  100 messages and labelled as such. Phone-number search in Messages filters the
  current page only.
- No email verification or password reset (no email service yet), and no
  ownership transfer or "leave workspace".
- Payments are confirmed manually by the operator; no payment gateway or automatic reminders yet. Prices show "segera diumumkan" until the operator marks them final.
- Real-time updates are polling (10 to 60 seconds), not WebSocket.
- The QR flow has been exercised up to the real QR code appearing; the
  "connected" state needs a phone to scan it.

## Verification

Screens were driven in headless Chromium against the running stack: sign-up,
setup checklist, adding a number and the real QR, presets, keys (create, rotate,
revoke), quick start, team invitation accepted by a second browser context
(with the role-limited menu), activity, and a phone-width viewport. Checks
were on rendering, console errors and 5xx responses, not pixel comparison.
Dark mode and full keyboard navigation have not been reviewed screen by screen.

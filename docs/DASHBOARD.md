# Dashboard

Tenant-facing Next.js app in `dashboard/`. Talks to `src/api-gateway`
(repo root) over `/api/v1/*` using the tenant's `apikey` header. See
`dashboard/README.md` for the full list of known backend gaps and
per-feature decisions — this doc covers structure, state, integration and
deployment.

## Component structure

```
dashboard/src/
├── app/
│   ├── login/page.tsx              # API key entry, no validation endpoint
│   ├── global-error.tsx            # root error boundary (crash outside the group layout)
│   └── (dashboard)/                # route group behind AuthGuard
│       ├── layout.tsx              # Sidebar + Header shell
│       ├── error.tsx               # per-route error boundary (react-query throws, render errors)
│       ├── page.tsx                # overview: stats, chart, alerts, quick actions
│       ├── devices/page.tsx + [deviceKey]/page.tsx
│       ├── messages/page.tsx
│       ├── broadcast/page.tsx      # spintax template + bulk send
│       ├── contacts/page.tsx       # CSV import, localStorage-only
│       ├── analytics/page.tsx
│       └── settings/page.tsx       # webhook config, team mgmt placeholder
├── components/
│   ├── auth/auth-guard.tsx         # client-side route protection
│   ├── layout/{sidebar,header,notification-center}.tsx
│   ├── devices/{add-device-form,qr-code-dialog,health-bar,device-status-badge}.tsx
│   ├── messages/{template-builder,message-status-badge}.tsx
│   ├── dashboard/{stats-card,messages-chart,recent-alerts,quick-actions}.tsx
│   ├── providers/{query-provider,theme-provider}.tsx
│   └── ui/                         # shadcn/ui primitives (Radix-based)
├── hooks/use-{auth,devices,device,messages,contacts}.ts  # TanStack Query wrappers
└── lib/{api,types,spintax,contacts,constants,utils}.ts
```

## State management

- **Server state** — TanStack Query exclusively (`components/providers/query-provider.tsx`).
  No Redux/Zustand. Each domain has one hook file (`use-devices.ts`,
  `use-messages.ts`, ...) wrapping `lib/api.ts` calls with `useQuery`/`useMutation`.
  Polling intervals (10-30s depending on resource) stand in for real-time
  updates — there's no WebSocket/SSE endpoint on api-gateway to consume yet.
- **Auth state** — `use-auth.ts`, backed by `localStorage` + `useSyncExternalStore`
  (not React context), so `AuthGuard` and `Header` read the same source
  without a provider re-render cascade. No cookie, no server-readable
  session — purely client-side gating.
- **Theme** — `next-themes` (`ThemeProvider` in root layout, toggle in
  `Header`), class-based dark mode (`dark:` variants throughout, Tailwind v4).
- **Contacts** — `localStorage` only (`lib/contacts.ts`), since there's no
  `contacts` table in the backend. Doesn't sync across browsers/devices.

## API integration

- `lib/api.ts` — single Axios instance, `apikey` header injected from the
  stored key, 401 response clears the key and bounces to `/login`.
- Endpoints actually verified against a live api-gateway (this session):
  `GET/POST /api/v1/devices`, `GET /api/v1/devices/:key`,
  `GET /api/v1/devices/:key/qr`, `POST /api/v1/devices/:key/{pause,resume}`,
  `POST /api/v1/message/send`, `GET /api/v1/messages`.
- `GET /api/v1/messages` is the one endpoint that doesn't wrap its response
  in `{ success, data }` — it returns `{ data, pagination }` directly.
  `lib/api.ts` handles this inconsistency explicitly; don't "fix" it to
  match the other endpoints without changing the backend too.
- Endpoints the UI expects but api-gateway doesn't expose yet (tenant
  self-service device create, tenant profile/webhook update, API key
  regen, message search) are wired against the URL they *should* be at and
  degrade to an inline "not available yet" notice or toast — see the table
  in `dashboard/README.md`. Device creation currently requires an operator
  to call `POST /admin/device/create` with `x-admin-key` out of band.

## Deployment

No Dockerfile or k8s manifest exists yet for the dashboard (only
`src/api-gateway` / `bot-container` are containerized under `docker/` and
`k8s/`). Given the stack (Next.js 16, App Router, no server-only secrets
beyond `NEXT_PUBLIC_API_URL`), the fastest path is Vercel:

```bash
cd dashboard
vercel deploy --prod
```

Required env var: `NEXT_PUBLIC_API_URL` — the tenant-facing api-gateway
origin, e.g. `https://api.yourdomain.com` (must be publicly reachable from
the browser, not the in-cluster service name). Build/verify locally first:

```bash
npm run build      # next build, fails the deploy if this fails
npx tsc --noEmit
npm run lint
```

If deploying alongside the rest of the stack in k8s instead, add a
`Deployment` + `Service` (+ `Ingress` if it needs its own host) mirroring
`k8s/api-gateway/`, with `NEXT_PUBLIC_API_URL` baked in at build time
(Next.js inlines `NEXT_PUBLIC_*` vars at build, not runtime) — this hasn't
been done, since `k8s/` work is scoped to Codex's side per
`docs/PROJECT_VISION.md`.

## What changed in this pass

- Added `app/(dashboard)/error.tsx` and `app/global-error.tsx` — there were
  no Next.js error boundaries anywhere before this; an unhandled render
  error (e.g. a react-query throw with no `onError`) would have produced a
  blank white screen instead of a recoverable UI.
- Verified end-to-end against a live stack: Postgres + Redis (docker
  compose), api-gateway (`:8000`) + device-manager (`:8001`) + dashboard
  (`:3000`), seeded tenant `test_api_key_123`. `devices`, `messages`,
  `pause`/`resume`, `qr` (409 when unavailable, correct), `message/send`
  (`DEVICE_OFFLINE` with no live bot session, correct — status code for this
  was 409 when checked, Codex changed it to 503 mid-session on the
  api-gateway side; dashboard doesn't hardcode the status, so this doesn't
  need a UI change) all matched documented behavior.
- Full in-browser visual pass (responsive layout, dark mode toggle,
  toast rendering, QR scan flow) **was not possible in this session** —
  Playwright's headless Chromium is installed but missing a system
  library (`libnspr4.so`), and installing it needs `sudo` (no TTY
  available for the password prompt here). `next build`, `tsc --noEmit`,
  `eslint`, and live `curl` checks against every endpoint all pass. Do a
  manual browser pass before shipping, or run
  `sudo npx playwright install-deps chromium` once and re-run browser
  automation.

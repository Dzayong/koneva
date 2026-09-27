import type { Page, Route } from "@playwright/test";

/**
 * In-browser FAKE of the proposed operator API. It lives only under tests/ and is never a runtime fallback.
 * It enforces the parts of the contract the frontend must cooperate with (CSRF header, X-Requested-With,
 * Idempotency-Key semantics) so those behaviours are actually exercised. Data is synthetic.
 * A passing test here is UI evidence; it proves nothing about the real backend.
 */
export const CSRF = "csrf_EXAMPLE";
export const ALL_PERMISSIONS = ["payments:read", "payments:confirm", "students:read", "students:decide", "workspaces:read", "audit:read"];

type Json = Record<string, unknown>;
export interface Invoice { id: string; number: string; workspace: { id: string; name: string }; plan: { id: string; name: string }; cycle: "monthly" | "yearly"; amount_idr: number; status: "unpaid" | "paid" | "void"; created_at: string; due_at: string; version: number; paid_at: string | null; method: string | null; reference: string | null; confirmed_by: { name: string } | null }
export interface StudentReq { id: string; workspace: { id: string; name: string }; requester_email: string; requester_email_masked: string; email_domain: string; academic_domain_hint: boolean; status: "pending" | "approved" | "rejected" | "superseded"; requested_at: string; version: number; note: string | null; decided_by: { name: string } | null; reason: string | null }

export type ConfirmMode = "ok" | "already_paid" | "duplicate_reference" | "lose_response_once" | "delay" | "expired" | "audit_failed" | "audit_unknown" | "outcome_unknown" | "html_502" | "html_404" | "bad_body_200" | "redirect" | "hang" | "reauth_required";
export type DecideMode = "ok" | "not_pending" | "lose_response_once" | "reauth_required";

export interface MockState {
  authenticated: boolean;
  permissions: string[];
  loginMode: "ok" | "bad_password" | "rate_limited" | "enroll" | "not_operator" | "absent" | "challenge_dies";
  /** Reauthentication window: confirm/decide answer REAUTH_REQUIRED (before any effect) while false. */
  recentAuth: boolean;
  validCode: string;
  meMode: "ok" | "expired";
  listMode: "ok" | "expired" | "forbidden" | "error" | "hang";
  detailDelayMs: number;
  confirmMode: ConfirmMode;
  decideMode: DecideMode;
  delayMs: number;
  invoices: Invoice[];
  students: StudentReq[];
  workspace: Json;
  audit: Json[];
  /** Data of GET /alerts/otp. The default is the empty state. */
  otpAlerts: Json;
  effects: { confirm: number; decide: number };
  mfaVerified: number;
  seenKeys: string[];
  requests: Array<{ method: string; path: string; query: string; headers: Record<string, string>; body: unknown }>;
  idempotency: Map<string, { hash: string; response: Json }>;
}

const now = "2026-09-26T03:00:00Z";
const inv = (n: number, name: string, over: Partial<Invoice> = {}): Invoice => ({
  id: `inv-${n}`, number: `INV-202609-000${n}`, workspace: { id: `w-${n}`, name }, plan: { id: "umkm", name: "UMKM" }, cycle: "yearly", amount_idr: 990000,
  status: "unpaid", created_at: now, due_at: "2026-10-03T03:00:00Z", version: 1, paid_at: null, method: null, reference: null, confirmed_by: null, ...over,
});
const stu = (n: number, ws: string, over: Partial<StudentReq> = {}): StudentReq => ({
  id: `req-${n}`, workspace: { id: `w-s${n}`, name: ws }, requester_email: `mahasiswa${n}@kampus.example.ac.id`, requester_email_masked: `m***${n}@kampus.example.ac.id`,
  email_domain: "kampus.example.ac.id", academic_domain_hint: true, status: "pending", requested_at: now, version: 1, note: "Mahasiswa semester 5", decided_by: null, reason: null, ...over,
});

export function freshState(over: Partial<MockState> = {}): MockState {
  return {
    authenticated: true, permissions: [...ALL_PERMISSIONS], loginMode: "ok", recentAuth: true, validCode: "123456", meMode: "ok", listMode: "ok", confirmMode: "ok", decideMode: "ok", delayMs: 0, detailDelayMs: 0,
    invoices: [inv(1, "Toko Uji"), inv(2, "Warung Contoh"), inv(3, "Studio Sample", { status: "paid", paid_at: now, method: "transfer", reference: "TRF-9", version: 2, confirmed_by: { name: "Operator Lain" } })],
    students: [stu(1, "Uji Pelajar"), stu(2, "Kelas Contoh", { status: "approved", version: 2, decided_by: { name: "Operator Lain" } })],
    workspace: {
      id: "w-1", name: "Toko Uji", status: "active", created_at: now, owner: { name: "Pemilik Uji", email: "owner@example.test" },
      subscription: { plan: { id: "umkm", name: "UMKM" }, status: "active", cycle: "yearly", period_start: now, period_end: "2027-09-26T03:00:00Z", days_left: 365 },
      usage: { messages_used: 12, messages_limit: 10000, devices_used: 1, devices_limit: 3, members_used: 1, members_limit: 3 }, student: { status: "approved" },
    },
    audit: [{ id: "a-1", at: now, operator: { id: "op-1", name: "Operator Uji" }, action: "invoice.confirm_payment", target: { type: "invoice", id: "inv-3", label: "INV-202609-0003" }, reason: null, changes: { status: { from: "unpaid", to: "paid" } }, request_id: "req-EXAMPLE" }],
    otpAlerts: { events: [], has_active: false, history_days: 30, current: { scope: "sender_daily", window_hours: 24, usage: 12, cap: 200, percent: 6, measured_at: "2026-09-26T03:00:00Z" } },
    effects: { confirm: 0, decide: 0 }, mfaVerified: 0, seenKeys: [], requests: [], idempotency: new Map(), ...over,
  };
}

const ok = (data: unknown, extra: Json = {}, status = 200, headers: Record<string, string> = {}) => ({ status, contentType: "application/json", headers, body: JSON.stringify({ success: true, data, ...extra }) });
const fail = (status: number, code: string, message: string, details: Json = {}, headers: Record<string, string> = {}) => ({ status, contentType: "application/json", headers, body: JSON.stringify({ success: false, error: { code, message, details } }) });
const page = (items: unknown[], offset: number, limit: number) => ok(items.slice(offset, offset + limit), { pagination: { total: items.length, limit, offset, has_more: offset + limit < items.length } });
const hashOf = (v: unknown) => JSON.stringify(v);

export async function installOperatorMock(page_: Page, state: MockState): Promise<MockState> {
  await page_.route("**/api/operator/**", async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace("/api/operator", "");
    const method = req.method();
    const headers = req.headers();
    let body: unknown;
    try { body = req.postDataJSON(); } catch { body = undefined; }
    state.requests.push({ method, path, query: url.search, headers, body });

    if (state.loginMode === "absent") return route.fulfill({ status: 404, contentType: "text/html", body: "<html>Not Found</html>" });

    const unsafe = method !== "GET";
    // Pre-session steps (password, MFA, enrollment) have no session and therefore no CSRF token yet; Origin and the custom header apply.
    if (unsafe && path !== "/auth/login" && !path.startsWith("/auth/mfa/")) {
      if (headers["x-csrf-token"] !== CSRF) return route.fulfill(fail(403, "CSRF_INVALID", "csrf"));
    }
    if (headers["x-requested-with"] !== "koneva-operator") return route.fulfill(fail(403, "ORIGIN_NOT_ALLOWED", "origin"));

    if (path === "/auth/login" && method === "POST") {
      if (state.loginMode === "bad_password") return route.fulfill(fail(401, "INVALID_CREDENTIALS", "x"));
      if (state.loginMode === "rate_limited") return route.fulfill(fail(429, "RATE_LIMITED", "x", {}, { "Retry-After": "42" }));
      // Password never yields a session: only a challenge that MFA must complete.
      return route.fulfill(ok({ status: state.loginMode === "enroll" ? "mfa_enrollment_required" : "mfa_required", challenge_id: "c".repeat(64), expires_in: 300 }));
    }
    if (path === "/auth/mfa/verify" && method === "POST") {
      const b = body as Json;
      if (state.loginMode === "challenge_dies") return route.fulfill(fail(401, "MFA_CHALLENGE_INVALID", "x"));
      if (b["code"] !== state.validCode && b["recovery_code"] !== "AAAAA-BBBBB") return route.fulfill(fail(401, "MFA_INVALID", "x"));
      state.authenticated = true; state.recentAuth = true; state.mfaVerified += 1;
      return route.fulfill(ok({ ...meBody(state), recovery_codes_remaining: b["recovery_code"] ? 9 : 10 }));
    }
    if (path === "/auth/mfa/enroll/start" && method === "POST") {
      if ((body as Json)["enrollment_code"] !== "AAAAA-BBBBB-CCCCC") return route.fulfill(fail(401, "ENROLLMENT_CODE_INVALID", "x"));
      return route.fulfill(ok({ secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", otpauth_uri: "otpauth://totp/KONEVA%20Operator%3Aops%40example.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=KONEVA%20Operator" }));
    }
    if (path === "/auth/mfa/enroll/confirm" && method === "POST") {
      if ((body as Json)["code"] !== state.validCode) return route.fulfill(fail(401, "MFA_INVALID", "x"));
      state.authenticated = true; state.recentAuth = true; state.mfaVerified += 1;
      return route.fulfill(ok({ ...meBody(state), recovery_codes: ["ABCDE-FGHJK", "MNPQR-STUVW", "XYZ23-45678", "9ABCD-EFGHJ"], recovery_codes_remaining: 4 }));
    }
    if (path === "/auth/logout" && method === "POST") { state.authenticated = false; return route.fulfill({ status: 204 }); }

    if (!state.authenticated) return route.fulfill(fail(401, "UNAUTHENTICATED", "x"));
    if (path === "/me") return state.meMode === "expired" ? route.fulfill(fail(401, "SESSION_EXPIRED", "x")) : state.loginMode === "not_operator" ? route.fulfill(fail(403, "NOT_OPERATOR", "x")) : route.fulfill(ok(meBody(state)));

    if (method === "GET" && state.listMode !== "ok" && path !== "/me") {
      if (state.listMode === "expired") return route.fulfill(fail(401, "SESSION_EXPIRED", "x"));
      if (state.listMode === "forbidden") return route.fulfill(fail(403, "FORBIDDEN", "x"));
      if (state.listMode === "hang") return new Promise<void>(() => undefined);
      return route.fulfill(fail(500, "INTERNAL", "x"));
    }

    const limit = Number(url.searchParams.get("limit") ?? 25); const offset = Number(url.searchParams.get("offset") ?? 0);
    const q = (url.searchParams.get("q") ?? "").toLowerCase();

    if (path === "/invoices" && method === "GET") {
      const status = url.searchParams.get("status");
      return route.fulfill(page(state.invoices.filter((i) => (!status || i.status === status) && (!q || `${i.number} ${i.workspace.name}`.toLowerCase().includes(q))), offset, limit));
    }
    const invMatch = /^\/invoices\/([^/]+)$/.exec(path);
    if (invMatch && method === "GET") {
      if (state.detailDelayMs) await new Promise((r) => setTimeout(r, state.detailDelayMs));
      const i = state.invoices.find((x) => x.id === invMatch[1]);
      if (!i) return route.fulfill(fail(404, "INVOICE_NOT_FOUND", "x"));
      return route.fulfill(ok({ ...i, note: null, workspace: { ...i.workspace, owner: { name: "Pemilik Uji", email: "owner@example.test" } }, subscription: { plan: "trial", status: "trial", period_end: "2026-10-10T00:00:00Z" }, student: null, timeline: [{ at: i.created_at, event: "invoice.created" }] }));
    }
    const payMatch = /^\/invoices\/([^/]+)\/confirm-payment$/.exec(path);
    if (payMatch && method === "POST") return confirm(route, state, payMatch[1]!, headers, body as Json);

    if (path === "/student-requests" && method === "GET") {
      const status = url.searchParams.get("status");
      return route.fulfill(page(state.students.filter((s) => (!status || s.status === status) && (!q || `${s.workspace.name} ${s.email_domain}`.toLowerCase().includes(q))).map(summary), offset, limit));
    }
    const stuMatch = /^\/student-requests\/([^/]+)$/.exec(path);
    if (stuMatch && method === "GET") {
      const s = state.students.find((x) => x.id === stuMatch[1]);
      return s ? route.fulfill(ok({ ...summary(s), requester_email: s.requester_email, note: s.note, decided_at: s.decided_by ? now : null, decided_by: s.decided_by, reason: s.reason, history: [] })) : route.fulfill(fail(404, "NOT_FOUND", "x"));
    }
    const decMatch = /^\/student-requests\/([^/]+)\/decision$/.exec(path);
    if (decMatch && method === "POST") return decide(route, state, decMatch[1]!, headers, body as Json);

    if (/^\/workspaces\/[^/]+$/.test(path) && method === "GET") return route.fulfill(ok(state.workspace));
    if (path === "/audit" && method === "GET") return route.fulfill(page(state.audit, offset, limit));
    if (path === "/alerts/otp" && method === "GET") return route.fulfill(state.permissions.includes("audit:read") ? ok(state.otpAlerts) : fail(403, "FORBIDDEN", "x"));
    return route.fulfill(fail(404, "NOT_FOUND", "x"));
  });
  return state;
}

const summary = (s: StudentReq) => ({ id: s.id, workspace: s.workspace, requester_email_masked: s.requester_email_masked, email_domain: s.email_domain, academic_domain_hint: s.academic_domain_hint, status: s.status, requested_at: s.requested_at, version: s.version });
const meBody = (state: MockState) => ({ status: "authenticated", operator: { id: "op-1", name: "Operator Uji", email: "ops@example.test" }, permissions: state.permissions, csrf_token: CSRF, session: { idle_expires_at: "2026-09-27T09:30:00Z", absolute_expires_at: "2026-09-27T17:00:00Z" } });

async function confirm(route: Route, state: MockState, id: string, headers: Record<string, string>, body: Json): Promise<void> {
  const key = headers["idempotency-key"] ?? "";
  state.seenKeys.push(key);
  const invoice = state.invoices.find((i) => i.id === id);
  if (!invoice) return route.fulfill(fail(404, "INVOICE_NOT_FOUND", "x"));
  const slot = `op-1:confirm:${id}:${key}`;
  const prior = state.idempotency.get(slot);
  if (prior) {
    if (prior.hash !== hashOf(body)) return route.fulfill(fail(409, "IDEMPOTENCY_KEY_REUSED", "x"));
    return route.fulfill(ok(prior.response, {}, 200, { "Idempotent-Replay": "true" }));
  }
  if (state.confirmMode === "expired") return route.fulfill(fail(401, "SESSION_EXPIRED", "x"));
  if (state.confirmMode === "reauth_required" && !state.recentAuth) return route.fulfill(fail(401, "REAUTH_REQUIRED", "x"));
  if (state.confirmMode === "reauth_required" && state.recentAuth) state.confirmMode = "ok";
  if (state.confirmMode === "audit_unknown") return route.fulfill(fail(500, "AUDIT_FAILED", "x")); // no rolled_back marker: NOT definite
  if (state.confirmMode === "outcome_unknown") return route.fulfill(fail(503, "OUTCOME_UNKNOWN", "x"));
  if (state.confirmMode === "html_404") return route.fulfill({ status: 404, contentType: "text/html", body: "<html>Not Found</html>" });
  if (state.confirmMode === "bad_body_200") return route.fulfill({ status: 200, contentType: "text/html", body: "<html>proxy says ok</html>" });
  if (state.confirmMode === "redirect") return route.fulfill({ status: 302, headers: { Location: "/operator/login" }, body: "" });
  if (state.confirmMode === "hang") return new Promise<void>(() => undefined); // never answers
  if (state.confirmMode === "html_502") return route.fulfill({ status: 502, contentType: "text/html", body: "<html>Bad gateway</html>" });
  if (state.confirmMode === "audit_failed") return route.fulfill(fail(500, "AUDIT_FAILED", "x", { rolled_back: true }));
  if (state.confirmMode === "already_paid") return route.fulfill(fail(409, "INVOICE_NOT_PAYABLE", "x", { current_status: "paid", paid_at: now, confirmed_by: { name: "Operator Lain" } }));
  if (state.confirmMode === "duplicate_reference" && (body["reference"] as string | undefined) === "TRF-DUP") return route.fulfill(fail(409, "DUPLICATE_REFERENCE", "x", { existing_invoice_number: "INV-202609-0003" }));
  if (state.confirmMode === "delay") await new Promise((r) => setTimeout(r, state.delayMs));
  const expected = body["expected"] as { amount_idr: number; version: number };
  if (expected.version !== invoice.version) return route.fulfill(fail(409, "INVOICE_CHANGED", "x", { current: { amount_idr: invoice.amount_idr, version: invoice.version, status: invoice.status } }));
  invoice.status = "paid"; invoice.version += 1; invoice.paid_at = now; invoice.method = String(body["method"]); invoice.reference = (body["reference"] as string | undefined) ?? null; invoice.confirmed_by = { name: "Operator Uji" };
  state.effects.confirm += 1;
  const response = { invoice: { id: invoice.id, number: invoice.number, status: "paid", version: invoice.version, paid_at: now, method: invoice.method, reference: invoice.reference, confirmed_by: invoice.confirmed_by }, subscription: { plan: "umkm", status: "active", cycle: "yearly", period_end: "2027-09-26T03:00:00Z" } };
  state.idempotency.set(slot, { hash: hashOf(body), response });
  if (state.confirmMode === "lose_response_once") { state.confirmMode = "ok"; return route.abort("failed"); }
  return route.fulfill(ok(response));
}

async function decide(route: Route, state: MockState, id: string, headers: Record<string, string>, body: Json): Promise<void> {
  const key = headers["idempotency-key"] ?? "";
  state.seenKeys.push(key);
  const s = state.students.find((x) => x.id === id);
  if (!s) return route.fulfill(fail(404, "NOT_FOUND", "x"));
  const slot = `op-1:decide:${id}:${key}`;
  const prior = state.idempotency.get(slot);
  if (prior) return route.fulfill(ok(prior.response, {}, 200, { "Idempotent-Replay": "true" }));
  if (state.decideMode === "reauth_required" && !state.recentAuth) return route.fulfill(fail(401, "REAUTH_REQUIRED", "x"));
  if (state.decideMode === "reauth_required") state.decideMode = "ok";
  if (state.decideMode === "not_pending" || s.status !== "pending") return route.fulfill(fail(409, "REQUEST_NOT_PENDING", "x", { current_status: s.status, decided_by: { name: "Operator Lain" } }));
  if (body["decision"] === "reject" && !String(body["reason"] ?? "").trim()) return route.fulfill(fail(400, "REASON_REQUIRED", "x"));
  s.status = body["decision"] === "approve" ? "approved" : "rejected"; s.version += 1; s.decided_by = { name: "Operator Uji" }; s.reason = (body["reason"] as string | undefined) ?? null;
  state.effects.decide += 1;
  const response = { id: s.id, status: s.status, version: s.version, decided_at: now, decided_by: s.decided_by, reason: s.reason };
  state.idempotency.set(slot, { hash: hashOf(body), response });
  if (state.decideMode === "lose_response_once") { state.decideMode = "ok"; return route.abort("failed"); }
  return route.fulfill(ok(response));
}

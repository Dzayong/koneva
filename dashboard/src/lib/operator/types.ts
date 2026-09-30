/**
 * Operator panel DTOs. PROPOSED contract: dashboard/docs/operator-panel-contract.md (no backend exists yet).
 * Every parser below picks an explicit allowlist of fields, so anything extra a backend might send
 * (an api_key, a secret, a QR string) is dropped before it can reach React state, the query cache or the DOM.
 */

export type OperatorPermission = "payments:read" | "payments:confirm" | "students:read" | "students:decide" | "workspaces:read" | "audit:read";

export interface Operator { id: string; name: string; email: string }
export interface OperatorSession { idle_expires_at: string; absolute_expires_at: string }
export interface OperatorMe { operator: Operator; permissions: OperatorPermission[]; csrf_token: string; session: OperatorSession }

/** Result of a completed sign-in (after MFA). Recovery codes are present only right after enrollment and are shown once. */
export interface SignedIn { me: OperatorMe; recovery_codes: string[] | null; recovery_codes_remaining: number | null }
export interface EnrollmentSecret { secret: string; otpauth_uri: string }

export interface Pagination { total: number; limit: number; offset: number; has_more: boolean }
export interface Page<T> { items: T[]; pagination: Pagination }

export type InvoiceStatus = "unpaid" | "paid" | "void";
export interface WorkspaceRef { id: string; name: string }

export interface InvoiceSummary {
  id: string; number: string; workspace: WorkspaceRef; plan: { id: string; name: string }; cycle: "monthly" | "yearly";
  amount_idr: number; status: InvoiceStatus; created_at: string; due_at: string; version: number;
}
export interface InvoiceDetail extends InvoiceSummary {
  paid_at: string | null; method: string | null; reference: string | null; note: string | null; confirmed_by: { name: string } | null;
  workspace_owner: { name: string; email: string } | null;
  subscription: { plan: string; status: string; period_end: string | null } | null;
  student: { status: string } | null;
  timeline: Array<{ at: string; event: string }>;
}

export interface ConfirmPaymentInput { method: string; reference?: string; note?: string; expected: { amount_idr: number; version: number } }
export interface ConfirmPaymentResult {
  invoice: { id: string; number: string; status: InvoiceStatus; version: number; paid_at: string | null; method: string | null; reference: string | null; confirmed_by: { name: string } | null };
  subscription: { plan: string; status: string; cycle: string; period_end: string | null } | null;
}

export type StudentStatus = "pending" | "approved" | "rejected" | "correction_required" | "expired" | "superseded";
export interface StudentRequestSummary {
  id: string; workspace: WorkspaceRef; requester_email_masked: string; email_domain: string; academic_domain_hint: boolean;
  status: StudentStatus; requested_at: string; version: number; correction_due_at: string | null;
}
export interface StudentRequestDetail extends StudentRequestSummary {
  requester_email: string; note: string | null; decided_at: string | null; decided_by: { name: string } | null; reason: string | null;
  history: Array<{ id: string; status: StudentStatus; decided_at: string | null; decided_by: { name: string } | null }>;
}
export interface DecisionInput { decision: "approve" | "reject"; reason?: string; expected: { request_id: string; version: number } }
export interface DecisionResult { id: string; status: StudentStatus; version: number; decided_at: string | null; decided_by: { name: string } | null; reason: string | null }

export interface WorkspaceDetail {
  id: string; name: string; status: string; created_at: string; owner: { name: string; email: string } | null;
  subscription: { plan: { id: string; name: string }; status: string; cycle: string | null; period_start: string | null; period_end: string | null; days_left: number | null } | null;
  usage: { messages_used: number; messages_limit: number; devices_used: number; devices_limit: number; members_used: number; members_limit: number | null };
  student: { status: string } | null;
}

export interface AuditEntry {
  id: string; at: string; operator: { id: string; name: string } | null; action: string;
  target: { type: string; id: string; label: string | null } | null; reason: string | null;
  changes: Record<string, { from: string | number | boolean | null; to: string | number | boolean | null }>; request_id: string | null;
}

// ---- allowlist parsers ---------------------------------------------------------

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const nameRef = (v: unknown): { name: string } | null => (v && typeof v === "object" ? { name: str(obj(v)["name"]) } : null);
const wsRef = (v: unknown): WorkspaceRef => ({ id: str(obj(v)["id"]), name: str(obj(v)["name"]) });

export function parsePagination(v: unknown, fallbackLimit: number): Pagination {
  const p = obj(v);
  return { total: num(p["total"]), limit: num(p["limit"]) || fallbackLimit, offset: num(p["offset"]), has_more: p["has_more"] === true };
}

export function parseMe(v: unknown): OperatorMe {
  const d = obj(v); const op = obj(d["operator"]); const s = obj(d["session"]);
  return {
    operator: { id: str(op["id"]), name: str(op["name"]), email: str(op["email"]) },
    permissions: arr(d["permissions"]).filter((p): p is OperatorPermission => typeof p === "string") as OperatorPermission[],
    csrf_token: str(d["csrf_token"]),
    session: { idle_expires_at: str(s["idle_expires_at"]), absolute_expires_at: str(s["absolute_expires_at"]) },
  };
}

export function parseSignedIn(v: unknown): SignedIn {
  const d = obj(v);
  const codes = arr(d["recovery_codes"]).filter((c): c is string => typeof c === "string");
  return { me: parseMe(v), recovery_codes: codes.length ? codes : null, recovery_codes_remaining: numOrNull(d["recovery_codes_remaining"]) };
}

export function parseEnrollmentSecret(v: unknown): EnrollmentSecret {
  const d = obj(v);
  return { secret: str(d["secret"]), otpauth_uri: str(d["otpauth_uri"]) };
}

export function parseInvoiceSummary(v: unknown): InvoiceSummary {
  const d = obj(v); const plan = obj(d["plan"]);
  return {
    id: str(d["id"]), number: str(d["number"]), workspace: wsRef(d["workspace"]), plan: { id: str(plan["id"]), name: str(plan["name"]) },
    cycle: d["cycle"] === "yearly" ? "yearly" : "monthly", amount_idr: num(d["amount_idr"]),
    status: d["status"] === "paid" ? "paid" : d["status"] === "void" ? "void" : "unpaid",
    created_at: str(d["created_at"]), due_at: str(d["due_at"]), version: num(d["version"]),
  };
}

export function parseInvoiceDetail(v: unknown): InvoiceDetail {
  const d = obj(v); const ws = obj(d["workspace"]); const owner = obj(ws["owner"]); const sub = obj(d["subscription"]); const st = obj(d["student"]);
  return {
    ...parseInvoiceSummary(v),
    paid_at: strOrNull(d["paid_at"]), method: strOrNull(d["method"]), reference: strOrNull(d["reference"]), note: strOrNull(d["note"]),
    confirmed_by: nameRef(d["confirmed_by"]),
    workspace_owner: d["workspace"] && ws["owner"] ? { name: str(owner["name"]), email: str(owner["email"]) } : null,
    subscription: d["subscription"] ? { plan: str(sub["plan"]), status: str(sub["status"]), period_end: strOrNull(sub["period_end"]) } : null,
    student: d["student"] ? { status: str(st["status"]) } : null,
    timeline: arr(d["timeline"]).map((t) => ({ at: str(obj(t)["at"]), event: str(obj(t)["event"]) })),
  };
}

export function parseConfirmResult(v: unknown): ConfirmPaymentResult {
  const d = obj(v); const i = obj(d["invoice"]); const s = obj(d["subscription"]);
  return {
    invoice: { id: str(i["id"]), number: str(i["number"]), status: i["status"] === "paid" ? "paid" : i["status"] === "void" ? "void" : "unpaid", version: num(i["version"]), paid_at: strOrNull(i["paid_at"]), method: strOrNull(i["method"]), reference: strOrNull(i["reference"]), confirmed_by: nameRef(i["confirmed_by"]) },
    subscription: d["subscription"] ? { plan: str(s["plan"]), status: str(s["status"]), cycle: str(s["cycle"]), period_end: strOrNull(s["period_end"]) } : null,
  };
}

const studentStatus = (v: unknown): StudentStatus => v === "approved" || v === "rejected" || v === "correction_required" || v === "expired" || v === "superseded" ? v : "pending";

export function parseStudentSummary(v: unknown): StudentRequestSummary {
  const d = obj(v);
  return {
    id: str(d["id"]), workspace: wsRef(d["workspace"]), requester_email_masked: str(d["requester_email_masked"]), email_domain: str(d["email_domain"]),
    academic_domain_hint: d["academic_domain_hint"] === true, status: studentStatus(d["status"]), requested_at: str(d["requested_at"]), version: num(d["version"]), correction_due_at: strOrNull(d["correction_due_at"]),
  };
}

export function parseStudentDetail(v: unknown): StudentRequestDetail {
  const d = obj(v);
  return {
    ...parseStudentSummary(v), requester_email: str(d["requester_email"]), note: strOrNull(d["note"]), decided_at: strOrNull(d["decided_at"]),
    decided_by: nameRef(d["decided_by"]), reason: strOrNull(d["reason"]),
    history: arr(d["history"]).map((h) => ({ id: str(obj(h)["id"]), status: studentStatus(obj(h)["status"]), decided_at: strOrNull(obj(h)["decided_at"]), decided_by: nameRef(obj(h)["decided_by"]) })),
  };
}

export function parseDecisionResult(v: unknown): DecisionResult {
  const d = obj(v);
  return { id: str(d["id"]), status: studentStatus(d["status"]), version: num(d["version"]), decided_at: strOrNull(d["decided_at"]), decided_by: nameRef(d["decided_by"]), reason: strOrNull(d["reason"]) };
}

export function parseWorkspace(v: unknown): WorkspaceDetail {
  const d = obj(v); const o = obj(d["owner"]); const s = obj(d["subscription"]); const p = obj(s["plan"]); const u = obj(d["usage"]); const st = obj(d["student"]);
  return {
    id: str(d["id"]), name: str(d["name"]), status: str(d["status"]), created_at: str(d["created_at"]),
    owner: d["owner"] ? { name: str(o["name"]), email: str(o["email"]) } : null,
    subscription: d["subscription"] ? { plan: { id: str(p["id"]), name: str(p["name"]) }, status: str(s["status"]), cycle: strOrNull(s["cycle"]), period_start: strOrNull(s["period_start"]), period_end: strOrNull(s["period_end"]), days_left: numOrNull(s["days_left"]) } : null,
    usage: { messages_used: num(u["messages_used"]), messages_limit: num(u["messages_limit"]), devices_used: num(u["devices_used"]), devices_limit: num(u["devices_limit"]), members_used: num(u["members_used"]), members_limit: numOrNull(u["members_limit"]) },
    student: d["student"] ? { status: str(st["status"]) } : null,
  };
}

type Scalar = string | number | boolean | null;
const scalar = (v: unknown): Scalar => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : null);

export function parseAudit(v: unknown): AuditEntry {
  const d = obj(v); const t = obj(d["target"]); const op = obj(d["operator"]); const ch = obj(d["changes"]);
  const changes: AuditEntry["changes"] = {};
  for (const [k, val] of Object.entries(ch)) changes[k] = { from: scalar(obj(val)["from"]), to: scalar(obj(val)["to"]) };
  return {
    id: str(d["id"]), at: str(d["at"]), operator: d["operator"] ? { id: str(op["id"]), name: str(op["name"]) } : null, action: str(d["action"]),
    target: d["target"] ? { type: str(t["type"]), id: str(t["id"]), label: strOrNull(t["label"]) } : null, reason: strOrNull(d["reason"]),
    changes, request_id: strOrNull(d["request_id"]),
  };
}

// ---- OTP sender-budget alerts (counts and times only; the parser drops anything else) ---------------------------------------------
export interface OtpAlertEvent {
  id: string; at: string; kind: "sender_70_percent" | "sender_cap_reached"; scope: "sender_daily"; window_hours: number;
  threshold_percent: number; severity: "warning" | "critical"; usage_at_event: number; cap_at_event: number; percent_at_event: number; active: boolean;
}
export interface OtpAlerts {
  events: OtpAlertEvent[]; has_active: boolean; history_days: number;
  current: { usage: number; cap: number; percent: number; window_hours: number; measured_at: string };
}
export function parseOtpAlerts(v: unknown): OtpAlerts {
  const d = obj(v); const c = obj(d["current"]);
  return {
    events: arr(d["events"]).map((e) => {
      const x = obj(e);
      return {
        id: str(x["id"]), at: str(x["at"]), kind: x["kind"] === "sender_cap_reached" ? "sender_cap_reached" : "sender_70_percent", scope: "sender_daily" as const,
        window_hours: num(x["window_hours"]) || 24, threshold_percent: num(x["threshold_percent"]), severity: x["severity"] === "critical" ? "critical" as const : "warning" as const,
        usage_at_event: num(x["usage_at_event"]), cap_at_event: num(x["cap_at_event"]), percent_at_event: num(x["percent_at_event"]), active: x["active"] === true,
      };
    }),
    has_active: d["has_active"] === true, history_days: num(d["history_days"]) || 30,
    current: { usage: num(c["usage"]), cap: num(c["cap"]), percent: num(c["percent"]), window_hours: num(c["window_hours"]) || 24, measured_at: str(c["measured_at"]) },
  };
}

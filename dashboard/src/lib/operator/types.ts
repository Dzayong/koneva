/**
 * Operator panel DTOs. PROPOSED contract: dashboard/docs/operator-panel-contract.md (no backend exists yet).
 * Every parser below picks an explicit allowlist of fields, so anything extra a backend might send
 * (an api_key, a secret, a QR string) is dropped before it can reach React state, the query cache or the DOM.
 */

export type OperatorPermission = "payments:read" | "payments:confirm" | "students:read" | "students:decide" | "workspaces:read" | "audit:read" | "owner:insights";

export interface Operator { id: string; name: string; email: string }
export interface OperatorSession { idle_expires_at: string; absolute_expires_at: string }
export interface OperatorMe { operator: Operator; permissions: OperatorPermission[]; csrf_token: string; session: OperatorSession }

export interface SignedIn { me: OperatorMe }

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
  changes: Record<string, { from: string | number | boolean | null; to: string | number | boolean | null }>; request_id: string | null; client_ip: string | null;
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
  return { me: parseMe(v) };
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
    changes, request_id: strOrNull(d["request_id"]), client_ip: strOrNull(d["client_ip"]),
  };
}

// ---- Owner Phase A types ----

export interface OwnerDeviceSummary {
  id: string; label: string; workspace: WorkspaceRef; phone_masked: string | null;
  status: string; status_label: string; status_since: string | null;
  health_score: number | null; health_badge: string; created_at: string | null;
}
export interface OwnerDeviceEvent {
  id: string; status: string; status_label: string;
  previous_status: string | null; previous_status_label: string | null;
  reason_label: string; at: string;
}
export interface OwnerDeviceDetail extends OwnerDeviceSummary {
  reconnect_24h: number; stream_error_24h: number;
  fail_ratio: { failed: number; attempted: number; percent: number | null };
  container_status: string; events: OwnerDeviceEvent[];
  thresholds: { reconnect_24h: number; stream_error_24h: number; fail_ratio_percent: number; fail_ratio_min_messages: number; offline_hours: number };
}

export interface OwnerSystemHealth {
  measured_at: string;
  api_status: string; db_status: string;
  queue: { queued: number; sending: number; oldest_queued_at: string | null };
  error_rate_24h: { attempted: number; failed: number; percent: number };
  error_rate_1h: { attempted: number; failed: number; percent: number };
  email_transport: string;
  otp: { today: number; daily_cap: number; remaining: number };
  otp_alerts: Array<{ id: string; at: string; kind: string; window_count: number; cap: number }>;
  thresholds: { reconnect_24h: number; stream_error_24h: number; fail_ratio_percent: number; fail_ratio_min_messages: number; offline_hours: number };
  threshold_devices: { reconnect_exceeded: number; error_exceeded: number; offline_exceeded: number };
  container_status: string; downtime_history: string;
}

export interface SystemWhatsappOtpSender {
  configured: boolean; device_key: string | null; status: string; phone_last4: string | null; updated_at: string;
  notifications_enabled: boolean; notification_recipient_last4: string | null; notification_test_queued_at: string | null;
  recent_otps: Array<{ id: string; phone_last4: string | null; created_at: string; expires_at: string; attempts: number;
    verification_status: "pending" | "used" | "expired" | "invalidated"; message_status: string; error_code: string | null;
    sent_at: string | null; delivered_at: string | null; read_at: string | null }>;
  qr_code?: string;
}

export interface AiReplyProviderSettings {
  configured: boolean; enabled: boolean; base_url: string; model: string; updated_at: string | null;
}
export function parseAiReplyProviderSettings(v: unknown): AiReplyProviderSettings {
  const d = obj(v);
  return { configured: d["configured"] === true, enabled: d["enabled"] === true, base_url: str(d["base_url"]),
    model: str(d["model"]), updated_at: strOrNull(d["updated_at"]) };
}
export function parseSystemWhatsappOtpSender(v: unknown): SystemWhatsappOtpSender {
  const d = obj(v);
  const qr = str(d["qr_code"]);
  return { configured: Boolean(d["configured"]), device_key: strOrNull(d["device_key"]), status: str(d["status"]),
    phone_last4: strOrNull(d["phone_last4"]), updated_at: str(d["updated_at"]),
    notifications_enabled: d["notifications_enabled"] === true,
    notification_recipient_last4: strOrNull(d["notification_recipient_last4"]),
    notification_test_queued_at: strOrNull(d["notification_test_queued_at"]),
    recent_otps: arr(d["recent_otps"]).map((item) => { const x = obj(item); const verification = str(x["verification_status"]);
      return { id: str(x["id"]), phone_last4: strOrNull(x["phone_last4"]), created_at: str(x["created_at"]), expires_at: str(x["expires_at"]),
        attempts: num(x["attempts"]), verification_status: verification === "used" || verification === "expired" || verification === "invalidated" ? verification : "pending",
        message_status: str(x["message_status"]), error_code: strOrNull(x["error_code"]), sent_at: strOrNull(x["sent_at"]),
        delivered_at: strOrNull(x["delivered_at"]), read_at: strOrNull(x["read_at"]) };
    }), ...(qr ? { qr_code: qr } : {}) };
}

export interface OwnerWorkspaceSummary {
  id: string; name: string; status: string; created_at: string | null;
  owner: { name: string; email: string } | null;
  subscription: { plan: string; status: string } | null;
  device_count: number; member_count: number; messages_30d: number; last_activity: string | null;
}
export interface OwnerWorkspaceMember { name: string; email: string; role: string; joined_at: string | null }
export interface OwnerWorkspacePayment { id: string; number: string; amount_idr: number; status: string; plan_name: string | null; cycle: string | null; created_at: string | null; paid_at: string | null }
export interface OwnerWorkspaceDetailData {
  id: string; name: string; status: string; created_at: string | null;
  owner: { name: string; email: string } | null;
  subscription: Record<string, unknown> | null; student: { status: string } | null;
  device_count: number; member_count: number; quota_messages: number; max_devices: number;
  used_messages: number; usage_period_start: string | null;
  messages_30d: number; last_activity: string | null;
  devices: Array<{ id: string; label: string; status: string; status_label: string; health_score: number | null; health_badge: string }>;
  members: OwnerWorkspaceMember[];
  recent_payments: OwnerWorkspacePayment[];
}
export interface CloseOwnerWorkspaceInput { confirmation: string; reason: string }
export interface CloseOwnerWorkspaceResult { id: string; status: "deleted"; closed_at: string; purge_after: string }
export interface OwnerWorkspaceCostMeter {
  measuredAt: string; windowHours: number;
  workspace: { id: string; name: string; planId: string | null; planName: string | null };
  database: { estimatedBytes: number; totalDatabaseBytes: number; confidence: string; billingReady: false; method: string; note: string;
    sampledTables: Array<{ table: string; relationBytes: number; samplePercent: number; sampledRows: number }> };
  devices: Array<{ id: string; label: string; status: string; sessionStorageBytes: number | null;
    queue: { waiting: number | null; active: number | null; delayed: number | null; failed: number | null; deadLetter: number | null };
    cpuPercentAvg: number | null; memoryUsageBytesAvg: number | null; memoryUsageBytesMax: number | null; resourceSamples: number }>;
  pricing: { status: "not_calculated"; note: string };
}
export interface SignupVoucher {
  id: string; code_hint: string; credit_idr: number; max_redemptions: number; redemptions_count: number;
  active: boolean; expires_at: string | null; created_at: string; disabled_at: string | null;
}
export interface CreatedSignupVoucher extends SignupVoucher { code: string }

export function parseOwnerDeviceSummary(v: unknown): OwnerDeviceSummary {
  const d = obj(v);
  return {
    id: str(d["id"]), label: str(d["label"]), workspace: wsRef(d["workspace"]), phone_masked: strOrNull(d["phone_masked"]),
    status: str(d["status"]), status_label: str(d["status_label"]), status_since: strOrNull(d["status_since"]),
    health_score: numOrNull(d["health_score"]), health_badge: str(d["health_badge"]), created_at: strOrNull(d["created_at"]),
  };
}
export function parseOwnerDeviceDetail(v: unknown): OwnerDeviceDetail {
  const d = obj(v); const fr = obj(d["fail_ratio"]); const th = obj(d["thresholds"]);
  return {
    ...parseOwnerDeviceSummary(v),
    reconnect_24h: num(d["reconnect_24h"]), stream_error_24h: num(d["stream_error_24h"]),
    fail_ratio: { failed: num(fr["failed"]), attempted: num(fr["attempted"]), percent: numOrNull(fr["percent"]) },
    container_status: str(d["container_status"]),
    events: arr(d["events"]).map((e) => {
      const x = obj(e);
      return { id: str(x["id"]), status: str(x["status"]), status_label: str(x["status_label"]),
        previous_status: strOrNull(x["previous_status"]), previous_status_label: strOrNull(x["previous_status_label"]),
        reason_label: str(x["reason_label"]), at: str(x["at"]) };
    }),
    thresholds: { reconnect_24h: num(th["reconnect_24h"]), stream_error_24h: num(th["stream_error_24h"]),
      fail_ratio_percent: num(th["fail_ratio_percent"]), fail_ratio_min_messages: num(th["fail_ratio_min_messages"]), offline_hours: num(th["offline_hours"]) },
  };
}
export function parseOwnerSystemHealth(v: unknown): OwnerSystemHealth {
  const d = obj(v); const q = obj(d["queue"]); const e24 = obj(d["error_rate_24h"]); const e1 = obj(d["error_rate_1h"]);
  const o = obj(d["otp"]); const th = obj(d["thresholds"]); const td = obj(d["threshold_devices"]);
  return {
    measured_at: str(d["measured_at"]),
    api_status: str(d["api_status"]) || "unknown", db_status: str(d["db_status"]) || "unknown",
    queue: { queued: num(q["queued"]), sending: num(q["sending"]), oldest_queued_at: strOrNull(q["oldest_queued_at"]) },
    error_rate_24h: { attempted: num(e24["attempted"]), failed: num(e24["failed"]), percent: num(e24["percent"]) },
    error_rate_1h: { attempted: num(e1["attempted"]), failed: num(e1["failed"]), percent: num(e1["percent"]) },
    email_transport: str(d["email_transport"]),
    otp: { today: num(o["today"]), daily_cap: num(o["daily_cap"]), remaining: num(o["remaining"]) },
    otp_alerts: arr(d["otp_alerts"]).map((a) => { const x = obj(a); return { id: str(x["id"]), at: str(x["at"]), kind: str(x["kind"]), window_count: num(x["window_count"]), cap: num(x["cap"]) }; }),
    thresholds: { reconnect_24h: num(th["reconnect_24h"]), stream_error_24h: num(th["stream_error_24h"]),
      fail_ratio_percent: num(th["fail_ratio_percent"]), fail_ratio_min_messages: num(th["fail_ratio_min_messages"]), offline_hours: num(th["offline_hours"]) },
    threshold_devices: { reconnect_exceeded: num(td["reconnect_exceeded"]), error_exceeded: num(td["error_exceeded"]), offline_exceeded: num(td["offline_exceeded"]) },
    container_status: str(d["container_status"]), downtime_history: str(d["downtime_history"]),
  };
}
export function parseOwnerWorkspaceSummary(v: unknown): OwnerWorkspaceSummary {
  const d = obj(v); const o = obj(d["owner"]); const s = obj(d["subscription"]);
  return {
    id: str(d["id"]), name: str(d["name"]), status: str(d["status"]), created_at: strOrNull(d["created_at"]),
    owner: d["owner"] ? { name: str(o["name"]), email: str(o["email"]) } : null,
    subscription: d["subscription"] ? { plan: str(s["plan"]), status: str(s["status"]) } : null,
    device_count: num(d["device_count"]), member_count: num(d["member_count"]),
    messages_30d: num(d["messages_30d"]), last_activity: strOrNull(d["last_activity"]),
  };
}
export function parseOwnerWorkspaceDetailData(v: unknown): OwnerWorkspaceDetailData {
  const d = obj(v); const o = obj(d["owner"]); const st = obj(d["student"]);
  return {
    id: str(d["id"]), name: str(d["name"]), status: str(d["status"]), created_at: strOrNull(d["created_at"]),
    owner: d["owner"] ? { name: str(o["name"]), email: str(o["email"]) } : null,
    subscription: d["subscription"] && typeof d["subscription"] === "object" ? d["subscription"] as Record<string, unknown> : null,
    student: d["student"] ? { status: str(st["status"]) } : null,
    device_count: num(d["device_count"]), member_count: num(d["member_count"]),
    quota_messages: num(d["quota_messages"]), max_devices: num(d["max_devices"]),
    used_messages: num(d["used_messages"]), usage_period_start: strOrNull(d["usage_period_start"]),
    messages_30d: num(d["messages_30d"]), last_activity: strOrNull(d["last_activity"]),
    devices: arr(d["devices"]).map((dv) => { const x = obj(dv); return { id: str(x["id"]), label: str(x["label"]), status: str(x["status"]), status_label: str(x["status_label"]), health_score: numOrNull(x["health_score"]), health_badge: str(x["health_badge"]) }; }),
    members: arr(d["members"]).map((m) => { const x = obj(m); return { name: str(x["name"]), email: str(x["email"]), role: str(x["role"]), joined_at: strOrNull(x["joined_at"]) }; }),
    recent_payments: arr(d["recent_payments"]).map((p) => { const x = obj(p); return { id: str(x["id"]), number: str(x["number"]), amount_idr: num(x["amount_idr"]), status: str(x["status"]), plan_name: strOrNull(x["plan_name"]), cycle: strOrNull(x["cycle"]), created_at: strOrNull(x["created_at"]), paid_at: strOrNull(x["paid_at"]) }; }),
  };
}
export function parseOwnerWorkspaceCostMeter(v: unknown): OwnerWorkspaceCostMeter {
  const d = obj(v); const w = obj(d["workspace"]); const database = obj(d["database"]); const pricing = obj(d["pricing"]);
  return {
    measuredAt: str(d["measuredAt"]), windowHours: num(d["windowHours"]),
    workspace: { id: str(w["id"]), name: str(w["name"]), planId: strOrNull(w["planId"]), planName: strOrNull(w["planName"]) },
    database: {
      estimatedBytes: num(database["estimatedBytes"]), totalDatabaseBytes: num(database["totalDatabaseBytes"]),
      confidence: str(database["confidence"]), billingReady: false, method: str(database["method"]), note: str(database["note"]),
      sampledTables: arr(database["sampledTables"]).map((item) => { const x = obj(item); return {
        table: str(x["table"]), relationBytes: num(x["relationBytes"]), samplePercent: num(x["samplePercent"]), sampledRows: num(x["sampledRows"]),
      }; }),
    },
    devices: arr(d["devices"]).map((item) => { const x = obj(item); const q = obj(x["queue"]); return {
      id: str(x["id"]), label: str(x["label"]), status: str(x["status"]), sessionStorageBytes: numOrNull(x["sessionStorageBytes"]),
      queue: { waiting: numOrNull(q["waiting"]), active: numOrNull(q["active"]), delayed: numOrNull(q["delayed"]), failed: numOrNull(q["failed"]), deadLetter: numOrNull(q["deadLetter"]) },
      cpuPercentAvg: numOrNull(x["cpuPercentAvg"]), memoryUsageBytesAvg: numOrNull(x["memoryUsageBytesAvg"]),
      memoryUsageBytesMax: numOrNull(x["memoryUsageBytesMax"]), resourceSamples: num(x["resourceSamples"]),
    }; }),
    pricing: { status: "not_calculated", note: str(pricing["note"]) },
  };
}

export function parseSignupVoucher(v: unknown): SignupVoucher {
  const d = obj(v);
  return {
    id: str(d["id"]), code_hint: str(d["code_hint"]), credit_idr: num(d["credit_idr"]),
    max_redemptions: num(d["max_redemptions"]), redemptions_count: num(d["redemptions_count"]),
    active: d["active"] === true, expires_at: strOrNull(d["expires_at"]),
    created_at: str(d["created_at"]), disabled_at: strOrNull(d["disabled_at"]),
  };
}

export function parseCreatedSignupVoucher(v: unknown): CreatedSignupVoucher {
  const d = obj(v);
  return { ...parseSignupVoucher(v), code: str(d["code"]) };
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

export interface OwnerInsights {
  measured_at: string;
  kpis: { registered_accounts: number; active_workspaces: number; suspended_workspaces: number; messages_sent_24h: number; messages_sent_30d: number; otp_sender_today: number; otp_sender_daily_cap: number; otp_sender_remaining_internal: number };
  device_counts: { total: number; online: number; offline: number; attention: number };
  health: { api: string; database: string; queue: { queued: number; sending: number }; message_delivery_24h: { attempted: number; failed: number; error_rate_percent: number }; devices: Array<{ id: string; label: string; status: string; updated_at: string | null; workspace_name: string | null }> };
  activity: Array<{ id: string; kind: string; at: string; title: string; detail: string | null }>;
  alerts: { otp_thresholds: Array<{ id: string; at: string; kind: string; window_count: number; cap: number }>; stop_events_last_hour: number; consent_blocked_messages_last_hour: number; break_glass_validation: { configured: boolean; last_validated_at: string | null; due: boolean } };
  data_limits: string[];
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

export function parseOwnerInsights(v: unknown): OwnerInsights {
  const d = obj(v); const k = obj(d["kpis"]); const dc = obj(d["device_counts"]); const h = obj(d["health"]); const q = obj(h["queue"]); const m = obj(h["message_delivery_24h"]); const a = obj(d["alerts"]);
  return {
    measured_at: str(d["measured_at"]),
    kpis: { registered_accounts: num(k["registered_accounts"]), active_workspaces: num(k["active_workspaces"]), suspended_workspaces: num(k["suspended_workspaces"]), messages_sent_24h: num(k["messages_sent_24h"]), messages_sent_30d: num(k["messages_sent_30d"]), otp_sender_today: num(k["otp_sender_today"]), otp_sender_daily_cap: num(k["otp_sender_daily_cap"]), otp_sender_remaining_internal: num(k["otp_sender_remaining_internal"]) },
    device_counts: { total: num(dc["total"]), online: num(dc["online"]), offline: num(dc["offline"]), attention: num(dc["attention"]) },
    health: { api: str(h["api"]), database: str(h["database"]), queue: { queued: num(q["queued"]), sending: num(q["sending"]) }, message_delivery_24h: { attempted: num(m["attempted"]), failed: num(m["failed"]), error_rate_percent: num(m["error_rate_percent"]) }, devices: arr(h["devices"]).map((v) => { const x = obj(v); return { id: str(x["id"]), label: str(x["label"]), status: str(x["status"]), updated_at: strOrNull(x["updated_at"]), workspace_name: strOrNull(x["workspace_name"]) }; }) },
    activity: arr(d["activity"]).map((v) => { const x = obj(v); return { id: str(x["id"]), kind: str(x["kind"]), at: str(x["at"]), title: str(x["title"]), detail: strOrNull(x["detail"]) }; }),
    alerts: { otp_thresholds: arr(a["otp_thresholds"]).map((v) => { const x = obj(v); return { id: str(x["id"]), at: str(x["at"]), kind: str(x["kind"]), window_count: num(x["window_count"]), cap: num(x["cap"]) }; }), stop_events_last_hour: num(a["stop_events_last_hour"]), consent_blocked_messages_last_hour: num(a["consent_blocked_messages_last_hour"]), break_glass_validation: { configured: obj(a["break_glass_validation"])["configured"] === true, last_validated_at: strOrNull(obj(a["break_glass_validation"])["last_validated_at"]), due: obj(a["break_glass_validation"])["due"] === true } },
    data_limits: arr(d["data_limits"]).map(str),
  };
}

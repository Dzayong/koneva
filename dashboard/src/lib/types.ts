// Mirrors src/api-gateway + src/shared/database schema (see ../../../docs/ARCHITECTURE.md
// in the repo root for the backend side of this contract).

export type DeviceStatus =
  | "offline"
  | "starting"
  | "pending_qr"
  | "online"
  | "paused"
  | "banned"
  | "error";

export type MessageStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "blocked"
  | "received";

export type HealthLevel = "excellent" | "good" | "fair" | "poor" | "critical";

export interface Tenant {
  id: string;
  name: string;
  email: string | null;
  api_key: string;
  webhook_url: string | null;
  max_devices: number;
  quota_messages: number;
  used_messages: number;
  status: "active" | "suspended" | "deleted";
  created_at: string;
  updated_at: string;
}

export interface Device {
  id: string;
  device_key: string;
  phone_number: string | null;
  label: string | null;
  status: DeviceStatus;
  qr_code: string | null;
  health_score: number;
  last_connected: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageStatusHistoryEntry {
  status: MessageStatus;
  created_at: string;
}

export interface Message {
  id: string;
  tenant_id: string;
  device_id: string;
  device_key: string;
  direction: "inbound" | "outbound";
  from_number: string | null;
  to_number: string;
  content: string;
  type: "text" | "image" | "document" | "video" | "audio";
  status: MessageStatus;
  external_id: string | null;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  status_history?: MessageStatusHistoryEntry[];
}

// ---- API envelopes -------------------------------------------------------
// api-gateway wraps most responses as { success, data }, except GET
// /api/v1/messages which returns { data, pagination } directly (no
// `success` field) — kept faithful to the real backend, not the ideal one.

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiErrorBody {
  success: false;
  error: { code: string; message: string };
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: { limit: number; offset: number; total: number };
}

export interface SendMessageRequest {
  device_key: string;
  to: string;
  message: string;
  external_id?: string;
}

export interface SendMessageResponse {
  success: true;
  message_id: string;
  status: "queued";
}

export interface MessageListParams {
  device_key?: string;
  status?: MessageStatus;
  limit?: number;
  offset?: number;
}

export interface QRCodeResponse {
  success: true;
  device_key: string;
  status: DeviceStatus;
  qr_code: string | null;
  has_qr: boolean;
}

// Not implemented by api-gateway yet — see dashboard/README.md "Known gaps".
export interface CreateDeviceRequest {
  phone_number?: string;
  label?: string;
}

export interface StatsResponse {
  total_tenants: number;
  total_devices: number;
  messages_today: number;
  success_rate: number;
}

export interface StatusConfig {
  label: string;
  color: string;
  bgColor: string;
}

export interface HealthConfig {
  level: HealthLevel;
  label: string;
  color: string;
  bgColor: string;
  barColor: string;
}

// ---- Contacts & analytics (api-gateway routes added with migration 005) ----

export interface ContactRecord {
  id: string;
  phone_number: string;
  name: string | null;
  tags: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateContactRequest {
  phone_number: string;
  name?: string;
  tags?: string[];
  notes?: string;
}

export interface ContactListParams {
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AnalyticsOverview {
  total_messages: number;
  /** Percentage 0-100. */
  delivery_rate: number;
  /** Seconds. */
  avg_response_time: number;
  active_devices: number;
}

export interface AnalyticsDailyPoint {
  date: string;
  total_messages: number;
  inbound: number;
  outbound: number;
  delivered: number;
  read: number;
}

// ---- Auto-reply rules (/api/v1/auto-reply-rules) ---------------------------

export type AutoReplyTriggerType = "keyword" | "regex" | "all";

export interface AutoReplyRule {
  id: string;
  device_key: string;
  trigger_type: AutoReplyTriggerType;
  trigger_pattern: string;
  response_content: string;
  delay_ms: number;
  is_active: boolean;
  created_at: string;
}

export interface AutoReplyRuleInput {
  device_key: string;
  trigger_type: AutoReplyTriggerType;
  trigger_pattern: string;
  response_content: string;
  delay_ms: number;
}

// ---- Health score breakdown (/api/v1/devices/:key/health) -------------------

export type HealthBreakdownStatus = "complete" | "partial" | "locked" | "danger";

export interface HealthBreakdownItem {
  id: string;
  label: string;
  score: number;
  max: number;
  status: HealthBreakdownStatus;
  description: string;
}

export interface HealthMission {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  requirement: string;
}

export interface DeviceHealthData {
  health_score: number;
  device_age_days: number;
  warmup_completed: boolean;
  warmup_day: number;
  metrics: {
    total_sent: number;
    delivered: number;
    replied: number;
    blocked: number;
    reported: number;
  };
  rates: {
    delivery: number;
    reply: number;
    block: number;
    report: number;
  };
  breakdown: HealthBreakdownItem[];
  missions: HealthMission[];
}

// ---- Accounts, roles, keys, team, audit ------------------------------------

export type Role = "owner" | "admin" | "developer" | "viewer";

export type Permission =
  | "devices:read" | "devices:write" | "devices:delete"
  | "messages:read" | "messages:send" | "content:write"
  | "webhooks:manage" | "keys:manage" | "team:manage" | "billing:manage" | "audit:read";

export interface WorkspaceRef { id: string; name: string; role: Role }

export interface Me {
  user: { id: string; email: string; name: string };
  workspace: WorkspaceRef;
  workspaces: WorkspaceRef[];
  permissions: Permission[];
  subscription: SubscriptionSummary | null;
  support_contact: string | null;
}

export interface AuthResult {
  token: string;
  expires_at: string;
  user: { id: string; email: string; name: string };
  workspaces: WorkspaceRef[];
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface CreatedApiKey extends ApiKeyRecord { key: string }

export interface TeamMember {
  user_id: string;
  name: string;
  email: string;
  role: Role;
  joined_at: string;
  last_login_at: string | null;
}

export interface PendingInvitation { id: string; email: string; role: Role; expires_at: string; created_at: string }

export interface CreatedInvitation {
  id: string; email: string; role: Role; expires_at: string; token: string; accept_path: string;
}

export interface InvitationPreview {
  workspace: string; role: Role; invited_by: string | null; email_hint: string; expires_at: string;
}

export interface AuditEntry {
  id: string;
  actor_type: "user" | "api_key" | "system";
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  ip: string | null;
  created_at: string;
}

// ---- Sending behaviour (persona, presets, activity) ------------------------

export type PresetId = "customer_service" | "notifications" | "careful_marketing";

export interface Preset {
  id: PresetId;
  label: string;
  description: string;
  always_on: boolean;
  wake_hour: number;
  sleep_hour: number;
  delay_min_ms: number;
  delay_max_ms: number;
  burst_size: number;
  notes: string[];
}

export interface Persona {
  timezone: string;
  wake_hour: number;
  sleep_hour: number;
  delay_min_ms: number;
  delay_max_ms: number;
  delay_mode: "flat" | "random";
  burst_size: number;
  rest_min_ms: number;
  rest_max_ms: number;
  typing_ms_per_char: number;
  always_on: boolean;
  presence_enabled: boolean;
  presence_min_ms: number;
  presence_max_ms: number;
  preset: PresetId | "custom";
}

export interface DeviceActivity {
  persona: Persona;
  today_window: { start: string; end: string; open: boolean; opens_in_minutes: number };
  fatigue: { burst_count: number; burst_limit: number; resting: boolean; rest_ends_at: string | null };
  streak_days: number;
  daily: Array<{ date: string; sent: number; received: number; active_hours: number; first_at: string | null; last_at: string | null }>;
}

export interface DeviceEvent {
  status: string;
  previous_status: string | null;
  reason: string | null;
  code: number | null;
  created_at: string;
}

// ---- Plans and billing ------------------------------------------------------

export type SubscriptionStatus = "trial" | "active" | "past_due" | "suspended" | "expired" | "cancelled";
export type BillingCycle = "monthly" | "yearly";

export interface PublicPlan {
  id: string;
  name: string;
  audience: string;
  features: string[];
  max_devices: number;
  monthly_messages: number;
  max_members: number;
  requires_student_verification: boolean;
  price_month_idr: number | null;
  price_year_idr: number | null;
  price_is_final: boolean;
}

export interface SubscriptionSummary {
  plan_id: string;
  plan_name: string;
  status: SubscriptionStatus;
  can_send: boolean;
  days_left: number | null;
  period_end: string | null;
}

export interface Invoice {
  id: string;
  number: string;
  plan_id: string;
  cycle: BillingCycle;
  amount_idr: number;
  status: "unpaid" | "paid" | "void";
  due_at: string;
  paid_at: string | null;
  method: string | null;
  reference: string | null;
  created_at: string;
}

export interface BillingState {
  subscription: {
    plan_id: string; plan_name: string; status: SubscriptionStatus; cycle: BillingCycle | null;
    period_start: string; period_end: string | null; days_left: number | null; grace_days: number;
  } | null;
  usage: {
    messages_used: number; messages_limit: number; resets_at: string | null;
    devices_used: number; devices_limit: number; members_used: number; members_limit: number | null;
  };
  student: { verified: boolean; requested: boolean };
  plans: PublicPlan[];
  invoices: Invoice[];
  payment: { instructions: string; contact: string | null };
}

// ---- Webhook ---------------------------------------------------------------

export interface WebhookSettings { url: string | null; secret_set: boolean; secret_hint: string | null }
export interface WebhookTestResult { success: boolean; status: number | null; detail: string; duration_ms: number }
export interface WebhookLog {
  id: string; event_type: string; response_status: number | null; retry_count: number;
  response_body: string | null; created_at: string;
}

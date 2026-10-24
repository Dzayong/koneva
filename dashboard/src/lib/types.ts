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
  last_connected: string | null;
  history_sync_status?: "not_started" | "syncing" | "paused" | "completed";
  history_sync_progress?: number | null;
  history_sync_completion_explicit?: boolean;
  history_latest_message_at?: string | null;
  history_synced_at?: string | null;
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
  chat_jid?: string | null;
  content: string;
  type: "text" | "image" | "document" | "video" | "audio";
  status: MessageStatus;
  external_id: string | null;
  reply_to_message_id?: string | null;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  status_history?: MessageStatusHistoryEntry[];
}

export interface InboxDevice {
  device_key: string;
  label: string | null;
  phone_number: string | null;
  status: DeviceStatus;
}

export interface InboxConversation {
  latest_message_id: string;
  device_key: string;
  device_label: string | null;
  chat_key: string;
  chat_jid: string | null;
  peer_number: string | null;
  direction: "inbound" | "outbound";
  content: string;
  type: Message["type"];
  status: MessageStatus;
  created_at: string;
  message_count: number;
}

export type Role = "owner" | "admin" | "developer" | "viewer" | "cs";

export type Permission =
  | "devices:read" | "devices:write" | "devices:delete"
  | "messages:read" | "messages:send" | "inbox:read" | "messages:reply" | "content:write"
  | "webhooks:manage" | "keys:manage" | "team:manage" | "billing:manage" | "audit:read";

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
  pagination: { limit: number; offset: number; total: number; has_more?: boolean };
}

export interface SendMessageRequest {
  device_key: string;
  to: string;
  message: string;
  media_url?: string;
  media_type?: "image" | "video" | "document";
  external_id?: string;
  reply_to_message_id?: string;
}

export interface SendMessageResponse {
  success: true;
  message_id: string;
  status: "queued" | "quota_hold";
}

export interface MessageListParams {
  device_key?: string;
  status?: MessageStatus;
  created_today?: boolean;
  search?: string;
  chat_jid?: string;
  limit?: number;
  offset?: number;
}

export interface DashboardStats {
  messages_today: number;
  delivery_rate: number;
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
  consent_status?: "opted_in" | "opted_out" | null;
}

export interface CreateContactRequest {
  phone_number: string;
  name?: string;
  tags?: string[];
  notes?: string;
  /** Records an owner-confirmed offline grant in the consent audit trail. */
  consent_source_note?: string;
}

export interface ContactListParams {
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ContactGroup {
  id: string;
  name: string;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface ScheduledCampaign {
  id: string;
  name: string;
  group_id: string;
  group_name: string;
  device_key: string;
  scheduled_at: string;
  status: "scheduled" | "processing" | "completed" | "cancelled";
  recipient_count: number;
  pending_count: number;
  queued_count: number;
  quota_hold_count: number;
  failed_count: number;
  created_at: string;
  completed_at: string | null;
}

export interface CreateScheduledCampaign {
  name: string;
  group_id: string;
  device_key: string;
  scheduled_at: string;
  message: string;
  media_url?: string;
  media_type?: "image" | "video" | "document";
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
  response_type: "text" | "template" | "ai" | "ai_general";
  response_content: string;
  response_config?: { skill_ids: string[]; variables: Record<string, string> };
  delay_ms: number;
  is_active: boolean;
  created_at: string;
}

export interface AutoReplyRuleInput {
  device_key: string;
  trigger_type: AutoReplyTriggerType;
  trigger_pattern: string;
  response_type?: "text" | "template" | "ai" | "ai_general";
  response_content: string;
  response_config?: { skill_ids: string[]; variables: Record<string, string> };
  delay_ms: number;
}

export interface WorkspaceSendHours {
  enabled: boolean;
  start_time: string;
  end_time: string;
}

export type WorkspaceMissionStatus = "completed" | "needs_action" | "not_applicable";
export interface WorkspaceMission {
  id: string;
  level: number;
  title: string;
  description: string;
  kind: "automatic" | "manual" | "test";
  source: string;
  status: WorkspaceMissionStatus;
  reason: string | null;
  confirmed_at: string | null;
  observed_at: string;
}
export interface WorkspaceReadinessLevel {
  level: number;
  name: string;
  missions: WorkspaceMission[];
  completed: number;
  total: number;
}
export interface WorkspaceReadiness {
  recommended_level: number | null;
  selected_level: number | null;
  selected_by_owner: boolean;
  evaluated_at: string;
  levels: WorkspaceReadinessLevel[];
}

// ---- Accounts, roles, keys, team, audit ------------------------------------

export interface WorkspaceRef { id: string; name: string; role: Role }

export interface Me {
  user: { id: string; email: string; name: string; email_verified?: boolean };
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
  device_key?: string | null;
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

export interface LegacyRoleTransition {
  phase: "none" | "notice_required" | "transition" | "reminder_due" | "suspended";
  legacy_member_count: number;
  notice_sent_at: string | null;
  deadline_at: string | null;
  days_remaining: number | null;
}

export interface PendingInvitation { id: string; email: string; role: Role; expires_at: string; created_at: string }

export interface CreatedInvitation {
  id: string; email: string; role: Role; expires_at: string; token: string; accept_path: string;
}

export interface InvitationPreview {
  workspace: string; role: Role; invited_by: string | null; email_hint: string; expires_at: string;
  /** The recipient must confirm an emailed code. `otp_available=false` means no email sender is configured yet. */
  requires_otp: boolean; otp_available: boolean;
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
  typing_enabled: boolean;
  always_on: boolean;
  presence_enabled: boolean;
  presence_min_ms: number;
  presence_max_ms: number;
  preset: PresetId | "custom";
}

export interface DeviceActivity {
  persona: Persona;
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
  /** Display override for monthly_messages, e.g. "Unlimited pesan*" (Bisnis CS). Null: show the raw number. */
  quota_headline: string | null;
  /** Fine print shown with quota_headline, e.g. the fair-use figure. Null when quota_headline is null. */
  quota_note: string | null;
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
  wallet: { enabled: boolean; price_per_message_idr: number | null; available_idr: number; reserved_idr: number; messages_sent: number; messages_failed: number;
    devices: Array<{ device_key: string; messages_sent: number; messages_failed: number; charged_idr: number }>;
    recent_topups: Array<{ invoice_number: string; amount_idr: number; status: string; created_at: string }> };
  subscription: {
    plan_id: string; plan_name: string; status: SubscriptionStatus; cycle: BillingCycle | null;
    period_start: string; period_end: string | null; days_left: number | null; grace_days: number;
  } | null;
  usage: {
    messages_used: number; messages_limit: number; resets_at: string | null;
    /** Messages held because the regular quota is spent -- kept, not dropped, and released automatically. */
    messages_held: number;
    /** OTP/transactional sends this period, verified server-side; never counted in messages_used. */
    exempt_used: number;
    /** Display override for the current plan's limit (e.g. "Unlimited pesan*"); null on every plan but Bisnis CS. */
    quota_headline: string | null;
    quota_note: string | null;
    devices_used: number; devices_limit: number; members_used: number; members_limit: number | null;
  };
  student: { verified: boolean; requested: boolean; needs_resubmission?: boolean; status?: string | null; correction_due_at?: string | null };
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

// ---- Status and device profile ------------------------------------

export type CommandStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export interface StatusPost {
  kind: "text" | "image" | "video";
  text?: string;
  media_url?: string;
  caption?: string;
  background?: string;
  audience: "chatted" | "all_contacts" | "contacts_except" | "list";
  numbers?: string[];
  send_at?: string;
}
export interface DeviceCommand {
  views?: number;
  id: string; type: string; status: CommandStatus; payload: Partial<StatusPost>;
  result: { message_id?: string | null; recipients?: number } | null;
  error: string | null; run_at: string; created_at: string; finished_at: string | null;
}
export interface BusinessProfile {
  wid?: string | null; description?: string | null; address?: string | null; email?: string | null; website?: string[] | null;
}
export interface BusinessHoursDay { day: "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat"; mode: "specific_hours" | "open_24h" | "appointment_only"; open?: string; close?: string }
export interface BusinessUpdate {
  description?: string; address?: string; email?: string; websites?: string[];
  hours?: { timezone: string; days: BusinessHoursDay[] };
}
export interface DeviceProfile {
  jid: string; phone: string | null; name: string | null; about: string | null; picture_url: string | null;
  is_business: boolean; business: BusinessProfile | null;
}
export interface ProfileUpdate { name?: string; about?: string; business?: BusinessUpdate }

export interface WhatsAppGroupSummary {
  id: string;
  name: string;
  member_count: number;
  description: string | null;
  is_community: boolean;
  is_community_announcement: boolean;
  parent_community_jid: string | null;
  announcement_only: boolean;
  created_at: string | null;
}
export interface WhatsAppGroupParticipant { id: string; name: string | null; role: "owner" | "admin" | "member" }
export interface WhatsAppGroupDetails {
  id: string; name: string; description: string | null; image_url?: string | null; created_at: string | null; owner: string | null;
  announcement_only: boolean; restricted: boolean; member_add_mode: "admin_add" | "all_member_add";
  join_approval: boolean; ephemeral_duration: number; participants: WhatsAppGroupParticipant[];
}
export interface WhatsAppGroupJoinRequest { id: string | null; requested_at: string | null }
export interface WhatsAppChannelSummary {
  id: string;
  name: string;
  description: string | null;
  subscribers: number | null;
  verification: "VERIFIED" | "UNVERIFIED";
  invite: string | null;
  is_owner?: boolean;
  followed_at?: string;
}

export interface StatusViewers { viewers: Array<{ number: string | null; viewed_at: string }>; total: number }

// ---- DOKU checkout ---------------------------------------------------------

export interface DokuCheckoutResult { invoice_number: string; payment_url: string }

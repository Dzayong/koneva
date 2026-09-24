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
  | "blocked";

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
  qr_code: string;
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

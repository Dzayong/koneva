import type { Request } from 'express';

export interface TenantContext {
  id: string;
  name: string;
  email: string | null;
  api_key: string;
  webhook_url: string | null;
  webhook_secret: string | null;
  max_devices: number;
  quota_messages: number;
  used_messages: number;
  status: 'active' | 'suspended' | 'deleted';
}

export interface PaginationQuery {
  limit: number;
  offset: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationQuery & { total: number };
}

export interface ApiErrorResponse {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export interface SendMessageRequest {
  device_key: string;
  to: string;
  message: string;
  external_id?: string | undefined;
}

export interface SendMessageResponse {
  success: true;
  message_id: string;
  status: 'queued';
}

export interface CreateTenantRequest {
  name: string;
  email: string;
  max_devices?: number;
  quota_messages?: number;
}

export interface CreateDeviceRequest {
  tenant_id: string;
  phone_number?: string;
  label?: string;
}

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
      isAdmin?: boolean;
      validated?: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

export type TenantRequest = Request & { tenant: TenantContext };

import type { Request } from 'express';
import { z } from 'zod';
import type { Permission, Role } from '../permissions';

export const createDeviceSchema = z.object({
  phone_number: z.string().regex(/^\+?[0-9]{10,15}$/).optional(),
  label: z.string().min(1).max(100).optional(),
});

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
  success: true;
  data: T[];
  pagination: PaginationQuery & { total: number; has_more: boolean };
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
  /** 'urgent' is for OTP and other time-critical transactional messages. */
  priority?: 'normal' | 'urgent' | undefined;
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
  phone_number?: string;
  label?: string;
}

/** Who is calling: a person signed in to the console, or a system using an API key. */
export type Actor =
  | { kind: 'user'; userId: string; email: string; role: Role }
  | { kind: 'api_key'; role: Role; scopes?: readonly Permission[]; keyId?: string };

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
      actor?: Actor;
      isAdmin?: boolean;
      validated?: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

export type TenantRequest = Request & { tenant: TenantContext };

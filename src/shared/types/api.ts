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
  /** Text, or the caption when `media_url` is set (may be empty for media). */
  message: string;
  media_url?: string | undefined;
  media_type?: 'image' | 'video' | 'document' | undefined;
  external_id?: string | undefined;
  /** Inbound message being answered; limits this no-START path to a recent customer-initiated chat. */
  reply_to_message_id?: string | undefined;
  /** Explicit per-message approval to bypass only the proactive/media warm-up restriction. */
  allow_warmup_override?: boolean | undefined;
  /** Accepted for backward compatibility but ignored as a trust signal. Server-verified transactional messages
   * receive urgent routing; caller-supplied `urgent` never bypasses consent, quota, or pacing controls. */
  priority?: 'normal' | 'urgent' | undefined;
}

export interface SendMessageResponse {
  success: true;
  message_id: string;
  /** 'quota_hold' means the regular monthly quota is spent: the message is kept, not dropped, and is queued
   * automatically once quota frees up (a new billing window, an upgrade, or another message finishing). */
  status: 'queued' | 'quota_hold';
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
  | { kind: 'api_key'; role: Role; scopes?: readonly Permission[]; keyId?: string; deviceKey?: string | null };

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
      actor?: Actor;
      isAdmin?: boolean;
      validated?: { body?: unknown; query?: unknown; params?: unknown };
      /** Raw request body bytes, captured by express.json()'s `verify` hook — needed to check an inbound
       * webhook signature (e.g. DOKU's), since a parsed-then-re-serialised body would not match it. */
      rawBody?: Buffer;
    }
  }
}

export type TenantRequest = Request & { tenant: TenantContext };

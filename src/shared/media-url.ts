import { z } from 'zod';

export const BLOCKED_HOSTS = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[::1?\])$/i;

/** Media is fetched server-side (by the bot), so only public https addresses are accepted. */
export const mediaUrl = z.string().url().max(2048)
  .refine((u) => u.toLowerCase().startsWith('https://'), 'Media URL must use https')
  .refine((u) => { try { return !BLOCKED_HOSTS.test(new URL(u).hostname); } catch { return false; } }, 'Media URL must not point to a private address');

export const MEDIA_TYPES = ['image', 'video', 'document'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

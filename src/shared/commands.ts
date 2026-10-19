// Shared between the API gateway (which validates and enqueues) and the bot (which runs).
export const COMMAND_TYPES = [
  'profile.get', 'profile.update', 'profile.picture', 'status.post',
  'whatsapp.groups.list', 'whatsapp.channel.lookup',
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export const commandChannel = (deviceKey: string): string => `bot:command:${deviceKey}`;

/**
 * WhatsApp Status posts per device per day. Each post is seen by many contacts at once, so the
 * default is deliberately low. Not measured against WhatsApp's limits; treat it as caution.
 */
export const STATUS_DAILY_LIMIT = 3;

export interface StatusPayload {
  kind: 'text' | 'image' | 'video';
  text?: string;
  media_url?: string;
  caption?: string;
  background?: string;
  audience: 'chatted' | 'all_contacts' | 'contacts_except' | 'list';
  numbers?: string[];
}

export interface BusinessProfileUpdate {
  description?: string;
  address?: string;
  email?: string;
  websites?: string[];
  hours?: { timezone: string; days: Array<{ day: string; mode: string; open?: string; close?: string }> };
}

export interface ProfileUpdate {
  name?: string;
  about?: string;
  business?: BusinessProfileUpdate;
}

/** `image_base64` is a resized JPEG/PNG from the dashboard; `image_url` is a public https address. Neither = remove. */
export interface ProfilePicturePayload {
  image_base64?: string;
  image_url?: string;
}

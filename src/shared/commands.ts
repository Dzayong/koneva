// Shared between the API gateway (which validates and enqueues) and the bot (which runs).
export const COMMAND_TYPES = [
  'account.info', 'business.get', 'business.update', 'catalog.list', 'collections.list',
  'product.create', 'product.update', 'product.delete', 'status.post',
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export const commandChannel = (deviceKey: string): string => `bot:command:${deviceKey}`;

/**
 * WhatsApp Status posts per number per day. Each post is seen by many contacts at once, so the
 * default is deliberately low. Not measured against WhatsApp's limits; treat it as caution.
 */
export const STATUS_DAILY_LIMIT = 3;

/**
 * WhatsApp stores catalog prices as amount x 1000 (Rp 25.000 -> 25000000). Baileys passes the number
 * through untouched. UNVERIFIED against a real Business number: check the first product in the app.
 */
export const PRICE_SCALE = 1000;

export interface StatusPayload {
  kind: 'text' | 'image' | 'video';
  text?: string;
  media_url?: string;
  caption?: string;
  background?: string;
  audience: 'chatted' | 'list';
  numbers?: string[];
}

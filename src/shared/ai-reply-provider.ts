import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface AiReplyProviderSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  enabled: boolean;
}

function encryptionKey(): Buffer {
  const encoded = process.env['AI_REPLY_ENCRYPTION_KEY'];
  if (!encoded) throw new Error('ai_reply_encryption_key_missing');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('ai_reply_encryption_key_invalid');
  return key;
}

export function encryptAiReplySecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptAiReplySecret(value: string): string {
  const [version, ivEncoded, tagEncoded, encryptedEncoded] = value.split(':');
  if (version !== 'v1' || !ivEncoded || !tagEncoded || !encryptedEncoded) throw new Error('ai_reply_secret_format_invalid');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivEncoded, 'base64'));
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedEncoded, 'base64')), decipher.final()]).toString('utf8');
}

export function normalizeAiReplyBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('ai_reply_base_url_invalid'); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    || url.username || url.password || url.search || url.hash) throw new Error('ai_reply_base_url_invalid');
  return url.toString().replace(/\/$/, '');
}

export function aiReplyCompletionsUrl(baseUrl: string): string {
  return `${normalizeAiReplyBaseUrl(baseUrl)}/chat/completions`;
}

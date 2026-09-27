import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash } from './core';

// ---- Base32 (RFC 4648, no padding) -----------------------------------------------------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(bytes: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/=+$/, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// ---- TOTP (RFC 6238: HMAC-SHA1, 30 s step, 6 digits) -----------------------------------------------------------
export const TOTP_PERIOD_S = 30;
export const stepAt = (ms: number): number => Math.floor(ms / 1000 / TOTP_PERIOD_S);

export function totp(secret: Buffer, step: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  const code = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(code % 10 ** digits).padStart(digits, '0');
}

/**
 * Returns the matching time step (within +-1 step of `nowMs`) or null. The caller must additionally refuse a step that is
 * not greater than the last accepted one, so a code can be used only once (replay protection).
 */
export function verifyTotp(secret: Buffer, code: string, nowMs: number = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepAt(nowMs);
  let match: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    const expected = Buffer.from(totp(secret, step)), given = Buffer.from(code);
    // Check every candidate (no early exit) so timing does not reveal which step matched.
    if (expected.length === given.length && timingSafeEqual(expected, given)) match = step;
  }
  return match;
}

export const newSecret = (): { base32: string; bytes: Buffer } => { const bytes = randomBytes(20); return { base32: base32Encode(bytes), bytes }; };

export function otpauthUri(base32: string, accountEmail: string): string {
  const issuer = 'KONEVA Operator';
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${accountEmail}`)}?secret=${base32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_PERIOD_S}`;
}

// ---- Secret encryption at rest (AES-256-GCM, operator id bound as AAD) ------------------------------------------
export function encryptSecret(key: Buffer, plaintext: Buffer, operatorId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(operatorId));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}
export function decryptSecret(key: Buffer, stored: string, operatorId: string): Buffer {
  const [version, iv, tag, ct] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !ct) throw new Error('unsupported secret format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(operatorId));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]);
}

// ---- Recovery and enrollment codes (high entropy, stored only as hashes) ----------------------------------------
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O/1/I/L
function randomCode(groups: number, size: number): string {
  const bytes = randomBytes(groups * size);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return Array.from({ length: groups }, (_, i) => chars.slice(i * size, (i + 1) * size)).join('-');
}
export const newRecoveryCodes = (count = 10): string[] => Array.from({ length: count }, () => randomCode(2, 5));
export const newEnrollmentCode = (): string => randomCode(3, 5);
/** Case, dashes and spaces do not matter when a person types a code. */
export const normalizeCode = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const codeHash = (code: string): string => hash(`koneva-operator-code-v1:${normalizeCode(code)}`);

export function sameCodeHash(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * DOKU Non-SNAP HMAC-SHA256 request/notification signing, per developers.doku.com (read 2026-10-04).
 * Pure math only — no network call, no DOKU account needed. Spec: docs/DOKU_INTEGRATION_SPEC.md §3.
 * Not wired into any route; this module is a tested building block for a future integration PR.
 */
export interface DokuSignatureInput {
  clientId: string;
  requestId: string;
  /** ISO 8601 UTC, e.g. 2026-10-04T03:24:23Z */
  requestTimestamp: string;
  /** Request path only, e.g. /checkout/v1/payment */
  requestTarget: string;
  /** Raw request/notification body exactly as sent; omit for a bodyless request (GET). */
  rawBody?: string | undefined;
}

export const dokuDigest = (rawBody: string): string => createHash('sha256').update(rawBody, 'utf8').digest('base64');

function stringToSign(input: DokuSignatureInput): string {
  const lines = [
    `Client-Id:${input.clientId}`,
    `Request-Id:${input.requestId}`,
    `Request-Timestamp:${input.requestTimestamp}`,
    `Request-Target:${input.requestTarget}`,
  ];
  if (input.rawBody !== undefined) lines.push(`Digest:${dokuDigest(input.rawBody)}`);
  return lines.join('\n');
}

/** DOKU_SHARED_KEY is the HMAC secret (DOKU's own "Secret Key"); never logged, never returned. */
export function computeDokuSignature(input: DokuSignatureInput, sharedKey: string): string {
  const mac = createHmac('sha256', sharedKey).update(stringToSign(input), 'utf8').digest('base64');
  return `HMACSHA256=${mac}`;
}

/** Timing-safe: used both to sign outgoing requests and to verify an incoming notification's Signature header. */
export function verifyDokuSignature(input: DokuSignatureInput, sharedKey: string, presentedSignature: string): boolean {
  const expected = Buffer.from(computeDokuSignature(input, sharedKey));
  const given = Buffer.from(presentedSignature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * One idempotency key per FINAL payload.
 *  - Same payload  -> same key (a retry after an ambiguous result is safe: the server replays, no second effect).
 *  - Changed payload -> a NEW key, never the old one.
 *  - After an ambiguous outcome the key is never regenerated automatically; only an explicit reset() does that.
 * Pure and framework-free so it can be tested without a browser.
 */

/** JSON with sorted keys, so two equal payloads always produce the same string. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const newKey = (): string => crypto.randomUUID();

export class IdempotencyGuard {
  private key: string | null = null;
  private fingerprint: string | null = null;

  constructor(private readonly generate: () => string = newKey) {}

  /** Key for this exact payload; reuses the current key only while the payload is unchanged. */
  keyFor(payload: unknown): string {
    const fp = canonicalJson(payload);
    if (this.key === null || fp !== this.fingerprint) {
      this.key = this.generate();
      this.fingerprint = fp;
    }
    return this.key;
  }

  /** True while a key exists for exactly this payload (used to lock the form after an ambiguous result). */
  holds(payload: unknown): boolean {
    return this.key !== null && canonicalJson(payload) === this.fingerprint;
  }

  /** Explicit, user-driven fresh start (e.g. after re-reading the invoice). */
  reset(): void {
    this.key = null;
    this.fingerprint = null;
  }
}

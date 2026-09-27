/**
 * KONEVA_SANDBOX gates behaviour that must never touch a real WhatsApp number or a real email inbox. It is
 * fail-closed both ways:
 *   - Unset/anything other than "1" means "not sandbox": every function here returns the same answer it always
 *     did, so :13000/production is byte-for-byte unaffected by this module existing.
 *   - Once sandbox IS on, every gated feature defaults to the safest choice (mock transport, empty allowlist)
 *     and there is no separate flag that can re-enable the dangerous path while sandbox stays on -- e.g.
 *     WHATSAPP_TRANSPORT=real is ignored, not honoured, when KONEVA_SANDBOX=1.
 */
export function isSandbox(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['KONEVA_SANDBOX'] === '1';
}

export type WhatsappTransportMode = 'real' | 'mock';

/** Sandbox always forces 'mock' -- no env var can turn real WhatsApp transport back on while sandbox is active. */
export function whatsappTransportMode(env: NodeJS.ProcessEnv = process.env): WhatsappTransportMode {
  if (isSandbox(env)) return 'mock';
  const value = (env['WHATSAPP_TRANSPORT'] ?? 'real').trim() || 'real';
  if (value !== 'real' && value !== 'mock') {
    throw new Error(`WHATSAPP_TRANSPORT "${value}" is not supported (use real or mock)`);
  }
  return value;
}

/** Same normalization on both sides of an allowlist comparison: trimmed, lower-cased. Not full RFC 5321 canonicalization. */
export function normalizeEmail(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Sandbox recipient allowlist: exact match only, after normalizeEmail on both sides. Comma-separated in the env
 * var; empty/unset means the allowlist is empty, which rejects every recipient (fail-closed default).
 * Only ever consulted when isSandbox() is true -- :13000/production email is never filtered by this.
 */
export function sandboxEmailAllowlist(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env['SANDBOX_EMAIL_ALLOWLIST'] ?? '';
  return new Set(raw.split(',').map(normalizeEmail).filter((s) => s.length > 0));
}

export function isSandboxEmailAllowed(address: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return sandboxEmailAllowlist(env).has(normalizeEmail(address));
}

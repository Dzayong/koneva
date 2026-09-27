import { BlockList, isIP } from 'node:net';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Network restriction for the legacy `/admin` maintenance interface (defence in depth behind the reverse proxy).
 * ADMIN_ALLOWED_NETWORKS: comma-separated IPs/CIDRs plus the keywords `loopback`, `private`, `any`.
 * Default: production -> `loopback,private` (localhost curl, docker/VPN networks); other environments -> `any`.
 * Behind a proxy, set TRUST_PROXY_HOPS so req.ip is the real client; then a public client is refused here even if the proxy rule is lost.
 * The operator cookie is not an /admin credential (adminAuth only reads x-admin-key) and never becomes one.
 */
const KEYWORDS: Record<string, Array<[string, number, 'ipv4' | 'ipv6']>> = {
  loopback: [['127.0.0.0', 8, 'ipv4'], ['::1', 128, 'ipv6']],
  private: [['10.0.0.0', 8, 'ipv4'], ['172.16.0.0', 12, 'ipv4'], ['192.168.0.0', 16, 'ipv4'], ['169.254.0.0', 16, 'ipv4'], ['fc00::', 7, 'ipv6'], ['fe80::', 10, 'ipv6']],
};

export function parseAdminNetworks(raw: string | undefined, nodeEnv: string | undefined): BlockList | null {
  const value = (raw ?? '').trim() || (nodeEnv === 'production' ? 'loopback,private' : 'any');
  const list = new BlockList();
  for (const entry of value.split(',').map((e) => e.trim()).filter(Boolean)) {
    if (entry === 'any') return null;
    const keyword = KEYWORDS[entry];
    if (keyword) { for (const [net, prefix, family] of keyword) list.addSubnet(net, prefix, family); continue; }
    const [address, prefix] = entry.split('/');
    const family = isIP(address ?? '');
    if (!family) throw new Error(`ADMIN_ALLOWED_NETWORKS: invalid entry "${entry}"`);
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) list.addAddress(address!, type);
    else {
      const bits = Number(prefix);
      if (!Number.isInteger(bits) || bits < 0 || bits > (family === 4 ? 32 : 128)) throw new Error(`ADMIN_ALLOWED_NETWORKS: invalid prefix in "${entry}"`);
      list.addSubnet(address!, bits, type);
    }
  }
  return list;
}

const normalise = (ip: string): string => ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');

export function adminNetworkGuard(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  const allowed = parseAdminNetworks(env['ADMIN_ALLOWED_NETWORKS'], env['NODE_ENV']);
  return (request: Request, response: Response, next: NextFunction): void => {
    if (allowed === null) { next(); return; }
    const ip = normalise(request.ip ?? '');
    const family = isIP(ip);
    if (!family || !allowed.check(ip, family === 4 ? 'ipv4' : 'ipv6')) {
      response.status(403).json({ success: false, error: { code: 'ADMIN_NETWORK_FORBIDDEN', message: 'Antarmuka admin tidak tersedia dari jaringan ini.' } });
      return;
    }
    next();
  };
}

/**
 * The operator panel replaces the legacy invoice-pay and student-verify writes (identity, MFA, audit, idempotency).
 * While the panel is enabled they are refused unless ADMIN_LEGACY_BILLING_WRITES=true is set deliberately.
 * `void` and manual `subscription` have no operator replacement yet and stay available.
 */
export function legacyBillingWrites(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  return (_request, response, next): void => {
    if (env['OPERATOR_ENABLED'] === 'true' && env['ADMIN_LEGACY_BILLING_WRITES'] !== 'true') {
      response.status(403).json({ success: false, error: { code: 'LEGACY_ENDPOINT_DISABLED', message: 'Gunakan Panel Operator untuk tindakan ini.' } });
      return;
    }
    next();
  };
}

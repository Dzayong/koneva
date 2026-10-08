export interface OperatorConfig {
  enabled: boolean;
  origin: string;
  cookieName: string;
  secure: boolean;
  /** Per-IP request ceiling of the whole operator router; only tests override the default of 120. */
  requestsPerMinute?: number;
}

export function readOperatorConfig(env: NodeJS.ProcessEnv = process.env): OperatorConfig {
  const enabled = env['OPERATOR_ENABLED'] === 'true';
  const insecure = env['OPERATOR_INSECURE_DEV_COOKIES'] === 'true';
  const secure = env['OPERATOR_COOKIE_SECURE'] !== 'false';
  const cookieName = env['OPERATOR_COOKIE_NAME'] ?? '__Host-koneva_op';
  const origin = env['OPERATOR_ALLOWED_ORIGIN'] ?? '';
  const production = env['NODE_ENV'] === 'production';
  if (production && (insecure || !secure || !cookieName.startsWith('__Host-'))) {
    throw new Error('Insecure operator cookie configuration is forbidden in production');
  }
  if (enabled) {
    if (production && env['OPERATOR_ALLOW_PRODUCTION'] !== 'true') {
      throw new Error('Operator production access needs explicit OPERATOR_ALLOW_PRODUCTION=true after the operational checklist in docs/OPERATOR_PANEL.md');
    }
    if (!/^[A-Za-z0-9_-]+$/.test(cookieName) || cookieName === 'wa_gateway_session') throw new Error('Invalid operator cookie name');
    if ((!secure || !cookieName.startsWith('__Host-')) && !insecure) throw new Error('Weak operator cookies require explicit development opt-in');
    if (cookieName.startsWith('__Host-') && !secure) throw new Error('__Host- cookies require Secure');
    const url = new URL(origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('OPERATOR_ALLOWED_ORIGIN must be an exact origin');
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('HTTP operator access is limited to loopback development');
    if (production && url.protocol !== 'https:') throw new Error('Production operator access requires an https origin');
  }
  return { enabled, origin, cookieName, secure };
}

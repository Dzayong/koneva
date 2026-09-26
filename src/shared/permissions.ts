// One place that says who may do what. Roles are for people signed in to the console;
// API keys carry a subset of the same permissions (scopes).

export const ROLES = ['owner', 'admin', 'developer', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'devices:read', 'devices:write', 'devices:delete',
  'messages:read', 'messages:send',
  'content:write',
  'webhooks:manage', 'keys:manage',
  'team:manage', 'billing:manage', 'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter((p) => p !== 'billing:manage'),
  developer: [
    'devices:read', 'devices:write', 'messages:read', 'messages:send', 'content:write',
    'webhooks:manage', 'keys:manage',
  ],
  viewer: ['devices:read', 'messages:read'],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

type Rule = readonly [methods: readonly string[], pattern: RegExp, permission: Permission];
const ANY_WRITE = ['POST', 'PATCH', 'PUT', 'DELETE'] as const;

// Order matters: the first matching rule wins, so specific rules come before general ones.
const RULES: readonly Rule[] = [
  [['POST'], /^\/message\/send$/, 'messages:send'],
  [['POST'], /^\/broadcast$/, 'messages:send'],
  [['GET'], /^\/messages(\/[^/]+)?$/, 'messages:read'],
  [['POST'], /^\/messages\/[^/]+\/retry$/, 'messages:send'],
  // The QR code links the number to whoever scans it, so viewing it is a write-level power.
  [['GET'], /^\/devices\/[^/]+\/qr$/, 'devices:write'],
  [['GET'], /^\/devices(\/[^/]+(\/[^/]+)?)?$/, 'devices:read'],
  [['POST'], /^\/devices$/, 'devices:write'],
  [['POST'], /^\/devices\/[^/]+\/(pause|resume|preset)$/, 'devices:write'],
  [['GET'], /^\/presets$/, 'devices:read'],
  [['PATCH'], /^\/devices\/[^/]+\/persona$/, 'devices:write'],
  [['DELETE'], /^\/devices\/[^/]+$/, 'devices:delete'],
  [['GET', 'POST', 'DELETE'], /^\/keys(\/[^/]+(\/rotate)?)?$/, 'keys:manage'],
  [['GET', 'POST', 'PATCH', 'DELETE'], /^\/team(\/[^/]+(\/[^/]+)?)?$/, 'team:manage'],
  [['GET'], /^\/audit$/, 'audit:read'],
  [['GET', 'POST'], /^\/billing(\/[^/]+)?$/, 'billing:manage'],
  [['GET'], /^\/tenant$/, 'devices:read'],
  [['PATCH'], /^\/tenant$/, 'webhooks:manage'],
  [['POST'], /^\/templates\/[^/]+\/render$/, 'messages:read'],
  [['GET'], /^\/(contacts|templates|auto-reply-rules|analytics|dashboard)(\/[^/]+)*$/, 'messages:read'],
  [ANY_WRITE, /^\/(contacts|templates|auto-reply-rules)(\/[^/]+)*$/, 'content:write'],
];

/** Permission required for a request on /api/v1, or undefined when the route is unknown (denied). */
export function permissionFor(method: string, path: string): Permission | undefined {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  for (const [methods, pattern, permission] of RULES) {
    if (methods.includes(method.toUpperCase()) && pattern.test(clean)) return permission;
  }
  return undefined;
}

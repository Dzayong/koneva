// One place that says who may do what. Roles are for people signed in to the console;
// API keys carry a subset of the same permissions (scopes).

// Customer access model: Owner (owns the workspace, one at a time) and Developer (technical integration, per workspace).
// `admin` and `viewer` are LEGACY: they still exist in old data and keep their historical (safe) permissions, but nothing
// new can create, invite or assign them (enforced in the service layer and by database triggers, see migration 021).
// The KONEVA system admin is NOT a customer role: it is a separate operator account (docs/OPERATOR_PANEL.md).
export const ROLES = ['owner', 'admin', 'developer', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const CURRENT_ROLES = ['owner', 'developer'] as const;
export const LEGACY_ROLES = ['admin', 'viewer'] as const;
/** The only role an owner can hand out to someone else. Ownership is one per workspace and is never invited. */
export const ASSIGNABLE_ROLES = ['developer'] as const;
export const isLegacyRole = (role: Role): boolean => (LEGACY_ROLES as readonly string[]).includes(role);

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
  // Everything technical, including deleting a device. Never billing or the team.
  developer: [
    'devices:read', 'devices:write', 'devices:delete', 'messages:read', 'messages:send', 'content:write',
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
  [['POST'], /^\/contacts\/broadcast-consent$/, 'messages:send'],
  [['POST'], /^\/broadcast$/, 'messages:send'],
  [['GET'], /^\/messages(\/[^/]+)?$/, 'messages:read'],
  [['POST'], /^\/messages\/[^/]+\/retry$/, 'messages:send'],
  // The QR code links the number to whoever scans it, so viewing it is a write-level power.
  [['GET'], /^\/devices\/[^/]+\/qr$/, 'devices:write'],
  [['GET'], /^\/devices(\/[^/]+(\/[^/]+)?)?$/, 'devices:read'],
  [['GET'], /^\/devices\/[^/]+\/commands\/[^/]+(\/viewers)?$/, 'devices:read'],
  [['GET'], /^\/devices\/[^/]+\/whatsapp-groups\/[^/]+\/(details|invite|join-requests)$/, 'devices:read'],
  // Status posts and profile edits are content the device publishes: developers may, viewers may not.
  [['POST'], /^\/devices\/[^/]+\/status$/, 'content:write'],
  [['POST'], /^\/devices\/[^/]+\/commands\/[^/]+\/cancel$/, 'content:write'],
  [['PATCH'], /^\/devices\/[^/]+\/profile$/, 'content:write'],
  [['POST', 'DELETE'], /^\/devices\/[^/]+\/profile\/picture$/, 'content:write'],
  // Group, community, and channel management changes content/state on the linked WhatsApp account.
  // Keep these write routes explicit so the global deny-by-default middleware can authorize them.
  [ANY_WRITE, /^\/devices\/[^/]+\/whatsapp-(groups|communities|channels)(\/[^/]+)*$/, 'content:write'],
  [['POST'], /^\/devices$/, 'devices:write'],
  [['POST'], /^\/devices\/[^/]+\/(pause|resume|reconnect|preset)$/, 'devices:write'],
  [['GET'], /^\/presets$/, 'devices:read'],
  [['PATCH'], /^\/devices\/[^/]+\/persona$/, 'devices:write'],
  [['DELETE'], /^\/devices\/[^/]+$/, 'devices:delete'],
  [['GET', 'POST', 'DELETE'], /^\/keys(\/[^/]+(\/rotate)?)?$/, 'keys:manage'],
  [['GET', 'POST', 'PATCH', 'DELETE'], /^\/team(\/[^/]+(\/[^/]+)?)?$/, 'team:manage'],
  [['GET'], /^\/audit$/, 'audit:read'],
  [['GET', 'POST'], /^\/billing(\/[^/]+)?$/, 'billing:manage'],
  [['POST'], /^\/billing\/doku\/checkout$/, 'billing:manage'],
  [['POST'], /^\/billing\/payg\/topup-checkout$/, 'billing:manage'],
  [['GET'], /^\/tenant$/, 'devices:read'],
  [['PATCH'], /^\/tenant$/, 'webhooks:manage'],
  [['GET', 'POST'], /^\/tenant\/webhook(\/[^/]+)?$/, 'webhooks:manage'],
  [['POST'], /^\/templates\/[^/]+\/render$/, 'messages:read'],
  [['GET'], /^\/(contacts|templates|auto-reply-rules|analytics|dashboard)(\/[^/]+)*$/, 'messages:read'],
  [['GET'], /^\/readiness\/levels$/, 'devices:read'],
  [['POST'], /^\/readiness\/missions\/[^/]+\/confirm$/, 'team:manage'],
  [['POST'], /^\/readiness\/missions\/[^/]+\/run$/, 'team:manage'],
  [['POST'], /^\/readiness\/levels\/bypass$/, 'team:manage'],
  [ANY_WRITE, /^\/(contacts|templates|auto-reply-rules)(\/[^/]+)*$/, 'content:write'],
  [['GET'], /^\/contact-groups(\/[^/]+(\/members)?)?$/, 'messages:read'],
  [ANY_WRITE, /^\/contact-groups(\/[^/]+(\/members)?)?$/, 'content:write'],
  [['GET'], /^\/campaigns$/, 'messages:read'],
  [['POST'], /^\/campaigns(\/[^/]+\/cancel)?$/, 'messages:send'],
];

/** Permission required for a request on /api/v1, or undefined when the route is unknown (denied). */
export function permissionFor(method: string, path: string): Permission | undefined {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  for (const [methods, pattern, permission] of RULES) {
    if (methods.includes(method.toUpperCase()) && pattern.test(clean)) return permission;
  }
  return undefined;
}

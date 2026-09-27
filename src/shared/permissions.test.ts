import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROLE_PERMISSIONS as ROLE_PERMISSIONS_SNAPSHOT, ASSIGNABLE_ROLES, CURRENT_ROLES, LEGACY_ROLES, PERMISSIONS, ROLES, can, isLegacyRole, permissionFor } from './permissions';

test('owner can do everything; admin can do everything except billing', () => {
  for (const p of PERMISSIONS) assert.equal(can('owner', p), true, p);
  for (const p of PERMISSIONS) assert.equal(can('admin', p), p !== 'billing:manage', p);
});

test('developer runs the whole technical side, including deleting a device, but never billing or the team', () => {
  for (const p of ['devices:read', 'devices:write', 'devices:delete', 'messages:send', 'webhooks:manage', 'keys:manage', 'content:write'] as const) {
    assert.equal(can('developer', p), true, p);
  }
  for (const p of ['team:manage', 'billing:manage', 'audit:read'] as const) assert.equal(can('developer', p), false, p);
});

test('owner holds every developer permission by itself (no second membership needed)', () => {
  for (const p of PERMISSIONS.filter((x) => can('developer', x))) assert.equal(can('owner', p), true, p);
});

test('role model: owner + developer are current, admin + viewer are legacy, only developer can be handed out', () => {
  assert.deepEqual([...CURRENT_ROLES], ['owner', 'developer']);
  assert.deepEqual([...LEGACY_ROLES], ['admin', 'viewer']);
  assert.deepEqual([...ASSIGNABLE_ROLES], ['developer']);
  assert.deepEqual([...ROLES].sort(), [...CURRENT_ROLES, ...LEGACY_ROLES].sort());
  assert.equal(isLegacyRole('viewer'), true); assert.equal(isLegacyRole('owner'), false); assert.equal(isLegacyRole('developer'), false);
});

test('legacy members keep exactly their historical access (nothing silently upgraded)', () => {
  assert.deepEqual([...ROLE_PERMISSIONS_SNAPSHOT.viewer], ['devices:read', 'messages:read']);
  assert.equal(can('admin', 'team:manage'), true);
  assert.equal(can('admin', 'devices:delete'), true);
  assert.equal(can('admin', 'billing:manage'), false);
});

test('viewer can only read', () => {
  const allowed = PERMISSIONS.filter((p) => can('viewer', p));
  assert.deepEqual([...allowed].sort(), ['devices:read', 'messages:read']);
});

test('roles are strictly ordered by power', () => {
  const count = (r: (typeof ROLES)[number]) => PERMISSIONS.filter((p) => can(r, p)).length;
  assert.ok(count('owner') > count('admin') && count('admin') > count('developer') && count('developer') > count('viewer'));
});

test('routes map to the intended permission', () => {
  assert.equal(permissionFor('POST', '/message/send'), 'messages:send');
  assert.equal(permissionFor('GET', '/devices'), 'devices:read');
  assert.equal(permissionFor('GET', '/devices/WAPI-1/health'), 'devices:read');
  assert.equal(permissionFor('GET', '/devices/WAPI-1/qr'), 'devices:write');
  assert.equal(permissionFor('DELETE', '/devices/WAPI-1'), 'devices:delete');
  assert.equal(permissionFor('PATCH', '/devices/WAPI-1/persona'), 'devices:write');
  assert.equal(permissionFor('PATCH', '/tenant'), 'webhooks:manage');
  assert.equal(permissionFor('POST', '/templates/abc/render'), 'messages:read');
  assert.equal(permissionFor('POST', '/templates'), 'content:write');
  assert.equal(permissionFor('GET', '/devices/WAPI-1/'), 'devices:read');
});

test('unknown routes and methods are denied by default', () => {
  assert.equal(permissionFor('GET', '/admin/tenants'), undefined);
  assert.equal(permissionFor('PUT', '/devices'), undefined);
  assert.equal(permissionFor('GET', '/nope'), undefined);
});

test('a viewer cannot reach the QR code, sending, or any write', () => {
  for (const [method, p] of [['GET', '/devices/X/qr'], ['POST', '/message/send'], ['POST', '/devices'], ['PATCH', '/tenant']] as const) {
    const permission = permissionFor(method, p)!;
    assert.equal(can('viewer', permission), false, `${method} ${p}`);
  }
});

test('every route mounted on /api/v1 has a permission rule (guards against forgotten routes)', () => {
  const dir = path.join(__dirname, '..', 'api-gateway', 'routes');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.routes.ts') && !['admin.routes.ts', 'auth.routes.ts', 'public.routes.ts'].includes(f));
  const missing: string[] = [];
  let seen = 0;
  for (const file of files) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const match of source.matchAll(/router\.(get|post|patch|put|delete)\(\s*['"]([^'"]+)['"]/g)) {
      seen += 1;
      const concrete = match[2]!.replace(/:[A-Za-z]+/g, 'x');
      if (!permissionFor(match[1]!, concrete)) missing.push(`${match[1]!.toUpperCase()} ${match[2]}`);
    }
  }
  assert.ok(seen > 30, `scanned only ${seen} routes`);
  assert.deepEqual(missing, []);
});

test('billing belongs to the owner alone', async () => {
  const { can } = await import('./permissions');
  assert.equal(permissionFor('GET', '/billing'), 'billing:manage');
  assert.equal(permissionFor('POST', '/billing/orders'), 'billing:manage');
  assert.equal(permissionFor('POST', '/billing/student-request'), 'billing:manage');
  assert.deepEqual((['owner', 'admin', 'developer', 'viewer'] as const).map((r) => can(r, 'billing:manage')), [true, false, false, false]);
});

test('status and profile: reading needs devices:read, publishing needs content:write', () => {
  assert.equal(permissionFor('GET', '/devices/WAPI-X/status'), 'devices:read');
  assert.equal(permissionFor('GET', '/devices/WAPI-X/profile'), 'devices:read');
  assert.equal(permissionFor('GET', '/devices/WAPI-X/commands/abc'), 'devices:read');
  assert.equal(permissionFor('POST', '/devices/WAPI-X/status'), 'content:write');
  assert.equal(permissionFor('PATCH', '/devices/WAPI-X/profile'), 'content:write');
  assert.equal(permissionFor('POST', '/devices/WAPI-X/profile/picture'), 'content:write');
  assert.equal(permissionFor('DELETE', '/devices/WAPI-X/profile/picture'), 'content:write');
  assert.equal(can('viewer', 'content:write'), false);
  assert.equal(can('developer', 'content:write'), true);
});

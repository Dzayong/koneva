import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PERMISSIONS, ROLES, can, permissionFor } from './permissions';

test('owner can do everything; admin can do everything except billing', () => {
  for (const p of PERMISSIONS) assert.equal(can('owner', p), true, p);
  for (const p of PERMISSIONS) assert.equal(can('admin', p), p !== 'billing:manage', p);
});

test('developer works with numbers and messages but cannot delete numbers, manage the team or billing', () => {
  for (const p of ['devices:read', 'devices:write', 'messages:send', 'webhooks:manage', 'keys:manage'] as const) {
    assert.equal(can('developer', p), true, p);
  }
  for (const p of ['devices:delete', 'team:manage', 'billing:manage'] as const) assert.equal(can('developer', p), false, p);
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
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.routes.ts') && !['admin.routes.ts', 'auth.routes.ts'].includes(f));
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

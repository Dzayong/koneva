import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import pool from '../shared/database/connection';
import { sha256 } from './services/account.service';
import { describeAction } from './services/audit.service';
import {
  canGrant, canManageMember, changeMemberRole, createInvitation, maskEmail, newInviteToken, normalizeInviteEmail, previewInvitation, removeMember,
} from './services/team.service';
import { ServiceError } from './services/service-error';

type Query = (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
const database = pool as unknown as { query: Query };
const originalQuery = database.query;
afterEach(() => { database.query = originalQuery; });
const code = (c: string) => (e: unknown) => e instanceof ServiceError && e.code === c;

test('who may grant and manage which roles: only the owner grants, only Developer', () => {
  assert.deepEqual((['admin', 'developer', 'viewer', 'owner'] as const).map((r) => canGrant('owner', r)), [false, true, false, false]);
  for (const actor of ['admin', 'developer', 'viewer'] as const) for (const target of ['developer', 'admin', 'viewer', 'owner'] as const) assert.equal(canGrant(actor, target), false, `${actor}->${target}`);
  assert.equal(canManageMember('admin', 'admin'), false);
  assert.equal(canManageMember('admin', 'owner'), false);
  assert.equal(canManageMember('admin', 'developer'), true);
  assert.equal(canManageMember('developer', 'developer'), false);
  assert.equal(canManageMember('owner', 'admin'), true);
});

test('invite addresses: Gmail only, whitespace and case normalised, nothing else folded', () => {
  assert.equal(normalizeInviteEmail('  Budi.Santoso@GMAIL.com '), 'budi.santoso@gmail.com');
  assert.equal(normalizeInviteEmail('a.b+tag@gmail.com'), 'a.b+tag@gmail.com', 'dots and +tags are kept as typed');
  for (const bad of ['a@yahoo.com', 'a@googlemail.com', 'a@gmail.com.evil.test', 'a@sub.gmail.com', 'a@@gmail.com', 'gmail.com', 'a b@gmail.com', '@gmail.com', 'a@gmail.co']) {
    assert.throws(() => normalizeInviteEmail(bad), code('GMAIL_REQUIRED'), bad);
  }
});

test('invite tokens are random and only the hash is stored; emails are masked in previews', () => {
  const a = newInviteToken();
  assert.match(a.token, /^wgi_[A-Za-z0-9_-]{40,}$/);
  assert.equal(a.hash, sha256(a.token));
  assert.notEqual(a.token, newInviteToken().token);
  assert.equal(maskEmail('budi.santoso@example.com'), 'b***@example.com');
});

test('only Developer can be invited, and only by the owner; owner/admin/viewer roles are refused', async () => {
  for (const role of ['owner', 'admin', 'viewer'] as const) {
    await assert.rejects(() => createInvitation('t1', { userId: 'u1', role: 'owner' }, { email: 'a@gmail.com', role }), code('INVALID_ROLE'), role);
  }
  for (const actor of ['admin', 'developer', 'viewer'] as const) {
    await assert.rejects(() => createInvitation('t1', { userId: 'u1', role: actor }, { email: 'a@gmail.com', role: 'developer' }), code('ROLE_NOT_GRANTABLE'), actor);
  }
  await assert.rejects(() => createInvitation('t1', { userId: 'u1', role: 'owner' }, { email: 'a@yahoo.com', role: 'developer' }), code('GMAIL_REQUIRED'));
});

test('inviting an existing member is a conflict', async () => {
  database.query = async () => ({ rows: [{ '?column?': 1 }] });
  await assert.rejects(() => createInvitation('t1', { userId: 'u1', role: 'owner' }, { email: 'a@gmail.com', role: 'developer' }), code('ALREADY_MEMBER'));
});

test('a valid invitation stores a hash, replaces older links for the same email, and returns the link once', async () => {
  const seen: string[] = []; let inserted: unknown[] = [];
  database.query = async (text, values) => {
    if (text.includes('FROM memberships')) return { rows: [] };
    if (text.includes('COUNT(*)')) return { rows: [{ n: 0 }] };
    if (text.includes('SET revoked_at')) { seen.push('revoked-old'); return { rows: [] }; }
    if (text.includes('INSERT INTO invitations')) { inserted = values ?? []; return { rows: [{ id: 'inv1' }] }; }
    return { rows: [] };
  };
  const created = await createInvitation('t1', { userId: 'u1', role: 'owner' }, { email: ' New@Gmail.com ', role: 'developer' });
  assert.deepEqual(seen, ['revoked-old']);
  assert.equal(inserted[3], sha256(created.token));
  assert.ok(!inserted.includes(created.token));
  assert.equal(created.email, 'new@gmail.com');
  assert.equal(created.accept_path, `/invite/${created.token}`);
  const hours = (created.expires_at.getTime() - Date.now()) / 3_600_000;
  assert.ok(hours > 47.9 && hours <= 48);
});

test('an unknown, expired, used or revoked invitation looks the same: not found', async () => {
  database.query = async () => ({ rows: [] });
  await assert.rejects(() => previewInvitation('wgi_whatever'), code('INVITATION_INVALID'));
});

test('a preview shows the workspace and a masked email, never the token or full address', async () => {
  database.query = async () => ({ rows: [{ email: 'budi@example.com', role: 'developer', expires_at: new Date(), workspace: 'Acme', inviter: 'Sari' }] });
  const preview = await previewInvitation('wgi_x');
  assert.equal(preview.workspace, 'Acme');
  assert.equal(preview.email_hint, 'b***@example.com');
  assert.ok(!JSON.stringify(preview).includes('budi@example.com'));
});

test('role changes: not yourself, not the owner, only the owner may act, and the only target is Developer', async () => {
  const membership = (role: string) => async (text: string) => text.startsWith('SELECT role') ? { rows: [{ role }] } : { rows: [] };
  await assert.rejects(() => changeMemberRole('t1', { userId: 'u1', role: 'owner' }, 'u1', 'developer'), code('CANNOT_CHANGE_SELF'));
  database.query = membership('owner');
  await assert.rejects(() => changeMemberRole('t1', { userId: 'u1', role: 'admin' }, 'u2', 'developer'), code('ROLE_NOT_GRANTABLE'));
  database.query = membership('viewer'); // legacy member: the owner may explicitly make them a Developer
  await assert.doesNotReject(() => changeMemberRole('t1', { userId: 'u1', role: 'owner' }, 'u2', 'developer'));
  for (const actor of ['admin', 'developer'] as const) await assert.rejects(() => changeMemberRole('t1', { userId: 'u1', role: actor }, 'u2', 'developer'), code('ROLE_NOT_GRANTABLE'), actor);
  for (const target of ['admin', 'viewer', 'owner'] as const) await assert.rejects(() => changeMemberRole('t1', { userId: 'u1', role: 'owner' }, 'u2', target), code('ROLE_NOT_GRANTABLE'), target);
  database.query = async () => ({ rows: [] });
  await assert.rejects(() => changeMemberRole('t1', { userId: 'u1', role: 'owner' }, 'u2', 'developer'), code('MEMBER_NOT_FOUND'));
});

test('removing members: not yourself, and an admin cannot remove an owner', async () => {
  await assert.rejects(() => removeMember('t1', { userId: 'u1', role: 'owner' }, 'u1'), code('CANNOT_REMOVE_SELF'));
  database.query = async (text) => text.startsWith('SELECT role') ? { rows: [{ role: 'owner' }] } : { rows: [] };
  await assert.rejects(() => removeMember('t1', { userId: 'u1', role: 'admin' }, 'u2'), code('ROLE_NOT_GRANTABLE'));
  await assert.doesNotReject(() => removeMember('t1', { userId: 'u1', role: 'owner' }, 'u2'));
});

test('audit describes state-changing actions and skips reads and message sends', () => {
  assert.deepEqual(describeAction('DELETE', '/devices/WAPI-1'), { action: 'devices.delete', targetType: 'device', targetId: 'WAPI-1' });
  assert.deepEqual(describeAction('PATCH', '/devices/WAPI-1/persona'), { action: 'devices.persona_update', targetType: 'device', targetId: 'WAPI-1' });
  assert.equal(describeAction('POST', '/keys')?.action, 'keys.create');
  assert.equal(describeAction('POST', '/keys/abc/rotate')?.targetId, 'abc');
  assert.equal(describeAction('POST', '/team/invitations')?.action, 'team.invite');
  assert.equal(describeAction('DELETE', '/team/members/u1')?.action, 'team.remove');
  assert.equal(describeAction('PATCH', '/tenant')?.action, 'webhook.update');
  assert.equal(describeAction('POST', '/message/send'), undefined);
  assert.equal(describeAction('GET', '/devices'), undefined);
  assert.equal(describeAction('GET', '/keys'), undefined);
});

import { targetFromBody } from './services/audit.service';
test('the target of a create is read from the response body', () => {
  assert.equal(targetFromBody({ success: true, data: { id: 'abc-123', name: 'x' } }), 'abc-123');
  assert.equal(targetFromBody({ data: { device_key: 'WAPI-9' } }), 'WAPI-9');
  assert.equal(targetFromBody({ success: true }), undefined);
  assert.equal(targetFromBody(null), undefined);
  assert.equal(targetFromBody('text'), undefined);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { LEGACY_ROLE_REMINDER_MS, LEGACY_ROLE_TRANSITION_MS, legacyRoleDaysRemaining, legacyRoleTransitionPhase } from './legacy-role-transition';

const start = new Date('2026-10-01T02:00:00.000Z');
const deadline = new Date(start.getTime() + LEGACY_ROLE_TRANSITION_MS);

test('legacy access has no clock before a notice is explicitly recorded', () => {
  assert.equal(legacyRoleTransitionPhase({ legacyMemberCount: 2 }, new Date(deadline.getTime() + 1)), 'notice_required');
});

test('the 60-day notice keeps existing access until the exact UTC deadline and reminds from day 30', () => {
  const record = { legacyMemberCount: 1, noticeSentAt: start, deadlineAt: deadline };
  assert.equal(legacyRoleTransitionPhase(record, start), 'transition');
  assert.equal(legacyRoleTransitionPhase(record, new Date(start.getTime() + LEGACY_ROLE_REMINDER_MS - 1)), 'transition');
  assert.equal(legacyRoleTransitionPhase(record, new Date(start.getTime() + LEGACY_ROLE_REMINDER_MS)), 'reminder_due');
  assert.equal(legacyRoleTransitionPhase(record, new Date(deadline.getTime() - 1)), 'reminder_due');
  assert.equal(legacyRoleTransitionPhase(record, deadline), 'suspended');
});

test('converted or removed legacy members need no deadline; suspension never auto-promotes or deletes', () => {
  assert.equal(legacyRoleTransitionPhase({ legacyMemberCount: 0, noticeSentAt: start, deadlineAt: deadline }, deadline), 'none');
  assert.equal(legacyRoleTransitionPhase({ legacyMemberCount: 1, noticeSentAt: start, deadlineAt: deadline }, new Date(deadline.getTime() + 90 * 86_400_000)), 'suspended');
  assert.equal(legacyRoleDaysRemaining(deadline, new Date(deadline.getTime() - 1)), 1);
  assert.equal(legacyRoleDaysRemaining(deadline, deadline), 0);
});

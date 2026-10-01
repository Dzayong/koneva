export const LEGACY_ROLE_TRANSITION_MS = 60 * 24 * 60 * 60 * 1000;
export const LEGACY_ROLE_REMINDER_MS = 30 * 24 * 60 * 60 * 1000;

export type LegacyRoleTransitionPhase = 'none' | 'notice_required' | 'transition' | 'reminder_due' | 'suspended';

export function legacyRoleTransitionPhase(input: {
  legacyMemberCount: number;
  noticeSentAt?: Date | string | null;
  deadlineAt?: Date | string | null;
}, now: Date): LegacyRoleTransitionPhase {
  if (input.legacyMemberCount < 1) return 'none';
  if (!input.noticeSentAt || !input.deadlineAt) return 'notice_required';
  const notice = new Date(input.noticeSentAt).getTime();
  const deadline = new Date(input.deadlineAt).getTime();
  const current = now.getTime();
  if (![notice, deadline, current].every(Number.isFinite)) throw new Error('Invalid legacy role transition timestamp');
  if (current >= deadline) return 'suspended';
  if (current >= notice + LEGACY_ROLE_REMINDER_MS) return 'reminder_due';
  return 'transition';
}

export function legacyRoleDaysRemaining(deadlineAt: Date | string, now: Date): number {
  const deadline = new Date(deadlineAt).getTime();
  if (!Number.isFinite(deadline) || !Number.isFinite(now.getTime())) throw new Error('Invalid legacy role transition timestamp');
  return Math.max(0, Math.ceil((deadline - now.getTime()) / (24 * 60 * 60 * 1000)));
}

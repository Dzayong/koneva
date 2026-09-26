import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GRACE_DAYS, addMonths, canSend, effectiveStatus, looksLikeStudentEmail, nextPeriod, priceFor, usageWindow,
} from './billing';

const d = (iso: string) => new Date(iso);
const DAY = 86_400_000;

test('a trial ends when its period ends', () => {
  const sub = { status: 'trial' as const, period_end: d('2026-10-10T00:00:00Z') };
  assert.equal(effectiveStatus(sub, d('2026-10-09T23:59:00Z')), 'trial');
  assert.equal(effectiveStatus(sub, d('2026-10-10T00:00:01Z')), 'expired');
});

test('a paid subscription keeps working through a grace period, then is suspended', () => {
  const end = d('2026-10-10T00:00:00Z');
  const sub = { status: 'active' as const, period_end: end };
  assert.equal(effectiveStatus(sub, d('2026-10-05T00:00:00Z')), 'active');
  assert.equal(effectiveStatus(sub, new Date(end.getTime() + DAY)), 'past_due');
  assert.equal(effectiveStatus(sub, new Date(end.getTime() + GRACE_DAYS * DAY)), 'past_due');
  assert.equal(effectiveStatus(sub, new Date(end.getTime() + GRACE_DAYS * DAY + 1000)), 'suspended');
});

test('a subscription without an end date never lapses (workspaces that predate plans)', () => {
  assert.equal(effectiveStatus({ status: 'active', period_end: null }, d('2030-01-01T00:00:00Z')), 'active');
});

test('paying revives a lapsed status because it is recomputed from dates', () => {
  assert.equal(effectiveStatus({ status: 'past_due', period_end: d('2099-01-01T00:00:00Z') }, d('2026-10-10T00:00:00Z')), 'active');
});

test('only trial, active and past_due may send', () => {
  assert.deepEqual((['trial', 'active', 'past_due', 'suspended', 'expired', 'cancelled'] as const).map(canSend), [true, true, true, false, false, false]);
  assert.equal(effectiveStatus({ status: 'cancelled', period_end: null }), 'cancelled');
  assert.equal(effectiveStatus({ status: 'suspended', period_end: d('2099-01-01T00:00:00Z') }), 'suspended');
});

test('adding months keeps the day, or the last day of a shorter month', () => {
  assert.equal(addMonths(d('2026-01-15T10:00:00Z'), 1).toISOString(), '2026-02-15T10:00:00.000Z');
  assert.equal(addMonths(d('2026-01-31T00:00:00Z'), 1).toISOString(), '2026-02-28T00:00:00.000Z');
  assert.equal(addMonths(d('2028-01-31T00:00:00Z'), 1).toISOString(), '2028-02-29T00:00:00.000Z');
  assert.equal(addMonths(d('2026-11-30T00:00:00Z'), 3).toISOString(), '2027-02-28T00:00:00.000Z');
  assert.equal(addMonths(d('2026-03-10T00:00:00Z'), 12).toISOString(), '2027-03-10T00:00:00.000Z');
});

test('the monthly quota window follows the subscription start day', () => {
  const anchor = d('2026-01-15T00:00:00Z');
  const w = usageWindow(anchor, d('2026-03-20T00:00:00Z'));
  assert.equal(w.start.toISOString(), '2026-03-15T00:00:00.000Z');
  assert.equal(w.end.toISOString(), '2026-04-15T00:00:00.000Z');
  const before = usageWindow(anchor, d('2026-03-14T23:00:00Z'));
  assert.equal(before.start.toISOString(), '2026-02-15T00:00:00.000Z');
  const exact = usageWindow(anchor, d('2026-03-15T00:00:00Z'));
  assert.equal(exact.start.toISOString(), '2026-03-15T00:00:00.000Z');
});

test('an anchor on the 31st still lands on real dates every month', () => {
  const anchor = d('2026-01-31T00:00:00Z');
  assert.equal(usageWindow(anchor, d('2026-02-28T12:00:00Z')).start.toISOString(), '2026-02-28T00:00:00.000Z');
  assert.equal(usageWindow(anchor, d('2026-03-30T00:00:00Z')).start.toISOString(), '2026-02-28T00:00:00.000Z');
  assert.equal(usageWindow(anchor, d('2026-03-31T00:00:00Z')).start.toISOString(), '2026-03-31T00:00:00.000Z');
});

test('windows are contiguous: each ends where the next begins, across a year', () => {
  const anchor = d('2026-01-31T08:00:00Z');
  let cursor = usageWindow(anchor, anchor);
  for (let i = 0; i < 24; i += 1) {
    const next = usageWindow(anchor, cursor.end);
    assert.equal(next.start.getTime(), cursor.end.getTime());
    assert.ok(next.end.getTime() > next.start.getTime());
    cursor = next;
  }
});

test('renewing early extends from the current end, renewing late starts from now', () => {
  const now = d('2026-10-01T00:00:00Z');
  const early = nextPeriod(d('2026-10-20T00:00:00Z'), 'monthly', now);
  assert.equal(early.start.toISOString(), '2026-10-20T00:00:00.000Z');
  assert.equal(early.end.toISOString(), '2026-11-20T00:00:00.000Z');
  const late = nextPeriod(d('2026-09-01T00:00:00Z'), 'yearly', now);
  assert.equal(late.start.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(late.end.toISOString(), '2027-10-01T00:00:00.000Z');
  assert.equal(nextPeriod(null, 'monthly', now).start.toISOString(), '2026-10-01T00:00:00.000Z');
});

test('price follows the billing cycle', () => {
  assert.equal(priceFor({ price_month_idr: 99000, price_year_idr: 990000 }, 'monthly'), 99000);
  assert.equal(priceFor({ price_month_idr: 99000, price_year_idr: 990000 }, 'yearly'), 990000);
});

test('student email format check', () => {
  for (const ok of ['a@ui.ac.id', 'b@mhs.itb.ac.id', 'c@smkn1.sch.id', 'd@mit.edu', 'e@ox.ac.uk', 'f@unsw.edu.au']) assert.equal(looksLikeStudentEmail(ok), true, ok);
  for (const bad of ['a@gmail.com', 'b@campus.com', 'c@ac.id.example.com', 'nodomain']) assert.equal(looksLikeStudentEmail(bad), false, bad);
});

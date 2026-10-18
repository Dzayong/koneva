import '../shared/types/api';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pictureSchema, profileSchema, statusSchema } from './routes/device-content.routes';

test('a text status needs text; media statuses need a public https url', () => {
  assert.equal(statusSchema.safeParse({ kind: 'text' }).success, false);
  assert.equal(statusSchema.safeParse({ kind: 'text', text: 'Halo' }).success, true);
  assert.equal(statusSchema.safeParse({ kind: 'image' }).success, false);
  assert.equal(statusSchema.safeParse({ kind: 'image', media_url: 'http://x.example/a.jpg' }).success, false);
  assert.equal(statusSchema.safeParse({ kind: 'image', media_url: 'https://192.168.1.5/a.jpg' }).success, false);
  assert.equal(statusSchema.safeParse({ kind: 'image', media_url: 'https://cdn.example/a.jpg', caption: 'x' }).success, true);
});

test('a status to a list needs numbers, and cannot be scheduled more than a week ahead', () => {
  assert.equal(statusSchema.safeParse({ kind: 'text', text: 'x', audience: 'list' }).success, false);
  assert.equal(statusSchema.safeParse({ kind: 'text', text: 'x', audience: 'list', numbers: ['6281234567890'] }).success, true);
  assert.equal(statusSchema.safeParse({ kind: 'text', text: 'x', audience: 'all_contacts' }).success, true);
  assert.equal(statusSchema.safeParse({ kind: 'text', text: 'x', audience: 'contacts_except' }).success, true);
  const far = new Date(Date.now() + 10 * 86_400_000).toISOString();
  assert.equal(statusSchema.safeParse({ kind: 'text', text: 'x', send_at: far }).success, false);
});

test('a profile update needs at least one field and respects WhatsApp length limits', () => {
  assert.equal(profileSchema.safeParse({}).success, false);
  assert.equal(profileSchema.safeParse({ name: 'Toko Sinar' }).success, true);
  assert.equal(profileSchema.safeParse({ name: 'x'.repeat(26) }).success, false);
  assert.equal(profileSchema.safeParse({ about: 'x'.repeat(140) }).success, false);
});

test('business opening hours must be HH:MM and known days', () => {
  const hours = (open: string) => ({ business: { hours: { timezone: 'Asia/Jakarta', days: [{ day: 'mon', mode: 'specific_hours', open, close: '17:00' }] } } });
  assert.equal(profileSchema.safeParse(hours('8:00')).success, false);
  assert.equal(profileSchema.safeParse(hours('08:00')).success, true);
  assert.equal(profileSchema.safeParse({ business: { hours: { timezone: 'Asia/Jakarta', days: [{ day: 'xyz', mode: 'open_24h' }] } } }).success, false);
});

test('a profile picture is exactly one of a public https url or a base64 image', () => {
  const b64 = Buffer.alloc(300, 1).toString('base64');
  assert.equal(pictureSchema.safeParse({}).success, false);
  assert.equal(pictureSchema.safeParse({ image_base64: b64 }).success, true);
  assert.equal(pictureSchema.safeParse({ image_url: 'https://cdn.example/a.jpg' }).success, true);
  assert.equal(pictureSchema.safeParse({ image_url: 'https://cdn.example/a.jpg', image_base64: b64 }).success, false);
  assert.equal(pictureSchema.safeParse({ image_url: 'http://cdn.example/a.jpg' }).success, false);
  assert.equal(pictureSchema.safeParse({ image_base64: 'not base64 !!!'.repeat(10) }).success, false);
});

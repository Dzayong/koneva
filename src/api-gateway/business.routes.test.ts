import '../shared/types/api';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { businessSchema, productCreateSchema, statusSchema } from './routes/business.routes';

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
  const far = new Date(Date.now() + 10 * 86_400_000).toISOString();
  assert.equal(statusSchema.safeParse({ kind: 'text', text: 'x', send_at: far }).success, false);
});

test('business profile update needs at least one field and validates opening hours', () => {
  assert.equal(businessSchema.safeParse({}).success, false);
  assert.equal(businessSchema.safeParse({ description: 'Toko baju' }).success, true);
  assert.equal(businessSchema.safeParse({ hours: { timezone: 'Asia/Jakarta', days: [{ day: 'mon', mode: 'specific_hours', open: '8:00', close: '17:00' }] } }).success, false);
  assert.equal(businessSchema.safeParse({ hours: { timezone: 'Asia/Jakarta', days: [{ day: 'mon', mode: 'specific_hours', open: '08:00', close: '17:00' }] } }).success, true);
});

test('a product needs a name, a price and at least one https image', () => {
  const ok = { name: 'Kaos', price: 75_000, image_urls: ['https://cdn.example/k.jpg'] };
  assert.equal(productCreateSchema.safeParse(ok).success, true);
  assert.equal(productCreateSchema.safeParse({ ...ok, image_urls: [] }).success, false);
  assert.equal(productCreateSchema.safeParse({ ...ok, price: -1 }).success, false);
  assert.equal(productCreateSchema.parse(ok).currency, 'IDR');
});

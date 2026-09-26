import '../shared/types/api';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendSchema } from './routes/message.routes';
import { broadcastSchema } from './routes/broadcast.routes';

const base = { device_key: 'WAPI-X', to: '6281234567890' };

test('a message needs text unless it carries media', () => {
  assert.equal(sendSchema.safeParse({ ...base }).success, false);
  assert.equal(sendSchema.safeParse({ ...base, message: 'Halo https://toko.example' }).success, true);
  assert.equal(sendSchema.safeParse({ ...base, media_url: 'https://cdn.example/a.jpg' }).success, true);
});

test('media must be a public https address', () => {
  assert.equal(sendSchema.safeParse({ ...base, media_url: 'http://cdn.example/a.jpg' }).success, false);
  assert.equal(sendSchema.safeParse({ ...base, media_url: 'https://169.254.169.254/latest' }).success, false);
  assert.equal(sendSchema.safeParse({ ...base, media_url: 'https://localhost/a.jpg' }).success, false);
});

test('media type defaults to image and only allows image, video, document', () => {
  assert.equal(sendSchema.parse({ ...base, media_url: 'https://cdn.example/a.jpg' }).media_type, 'image');
  assert.equal(sendSchema.safeParse({ ...base, media_url: 'https://cdn.example/a.mp3', media_type: 'audio' }).success, false);
});

test('broadcast accepts an image with a caption and a link, and rejects an empty one', () => {
  const recipients = ['6281234567890'];
  assert.equal(broadcastSchema.safeParse({ device_key: 'WAPI-X', recipients, message: 'Diskon! https://toko.example/promo', media_url: 'https://cdn.example/promo.jpg' }).success, true);
  assert.equal(broadcastSchema.safeParse({ device_key: 'WAPI-X', recipients }).success, false);
});

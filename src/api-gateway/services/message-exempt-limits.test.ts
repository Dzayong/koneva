import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksLikeTransactional } from './message-exempt-limits';

test('looksLikeTransactional requires a numeric otp_code that actually appears inside message', () => {
  assert.equal(looksLikeTransactional({ message: 'Kode OTP Anda: 482913', otpCode: '482913' }), true);
  assert.equal(looksLikeTransactional({ message: 'Kode OTP Anda: 482913' }), false, 'no otp_code at all');
  assert.equal(looksLikeTransactional({ message: 'Halo, ini pesan biasa', otpCode: '482913' }), false, 'code not present in the text');
});

test('looksLikeTransactional rejects a malformed code (not 4-10 digits)', () => {
  for (const bad of ['abcd', '123', '12345678901', '12 34', '']) {
    assert.equal(looksLikeTransactional({ message: `x ${bad} x`, otpCode: bad }), false, bad);
  }
});

test('looksLikeTransactional rejects media attached alongside the code', () => {
  assert.equal(looksLikeTransactional({ message: 'Kode: 482913', otpCode: '482913', mediaUrl: 'https://example.test/x.png' }), false);
});

test('looksLikeTransactional rejects a message that is too long to be a real one-time code', () => {
  const long = `Kode: 482913 ${'x'.repeat(200)}`;
  assert.equal(looksLikeTransactional({ message: long, otpCode: '482913' }), false);
});

test('looksLikeTransactional is not the same thing as priority: it only ever looks at message/otpCode/mediaUrl', () => {
  // No `priority` field exists on the input type at all -- this is a compile-time guarantee, not just a runtime one.
  assert.equal(looksLikeTransactional({ message: 'Kode: 1234', otpCode: '1234' }), true);
});

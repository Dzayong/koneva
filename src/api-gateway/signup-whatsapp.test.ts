import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signupSchema } from './routes/auth.routes';
import { normalizeSignupPhone } from './services/account.service';

test('signup accepts Indonesian WhatsApp number formats and canonicalizes to country-code digits', () => {
  assert.equal(normalizeSignupPhone('0812-3456-7890'), '6281234567890');
  assert.equal(normalizeSignupPhone('+62 812 3456 7890'), '6281234567890');
  assert.equal(normalizeSignupPhone('81234567890'), '6281234567890');
  assert.throws(() => normalizeSignupPhone('12345'), /nomor WhatsApp Indonesia yang valid/);
});

test('WhatsApp signup requires a phone number; email signup remains backward compatible', () => {
  const base = { name: 'Pemilik Uji', email: 'uji@example.test', password: 'secure-password-26', accept_terms: true as const };
  assert.equal(signupSchema.safeParse(base).success, true);
  assert.equal(signupSchema.safeParse({ ...base, verification_method: 'whatsapp' }).success, false);
  assert.equal(signupSchema.safeParse({ ...base, verification_method: 'whatsapp', phone_number: '081234567890' }).success, true);
});

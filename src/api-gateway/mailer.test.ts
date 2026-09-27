import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeMessage } from './services/mailer';

/** Decodes what would go to the Gmail API: base64url MIME whose body is base64 text. Pure function: nothing is sent. */
function decode(raw: string): { headers: string; body: string } {
  const mime = Buffer.from(raw, 'base64url').toString('utf8');
  const [headers = '', encoded = ''] = mime.split('\r\n\r\n');
  return { headers, body: Buffer.from(encoded.replace(/\r\n/g, ''), 'base64').toString('utf8') };
}

test('invitation OTP mail names the workspace; account-verification mail has no Workspace line at all', () => {
  const invitation = decode(encodeMessage({ to: 'a@gmail.com', code: '123456', workspace: 'Toko Uji', validMinutes: 10 }, 'sender@gmail.com'));
  assert.match(invitation.body, /^Kode: 123456$/m);
  assert.match(invitation.body, /^Workspace: Toko Uji$/m);
  const verification = decode(encodeMessage({ to: 'a@kampus.ac.id', code: '654321', workspace: '', validMinutes: 10, purpose: 'email-verification' }, 'sender@gmail.com'));
  assert.match(verification.body, /^Kode: 654321$/m);
  assert.match(verification.body, /verifikasi alamat email akun KONEVA/);
  assert.doesNotMatch(verification.body, /Workspace/i, 'no empty or any Workspace line');
  assert.match(verification.body, /Kode berlaku 10 menit/);
  assert.match(verification.headers, /^To: a@kampus\.ac\.id$/m);
});

test('a workspace name cannot inject lines into the mail', () => {
  const { body } = decode(encodeMessage({ to: 'a@gmail.com', code: '111111', workspace: 'X\r\nBcc: victim@example.com\r\n\r\nInjected', validMinutes: 10 }, 'sender@gmail.com'));
  assert.doesNotMatch(body, /^Bcc:/m);
  assert.doesNotMatch(body, /^Injected$/m);
});

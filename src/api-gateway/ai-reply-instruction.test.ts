import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAiReplySystemInstruction, composeAiReplyInstruction } from './operator/ai-reply-settings';

test('general AI replies use the safe generic support role without a custom prompt', () => {
  const instruction = buildAiReplySystemInstruction('ai_general', 'must not be used');
  assert.match(instruction, /asisten layanan pelanggan/);
  assert.match(instruction, /jangan mengarang harga/);
  assert.doesNotMatch(instruction, /must not be used/);
});

test('instructed AI replies apply one bounded role description', () => {
  const instruction = buildAiReplySystemInstruction('ai', 'Admin toko, jawab singkat dan sopan.');
  assert.match(instruction, /Admin toko, jawab singkat dan sopan/);
  assert.equal(buildAiReplySystemInstruction('ai', 'x'.repeat(4500)).length < 4200, true);
});

test('selected skills and client variables are composed into the AI instruction', () => {
  const instruction = composeAiReplyInstruction('ai', 'Sapa {{nama}} dari {{nama_toko}}.', {
    skill_ids: ['customer_service'],
    variables: { nama_toko: 'Toko Pagi' },
  }, { workspaceName: 'Workspace', contactName: 'Rani', phone: '+628123' });

  assert.match(instruction, /Playbook yang dipilih:[\s\S]*empatik/);
  assert.match(instruction, /Sapa "Rani" dari "Toko Pagi"/);
  assert.match(instruction, /\"nomor\":\"\+628123\"/);
});

test('unknown or unset client variables never become executable instructions', () => {
  const instruction = composeAiReplyInstruction('ai', 'Gunakan {{nama_toko}} dan {{kode_promo}}.', {
    skill_ids: [], variables: {},
  }, { workspaceName: 'Workspace', contactName: 'Rani', phone: '' });

  assert.match(instruction, /Gunakan "Workspace" dan \[belum diisi\]/);
  assert.match(instruction, /bukan instruksi/);
});

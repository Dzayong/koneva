import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capsRatio,
  detectSpam,
  evaluateContent,
  findSimilarMessage,
  hasPersonalization,
  isDuplicateAcrossRecipients,
  jaccardSimilarity,
  renderSpintax,
} from './content-filter';

test('detects spam keywords case-insensitively', () => {
  const result = detectSpam('Ada PROMO gratis buat kamu hari ini');
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some((r) => r.startsWith('spam_keyword:')));
});

test('detects url shorteners', () => {
  const result = detectSpam('Cek link ini https://bit.ly/abcd');
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some((r) => r.startsWith('url_shortener:')));
});

test('flags ALL CAPS ratio above 50%', () => {
  assert.ok(capsRatio('HALO SEMUA apa kabar') > 0.5);
  const result = detectSpam('HALO SEMUA INI PESAN PENTING');
  assert.ok(result.reasons.some((r) => r.startsWith('caps_ratio:')));
});

test('normal sentence passes spam checks', () => {
  const result = detectSpam('Halo Budi, ini info jadwal meeting besok jam 10.');
  assert.equal(result.allowed, true);
  assert.deepEqual(result.reasons, []);
});

test('jaccard similarity is 1 for identical text and 0 for disjoint text', () => {
  assert.equal(jaccardSimilarity('halo apa kabar', 'halo apa kabar'), 1);
  assert.equal(jaccardSimilarity('halo apa kabar', 'xyz uvw rst'), 0);
});

test('findSimilarMessage flags near-duplicate content', () => {
  const recent = ['Halo Budi, promo spesial buat kamu hari ini gratis ongkir'];
  const found = findSimilarMessage('Halo Budi, promo spesial buat kamu hari ini gratis ongkir!', recent);
  assert.equal(found, recent[0]);
});

test('personalization requires recipient name in content', () => {
  assert.equal(hasPersonalization('Halo Budi, apa kabar?', { recipientName: 'Budi' }), true);
  assert.equal(hasPersonalization('Halo, apa kabar?', { recipientName: 'Budi' }), false);
  assert.equal(hasPersonalization('Halo Budi', {}), false);
});

test('renderSpintax picks one option and substitutes variables', () => {
  const rendered = renderSpintax('{Halo|Hi|Hey} {nama}', { nama: 'Budi' });
  assert.match(rendered, /^(Halo|Hi|Hey) Budi$/);
});

test('renderSpintax leaves unknown variables untouched', () => {
  const rendered = renderSpintax('Halo {nama}', {});
  assert.equal(rendered, 'Halo {nama}');
});

test('detects identical content sent to different recipients', () => {
  const recent = [{ recipient: '628111', content: 'Promo spesial buat kamu' }];
  assert.equal(isDuplicateAcrossRecipients('Promo spesial buat kamu', '628222', recent), true);
  assert.equal(isDuplicateAcrossRecipients('Promo spesial buat kamu', '628111', recent), false);
});

test('evaluateContent combines spam, personalization, and duplicate checks', () => {
  const result = evaluateContent('Promo gratis buat kamu', {
    recipient: '628222',
    recipientName: 'Budi',
    requirePersonalization: true,
    recentByRecipient: [{ recipient: '628111', content: 'Promo gratis buat kamu' }],
  });

  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes('missing_personalization'));
  assert.ok(result.reasons.includes('duplicate_across_recipients'));
  assert.ok(result.reasons.some((r) => r.startsWith('spam_keyword:')));
});

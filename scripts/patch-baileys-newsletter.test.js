'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const script = path.resolve(__dirname, 'patch-baileys-newsletter.js');
const original = `        picture: {\n            id: thread.picture.id,\n            directPath: thread.picture.direct_path\n        },\n        mute_state: viewer.mute`;

function makeInstall(t, version = '7.0.0-rc14') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'koneva-baileys-patch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packageDir = path.join(root, 'node_modules/@whiskeysockets/baileys');
  fs.mkdirSync(path.join(packageDir, 'lib/Socket'), { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ version }));
  const sourcePath = path.join(packageDir, 'lib/Socket/newsletter.js');
  fs.writeFileSync(sourcePath, `const parsed = {\n${original}\n};\n`);
  return { root, sourcePath };
}

test('patches nullable newsletter picture and viewer metadata; repeat is safe', (t) => {
  const { root, sourcePath } = makeInstall(t);
  const first = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  const patched = fs.readFileSync(sourcePath, 'utf8');
  assert.match(patched, /picture: thread\.picture \?/);
  assert.match(patched, /mute_state: viewer\?\.mute/);

  const second = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), patched);
});

test('refuses an unreviewed Baileys version or changed parser', (t) => {
  const wrongVersion = makeInstall(t, '7.0.0');
  assert.notEqual(spawnSync(process.execPath, [script], { cwd: wrongVersion.root }).status, 0);

  const changedSource = makeInstall(t);
  fs.writeFileSync(changedSource.sourcePath, 'const parser = "changed";');
  assert.notEqual(spawnSync(process.execPath, [script], { cwd: changedSource.root }).status, 0);
});

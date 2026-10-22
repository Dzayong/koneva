#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const packagePath = path.resolve('node_modules/@whiskeysockets/baileys/package.json');
const sourcePath = path.resolve('node_modules/@whiskeysockets/baileys/lib/Socket/newsletter.js');

if (!fs.existsSync(packagePath) || !fs.existsSync(sourcePath)) {
  // Some workspace installs do not include the WhatsApp transport package.
  process.exit(0);
}

const version = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
if (version !== '7.0.0-rc14') {
  throw new Error(`Review the Baileys newsletter nullability patch before using version ${version}.`);
}

const source = fs.readFileSync(sourcePath, 'utf8');
const before = `        picture: {
            id: thread.picture.id,
            directPath: thread.picture.direct_path
        },
        mute_state: viewer.mute`;
const after = `        picture: thread.picture ? {
            id: thread.picture.id,
            directPath: thread.picture.direct_path
        } : undefined,
        mute_state: viewer?.mute`;

if (source.includes(after)) process.exit(0);
if (!source.includes(before)) {
  throw new Error('Baileys newsletter parser changed; refusing to apply an unverified patch.');
}

fs.writeFileSync(sourcePath, source.replace(before, after));

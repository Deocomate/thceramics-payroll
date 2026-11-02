#!/usr/bin/env node
/* Build dist/index.html from src/: inlines the QR encoder and the two logos (as data URIs). */
const fs = require('fs');
const path = require('path');
const root = __dirname;
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const datauri = p => 'data:image/png;base64,' + fs.readFileSync(path.join(root, p)).toString('base64');
let src = read('src/app.html');
for (const [marker, val] of [['/*__QR__*/', read('src/qr.js')],
                             ['/*__LOGO_B__*/', datauri('src/assets/logo-brand.png')],
                             ['/*__LOGO_W__*/', datauri('src/assets/logo-white.png')]]) {
  if (src.split(marker).length !== 2) throw new Error('marker must appear exactly once: ' + marker);
  src = src.split(marker).join(val);
}
const out = path.join(root, 'dist/index.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, src, 'utf8');
console.log('built', out, Buffer.byteLength(src), 'bytes');

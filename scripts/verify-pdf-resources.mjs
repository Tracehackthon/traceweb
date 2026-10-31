import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { localPdfAssets, pdfPackageRoot, pdfVersion } from '../apps/web/pdf-assets.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const record = JSON.parse(fs.readFileSync(path.join(root, 'vendor/pdfjs-source-record.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(record.version, pdfVersion);
assert.equal(manifest.dependencies['pdfjs-dist'], pdfVersion);
assert.equal(lock.packages['node_modules/pdfjs-dist'].integrity, record.integrity);
for (const file of record.files) {
  const absolute = path.resolve(pdfPackageRoot, file.path);
  assert.ok(absolute.startsWith(pdfPackageRoot + path.sep));
  assert.equal(hash(absolute), file.sha256, file.path);
}
assert.equal(hash(path.join(root, 'apps/web/public/licenses/pdfjs-Apache-2.0.txt')), record.files.find(file => file.path === 'LICENSE').sha256);
const assets = localPdfAssets();
assert.ok([...assets.keys()].every(name => record.files.some(file => file.path === name)));
console.log(`PDF.js ${pdfVersion}: ${record.files.length} fixed package files, ${assets.size} local support/license assets verified; no CDN fallback`);

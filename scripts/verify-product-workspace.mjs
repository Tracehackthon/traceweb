import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Verify the consumed artifact without requiring a sibling Runtime checkout.
// This checks identity/import boundaries, not business acceptance.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor/product-workspace-source.json'), 'utf8'));
const hash = (file, algorithm = 'sha256', encoding = 'hex') => crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);
const archive = path.resolve(root, manifest.archive.path);
assert.ok(archive.startsWith(path.join(root, 'vendor') + path.sep), 'Archive must be inside the project vendor directory');
assert.equal(hash(archive), manifest.archive.sha256, 'Local Product archive SHA-256 mismatch');
assert.equal('sha512-' + hash(archive, 'sha512', 'base64'), manifest.archive.integrity, 'Archive integrity mismatch');
const installedRoot = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@trace/product-workspace'))), '..');
const installed = JSON.parse(fs.readFileSync(path.join(installedRoot, 'package.json'), 'utf8'));
assert.equal(installed.version, manifest.version, 'Installed Product version mismatch');
assert.equal(installed.name, '@trace/product-workspace');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
assert.equal(lock.packages['node_modules/@trace/product-workspace'].integrity, manifest.archive.integrity, 'Lock integrity differs from the approved local archive');
assert.equal(lock.packages['node_modules/@trace/product-workspace'].resolved, 'file:' + manifest.archive.path);
for (const file of manifest.source.files) {
  const target = path.resolve(installedRoot, file.path);
  assert.ok(target.startsWith(installedRoot + path.sep), 'Invalid package source path');
  assert.equal(hash(target), file.sha256, `Installed Product bytes differ: ${file.path}`);
}

const seen = new Set();
function visit(relative) {
  relative = path.normalize(relative).replaceAll('\\', '/');
  if (seen.has(relative)) return;
  seen.add(relative);
  const file = path.resolve(installedRoot, relative);
  assert.ok(file.startsWith(installedRoot + path.sep), 'Pure import escaped the fixed package');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const imports = [];
  function scan(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) imports.push(node.moduleSpecifier);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      assert.equal(node.arguments.length, 1, 'Unexpected dynamic import shape');
      imports.push(node.arguments[0]);
    }
    ts.forEachChild(node, scan);
  }
  scan(source);
  for (const specifier of imports) {
    assert.ok(ts.isStringLiteral(specifier), 'Pure Product imports must have a statically declared boundary');
    assert.ok(specifier.text.startsWith('./'), `Browser Product entry imported an external/Node dependency: ${specifier.text}`);
    const target = path.resolve(path.dirname(file), specifier.text);
    visit(path.relative(installedRoot, target));
  }
}
visit('src/index.mjs');
for (const entry of ['./bridge', './chain-model', './comparison-model', './worksite-model']) {
  const target = installed.exports[entry];
  visit(typeof target === 'string' ? target : target.default);
}
console.log(JSON.stringify({ verified: true, package: installed.name, version: installed.version,
  archive: manifest.archive.path, sourceFiles: manifest.source.files.length, browserImportClosure: [...seen].sort(),
  businessAcceptance: false }, null, 2));

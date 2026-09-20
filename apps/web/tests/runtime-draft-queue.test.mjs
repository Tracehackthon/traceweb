import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = await readFile(resolve(import.meta.dirname, '../src/react/runtime.ts'), 'utf8');

test('draft queue preserves the editor update before a selection focus', () => {
  assert.match(source, /this\.pendingOperations = \[\.\.\.\(this\.pendingOperations \|\| \[\]\), \.\.\.clone\(additions\)\]/);
  assert.doesNotMatch(source, /this\.pendingOperations = operation \? \(Array\.isArray\(operation\)/);
});

test('a completed save cannot clear operations drafted while it was in flight', () => {
  const take = source.indexOf('this.pendingOperations = null;', source.indexOf('private async flush'));
  const request = source.indexOf('this.tail.then(() => this.save', source.indexOf('private async flush'));
  assert.ok(take > -1 && take < request, 'flush must detach its operation batch before starting the request');
  const saveStart = source.indexOf('private async save');
  const flushStart = source.indexOf('private async flush');
  assert.doesNotMatch(source.slice(saveStart, flushStart), /this\.pendingOperations = null/);
  assert.match(source.slice(saveStart, flushStart), /this\.pendingPayload\?\.commandId === commandId/);
});

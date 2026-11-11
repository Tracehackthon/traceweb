import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createBridge } from '../src/product/bridge.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');

test('real in-memory demo adapter returns the committed host and historical head without duplicate writes', async () => {
  const source = await readFile(new URL('../src/react/demo-workspace-storage.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const { demoWorkspaceRequest: request } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  // HTTP JSON intentionally erases the in-memory null prototypes of empty maps.
  const one = JSON.parse(JSON.stringify(createBridge())); one.preferences = { displayName: 'first', reduceMotion: false };
  const two = structuredClone(one); two.preferences.displayName = 'second';
  const firstCommand = { commandId: 'demo-first', expectedRevision: 0, host: one };
  const put = payload => request('/api/web/workspace', { method: 'PUT', body: JSON.stringify(payload) });
  const first = await (await put(firstCommand)).json();
  assert.deepEqual(first.host, one); assert.equal(first.headRevision, 1);
  const second = await (await put({ commandId: 'demo-second', expectedRevision: 1, host: two })).json();
  assert.deepEqual(second.host, two); assert.equal(second.revision, 2);
  const replay = await (await put(firstCommand)).json();
  assert.deepEqual(replay.host, one); assert.equal(replay.revision, 1); assert.equal(replay.headRevision, 2);
  const read = await (await request('/api/web/workspace')).json();
  assert.deepEqual(read.host, two); assert.equal(read.revision, 2);
  const collision = await put({ ...firstCommand, host: two });
  assert.equal(collision.status, 409);
});

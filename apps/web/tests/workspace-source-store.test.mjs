import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProductWorkspace } from '@trace/product-workspace/node';
import { applyProductOperations, selectComparisonAnchor } from '@trace/product-workspace';

// The installed artifact, not the neighbouring Runtime source. All databases
// are new test files inside this repository, never the user's workspace.
const base = fileURLToPath(new URL('../../../.test-results/product-source-contract/', import.meta.url));
const source = Object.freeze({ id: 'shared-public-source', provider: 'zhihu', source: 'zhihu',
  title: '合成摘要', author: '合成作者', excerpt: '一份原件参与不同思考，关系须明确选择。',
  url: 'https://www.zhihu.com/question/1/answer/2', content_type: 'answer', content_mode: 'summary',
  fetched_at: '2026-10-31T00:00:00.000Z' });
const material = Object.freeze({ id: source.id, provider: source.provider, source: source.source,
  title: source.title, author: source.author, excerpt: source.excerpt, url: source.url,
  contentType: source.content_type, contentMode: source.content_mode, fetchedAt: source.fetched_at,
  context: '另一处明确选入；不改写首次取得语境。', sourceType: '公开摘要' });

function fixture(t) {
  fs.mkdirSync(base, { recursive: true });
  const directory = fs.mkdtempSync(path.join(base, 'source-')), file = path.join(directory, 'product.sqlite');
  let store = createProductWorkspace({ file }), sequence = 0;
  t.after(() => {
    store.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(base));
    assert.ok(path.basename(directory).startsWith('source-'));
    fs.rmSync(directory, { recursive: true });
  });
  const execute = (operations, commandId = `synthetic-${++sequence}`, expectedRevision = store.read().revision) =>
    store.execute({ protocolVersion: 1, commandId, expectedRevision, operations });
  execute([{ type: 'capture.create', matterId: 'm1', text: '第一段原始表达' },
    { type: 'capture.create', matterId: 'm2', text: '另一段原始表达' }]);
  return { execute, read: () => store.read(), reopen: () => { store.close(); store = createProductWorkspace({ file }); return store.read(); } };
}
const keep = (matterId, value = source) => ({ type: 'source.keep-public', matterId, source: value, query: '合成查询' });
const open = (host, matterId, sessionId) => ({ type: 'comparison.open', matterId, sessionId,
  anchor: selectComparisonAnchor(host, matterId, { field: 'originalText' }) });
const compare = (sessionId, type, fields = {}) => ({ type: 'comparison.action', sessionId, action: { type, ...fields } });

test('installed Product SQLite shares the same public-source rules, persistence and replay ledger', t => {
  const f = fixture(t);
  const kept = f.execute([keep('m1'), keep('m2')], 'keep-once');
  f.execute([open(f.read().host, 'm2', 'comparison')]);
  const operations = [compare('comparison', 'IMPORT_MATERIAL', { material }), compare('comparison', 'IMPORT_MATERIAL', { material }), compare('comparison', 'LINK')];
  const preview = applyProductOperations(f.read().host, operations);
  const committed = f.execute(operations);
  assert.deepEqual(committed.host.chain.matters, preview.chain.matters);
  assert.deepEqual(committed.host.chain.sources, preview.chain.sources);
  assert.equal(committed.host.chain.sources.length, 1);
  assert.equal(committed.host.chain.sources[0].ownerMatterId, 'm1');
  assert.equal(committed.host.chain.matters.find(item => item.id === 'm2').links.length, 1);
  const replayed = f.execute([keep('m1'), keep('m2')], 'keep-once', kept.receipt.beforeRevision);
  assert.deepEqual(replayed.receipt, kept.receipt, 'replay returns the original committed receipt, not a new mutation');
  assert.equal(replayed.revision, kept.revision);
  assert.equal(replayed.headRevision, committed.revision);
  const reopened = f.reopen();
  assert.equal(reopened.revision, committed.revision);
  assert.deepEqual(reopened.host.chain.sources, committed.host.chain.sources);
  assert.deepEqual(reopened.host.chain.matters, committed.host.chain.matters);
});

test('installed SQLite rejects a changed source atomically and preserves exact reading excerpts', t => {
  const f = fixture(t);
  f.execute([keep('m1'), keep('m2')]);
  const before = f.read();
  assert.throws(() => f.execute([{ type: 'capture.create', matterId: 'must-not-exist', text: '不能部分保存' },
    keep('m2', { ...source, excerpt: '同一身份下偷偷变更原件' })]), error => error.code === 'SOURCE_CONFLICT');
  assert.deepEqual(f.read(), before);
  const operations = [{ type: 'chain.action', matterId: 'm2', action: { type: 'CAPTURE_EXCERPT', sourceId: source.id, text: '不同思考' } },
    { type: 'chain.action', matterId: 'm2', action: { type: 'CAPTURE_DRAFT', text: '用户的附言不是原件' } }];
  const saved = f.execute(operations);
  assert.equal(saved.host.chain.capture.text, '用户的附言不是原件');
  assert.equal(saved.host.chain.capture.excerpt, '不同思考');
  assert.equal(saved.host.chain.capture.excerptSourceId, source.id);
  assert.equal(saved.host.chain.matters.length, 2);
  assert.equal(saved.host.chain.sources[0].excerpt, source.excerpt);
  assert.throws(() => f.execute([{ type: 'chain.action', matterId: 'm2', action: { type: 'CAPTURE_EXCERPT', sourceId: source.id, text: '编造选段' } }]), error => error.code === 'SOURCE_CONFLICT');
  assert.equal(f.reopen().host.chain.capture.text, '用户的附言不是原件');
});

for (const first of ['keep', 'comparison']) {
  test(`installed SQLite keeps absent metadata unknown across both entry points: ${first}`, t => {
    const f = fixture(t);
    const absent = { id: source.id, provider: source.provider, source: source.source, excerpt: source.excerpt, url: source.url, fetched_at: source.fetched_at,
      title: null, author: null, content_type: null, content_mode: null };
    const incoming = { id: source.id, provider: source.provider, source: source.source, excerpt: source.excerpt, url: source.url };
    if (first === 'keep') f.execute([keep('m1', absent)]);
    else f.execute([open(f.read().host, 'm1', 'first'), compare('first', 'IMPORT_MATERIAL', { material: incoming })]);
    const canonical = structuredClone(f.read().host.chain.sources[0]);
    f.execute([keep('m2', absent), open(f.read().host, 'm2', 'second'), compare('second', 'IMPORT_MATERIAL', { material: incoming }), compare('second', 'LINK')]);
    const reopened = f.reopen();
    assert.deepEqual(reopened.host.chain.sources, [canonical]);
    assert.equal(canonical.contentMode, 'unknown');
    assert.equal(reopened.host.chain.matters.find(item => item.id === 'm2').links.length, 1);
  });
}

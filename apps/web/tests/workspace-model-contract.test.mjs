import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Product package regression contract. All data is synthetic; no model, database or network calls.
// Keep these pre-migration export keys fixed; do not regenerate them after thin re-exports.
const oldExports = Object.freeze({
  bridge: ['applyPendingComparison','attachProviderSourceProvenance','captureInput','commitComparison','createBridge','createWorkFromHandoff','deliverComparisonResult','dispatchChain','dispatchComparison','dispatchWorksite','keepPublicSource','openComparison','recoverPendingComparisons','returnFromComparison','selectChain','selectComparison','selectComparisonAnchor','selectWorksite'],
  'chain-model': ['SCREENS','createChainDemo','createChainState','reduceChain','selectChainView'],
  'comparison-model': ['DIRECTION_OPTIONS','RELATION_OPTIONS','SCOPE_OPTIONS','SCREENS','applyComparisonRequest','classifyMaterialImport','createComparisonDemo','createComparisonState','reduceComparison','selectComparisonView'],
  'worksite-model': ['SCREENS','createWorksiteDemo','createWorksiteState','reduceWorksite','selectWorksiteView'],
});
const oldSourceHashes = Object.freeze({
  bridge: 'baac98e9ffe067089bca36af36a1fcb6fd348bb9b4c42aff45ca40f67310d668',
  'chain-model': 'b3eb047dacf8b01e19ccae5023aded2ee349c5c4a527c806f216162126d52f47',
  'comparison-model': '662d2d480dd09027192b4d108a36b2f2fc44e6d2d3b0dd4ef21e2f0f3501a950',
  'worksite-model': '4bc9ea7249cfa175b6e5590abc4e143b0dd2325f27a9fb19f82ca05cd75ec7d0',
});
const webModules = {};
for (const name of Object.keys(oldExports)) {
  webModules[name] = await import(new URL(`../src/product/${name}.mjs`, import.meta.url));
}
const installed = { root: await import('@trace/product-workspace') };
for (const name of Object.keys(oldExports)) installed[name] = await import(`@trace/product-workspace/${name}`);
const packageError = undefined, packagePending = false;
const copy = value => structuredClone(value);
const ownMatter = (host, id) => host.chain.matters.find(value => value.id === id);
const dc = (B, host, type, fields = {}, matterId = 'm1') => B.dispatchChain(host, { matterId, action: { type, ...fields } });
const dx = (B, host, type, fields = {}, sessionId = 'c2') => B.dispatchComparison(host, { sessionId, action: { type, ...fields } });
const dw = (B, host, type, fields = {}) => B.dispatchWorksite(host, { workId: 'w', action: { type, ...fields } });
function clean(host, label) { assert.equal(host.error, null, `${label}: ${host.error?.message || ''}`); return host; }
function seed(B) {
  let host = B.captureInput(B.createBridge(), { matterId: 'm1', text: '第一件事的完整原话，不是理解。' });
  host = B.captureInput(host, { matterId: 'm2', text: '第二件事的完整原话。' });
  return clean(host, 'two synthetic matters');
}
const publicResult = Object.freeze({
  id: 'external:provider-1', provider: 'zhihu', source: 'zhihu', title: '合成公开摘要', author: '合成作者',
  excerpt: '只有合成测试用的摘要，不代表全文或用户理解。', url: 'https://www.zhihu.com/question/1/answer/2',
  content_type: 'answer', content_mode: 'summary', content_id: 'answer-2',
  fetched_at: '2026-10-31T00:00:00.000Z', vote_up_count: 3, comment_count: 1,
});
const providerMaterial = Object.freeze({
  id: 'external:shared-source', provider: 'zhihu', source: 'zhihu', title: '跨事项合成来源',
  excerpt: '同一个原件可以参与两件事，但不是两份独立原件。', context: '合成公开摘要；关系未确认。',
  sourceType: '知乎公开内容', author: '合成作者', contentType: 'answer', contentMode: 'summary',
  fetchedAt: '2026-10-31T00:00:00.000Z', url: 'https://www.zhihu.com/question/1/answer/3',
});
const publicMaterial = Object.freeze({
  id: publicResult.id, provider: publicResult.provider, source: publicResult.source,
  title: publicResult.title, author: publicResult.author, excerpt: publicResult.excerpt, url: publicResult.url,
  context: '这次明确选择的摘要；不等同于首次保存语境。', sourceType: '知乎公开内容',
  contentType: publicResult.content_type, contentMode: publicResult.content_mode, fetchedAt: publicResult.fetched_at,
});
function open(B, host, matterId, sessionId) {
  const anchor = B.selectComparisonAnchor(host, matterId, { field: 'originalText' });
  return clean(B.openComparison(host, { matterId, sessionId, anchor,
    returnTarget: { view: 'chain', matterId, screen: 'discussion', anchor } }), 'open exact original comparison');
}
function crossSourceRequest(B, targetMatterId = 'm2') {
  let host = open(B, seed(B), 'm1', 'c1');
  host = clean(dx(B, host, 'IMPORT_MATERIAL', { material: providerMaterial }, 'c1'), 'original source import');
  host = open(B, host, targetMatterId, 'c2');
  host = clean(dx(B, host, 'IMPORT_MATERIAL', { material: providerMaterial }), 'explicit second comparison import');
  host = clean(dx(B, host, 'LINK'), 'propose relationship');
  assert.ok(host.comparisons.c2.model.request, 'explicit selection yields a pending request, not automatic success');
  return host;
}
function commit(B, host) {
  return B.commitComparison(host, { sessionId: 'c2', requestId: host.comparisons.c2.model.request.id });
}
function workSeed(B) {
  let host = seed(B);
  host = clean(dc(B, host, 'UNDERSTANDING_DRAFT', { text: '原有理解' }), 'understanding draft');
  host = clean(dc(B, host, 'SAVE_UNDERSTANDING'), 'understanding save');
  return clean(B.createWorkFromHandoff(host, { matterId: 'm1', workId: 'w',
    destination: { agent: '手工测试执行器', project: 'synthetic-project', task: '核验合约' },
    role: 'reference', selectedText: '原有理解', note: '不执行任何外部工作' }), 'explicit work');
}

test('report source identity and pre-migration export snapshot without asserting old hashes after migration', async t => {
  const currentHashes = {};
  for (const name of Object.keys(oldExports)) {
    const bytes = await readFile(new URL(`../src/product/${name}.mjs`, import.meta.url));
    currentHashes[name] = createHash('sha256').update(bytes).digest('hex');
  }
  t.diagnostic(JSON.stringify({ taskId: 'trace-frontend-replacement-20261031',
    baseline: '85455bb4044fa2b41e0cc349a810c7cb4e2e368570570e757a096554645f9bf5',
    oldSourceHashes, currentHashes, packagePending }));
});

test('installed fixed Product package and all four explicit subpaths are wired', () => {
  assert.equal(packageError, undefined, packagePending || 'package installed');
  assert.equal(typeof installed.root.validateProductOperations, 'function');
  assert.equal(typeof installed.root.applyProductOperations, 'function');
});

test('explicit excerpt/summary/metadata modes cannot be normalized into an unknown first snapshot', () => {
  const B = installed.bridge, apply = installed.root.applyProductOperations;
  let host = seed(B);
  const material = { ...publicMaterial, contentMode: 'unknown' };
  host = apply(host, [{ type: 'comparison.open', sessionId: 'first-mode', matterId: 'm1', anchor: B.selectComparisonAnchor(host, 'm1', { field: 'originalText' }) }]);
  host = apply(host, [{ type: 'comparison.action', sessionId: 'first-mode', action: { type: 'IMPORT_MATERIAL', material } }]);
  for (const mode of ['excerpt', 'summary', 'metadata']) {
    let draft = apply(host, [{ type: 'comparison.open', sessionId: `mode-${mode}`, matterId: 'm2', anchor: B.selectComparisonAnchor(host, 'm2', { field: 'originalText' }) }]);
    draft = apply(draft, [{ type: 'comparison.action', sessionId: `mode-${mode}`, action: { type: 'IMPORT_MATERIAL', material: { ...material, contentMode: mode } } }]);
    const before = copy(draft);
    assert.throws(() => apply(draft, [{ type: 'comparison.action', sessionId: `mode-${mode}`, action: { type: 'LINK' } }]), error => error.code === 'SOURCE_CONFLICT');
    assert.deepEqual(draft, before);
    assert.equal(draft.chain.sources[0].contentMode, 'unknown');
  }
});

for (const order of ['keep-first', 'comparison-first']) {
  test(`missing optional provenance remains unknown and reuses the first snapshot: ${order}`, () => {
    const B = installed.bridge, apply = installed.root.applyProductOperations;
    const absent = { id: publicResult.id, provider: 'zhihu', source: 'zhihu', excerpt: publicResult.excerpt,
      url: publicResult.url, fetched_at: publicResult.fetched_at, title: null, author: null, content_type: null, content_mode: null };
    const material = { id: absent.id, provider: absent.provider, source: absent.source, excerpt: absent.excerpt, url: absent.url };
    let host = seed(B);
    if (order === 'keep-first') host = apply(host, [{ type: 'source.keep-public', matterId: 'm1', source: absent, query: '合成查询' }]);
    else {
      host = apply(host, [{ type: 'comparison.open', sessionId: 'first', matterId: 'm1', anchor: B.selectComparisonAnchor(host, 'm1', { field: 'originalText' }) }]);
      host = apply(host, [{ type: 'comparison.action', sessionId: 'first', action: { type: 'IMPORT_MATERIAL', material } }]);
    }
    const first = copy(host.chain.sources[0]);
    assert.equal(first.contentMode, 'unknown', 'missing metadata is not invented as summary or metadata');
    host = apply(host, [{ type: 'source.keep-public', matterId: 'm2', source: absent, query: '第二次合成查询' }]);
    host = apply(host, [{ type: 'comparison.open', sessionId: 'second', matterId: 'm2', anchor: B.selectComparisonAnchor(host, 'm2', { field: 'originalText' }) }]);
    host = apply(host, [{ type: 'comparison.action', sessionId: 'second', action: { type: 'IMPORT_MATERIAL', material } }]);
    host = apply(host, [{ type: 'comparison.action', sessionId: 'second', action: { type: 'LINK' } }]);
    assert.deepEqual(host.chain.sources, [first]);
    assert.equal(ownMatter(host, 'm2').links.length, 1);
  });

  test(`same source remains usable across both public entry points: ${order}`, () => {
    const B = installed.bridge, apply = installed.root.applyProductOperations;
    let host = seed(B);
    const openCommand = (matterId, sessionId) => ({ type: 'comparison.open', sessionId, matterId,
      anchor: B.selectComparisonAnchor(host, matterId, { field: 'originalText' }) });
    if (order === 'comparison-first') {
      host = apply(host, [openCommand('m1', 'first-import')]);
      host = apply(host, [{ type: 'comparison.action', sessionId: 'first-import', action: { type: 'IMPORT_MATERIAL', material: publicMaterial } }]);
    } else host = apply(host, [{ type: 'source.keep-public', matterId: 'm1', source: publicResult, query: '首次查询' }]);
    const first = copy(host.chain.sources[0]);
    host = apply(host, [{ type: 'source.keep-public', matterId: 'm2', source: { ...publicResult, fetched_at: '2026-10-31T00:01:00.000Z' }, query: '后来查询' }]);
    host = apply(host, [openCommand('m2', 'second-import')]);
    host = apply(host, [{ type: 'comparison.action', sessionId: 'second-import', action: { type: 'IMPORT_MATERIAL', material: publicMaterial } }]);
    host = apply(host, [{ type: 'comparison.action', sessionId: 'second-import', action: { type: 'IMPORT_MATERIAL', material: publicMaterial } }]);
    assert.equal(host.comparisons['second-import'].model.catalog.length, 1, 'repeated import is an idempotent reference, not a second material');
    host = apply(host, [{ type: 'comparison.action', sessionId: 'second-import', action: { type: 'LINK' } }]);
    assert.equal(host.chain.sources.length, 1);
    assert.deepEqual(host.chain.sources[0], first, 'both routes retain the first immutable source and origin');
    assert.ok(ownMatter(host, 'm2').sourceIds.includes(publicResult.id));
    assert.equal(ownMatter(host, 'm2').links.length, 1);
    assert.equal(ownMatter(host, 'm2').understandingVersion, 0);
    for (const patch of [{ excerpt: '同ID下的另一份正文' }, { url: 'https://www.zhihu.com/question/1/answer/999' }, { author: '另一作者' }]) {
      const before = copy(host);
      assert.throws(() => apply(host, [{ type: 'source.keep-public', matterId: 'm2', source: { ...publicResult, ...patch }, query: '不能偷偷改原件' }]), /./);
      assert.deepEqual(host, before);
    }
  });
}

for (const name of Object.keys(oldExports)) {
  test(`legacy export surface remains compatible: ${name}`, () => {
    for (const key of oldExports[name]) assert.ok(Object.hasOwn(webModules[name], key), `Web lost ${name}.${key}`);
  });
  test(`installed package retains legacy exports and thin Web identity: ${name}`, { skip: packagePending }, () => {
    for (const key of oldExports[name]) assert.ok(Object.hasOwn(installed[name], key), `package lost ${name}.${key}`);
    assert.deepEqual(Object.keys(webModules[name]).sort(), Object.keys(installed[name]).sort());
    for (const key of Object.keys(installed[name])) assert.equal(webModules[name][key], installed[name][key], `${name}.${key} is not a thin export of the installed package`);
  });
}

for (const [label, B, skip] of [
  ['Web entry', webModules.bridge, false],
  ['installed package', installed.bridge, packagePending],
]) {
  test(`${label}: public source keep is strict, idempotent and never adopts a claim`, { skip }, () => {
    const initial = seed(B);
    const kept = clean(B.keepPublicSource(initial, { matterId: 'm1', source: publicResult, query: '合成查询' }), 'public keep');
    const source = kept.chain.sources.find(value => value.id === publicResult.id);
    assert.equal(source.origin, 'provider-snapshot');
    assert.equal(source.ownerMatterId, 'm1');
    assert.equal(source.url, publicResult.url);
    assert.equal(source.author, publicResult.author);
    assert.equal(source.fetchedAt, publicResult.fetched_at);
    assert.equal(ownMatter(kept, 'm1').understanding, '');
    assert.deepEqual(ownMatter(kept, 'm1').links || [], []);
    const repeated = B.keepPublicSource(kept, { matterId: 'm1', source: { ...publicResult, excerpt: '试图篡改原快照' }, query: '合成查询' });
    assert.equal(repeated.chain.sources.find(value => value.id === publicResult.id).excerpt, publicResult.excerpt);
    assert.equal(repeated.chain.sources.length, 1);
    for (const changed of [{ url: 'javascript:alert(1)' }, { url: 'https://example.invalid/not-zhihu' }, { fetched_at: 'not-a-time' }]) {
      const rejected = B.keepPublicSource(initial, { matterId: 'm1', source: { ...publicResult, ...changed }, query: '合成查询' });
      assert.equal(rejected.error?.code, 'invalid_public_source');
      assert.ok(rejected.error.message, 'rejection remains visible, not filtered out');
      assert.deepEqual(rejected.chain, initial.chain);
    }
  });

  test(`${label}: declared provenance rejects foreign ownership and invalid provider URL`, { skip }, () => {
    let host = B.captureInput(B.createBridge(), { matterId: 'm1', text: '原话', source: { id: 'captured-source', title: '出处', excerpt: '有限摘录' } });
    host = B.captureInput(host, { matterId: 'm2', text: '另一原话' });
    const provenance = { provider: 'zhihu', author: '合成作者', query: '合成查询', fetchedAt: publicResult.fetched_at, url: publicResult.url };
    const wrongOwner = B.attachProviderSourceProvenance(host, { matterId: 'm2', sourceId: 'captured-source', provenance });
    assert.equal(wrongOwner.error?.code, 'unknown_source');
    assert.deepEqual(wrongOwner.chain, host.chain);
    const invalid = B.attachProviderSourceProvenance(host, { matterId: 'm1', sourceId: 'captured-source', provenance: { ...provenance, url: 'javascript:alert(1)' } });
    assert.equal(invalid.error?.code, 'invalid_provenance');
    assert.deepEqual(invalid.chain, host.chain);
    const kept = clean(B.attachProviderSourceProvenance(host, { matterId: 'm1', sourceId: 'captured-source', provenance }), 'verified provenance');
    assert.equal(kept.chain.sources[0].url, provenance.url);
    assert.equal(ownMatter(kept, 'm1').understandingVersion, 0);
  });

  test(`${label}: comparison retains complete original text and explicit capability projection`, { skip }, () => {
    const host = open(B, seed(B), 'm2', 'c2');
    const connected = B.selectComparison(host, 'c2', { capabilityAvailable: true, provider: 'native' });
    assert.equal(connected.matter.originalText, ownMatter(host, 'm2').originalText);
    assert.equal(connected.search.capabilityAvailable, true);
    assert.equal(connected.search.provider, 'native');
    assert.equal(B.selectComparison(host, 'c2').search.capabilityAvailable, false);
    const rejected = dx(B, host, 'SEARCH');
    assert.equal(rejected.error?.code, 'capability_missing');
    assert.ok(rejected.error.message);
    assert.deepEqual(B.selectComparison(rejected, 'c2').candidates, []);
  });

  test(`${label}: two existing matters explicitly reuse one source without changing its origin`, { skip }, () => {
    const requested = crossSourceRequest(B);
    assert.deepEqual(ownMatter(requested, 'm2').links || [], [], 'request alone is not a committed relation');
    const applied = clean(commit(B, requested), 'cross-matter explicit link');
    assert.equal(applied.chain.sources.length, 1);
    assert.equal(applied.chain.sources[0].ownerMatterId, 'm1');
    assert.equal(ownMatter(applied, 'm2').links.length, 1);
    assert.equal(ownMatter(applied, 'm2').links[0].source.id, providerMaterial.id);
    assert.equal(ownMatter(applied, 'm2').understandingVersion, 0);
    assert.equal(applied.comparisons.c2.model.request, null);
    assert.ok(applied.comparisons.c2.model.receipt);
  });

  for (const [mode, tamper] of [
    ['missing source', host => { host.chain.sources = []; }],
    ['nonexistent origin owner', host => { host.chain.sources[0].ownerMatterId = 'missing-matter'; }],
    ['changed excerpt', host => { host.chain.sources[0].excerpt = 'changed'; }],
    ['changed title', host => { host.chain.sources[0].title = 'changed'; }],
    ['changed URL', host => { host.chain.sources[0].url = 'https://www.zhihu.com/question/1/answer/999'; }],
    ['changed author', host => { host.chain.sources[0].author = 'changed'; }],
    ['changed context', host => { host.chain.sources[0].context = 'changed'; }],
    ['changed sourceType', host => { host.chain.sources[0].sourceType = 'changed'; }],
  ]) {
    test(`${label}: final comparison mutation rejects ${mode}`, { skip }, () => {
      // Same-owner positive setup isolates each tamper. A pre-existing owner
      // mismatch must not mask a missing title/URL/provenance validation.
      const host = crossSourceRequest(B, 'm1'); tamper(host);
      const before = copy(ownMatter(host, 'm1'));
      const rejected = commit(B, host);
      assert.equal(rejected.error?.code, 'source_conflict');
      assert.ok(rejected.error.message, 'failure must remain inspectable');
      assert.deepEqual(ownMatter(rejected, 'm1'), before);
      assert.equal(B.selectComparison(rejected, 'c2').screen, 'compare', 'failed mutation does not render returned success');
      assert.equal(B.selectComparison(rejected, 'c2').selectedCandidate.id, providerMaterial.id, 'material remains available for review');
    });
  }

  test(`${label}: handoff is immutable history while current work connection owns delivery`, { skip }, () => {
    let host = workSeed(B);
    const historic = copy(B.selectChain(host, 'm1').handoffSnapshot);
    assert.equal(historic.snapshotKind, 'historical');
    assert.equal(historic.historical, true);
    assert.equal(historic.origin, 'user-confirmed');
    host.worksite.works.w.connection = { status: 'returned_for_review', deliveryId: 'synthetic-delivery' };
    host = dc(B, host, 'UNDERSTANDING_DRAFT', { text: '更晚的理解' });
    host = dc(B, host, 'SAVE_UNDERSTANDING');
    assert.deepEqual(B.selectChain(host, 'm1').handoffSnapshot, historic);
    assert.equal(B.selectWorksite(host, 'w').work.connection.status, 'returned_for_review');
    assert.equal(ownMatter(host, 'm1').understanding, '更晚的理解');
    assert.equal(historic.capturedUnderstanding, '原有理解');
    assert.equal(Object.hasOwn(host.worksite, 'matters'), false, 'worksite is not another persistent matter owner');
  });

  test(`${label}: saved finding reopens without losing its identity and missing finding is visible`, { skip }, () => {
    let host = workSeed(B);
    host.worksite.works.w.connection = { status: 'returned_for_review', deliveryId: 'synthetic-delivery' };
    host.worksite.sessions.w.codexDelivery = { status: 'returned_for_review' };
    host = clean(dw(B, host, 'COMPOSER_DRAFT', { text: '保存的一条合成发现' }), 'finding composer');
    host = clean(dw(B, host, 'OPEN_FINDING'), 'open finding');
    host = clean(dw(B, host, 'KEEP_FINDING'), 'save finding');
    const finding = copy(host.worksite.sessions.w.findings[0]);
    assert.ok(finding.id);
    host = dw(B, host, 'COMPOSER_DRAFT', { text: '另一个尚未保存的输入' });
    host = dw(B, host, 'OPEN_FINDING');
    host = clean(dw(B, host, 'OPEN_SAVED_FINDING', { id: finding.id }), 'reopen saved finding');
    assert.equal(host.worksite.sessions.w.finding.id, finding.id);
    assert.equal(host.worksite.sessions.w.finding.text, finding.text);
    const missing = dw(B, host, 'OPEN_SAVED_FINDING', { id: 'missing-finding' });
    assert.equal(missing.worksite.sessions.w.finding.id, finding.id);
    assert.match(B.selectWorksite(missing, 'w').notice, /没有找到/);
  });

  test(`${label}: confirmed result updates current delivery to revised and retains fact`, { skip }, () => {
    let host = workSeed(B);
    host.worksite.works.w.connection = { status: 'returned_for_review', deliveryId: 'synthetic-delivery' };
    host.worksite.sessions.w.codexDelivery = { status: 'returned_for_review' };
    host = clean(dw(B, host, 'RESULT_DRAFT', { patch: { matterId: 'm1', fact: '实际合成观察', interpretation: '仅为解释', unconfirmed: '仍未核验', proposedUnderstanding: '用户确认的新理解' } }), 'result draft');
    host = clean(dw(B, host, 'OPEN_REVISION_REVIEW'), 'review result');
    host = clean(dw(B, host, 'CONFIRM_REVISION'), 'confirm result');
    assert.equal(ownMatter(host, 'm1').understanding, '用户确认的新理解');
    assert.equal(host.worksite.works.w.connection.status, 'revised');
    assert.equal(host.worksite.sessions.w.codexDelivery.status, 'revised');
    assert.equal(host.worksite.sessions.w.result.decision, 'revised');
    assert.equal(host.worksite.sessions.w.results[0].fact, '实际合成观察');
  });
}

test('installed strict command contract supports existing-matter capture staging without new matter', { skip: packagePending }, () => {
  const B = installed.bridge;
  let host = B.captureInput(B.createBridge(), { matterId: 'm1', text: '原始表达',
    source: { id: 'reading-source', title: '合成原件', excerpt: '原件中实际选中的一段' } });
  const operations = [
    { type: 'chain.action', matterId: 'm1', action: { type: 'CAPTURE_EXCERPT', text: '原件中实际选中的一段', sourceId: 'reading-source' } },
    { type: 'chain.action', matterId: 'm1', action: { type: 'CAPTURE_DRAFT', text: '读取后自己的表达' } },
  ];
  installed.root.validateProductOperations(operations);
  host = installed.root.applyProductOperations(host, operations);
  assert.equal(host.chain.matters.length, 1);
  assert.equal(host.chain.capture.excerptSourceId, 'reading-source');
  assert.equal(host.chain.capture.excerpt, '原件中实际选中的一段');
  assert.equal(host.chain.capture.text, '读取后自己的表达');
  const toggle = [{ type: 'chain.action', matterId: 'm1', action: { type: 'TOGGLE_SOURCE', id: 'reading-source' } }];
  host = installed.root.applyProductOperations(host, toggle);
  assert.equal(host.chain.capture.sourceIds.includes('reading-source'), false);
  assert.equal(host.chain.capture.excerptSourceId, null);
  const before = copy(host);
  for (const action of [
    { type: 'CAPTURE_EXCERPT', text: '不在来源里的编造文本', sourceId: 'reading-source' },
    { type: 'CAPTURE_EXCERPT', text: '原件中实际选中的一段', sourceId: 'missing-source' },
    { type: 'TOGGLE_SOURCE', id: 'missing-source' },
  ]) {
    assert.throws(() => installed.root.applyProductOperations(host, [{ type: 'chain.action', matterId: 'm1', action }]), /./);
    assert.deepEqual(host, before, 'rejected staging operation cannot mutate input');
  }
  host = installed.root.applyProductOperations(host, [{ type: 'chain.action', matterId: 'm1', action: { type: 'CAPTURE_EXCERPT', text: '', sourceId: 'reading-source' } }]);
  assert.equal(host.chain.capture.excerpt, '');
  assert.equal(host.chain.capture.excerptSourceId, null);
  assert.throws(() => installed.root.validateProductOperations([{ ...operations[1], action: { ...operations[1].action, unsupportedField: true } }]), /./);
  assert.throws(() => installed.root.validateProductOperations([{ type: 'chain.action', matterId: 'm1', action: { type: 'CAPTURE' } }]), /./);
});

test('installed source.keep-public is strict and allows explicit reuse by another existing matter', { skip: packagePending }, () => {
  let host = seed(installed.bridge);
  const keep = (matterId, source = publicResult, query = '最初的查询语境') => ({ type: 'source.keep-public', matterId, source, query });
  host = installed.root.applyProductOperations(host, [keep('m1')]);
  const snapshot = copy(host.chain.sources[0]);
  host = installed.root.applyProductOperations(host, [keep('m2', { ...publicResult, fetched_at: '2026-10-31T01:00:00.000Z' }, '后来查询')]);
  assert.equal(host.chain.sources.length, 1);
  assert.deepEqual(host.chain.sources[0], snapshot, 'reuse cannot overwrite original retrieval context');
  assert.deepEqual(ownMatter(host, 'm2').sourceIds, [publicResult.id]);
  assert.equal((ownMatter(host, 'm2').links || []).length, 0, 'reuse itself does not infer semantic relation');
  for (const source of [
    { ...publicResult, excerpt: '不同原文' }, { ...publicResult, title: '不同标题' },
    { ...publicResult, url: 'https://www.zhihu.com/question/1/answer/999' },
    { ...publicResult, url: 'javascript:alert(1)' },
  ]) assert.throws(() => installed.root.applyProductOperations(host, [keep('m2', source)]), /./);
  assert.throws(() => installed.root.applyProductOperations(host, [keep('missing-matter')]), /./);
});

test('installed source.provenance.attach is strict and cannot attach to a foreign-owned source', { skip: packagePending }, () => {
  const B = installed.bridge;
  let host = B.captureInput(B.createBridge(), { matterId: 'm1', text: '原始表达', source: { id: 'captured-source', title: '合成原件', excerpt: '实际摘要' } });
  host = B.captureInput(host, { matterId: 'm2', text: '另一事项' });
  const provenance = { provider: 'zhihu', author: '合成作者', query: '最初的查询语境', fetchedAt: publicResult.fetched_at, url: publicResult.url };
  const attach = (matterId, value = provenance) => ({ type: 'source.provenance.attach', matterId, sourceId: 'captured-source', provenance: value });
  assert.throws(() => installed.root.applyProductOperations(host, [attach('m2')]), /./);
  assert.throws(() => installed.root.applyProductOperations(host, [attach('m1', { ...provenance, url: 'javascript:alert(1)' })]), /./);
  host = installed.root.applyProductOperations(host, [attach('m1')]);
  assert.equal(host.chain.sources[0].provider, 'zhihu');
  assert.equal(host.chain.sources[0].author, provenance.author);
  assert.equal(host.chain.sources[0].url, provenance.url);
  assert.equal(ownMatter(host, 'm1').understandingVersion, 0);
});

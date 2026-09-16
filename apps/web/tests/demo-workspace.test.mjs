import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPLETE_DEMO, createCompleteDemoWorkspace } from '../src/product/demo-workspace.mjs';
import { homeEntries, recordsOf } from '../src/product/library.mjs';
import { selectChain, selectComparison, selectWorksite } from '../src/product/bridge.mjs';

test('complete demo contains inspectable data for all six Trace actions', () => {
  const host = createCompleteDemoWorkspace();
  const matter = selectChain(host, COMPLETE_DEMO.matterId).matter;
  const comparison = selectComparison(host, COMPLETE_DEMO.comparisonId);
  const work = selectWorksite(host, COMPLETE_DEMO.workId);
  const home = homeEntries(host);
  const records = recordsOf(host);
  const kinds = new Set(records.map((record) => record.kind));
  assert.equal(host.experience.kind, 'complete-demo');
  assert.equal(host.experience.synthetic, true);
  assert.match(matter.originalText, /收藏动作和回顾动作之间没有建立联系/); // 留下一点
  assert.match(selectChain(host, COMPLETE_DEMO.matterId).discussion.text, /几周后|真正卡住/); // 从这里接着
  assert.equal(comparison.screen, 'returned');                  // 找个对照
  assert.equal(matter.understandingVersion, 3);                 // 我的理解
  assert.equal(work.intake.length, 1);                          // 带去用
  assert.equal(work.results.length, 1);                         // 结果回来
  assert.match(work.results[0].fact, /六个动作/);
  assert.equal(host.chain.matters.length, 4);
  assert.equal(host.chain.sources.length >= 2, true);
  assert.equal(Object.keys(host.worksite.works).length >= 2, true);
  assert.deepEqual(Object.fromEntries(Object.entries(home).map(([slot, entry]) => [slot, entry.matterId])), {
    thought: COMPLETE_DEMO.matterId,
    work: COMPLETE_DEMO.home.workMatterId,
    fresh: COMPLETE_DEMO.home.freshMatterId,
    handoff: COMPLETE_DEMO.home.handoffMatterId,
  });
  assert.equal(Object.values(host.worksite.works).every((item) => item.connected === false), true);
  const zhihuSources = host.chain.sources.filter((item) => item.origin === 'provider-snapshot');
  assert.equal(zhihuSources.length, 2);
  assert.deepEqual(zhihuSources.map((item) => item.author), ['拾光者', '波哥自修']);
  assert.equal(zhihuSources.every((item) => item.provider === 'zhihu' && item.contentMode === 'openapi-summary' && new URL(item.url).hostname.endsWith('zhihu.com')), true);
  assert.deepEqual(host.experience.sourceSnapshot, {
    provider: 'zhihu',
    query: '收藏很多内容 却很少回看 知识管理',
    fetchedAt: '2026-09-15T21:41:28.5400932+08:00',
    contentMode: 'openapi-summary',
    count: 2,
  });
  assert.equal(records.filter((record) => record.kind === 'source').every((record) => /知乎公开内容/.test(record.meta)), true);
  assert.equal(host.experience.version, COMPLETE_DEMO.version);
  for (const kind of ['expression', 'discussion', 'understanding', 'source', 'work', 'result', 'revision']) assert.equal(kinds.has(kind), true, `${kind} should be discoverable`);
  assert.equal(host.chain.isDemo, false);
  assert.equal(host.worksite.isDemo, false);
});

test('complete demo creation is deterministic and returns independent stores', () => {
  const first = createCompleteDemoWorkspace();
  const second = createCompleteDemoWorkspace();
  first.preferences.displayName = 'changed';
  first.chain.matters[0].understanding = 'changed';
  assert.equal(second.preferences.displayName, '');
  assert.notEqual(second.chain.matters[0].understanding, 'changed');
});

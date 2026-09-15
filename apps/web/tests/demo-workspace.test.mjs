import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPLETE_DEMO, createCompleteDemoWorkspace } from '../src/product/demo-workspace.mjs';
import { recordsOf } from '../src/product/library.mjs';
import { selectChain, selectComparison, selectWorksite } from '../src/product/bridge.mjs';

test('complete demo contains inspectable data for all six Trace actions', () => {
  const host = createCompleteDemoWorkspace();
  const matter = selectChain(host, COMPLETE_DEMO.matterId).matter;
  const comparison = selectComparison(host, COMPLETE_DEMO.comparisonId);
  const work = selectWorksite(host, COMPLETE_DEMO.workId);
  const kinds = new Set(recordsOf(host).map((record) => record.kind));
  assert.equal(host.experience.kind, 'complete-demo');
  assert.equal(host.experience.synthetic, true);
  assert.match(matter.originalText, /第二大脑/);                 // 留下一点
  assert.match(selectChain(host, COMPLETE_DEMO.matterId).discussion.text, /几周后|真正卡住/); // 从这里接着
  assert.equal(comparison.screen, 'returned');                  // 找个对照
  assert.equal(matter.understandingVersion, 3);                 // 我的理解
  assert.equal(work.intake.length, 1);                          // 带去用
  assert.equal(work.results.length, 1);                         // 结果回来
  assert.match(work.results[0].fact, /六个动作/);
  for (const kind of ['expression', 'discussion', 'understanding', 'source', 'work', 'result', 'revision']) assert.equal(kinds.has(kind), true, `${kind} should be discoverable`);
  assert.equal(host.chain.isDemo, false);
  assert.equal(host.worksite.isDemo, false);
});

test('complete demo creation is deterministic and returns independent stores', () => {
  const first = createCompleteDemoWorkspace();
  const second = createCompleteDemoWorkspace();
  first.preferences.displayName = 'changed';
  first.chain.matters[0].understanding = 'changed';
  assert.equal(second.preferences.displayName, '演示访客');
  assert.notEqual(second.chain.matters[0].understanding, 'changed');
});

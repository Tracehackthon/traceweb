import test from 'node:test';
import assert from 'node:assert/strict';
import { recordDialogTitle, routeDocumentTitle, runtimeStatusLabel } from '../src/react/presentation-copy.mjs';

test('every searchable record kind has its own title rather than a revision fallback', () => {
  const expected = { expression: '当时留下的原话', understanding: '当前保存的理解', discussion: '留下的补充', branch: '留下的旁支', source: '原材料与来处', result: '保存下来的这次结果', revision: '这次修订的记录', work: '这次工作的记录' };
  for (const [kind, title] of Object.entries(expected)) assert.equal(recordDialogTitle(kind), title);
  assert.equal(recordDialogTitle('unknown'), '这条记录');
  assert.equal(recordDialogTitle('constructor'), '这条记录');
});

test('every product route assigns a title independently of the previous page', () => {
  const expected = { home: '把此刻的一点，带到以后', matters: '在意的事', chain: '一件事', compare: '找个对照', worksite: '工作现场', works: '工作现场', search: '搜索', all: '全部痕迹', discussion: '深度讨论' };
  for (const [view, title] of Object.entries(expected)) assert.equal(routeDocumentTitle(view), `Trace · ${title}`);
  assert.equal(routeDocumentTitle('unknown'), 'Trace · 接着想');
  assert.equal(routeDocumentTitle('toString'), 'Trace · 接着想');
});

test('advanced status labels do not expose raw codes or claim unknown states succeeded', () => {
  assert.equal(runtimeStatusLabel('disabled'), '未启用');
  assert.equal(runtimeStatusLabel('active'), '已生效');
  assert.equal(runtimeStatusLabel('attached'), '正在跟随');
  assert.equal(runtimeStatusLabel('failed'), '未完成，可重试');
  assert.equal(runtimeStatusLabel('internal_future_state'), '状态待确认');
  assert.equal(runtimeStatusLabel('constructor'), '状态待确认');
  assert.equal(runtimeStatusLabel(undefined, '尚未开始跟随'), '尚未开始跟随');
});

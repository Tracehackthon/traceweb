import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalOriginalText } from '../src/product/comparison-screen.mjs';
import { captureInput, openComparison, selectComparison, selectComparisonAnchor, createBridge } from '../src/product/bridge.mjs';

test('comparison keeps the selected preview separate from the canonical original disclosure', async () => {
  const source = await readFile(new URL('../src/product/comparison-screen.mjs', import.meta.url), 'utf8');
  assert.match(source, /compare-anchor-preview" data-text="focus"/);
  assert.match(source, /compare-anchor-full[\s\S]*data-text="originalText"/);
  assert.match(source, /text\('originalText',canonicalOriginalText\(current\.matter\)\)/);
});

test('comparison canonical text prefers originalText and has basis/focus fallbacks', () => {
  assert.equal(canonicalOriginalText({ originalText: '原事项完整原话', basis: { text: '选中的一句' }, focus: { text: '焦点' } }), '原事项完整原话');
  assert.equal(canonicalOriginalText({ basis: { field: 'originalText', text: '原话基准' }, focus: { text: '焦点' } }), '原话基准');
  assert.equal(canonicalOriginalText({ basis: { field: 'understanding', text: '当前理解' }, focus: { text: '焦点' } }), '当前理解');
  assert.equal(canonicalOriginalText({ focus: { text: '焦点' } }), '焦点');
});

test('comparison projection carries the canonical matter original text', () => {
  let host = captureInput(createBridge(), { matterId: 'canonical-matter', text: '一整句需要保留的原话。' });
  const anchor = selectComparisonAnchor(host, 'canonical-matter', { field: 'originalText', start: 0, end: 3 });
  host = openComparison(host, { sessionId: 'canonical-comparison', matterId: 'canonical-matter', anchor });
  assert.equal(selectComparison(host, 'canonical-comparison').matter.originalText, '一整句需要保留的原话。');
});

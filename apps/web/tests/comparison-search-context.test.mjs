import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComparisonSearchQuery } from '../src/react/comparison-search.mjs';

test('comparison search keeps the original matter, selected focus and user condition together', () => {
  const query = buildComparisonSearchQuery({
    matter: {
      title: '我觉得可以设计隐藏中间的对话框和文字',
      originalText: '我觉得可以设计隐藏中间的对话框和文字，\n用来展示全屏流水气泡，而且鸟要跟踪当前交互目标。',
      focus: { text: '这个我已经做完了，但是我觉得效果还能更好才行吧' },
    },
    query: {
      question: '这个我已经做完了，但是我觉得效果还能更好才行吧',
      instructions: '没跟我之前的描述结合在一起呢',
      direction: 'experience',
    },
  });

  assert.match(query, /事情背景：.*全屏流水气泡.*鸟要跟踪/);
  assert.match(query, /当前想弄清：这个我已经做完了/);
  assert.match(query, /补充条件：没跟我之前的描述结合在一起呢/);
  assert.match(query, /寻找方向：真实做法与实践经验/);
  assert.ok(query.length <= 500);
});

test('comparison search bounds long fields without dropping the latest user condition', () => {
  const query = buildComparisonSearchQuery({
    matter: { title: `背景${'很长的原始描述'.repeat(100)}`, focus: { text: '焦点' } },
    query: { question: `问题${'继续'.repeat(100)}`, instructions: `条件${'保留'.repeat(100)}`, direction: 'condition' },
  });

  assert.ok(query.length <= 500);
  assert.match(query, /事情背景：/);
  assert.match(query, /当前想弄清：/);
  assert.match(query, /补充条件：条件保留/);
  assert.match(query, /寻找方向：条件变化与适用边界/);
});

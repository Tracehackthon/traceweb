import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const files = [
  'src/intro-main.tsx',
  'src/home.js',
  'src/react-main.tsx',
  'src/react/capability-client.ts',
  'src/video-main.tsx',
  'src/matters/matters-screen.mjs',
  'src/product/bridge.mjs',
  'src/product/chain-model.mjs',
  'src/product/chain-screen.mjs',
  'src/product/comparison-screen.mjs',
  'src/product/comparison-model.mjs',
  'src/product/demo-workspace.mjs',
  'src/product/library.mjs',
  'src/product/worksite-screen.mjs',
];

test('public product copy avoids internal proof and implementation language', async () => {
  const text = (await Promise.all(files.map((file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')))).join('\n');
  for (const phrase of [
    'LOCAL-FIRST CONTINUOUS THINKING',
    '体验完整桌面端',
    '真实 Trace Web 界面',
    'trace_backend 的原生接入',
    '接口摘要',
    '本机 Runtime',
    '服务未配置',
    '工作主场在原生 Agent',
    'Trace 的关系建议',
    '本地演示材料',
    '无关桌面细节已隐去',
    '宿主捕获入口',
    '核验宿主',
    '不会伪造模型回复',
    '真实产品模型',
    '已作为有关关联',
    '实现完成不等于真实使用有效',
  ]) assert.equal(text.includes(phrase), false, `不应向用户展示内部文案：${phrase}`);
});

test('product introduction uses current captures, current icon and native-Agent framing', async () => {
  const intro = await readFile(new URL('../src/intro-main.tsx', import.meta.url), 'utf8');
  const video = await readFile(new URL('../src/video-main.tsx', import.meta.url), 'utf8');
  assert.match(intro, /\/showcase\/trace-zhihu-source\.webp/);
  assert.match(intro, /\/showcase\/trace-result-detail\.webp/);
  assert.match(intro, /\/brand\/trace-app-icon-64\.png/);
  assert.match(intro, /Codex 原生/);
  assert.match(intro, /Codex Harness/);
  assert.match(intro, /自定义 Agent/);
  assert.equal(intro.includes('/evidence/'), false);
  assert.match(video, /本机 Agent/);
  assert.match(video, /以 Codex 为例/);
});

import test from 'node:test';
import assert from 'node:assert/strict';

test('public search keeps the access secret server-side and normalizes Zhihu summaries', async () => {
  process.env.ZHIHU_ACCESS_SECRET = 'test-only-search-secret';
  const module = await import(`../../../lib/zhihu-search.mjs?test=${Date.now()}`);
  let request;
  const result = await module.searchZhihu({ query: '如何接住一个想法', count: 2 }, 'zhihu', async (url, options) => {
    request = { url: String(url), headers: new Headers(options.headers) };
    return new Response(JSON.stringify({ Code: 0, Data: { HasMore: false, Items: [
      { Title: '<b>一个回答</b>', ContentID: 'answer-2', ContentType: 'Answer', ContentText: '<p>先保留原话，再决定关系。</p>', Url: 'https://www.zhihu.com/question/1/answer/2', AuthorName: '答主', VoteUpCount: 27, CommentCount: 4, AuthorityLevel: '2', EditTime: 1789401600 },
    ] } }), { status: 200 });
  });
  assert.equal(result.source, 'zhihu');
  assert.equal(result.items[0].title, '一个回答');
  assert.equal(result.items[0].excerpt, '先保留原话，再决定关系。');
  assert.equal(result.items[0].url, 'https://www.zhihu.com/question/1/answer/2');
  assert.equal(result.items[0].content_id, 'answer-2');
  assert.equal(result.items[0].content_type, 'Answer');
  assert.equal(result.items[0].vote_up_count, 27);
  assert.equal(result.items[0].comment_count, 4);
  assert.equal(result.items[0].authority_level, '2');
  assert.equal(result.items[0].edited_at, '2026-09-14T16:00:00.000Z');
  assert.equal(request.headers.get('authorization'), 'Bearer test-only-search-secret');
  assert.equal(request.url.includes('test-only-search-secret'), false);
});

test('source route controls provider semantics and invalid requests fail before network', async () => {
  process.env.ZHIHU_ACCESS_SECRET = 'test-only-search-secret';
  const module = await import(`../../../lib/zhihu-search.mjs?test=${Date.now()}-invalid`);
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response('{}'); };
  await assert.rejects(() => module.searchZhihu({ query: 'x', count: 6 }, 'global', fetchImpl), (error) => error.code === 'INVALID_INPUT');
  await assert.rejects(() => module.searchZhihu({ query: 'x', filter: 'host==example.com' }, 'zhihu', fetchImpl), (error) => error.code === 'INVALID_INPUT');
  assert.equal(calls, 0);
  assert.equal(module.searchCapabilities().sources.global.route, '/api/search/global');
});

import { createHash } from 'node:crypto';
import { ACCESS_SECRET, fail, json, readBody, requireSameOrigin } from './zhihu-oauth.mjs';

const clean = (value, max = 2400) => typeof value === 'string'
  ? value.slice(0, 32_000)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[name] || '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, max)
  : '';

const safeUrl = (value, zhihuOnly) => {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (zhihuOnly && url.hostname !== 'zhihu.com' && !url.hostname.endsWith('.zhihu.com')) return null;
    return url.href;
  } catch { return null; }
};

function validate(input, source) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['query', 'count', 'filter', 'search_db'].includes(key))) throw Object.assign(new Error('不支持的搜索请求。'), { status: 400, code: 'INVALID_INPUT' });
  if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 500 || /[\x00-\x1f\x7f]/.test(input.query)) throw Object.assign(new Error('搜索内容需要是 1–500 个可见字符。'), { status: 400, code: 'INVALID_INPUT' });
  const count = input.count === undefined ? 3 : input.count;
  if (!Number.isInteger(count) || count < 1 || count > 5) throw Object.assign(new Error('Web 一次只读取 1–5 条来源。'), { status: 400, code: 'INVALID_INPUT' });
  if (source === 'zhihu' && (input.filter !== undefined || input.search_db !== undefined)) throw Object.assign(new Error('知乎搜索不接受全网筛选字段。'), { status: 400, code: 'INVALID_INPUT' });
  if (input.filter !== undefined && (typeof input.filter !== 'string' || input.filter.length > 200 || /[\r\n\x00]/.test(input.filter))) throw Object.assign(new Error('全网筛选条件不正确。'), { status: 400, code: 'INVALID_INPUT' });
  if (input.search_db !== undefined && !['all', 'realtime', 'static'].includes(input.search_db)) throw Object.assign(new Error('全网搜索库不正确。'), { status: 400, code: 'INVALID_INPUT' });
  return { query: input.query.trim(), count, ...(input.filter === undefined ? {} : { filter: input.filter }), ...(input.search_db === undefined ? {} : { search_db: input.search_db }) };
}

function normalize(body, source, query, count, fetchedAt) {
  if (body?.Code !== 0 || !Array.isArray(body?.Data?.Items)) throw Object.assign(new Error('知乎没有返回可用的搜索数据。'), { status: body?.Code === 30001 || body?.Code === 30002 ? 429 : 502, code: `ZHIHU_${body?.Code ?? 'INVALID'}` });
  const items = body.Data.Items.slice(0, count).map((item, index) => {
    const title = clean(item?.Title ?? item?.title, 400);
    const excerpt = clean(item?.ContentText ?? item?.Summary ?? item?.content_text ?? item?.summary ?? item?.excerpt);
    if (!title && !excerpt) throw Object.assign(new Error('知乎返回了空的搜索项。'), { status: 502, code: 'INVALID_RESPONSE' });
    const url = safeUrl(item?.Url ?? item?.url, source === 'zhihu');
    const author = clean(item?.AuthorName ?? item?.author_name ?? item?.Author?.Name ?? item?.author?.name, 200) || null;
    const contentId = clean(item?.ContentID ?? item?.content_id, 200) || null;
    const id = `external:${createHash('sha256').update(JSON.stringify({ source, contentId, url, title, index: contentId || url ? undefined : index })).digest('hex').slice(0, 32)}`;
    const metric = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
    const editTime = Number.isSafeInteger(item?.EditTime) && item.EditTime > 0 ? new Date(item.EditTime * 1000).toISOString() : null;
    return {
      id, provider: 'zhihu', source, title, author, url, excerpt, content_id: contentId,
      content_type: clean(item?.ContentType ?? item?.content_type ?? item?.type, 60) || 'unknown',
      comment_count: metric(item?.CommentCount), vote_up_count: metric(item?.VoteUpCount),
      authority_level: clean(item?.AuthorityLevel, 20) || null, edited_at: editTime,
      content_mode: 'summary', fetched_at: fetchedAt,
    };
  });
  return { protocol_version: 1, provider: 'zhihu', source, query, items, has_more: body.Data.HasMore === true, search_id: clean(body.Data.SearchHashId, 200) || null, empty_reason: items.length ? null : clean(body.Data.EmptyReason, 400) || 'no_results', content_mode: 'summary', fetched_at: fetchedAt, saved_to_trace: false };
}

export async function searchZhihu(input, source, fetchImpl = fetch) {
  if (!ACCESS_SECRET) throw Object.assign(new Error('当前部署尚未配置知乎公开搜索。'), { status: 503, code: 'SEARCH_NOT_CONFIGURED' });
  const request = validate(input, source);
  const pathname = source === 'global' ? '/api/v1/content/global_search' : '/api/v1/content/zhihu_search';
  const url = new URL(pathname, 'https://developer.zhihu.com');
  url.searchParams.set('Query', request.query); url.searchParams.set('Count', String(request.count));
  if (request.filter !== undefined) url.searchParams.set('Filter', request.filter);
  if (request.search_db !== undefined) url.searchParams.set('SearchDB', request.search_db);
  const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${ACCESS_SECRET}`, 'x-request-timestamp': String(Math.floor(Date.now() / 1000)) } });
  if (!response.ok) throw Object.assign(new Error(response.status === 429 ? '知乎搜索额度暂时受限，请稍后再试。' : '知乎搜索请求没有完成。'), { status: response.status === 429 ? 429 : 502, code: response.status === 429 ? 'RATE_LIMITED' : 'ZHIHU_HTTP_ERROR' });
  const text = await response.text();
  if (text.length > 1_048_576) throw Object.assign(new Error('知乎搜索响应超过读取限制。'), { status: 502, code: 'RESPONSE_TOO_LARGE' });
  let body; try { body = JSON.parse(text); } catch { throw Object.assign(new Error('知乎返回了无法读取的搜索响应。'), { status: 502, code: 'INVALID_RESPONSE' }); }
  return normalize(body, source, request.query, request.count, new Date().toISOString());
}

export function searchCapabilities() {
  return { protocol_version: 1, enabled: Boolean(ACCESS_SECRET), provider: 'zhihu', content_mode: 'summary', sources: { zhihu: { route: '/api/search/zhihu', enabled: Boolean(ACCESS_SECRET) }, global: { route: '/api/search/global', enabled: Boolean(ACCESS_SECRET) } }, boundary: 'same-origin-explicit-user-action' };
}

export function createSearchHandler(source) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }, { allow: 'POST' });
    if (!requireSameOrigin(req, res)) return;
    try { return json(res, 200, await searchZhihu(await readBody(req), source)); }
    catch (error) { return fail(res, error?.status || 502, error?.code || 'SEARCH_FAILED', error?.message || '搜索请求没有完成。'); }
  };
}

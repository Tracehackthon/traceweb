import { ACCESS_SECRET, fail, json, readBody, readToken, requireSameOrigin } from '../../../lib/zhihu-oauth.mjs';

const paths = {
  contents: ['/api/v1/user/contents', { ContentType: 'all', SortField: 'ts', SortOrder: 'desc' }],
  favorites: ['/api/v1/user/collections', {}],
  favorite_lists: ['/api/v1/user/favlists', {}],
  favorite_items: ['/api/v1/user/favlist_contents', {}],
  followees: ['/api/v1/user/followees', {}],
};

const clean = (value, max = 500) => typeof value === 'string' ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, max) : '';
const safeUrl = (value) => {
  try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'zhihu.com' || url.hostname.endsWith('.zhihu.com')) ? url.href : null; } catch { return null; }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }, { allow: 'POST' });
  if (!requireSameOrigin(req, res)) return;
  const token = readToken(req);
  if (!token) return fail(res, 401, 'USER_AUTH_REQUIRED', '请先授权连接知乎。');
  if (!ACCESS_SECRET) return fail(res, 503, 'USER_CONTENT_NOT_CONFIGURED', '后端还没有配置用户数据所需的 Access Secret。');
  try {
    const input = await readBody(req);
    if (!input || !Object.hasOwn(paths, input.kind) || Object.keys(input).some((key) => !['kind', 'limit', 'offset', 'favorite_id'].includes(key))) return fail(res, 400, 'INVALID_INPUT', '不支持的知乎用户数据请求。');
    const limit = input.limit === undefined ? 3 : input.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) return fail(res, 400, 'INVALID_INPUT', '一次只能读取 1–10 条。');
    const offset = input.offset === undefined ? '0' : input.offset;
    if (typeof offset !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(offset)) return fail(res, 400, 'INVALID_INPUT', '分页位置不正确。');
    if (input.kind === 'favorite_items' ? typeof input.favorite_id !== 'string' || !/^[1-9]\d{0,18}$/.test(input.favorite_id) : input.favorite_id !== undefined) return fail(res, 400, 'INVALID_INPUT', '收藏夹内容必须使用列表返回的收藏夹 ID。');
    const [pathname, base] = paths[input.kind];
    const url = new URL(pathname, 'https://developer.zhihu.com');
    const query = { ...base, Limit: String(limit) };
    if (!['favorites', 'favorite_lists'].includes(input.kind)) query.Offset = offset;
    if (input.kind === 'favorite_items') query.FavlistUrlToken = input.favorite_id;
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: {
      accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${ACCESS_SECRET}`,
      'x-oauth-token': token.value, 'x-request-timestamp': String(Math.floor(Date.now() / 1000)),
    } });
    if (!response.ok) return fail(res, response.status === 429 ? 429 : 502, response.status === 429 ? 'RATE_LIMITED' : 'ZHIHU_HTTP_ERROR', '知乎用户数据请求没有完成。');
    const text = await response.text();
    if (text.length > 1_048_576) return fail(res, 502, 'RESPONSE_TOO_LARGE', '知乎响应超过读取限制。');
    let body; try { body = JSON.parse(text); } catch { return fail(res, 502, 'INVALID_RESPONSE', '知乎返回了无法读取的响应。'); }
    if (body?.Code !== 0 || !Array.isArray(body?.Data?.Items)) return fail(res, body?.Code === 30001 || body?.Code === 30002 ? 429 : body?.Code === 20001 ? 401 : 502, `ZHIHU_${body?.Code ?? 'INVALID'}`, '知乎没有返回可用的用户数据。');
    const items = body.Data.Items.slice(0, limit).map((item) => ({
      id: item.UrlToken === undefined ? null : String(item.UrlToken),
      title: clean(item.Title || item.Fullname || item.Name || '未命名内容', 400),
      summary: clean(item.Summary || item.Description || item.Headline || '', 800),
      url: safeUrl(item.Url),
      content_type: clean(item.ContentType || (input.kind === 'followees' ? 'person' : input.kind === 'favorite_lists' ? 'favorite_list' : ''), 50),
    }));
    const paging = body.Data.Paging;
    const nextOffset = paging?.IsEnd === false && typeof paging.NextOffset === 'string' && /^(0|[1-9]\d{0,18})$/.test(paging.NextOffset) ? paging.NextOffset : null;
    return json(res, 200, { protocol_version: 1, owner: 'oauth_authorized_user', resource: input.kind, items, next_offset: nextOffset, complete_history: false, saved_to_trace: false });
  } catch (error) {
    return fail(res, error?.status || 502, error?.code || 'ZHIHU_REQUEST_FAILED', error?.message || '知乎用户数据请求没有完成。');
  }
}

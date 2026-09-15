import { configured, fail, json, requireSameOrigin, startAuthorization } from '../../../lib/zhihu-oauth.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }, { allow: 'POST' });
  if (!requireSameOrigin(req, res)) return;
  if (!configured()) return fail(res, 503, 'OAUTH_NOT_CONFIGURED', '线上知乎授权还缺少后端 Secret，当前没有发起不完整的登录。');
  return json(res, 200, startAuthorization(res));
}

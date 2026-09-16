import { clearAuthorizationCookies, json, requireSameOrigin } from '../../../lib/zhihu-oauth.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }, { allow: 'POST' });
  if (!requireSameOrigin(req, res)) return;
  res.setHeader('set-cookie', clearAuthorizationCookies());
  return json(res, 200, { status: 'disconnected', local_session_cleared: true, provider_token_revoked: false });
}

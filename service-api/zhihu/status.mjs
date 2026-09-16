import { ACCESS_SECRET, configured, json, readToken } from '../../lib/zhihu-oauth.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }, { allow: 'GET' });
  const token = readToken(req);
  return json(res, 200, {
    protocol_version: 1,
    oauth: {
      configured: configured(),
      status: token ? 'authorized' : 'not_authorized',
      expires_at: token ? new Date(token.exp).toISOString() : null,
      identity_verified: false,
    },
    user_content_configured: Boolean(ACCESS_SECRET),
    storage: token ? 'encrypted_http_only_cookie' : 'none',
    notice: '知乎授权只允许读取用户资料，不等同于 Trace 云账号或跨设备同步。',
  });
}

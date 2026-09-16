import { configured, json, readToken, requireSameOrigin } from '../../../lib/zhihu-oauth.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }, { allow: 'POST' });
  if (!requireSameOrigin(req, res)) return;
  const token = readToken(req);
  return json(res, 200, {
    protocol_version: 1,
    oauth: {
      configured: configured(),
      status: token ? 'authorized' : 'not_authorized',
      expires_at: token ? new Date(token.exp).toISOString() : null,
      identity_verified: false,
    },
    storage: token ? 'encrypted_http_only_cookie' : 'none',
  });
}

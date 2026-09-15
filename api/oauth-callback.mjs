import { clearAuthorizationCookies, configured, finishAuthorization } from '../lib/zhihu-oauth.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET' || !configured()) {
    res.statusCode = req.method === 'GET' ? 503 : 405;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    return res.end(req.method === 'GET' ? '知乎授权回调尚未配置。' : 'Method not allowed');
  }
  try {
    const origin = new URL(process.env.ZHIHU_OAUTH_REDIRECT_URI || 'https://trace.neutronm.store/callback').origin;
    const url = new URL(req.url, origin);
    const result = await finishAuthorization(req, url.searchParams);
    res.setHeader('set-cookie', [result.tokenCookie, result.clearStateCookie]);
    res.statusCode = 303;
    res.setHeader('location', '/app?zhihu=connected');
    res.setHeader('cache-control', 'no-store');
    return res.end();
  } catch (error) {
    res.setHeader('set-cookie', clearAuthorizationCookies());
    res.statusCode = 303;
    res.setHeader('location', `/app?zhihu=error&reason=${encodeURIComponent(error?.code || 'OAUTH_CALLBACK_FAILED')}`);
    res.setHeader('cache-control', 'no-store');
    return res.end();
  }
}

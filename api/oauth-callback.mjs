import { clearAuthorizationCookies, configured, finishAuthorization } from '../lib/zhihu-oauth.mjs';

const LOCAL_STATE = /^trace-local-v1\.[A-Za-z0-9_-]{43}$/;
const LOCAL_CALLBACK = 'http://127.0.0.1:4174/api/zhihu/oauth/loopback-callback';

function forwardLocalAuthorization(req, res) {
  const origin = new URL(process.env.ZHIHU_OAUTH_REDIRECT_URI || 'https://trace.neutrom.store/callback').origin;
  const source = new URL(req.url, origin);
  const states = source.searchParams.getAll('state');
  if (states.length !== 1 || !LOCAL_STATE.test(states[0])) return false;
  const target = new URL(LOCAL_CALLBACK);
  for (const name of ['state', 'authorization_code', 'code', 'error']) {
    for (const value of source.searchParams.getAll(name)) target.searchParams.append(name, value);
  }
  res.statusCode = 303;
  res.setHeader('location', target.href);
  res.setHeader('cache-control', 'no-store');
  res.setHeader('referrer-policy', 'no-referrer');
  res.end();
  return true;
}

export default async function handler(req, res) {
  if (req.method === 'GET' && forwardLocalAuthorization(req, res)) return;
  if (req.method !== 'GET' || !configured()) {
    res.statusCode = req.method === 'GET' ? 503 : 405;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    return res.end(req.method === 'GET' ? '知乎授权回调尚未配置。' : 'Method not allowed');
  }
  try {
    const origin = new URL(process.env.ZHIHU_OAUTH_REDIRECT_URI || 'https://trace.neutrom.store/callback').origin;
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

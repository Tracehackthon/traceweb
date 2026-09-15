import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const APP_ID = process.env.ZHIHU_OAUTH_APP_ID || '669';
export const REDIRECT_URI = process.env.ZHIHU_OAUTH_REDIRECT_URI || 'https://trace.neutronm.store/callback';
const APP_KEY = process.env.ZHIHU_OAUTH_APP_KEY || '';
export const ACCESS_SECRET = process.env.ZHIHU_ACCESS_SECRET || '';
const OAUTH_COOKIE = 'trace_zhihu_oauth';
const TOKEN_COOKIE = 'trace_zhihu_token';

const b64 = (value) => Buffer.from(value).toString('base64url');
const unb64 = (value) => Buffer.from(value, 'base64url');
const mac = (value) => createHmac('sha256', APP_KEY).update(value).digest('base64url');
const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const tokenKey = () => createHash('sha256').update('trace.zhihu.token.v1\0').update(APP_KEY).digest();

export function configured() {
  try {
    const callback = new URL(REDIRECT_URI);
    return /^\d{1,32}$/.test(APP_ID) && APP_KEY.length >= 16 && callback.protocol === 'https:' && callback.pathname === '/callback';
  } catch { return false; }
}

export function json(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(JSON.stringify(body));
}

export function fail(res, status, code, message) {
  json(res, status, { error: { code, message } });
}

export function requireSameOrigin(req, res) {
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const expected = host ? `https://${host}` : '';
  if (!origin || origin !== expected) {
    fail(res, 403, 'ORIGIN_MISMATCH', '请求来源与当前 Trace 站点不一致。');
    return false;
  }
  return true;
}

function parseCookie(req, name) {
  const values = String(req.headers.cookie || '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  return values.length === 1 ? values[0].slice(name.length + 1) : null;
}

export function startAuthorization(res) {
  if (!configured()) return null;
  const nonce = randomBytes(32).toString('base64url');
  const payload = b64(JSON.stringify({ v: 1, nonce, exp: Date.now() + 5 * 60_000 }));
  const state = `${payload}.${mac(payload)}`;
  const target = new URL('https://openapi.zhihu.com/authorize');
  target.search = new URLSearchParams({ app_id: APP_ID, redirect_uri: REDIRECT_URI, response_type: 'code', state }).toString();
  // Keep the same signed, expiring value in an HttpOnly browser-bound cookie.
  // Zhihu's hackathon callback has been observed both with and without `state`;
  // when it omits `state`, the one-time authorization still has to originate
  // from a browser that successfully started this flow.
  res.setHeader('set-cookie', cookie(OAUTH_COOKIE, state, 300));
  return { status: 'user_action_required', login_url: target.href, expires_in: 300 };
}

function validateSignedState(state) {
  if (typeof state !== 'string' || state.length > 2000) return null;
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const expected = Buffer.from(mac(parts[0]));
  const actual = Buffer.from(parts[1]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  let payload;
  try { payload = JSON.parse(unb64(parts[0]).toString('utf8')); } catch { return null; }
  if (payload?.v !== 1 || typeof payload.nonce !== 'string' || payload.nonce.length < 32 || !Number.isSafeInteger(payload.exp) || payload.exp < Date.now()) return null;
  return payload;
}

export async function finishAuthorization(req, params) {
  const stateValues = params.getAll('state');
  const primaryValues = params.getAll('authorization_code');
  const aliasValues = params.getAll('code');
  if (stateValues.length > 1) throw Object.assign(new Error('授权状态参数重复。'), { code: 'OAUTH_DUPLICATE_PARAMETER' });
  const pending = parseCookie(req, OAUTH_COOKIE);
  if (!validateSignedState(pending) || (stateValues.length === 1 && stateValues[0] !== pending)) throw Object.assign(new Error('授权状态与发起授权的浏览器不一致或已经过期。'), { code: 'OAUTH_STATE_MISMATCH' });
  if (params.has('error')) throw Object.assign(new Error('知乎没有完成这次授权。'), { code: 'OAUTH_DENIED' });
  if (primaryValues.length > 1 || aliasValues.length > 1) throw Object.assign(new Error('授权码参数重复。'), { code: 'OAUTH_DUPLICATE_PARAMETER' });
  if (primaryValues[0] && aliasValues[0] && primaryValues[0] !== aliasValues[0]) throw Object.assign(new Error('授权码参数不一致。'), { code: 'OAUTH_CODE_CONFLICT' });
  const code = primaryValues[0] || aliasValues[0];
  if (!code || code.length > 4096 || /[\x00-\x20\x7f]/.test(code)) throw Object.assign(new Error('知乎没有返回有效授权码。'), { code: 'OAUTH_CODE_MISSING' });
  const response = await fetch('https://openapi.zhihu.com/access_token', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ app_id: APP_ID, app_key: APP_KEY, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI, code }),
  });
  if (!response.ok) throw Object.assign(new Error('知乎拒绝了授权码交换，请重新发起。'), { code: 'OAUTH_EXCHANGE_FAILED' });
  const text = await response.text();
  if (text.length > 16_384) throw Object.assign(new Error('知乎授权响应超过限制。'), { code: 'OAUTH_INVALID_RESPONSE' });
  let body; try { body = JSON.parse(text); } catch { throw Object.assign(new Error('知乎授权响应格式不正确。'), { code: 'OAUTH_INVALID_RESPONSE' }); }
  const value = body?.access_token ? body : body?.data?.access_token ? body.data : body?.Data?.access_token ? body.Data : null;
  if (!value || typeof value.access_token !== 'string' || value.access_token.length > 2600 || !Number.isSafeInteger(value.expires_in) || value.expires_in < 1 || value.expires_in > 31 * 86400) throw Object.assign(new Error('知乎授权响应缺少有效 Token 或期限。'), { code: 'OAUTH_INVALID_RESPONSE' });
  const maxAge = Math.min(value.expires_in, 7 * 86400);
  return { tokenCookie: cookie(TOKEN_COOKIE, encryptToken({ value: value.access_token, exp: Date.now() + maxAge * 1000 }), maxAge), clearStateCookie: cookie(OAUTH_COOKIE, '', 0) };
}

function encryptToken(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(encrypted)}`;
}

export function readToken(req) {
  if (!configured()) return null;
  const value = parseCookie(req, TOKEN_COOKIE);
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', tokenKey(), unb64(parts[0]));
    decipher.setAuthTag(unb64(parts[1]));
    const data = JSON.parse(Buffer.concat([decipher.update(unb64(parts[2])), decipher.final()]).toString('utf8'));
    return typeof data.value === 'string' && Number.isSafeInteger(data.exp) && data.exp > Date.now() ? data : null;
  } catch { return null; }
}

export function clearAuthorizationCookies() {
  return [cookie(OAUTH_COOKIE, '', 0), cookie(TOKEN_COOKIE, '', 0)];
}

export async function readBody(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 8192) throw Object.assign(new Error('请求内容超过限制。'), { status: 413, code: 'BODY_TOO_LARGE' });
  }
  try { return text ? JSON.parse(text) : {}; } catch { throw Object.assign(new Error('请求需要有效 JSON。'), { status: 400, code: 'INVALID_JSON' }); }
}

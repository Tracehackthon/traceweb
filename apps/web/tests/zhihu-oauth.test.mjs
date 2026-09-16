import test from 'node:test';
import assert from 'node:assert/strict';

test('serverless Zhihu OAuth keeps app key and token behind signed HttpOnly cookies', async () => {
  process.env.ZHIHU_OAUTH_APP_ID = '669';
  process.env.ZHIHU_OAUTH_APP_KEY = 'test-only-app-key-with-enough-length';
  process.env.ZHIHU_OAUTH_REDIRECT_URI = 'https://trace.neutrom.store/callback';
  const oauth = await import(`../../../lib/zhihu-oauth.mjs?test=${Date.now()}`);
  const headers = new Map();
  const response = { setHeader(name, value) { headers.set(name.toLowerCase(), value); } };
  const started = oauth.startAuthorization(response);
  assert.equal(started.status, 'user_action_required');
  assert.match(started.login_url, /^https:\/\/openapi\.zhihu\.com\/authorize\?/);
  assert.equal(started.login_url.includes(process.env.ZHIHU_OAUTH_APP_KEY), false);
  const pendingCookie = headers.get('set-cookie');
  assert.match(pendingCookie, /HttpOnly; Secure; SameSite=Lax/);
  const cookiePair = pendingCookie.split(';')[0];
  const params = new URL(started.login_url).searchParams;
  params.set('authorization_code', 'one-use-code');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 20000, access_token: 'oauth-user-token', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const finished = await oauth.finishAuthorization({ headers: { cookie: cookiePair } }, params);
    assert.match(finished.tokenCookie, /^trace_zhihu_token=/);
    assert.equal(finished.tokenCookie.includes('oauth-user-token'), false);
    const tokenPair = finished.tokenCookie.split(';')[0];
    assert.equal(oauth.readToken({ headers: { cookie: tokenPair } }).value, 'oauth-user-token');
  } finally { globalThis.fetch = originalFetch; }
});

test('OAuth callback accepts Zhihu hackathon callback without state but requires its browser binding', async () => {
  process.env.ZHIHU_OAUTH_APP_ID = '669';
  process.env.ZHIHU_OAUTH_APP_KEY = 'another-test-only-key-with-enough-length';
  process.env.ZHIHU_OAUTH_REDIRECT_URI = 'https://trace.neutrom.store/callback';
  const oauth = await import(`../../../lib/zhihu-oauth.mjs?test=${Date.now()}-missing`);
  await assert.rejects(() => oauth.finishAuthorization({ headers: {} }, new URLSearchParams({ authorization_code: 'code' })), (error) => error.code === 'OAUTH_STATE_MISMATCH');
  const headers = new Map();
  const started = oauth.startAuthorization({ setHeader(name, value) { headers.set(name.toLowerCase(), value); } });
  const cookiePair = headers.get('set-cookie').split(';')[0];
  const noState = new URLSearchParams({ authorization_code: 'code' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ access_token: 'oauth-user-token', expires_in: 3600 }), { status: 200 });
  try {
    const finished = await oauth.finishAuthorization({ headers: { cookie: cookiePair } }, noState);
    assert.match(finished.tokenCookie, /^trace_zhihu_token=/);
    const mismatched = new URL(started.login_url).searchParams;
    mismatched.set('state', `${mismatched.get('state')}tampered`);
    mismatched.set('authorization_code', 'code');
    await assert.rejects(() => oauth.finishAuthorization({ headers: { cookie: cookiePair } }, mismatched), (error) => error.code === 'OAUTH_STATE_MISMATCH');
  } finally { globalThis.fetch = originalFetch; }
});

test('OAuth callback forwards only marked local Trace handoffs to the fixed loopback receiver', async () => {
  const { default: handler } = await import(`../../../service-api/oauth-callback.mjs?loopback=${Date.now()}`);
  const headers = new Map();
  const response = { statusCode: 0, setHeader(name, value) { headers.set(name.toLowerCase(), value); }, end() {} };
  const state = `trace-local-v1.${'a'.repeat(43)}`;
  await handler({ method: 'GET', url: `/callback?state=${state}&authorization_code=one-time-code` }, response);
  assert.equal(response.statusCode, 303);
  const location = new URL(headers.get('location'));
  assert.equal(location.origin, 'http://127.0.0.1:4174');
  assert.equal(location.pathname, '/api/zhihu/oauth/loopback-callback');
  assert.equal(location.searchParams.get('state'), state);
  assert.equal(location.searchParams.get('authorization_code'), 'one-time-code');
  assert.equal(headers.get('cache-control'), 'no-store');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');

  const unmarkedHeaders = new Map();
  const unmarked = { statusCode: 0, setHeader(name, value) { unmarkedHeaders.set(name.toLowerCase(), value); }, end() {} };
  await handler({ method: 'GET', url: '/callback?state=ordinary&authorization_code=code' }, unmarked);
  assert.notEqual(unmarkedHeaders.get('location')?.startsWith('http://127.0.0.1:4174'), true);
});

test('same-origin guard accepts both Trace production origins behind the service proxy', async () => {
  process.env.ZHIHU_OAUTH_REDIRECT_URI = 'https://trace.neutrom.store/callback';
  process.env.TRACE_ALLOWED_ORIGINS = 'https://traceweb-neutronm.vercel.app';
  const oauth = await import(`../../../lib/zhihu-oauth.mjs?test=${Date.now()}-origins`);
  const invoke = (origin) => {
    let statusCode = 0;
    let payload = '';
    const response = {
      setHeader() {},
      end(value = '') { payload = String(value); },
      set statusCode(value) { statusCode = value; },
      get statusCode() { return statusCode; },
    };
    const allowed = oauth.requireSameOrigin({ headers: {
      origin,
      host: 'trace-api.103-201-130-12.sslip.io',
      'x-forwarded-host': 'trace-api.103-201-130-12.sslip.io',
    } }, response);
    return { allowed, statusCode, payload };
  };

  assert.equal(invoke('https://trace.neutrom.store').allowed, true);
  assert.equal(invoke('https://traceweb-neutronm.vercel.app').allowed, true);
  const denied = invoke('https://evil.example');
  assert.equal(denied.allowed, false);
  assert.equal(denied.statusCode, 403);
  assert.equal(JSON.parse(denied.payload).error.code, 'ORIGIN_MISMATCH');
});

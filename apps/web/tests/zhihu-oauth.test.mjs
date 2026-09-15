import test from 'node:test';
import assert from 'node:assert/strict';

test('serverless Zhihu OAuth keeps app key and token behind signed HttpOnly cookies', async () => {
  process.env.ZHIHU_OAUTH_APP_ID = '669';
  process.env.ZHIHU_OAUTH_APP_KEY = 'test-only-app-key-with-enough-length';
  process.env.ZHIHU_OAUTH_REDIRECT_URI = 'https://trace.neutronm.store/callback';
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
  process.env.ZHIHU_OAUTH_REDIRECT_URI = 'https://trace.neutronm.store/callback';
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

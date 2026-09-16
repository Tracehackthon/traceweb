import { createServer } from 'node:http';
import oauthCallback from '../api/oauth-callback.mjs';
import searchCapabilities from '../api/search/capabilities.mjs';
import searchGlobal from '../api/search/global.mjs';
import searchZhihu from '../api/search/zhihu.mjs';
import oauthCheck from '../api/zhihu/oauth/check.mjs';
import oauthDisconnect from '../api/zhihu/oauth/disconnect.mjs';
import oauthStart from '../api/zhihu/oauth/start.mjs';
import zhihuStatus from '../api/zhihu/status.mjs';
import userRead from '../api/zhihu/user/read.mjs';

const port = Number.parseInt(process.env.PORT || '4180', 10);
const host = process.env.HOST || '127.0.0.1';

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');

const routes = new Map([
  ['/callback', oauthCallback],
  ['/api/oauth-callback', oauthCallback],
  ['/api/search/capabilities', searchCapabilities],
  ['/api/search/global', searchGlobal],
  ['/api/search/zhihu', searchZhihu],
  ['/api/zhihu/oauth/check', oauthCheck],
  ['/api/zhihu/oauth/disconnect', oauthDisconnect],
  ['/api/zhihu/oauth/start', oauthStart],
  ['/api/zhihu/status', zhihuStatus],
  ['/api/zhihu/user/read', userRead],
]);

const server = createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  let pathname;
  try { pathname = new URL(req.url || '/', 'http://trace.local').pathname; }
  catch { pathname = '/'; }
  if (pathname === '/healthz') {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    return res.end(JSON.stringify({ status: 'ok', service: 'trace-zhihu-gateway' }));
  }
  const handler = routes.get(pathname);
  if (!handler) {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    return res.end(JSON.stringify({ error: { code: 'NOT_FOUND' } }));
  }
  try { await handler(req, res); }
  catch {
    if (res.headersSent) return res.end();
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: '服务暂时没有完成这次请求。' } }));
  }
});

server.requestTimeout = 20_000;
server.headersTimeout = 10_000;
server.listen(port, host, () => console.log(`Trace service listening on ${host}:${port}`));

const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

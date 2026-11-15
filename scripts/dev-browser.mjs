import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, loadConfigFromFile } from 'vite';

// 落地页和 Web 共用源码；此入口不启动本机 API，也不代理到用户的 Runtime。
process.env.VITE_TRACE_STORAGE = 'browser';
const webRoot = fileURLToPath(new URL('../apps/web/', import.meta.url));
const port = Number(process.env.TRACE_DESKTOP_PORT || 4327);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('TRACE_DESKTOP_PORT 必须为 1—65535 的整数。');
}
const loaded = await loadConfigFromFile(
  { command: 'serve', mode: 'development' },
  path.join(webRoot, 'vite.config.ts'),
  webRoot,
);
if (!loaded) throw new Error('未找到客户端 Vite 配置。');
const server = await createServer({
  ...loaded.config,
  configFile: false,
  root: webRoot,
  server: {
    ...loaded.config.server,
    host: '127.0.0.1',
    port,
    strictPort: true,
    open: false,
    proxy: undefined,
  },
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => void close().then(() => process.exit(0)));
}
try {
  await server.listen();
  const origin = `http://127.0.0.1:${port}`;
  console.log(`Trace 落地页：${origin}/`);
  console.log(`Trace Web：${origin}/app；隔离演示：${origin}/app/demo`);
  console.log('仅浏览器存储；没有启动 API、数据库或 Runtime 代理。Ctrl+C 停止。');
} catch (error) {
  await close();
  throw error;
}

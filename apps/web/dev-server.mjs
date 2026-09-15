import { createServer as createViteServer } from 'vite';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const desktopPort = Number(process.env.TRACE_DESKTOP_PORT || 4186);
const apiPort = Number(process.env.TRACE_API_PORT || 4187);
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const stateFile = process.env.TRACE_WEB_STATE_FILE || path.resolve(root, '../../.trace/state/web-dev.sqlite');
const env = { ...process.env, TRACE_API_ONLY: '1', TRACE_DESKTOP_PORT: String(apiPort), TRACE_WEB_STATE_FILE: stateFile };
const api = spawn(process.execPath, ['server.mjs'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let apiLog = '';
api.stdout.on('data', (chunk) => { apiLog += chunk; process.stdout.write(`[api] ${chunk}`); });
api.stderr.on('data', (chunk) => { apiLog += chunk; process.stderr.write(`[api] ${chunk}`); });
api.once('error', (error) => { console.error(error); process.exitCode = 1; });

let vite;
try {
  vite = await createViteServer({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    server: {
      host: '127.0.0.1', port: desktopPort, strictPort: true,
      proxy: { '/api': {
        target: apiOrigin,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyRequest, request) => {
            if (request.headers.origin) proxyRequest.setHeader('origin', `http://${proxyRequest.getHeader('host')}`);
          });
        },
      } },
    },
    appType: 'spa',
  });
  await vite.listen();
  console.log(`Trace Vite dev: http://127.0.0.1:${desktopPort}/`);
  console.log(`Trace API: http://127.0.0.1:${apiPort}/ (proxy keeps one browser origin)`);
} catch (error) {
  console.error(error);
  api.kill();
  process.exitCode = 1;
}

const close = async () => {
  await vite?.close();
  if (!api.killed) api.kill();
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void close().finally(() => process.exit(0)); });

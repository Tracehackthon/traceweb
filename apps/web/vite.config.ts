import { defineConfig } from 'vite';

const desktopPort = Number(process.env.TRACE_DESKTOP_PORT || 4186);
const apiPort = Number(process.env.TRACE_API_PORT || 4173);

export default defineConfig({
  root: '.',
  base: '/',
  server: {
    host: '127.0.0.1',
    port: Number.isInteger(desktopPort) && desktopPort > 0 ? desktopPort : 4186,
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${Number.isInteger(apiPort) && apiPort > 0 ? apiPort : 4173}`, changeOrigin: false },
    },
  },
  build: {
    outDir: process.env.TRACE_WEB_OUT_DIR || 'dist',
    emptyOutDir: true,
    manifest: true,
    rollupOptions: { input: { index: 'index.html', legacy: 'legacy.html' } },
  },
});

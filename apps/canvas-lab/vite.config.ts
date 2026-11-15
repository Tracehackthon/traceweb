import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
  plugins: [react()],
  resolve: { alias: {
    '@drawnix/drawnix': source('./vendor/drawnix/packages/drawnix/src/index.ts'),
    '@plait-board/react-board': source('./vendor/drawnix/packages/react-board/src/index.ts'),
    '@plait-board/react-text': source('./vendor/drawnix/packages/react-text/src/index.ts'),
  }, dedupe: ['react', 'react-dom', '@plait/core', '@plait/common'] },
  css: { preprocessorOptions: { scss: { silenceDeprecations: ['legacy-js-api', 'import', 'global-builtin', 'color-functions'] } } },
  server: { host: '127.0.0.1', port: 4196, strictPort: true },
  build: { chunkSizeWarningLimit: 1500 },
});

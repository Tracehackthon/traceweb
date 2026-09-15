import { spawnSync } from 'node:child_process';

// npm_execpath is supplied by npm on Windows and Linux; no shell env syntax.
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_TRACE_STORAGE: 'browser', TRACE_WEB_OUT_DIR: 'dist-vercel' },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);

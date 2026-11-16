// Full built application in headless Chromium. UI-only writes, read-only IDB proof.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const { chromium } = require('playwright');
const { startForegroundWatch } = require('./helpers/foreground-watch.cjs');
const root = path.resolve(__dirname, '..');
const phase = path.join(root, '.test-results/workbench-search-context');
const out = path.resolve(process.env.TRACE_E2E_OUTPUT_DIR || '');
const dist = path.resolve(process.env.TRACE_E2E_DIST_DIR || '');
assert(out.startsWith(phase + path.sep) && !fs.existsSync(path.join(out, 'report.json')));
assert(!fs.existsSync(path.join(out,'profile')),'Use a fresh profile; never reuse a stale verification owner');
assert(dist.startsWith(phase + path.sep) && fs.existsSync(path.join(dist, 'index.html')));
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
for (const key of ['TEMP', 'TMP', 'TMPDIR']) process.env[key] = path.join(out, 'tmp');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const identity = { entrySha256: hash(path.join(dist, 'index.html')), manifestSha256: hash(path.join(dist, '.vite/manifest.json')), driverSha256: hash(__filename), helperSha256: hash(path.join(__dirname,'helpers/workbench-search-context.cjs')) };
const checks = [], errors = [], external = [];
let server, context, page, watch, foreground;
const check = (name, value) => { assert(value, name); checks.push(name); process.stdout.write('PASS ' + name + '\n'); };
const state = () => page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => { const r = indexedDB.open('trace-portal-workspace-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try { return { product: await new Promise((resolve, reject) => { const r = db.transaction('workspace', 'readonly').objectStore('workspace').get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }) }; }
  finally { db.close(); }
});
(async () => {
  try {
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };
    server = http.createServer((req, res) => {
      const route = new URL(req.url, 'http://localhost').pathname;
      const file = path.resolve(dist, '.' + (['/', '/app'].includes(route) ? '/index.html' : decodeURIComponent(route)));
      if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const profile = path.join(out, 'profile');
    watch = await startForegroundWatch(out, profile);
    context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 940 } });
    const browserSession = await context.browser().newBrowserCDPSession();
    const browserProcesses = await browserSession.send('SystemInfo.getProcessInfo');
    const browserVersion = await browserSession.send('Browser.getVersion');
    assert(browserProcesses.processInfo.some(process => process.type === 'browser' && process.id > 0), 'Own browser CDP returns authoritative process identity');
    await watch.rememberBrowserPids(browserProcesses.processInfo.map(process => process.id));
    fs.writeFileSync(path.join(out, 'headless-process-identity.json'), JSON.stringify({ browserProcesses, browserVersion, launchProfile: profile, headless: true, identitySource: 'Browser-scoped CDP session obtained directly from the newly launched persistent context; no externally supplied endpoint' }, null, 2));
    page = context.pages()[0]; page.setDefaultTimeout(15000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
    page.on('request', r => { const u = new URL(r.url()); if (!['blob:', 'data:'].includes(u.protocol) && u.origin !== base) external.push(r.url()); });
    await page.goto(base + '/app?view=canvas');
    await page.getByRole('button', { name: '开始画布', exact: true }).click();
    await page.locator('[data-workbench-ready=true]').waitFor();
    await require('./helpers/workbench-search-context.cjs')({ page, state, check, out, baseline: process.argv.includes('--baseline'), saved: () => page.waitForFunction(() => document.querySelector('.wb-save-status')?.textContent.includes('已保存内容')), capture: async name => {
      await page.waitForFunction(() => !document.getAnimations().some(a => a.id.startsWith('trace-surface-') && a.playState === 'running'), undefined, { polling: 50, timeout: 3000 });
      await page.screenshot({ path: path.join(out, name + '.png'), timeout: 15000 });
    } });
    check('full application has no renderer console HTTP or external request errors', !errors.length && !external.length);
    check('built application remains immutable during interaction', identity.entrySha256 === hash(path.join(dist, 'index.html')) && identity.manifestSha256 === hash(path.join(dist, '.vite/manifest.json')));
  } catch (error) {
    process.exitCode = 1; process.stderr.write(error.stack + '\n');
    fs.writeFileSync(path.join(out, 'failure.txt'), error.stack);
    if (page) { await page.screenshot({ path: path.join(out, 'failure.png'), timeout: 10000 }).catch(() => {}); fs.writeFileSync(path.join(out, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => 'unavailable')); }
  } finally {
    if (context) await context.close();
    if (watch) { try { foreground = await watch.stop(); if (!foreground.passed) process.exitCode = 1; } catch (error) { process.exitCode = 1; errors.push(error.message); } }
    if (server) await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ passed: !process.exitCode, mode: 'Headless full application UI, actual IndexedDB saves, no OS keyboard/mouse or native window activation', identity, checks, errors, external, foreground, newProviderTurns: 0 }, null, 2));
  }
})();

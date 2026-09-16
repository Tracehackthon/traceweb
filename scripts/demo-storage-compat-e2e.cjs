const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'apps', 'web', 'dist-vercel');
const out = path.join(root, '.test-results', 'demo-storage', `run-${Date.now()}`);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
fs.mkdirSync(out, { recursive: true });

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const relative = pathname === '/' || pathname === '/app/demo' ? '/index.html' : pathname;
  const file = path.resolve(dist, `.${relative}`);
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(response);
});

function chromiumExecutable() {
  const candidates = [
    process.env.TRACE_CHROMIUM_EXECUTABLE,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}

(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable() });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors = [];
    const workspaceRequests = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/web/')) workspaceRequests.push(request.url()); });

    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('trace-web-complete-demo-v3', 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('workspace');
          request.result.createObjectStore('commands');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('workspace', 'readwrite');
        tx.objectStore('workspace').put({ schemaVersion: 999, revision: 4, host: 'legacy-demo-record' }, 'current');
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    });

    await page.goto(`${base}/app/demo`, { waitUntil: 'domcontentloaded' });
    await page.locator('.demo-guide-toggle').waitFor({ timeout: 10000 });
    await page.locator('.web-status[data-state=saved]').waitFor({ timeout: 10000 });
    assert.equal(await page.locator('.thought-bubble[data-matter-id]').count(), 4);

    const storage = await page.evaluate(async () => {
      const databases = await indexedDB.databases();
      const old = await new Promise((resolve, reject) => {
        const request = indexedDB.open('trace-web-complete-demo-v3', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const record = await new Promise((resolve, reject) => {
        const tx = old.transaction('workspace', 'readonly');
        const request = tx.objectStore('workspace').get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      old.close();
      return { names: databases.map(item => item.name), legacyHost: record.host };
    });

    assert.ok(storage.names.includes('trace-web-complete-demo-v3'));
    assert.ok(storage.names.includes('trace-web-complete-demo-v4'));
    assert.equal(storage.legacyHost, 'legacy-demo-record');
    assert.equal(workspaceRequests.length, 0);
    assert.deepEqual(pageErrors, []);
    await page.screenshot({ path: path.join(out, 'demo-open.png'), animations: 'disabled' });
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ base, storage, workspaceRequests, pageErrors }, null, 2));
    console.log('PASS legacy demo storage cannot block the current complete demo');
    console.log(`EVIDENCE ${out}`);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

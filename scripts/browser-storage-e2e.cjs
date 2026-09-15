const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'apps/web/dist-vercel');
const out = path.join(root, '.test-results/browser-storage/run-' + Date.now());
fs.mkdirSync(out, { recursive: true });
const checks = [], errors = [], requests = [];
const check = (name, condition = true) => { assert.ok(condition, name); checks.push({ name, passed: true }); console.log('PASS ' + name); };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };
// Static-only fixture: no workspace API, SQLite, or write endpoint exists.
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  let file = pathname === '/__test/browser-workspace.mjs' ? path.join(root, 'apps/web/src/product/browser-workspace.mjs')
    : path.resolve(dist, '.' + ((pathname === '/' || pathname === '/app' || pathname === '/app/demo') ? '/index.html' : pathname));
  if ((!file.startsWith(dist + path.sep) && pathname !== '/__test/browser-workspace.mjs') || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  let browser, page;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true, executablePath: process.env.TRACE_CHROMIUM_EXECUTABLE || undefined });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    context.on('page', p => p.on('pageerror', error => errors.push(error.message)));
    page.on('pageerror', error => errors.push(error.message));
    context.on('request', req => { if (new URL(req.url()).pathname.startsWith('/api/web/')) requests.push(req.url()); });
    const state = p => p.evaluate(async () => (await import('/__test/browser-workspace.mjs')).readBrowserWorkspace());
    const saved = async p => { await p.waitForTimeout(550); await p.locator('.web-status[data-state=saved]').waitFor(); };
    await page.goto(base + '/app');
    await page.locator('#capture-input').waitFor();
    check('static empty workspace loads without an API', (await state(page)).host === null);
    const original = 'Vercel 浏览器保存验证：这次内容会在刷新后留下吗？';
    await page.locator('#capture-input').fill(original);
    await page.locator('#capture-form [type=submit]').click();
    await page.locator('[data-selection=originalText]').waitFor();
    await saved(page);
    const initial = await state(page), matterId = initial.host.chain.matters[0].id;
    check('capture transaction commits one real matter', initial.host.chain.matters.length === 1 && initial.host.chain.matters[0].originalText === original);
    await page.reload();
    await page.locator('[data-selection=originalText]').waitFor();
    check('refresh recovers same matter', (await state(page)).host.chain.matters[0].id === matterId);
    await page.locator('[data-action=understanding]').first().click();
    await page.locator('[data-field=understanding]').fill('内容只保存在同一浏览器、同一网站。');
    await page.locator('[data-action=save-understanding]').click();
    await saved(page);
    check('explicit understanding persisted', (await state(page)).host.chain.matters[0].understandingVersion === 1);
    await page.locator('[data-action=handoff]').click();
    await page.locator('[data-field=agent]').fill('手工验证');
    await page.locator('[data-field=project]').fill('上线');
    await page.locator('[data-field=task]').fill('确认保存边界');
    await page.locator('[data-action=confirm-handoff]').click();
    await page.locator('.worksite-viewport').waitFor();
    await saved(page);
    await page.locator('[data-action=results]').filter({ visible: true }).first().click();
    await page.locator('[data-field=result-fact]').fill('刷新后内容保持。');
    await page.locator('[data-action=keep-result]').click();
    await saved(page);
    const workState = await state(page), workId = Object.keys(workState.host.worksite.works)[0];
    check('work result persisted without changing understanding', workState.host.worksite.sessions[workId].results.length === 1 && workState.host.chain.matters[0].understandingVersion === 1);
    await page.goto(base + '/app?view=home'); await page.locator('#capture-input').waitFor();
    await page.getByRole('button', { name: '个人与设置', exact: true }).click();
    check('settings disclose browser scope and data deletion', (await page.locator('.web-dialog').innerText()).includes('清除网站数据会丢失内容'));
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出全部内容', exact: true }).click();
    const download = await downloadPromise;
    const exportPath = path.join(out, 'export.json'); await download.saveAs(exportPath);
    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    check('download contains authoritative saved content', exported.host.chain.matters[0].id === matterId && exported.storage.kind === 'indexeddb');
    await page.locator('.web-dialog input[name=name]').fill('浏览器验证者');
    await page.locator('.web-dialog [type=submit]').click();
    await saved(page);
    check('preferences saved', (await state(page)).host.preferences.displayName === '浏览器验证者');
    await page.goto(base + '/app?view=home');
    await page.locator('#capture-input').waitFor();
    const second = await context.newPage();
    await second.goto(base + '/app'); await second.locator('#capture-input').waitFor();
    await second.locator('#capture-input').fill('另一标签页的新内容'); await saved(second);
    await page.locator('#capture-input').fill('过时标签页试图覆盖');
    await page.locator('.web-status[data-state=error]').waitFor();
    check('cross-tab atomic CAS rejects stale writes', (await state(page)).host.chain.capture.text === '另一标签页的新内容');
    await page.locator('[data-load]').click(); await page.getByRole('button', { name: '载入已保存版本', exact: true }).last().click();
    await saved(page);
    check('conflict recovery loads latest version', await page.locator('#capture-input').inputValue() === '另一标签页的新内容');
    await page.evaluate(() => { window.originalOpen = indexedDB.open.bind(indexedDB); indexedDB.open = () => { throw new DOMException('Simulated quota failure', 'QuotaExceededError'); }; });
    await page.locator('#capture-input').fill('失败的草稿 A'); await page.locator('.web-status[data-state=error]').waitFor();
    await page.locator('#capture-input').fill('继续编辑的草稿 B');
    await page.evaluate(() => { indexedDB.open = window.originalOpen; });
    await page.locator('[data-retry]').click(); await saved(page);
    await page.reload(); await page.locator('#capture-input').waitFor();
    check('storage failure retry preserves newer draft', await page.locator('#capture-input').inputValue() === '继续编辑的草稿 B');
    await second.close();
    const adapter = await page.evaluate(async () => {
      const m = await import('/__test/browser-workspace.mjs');
      const before = await m.readBrowserWorkspace();
      const command = { expectedRevision: before.revision, commandId: 'test-' + crypto.randomUUID(), host: before.host };
      const first = await m.putBrowserWorkspace(command), replay = await m.putBrowserWorkspace(command);
      const changed = structuredClone(command); changed.host.preferences.displayName = 'different';
      let reused; try { await m.putBrowserWorkspace(changed); } catch (error) { reused = error.status; }
      const next = await m.readBrowserWorkspace();
      const outcomes = await Promise.allSettled(['a', 'b'].map(id => m.putBrowserWorkspace({ expectedRevision: next.revision, commandId: 'concurrent-' + id, host: next.host })));
      return { first, replay, reused, winners: outcomes.filter(item => item.status === 'fulfilled').length, conflicts: outcomes.filter(item => item.status === 'rejected' && item.reason.status === 409).length };
    });
    check('command replay is idempotent', adapter.first.revision === adapter.replay.revision && adapter.replay.replayed);
    check('changed command replay rejected', adapter.reused === 409);
    check('concurrent writers have exactly one winner', adapter.winners === 1 && adapter.conflicts === 1);
    const isolated = await browser.newContext(); const isolatedPage = await isolated.newPage();
    await isolatedPage.goto(base + '/app'); await isolatedPage.locator('#capture-input').waitFor();
    check('separate browser profile does not share data', (await state(isolatedPage)).host === null);
    const handoffURL = base + '/app?' + new URLSearchParams({ from: 'deepseek-harness', observationId: 'ci-handoff-1', text: 'CI 验证原始交接，不推断结论。', source: 'CI synthetic fixture', status: 'unconfirmed' });
    await isolatedPage.goto(handoffURL); await isolatedPage.locator('[data-selection=originalText]').waitFor(); await saved(isolatedPage);
    const handed = await state(isolatedPage);
    check('upstream harness handoff preserves literal input without a conclusion', handed.host.chain.matters.length === 1 && handed.host.chain.matters[0].originalText === 'CI 验证原始交接，不推断结论。' && handed.host.chain.matters[0].understanding === '');
    await isolatedPage.reload(); await isolatedPage.locator('[data-selection=originalText]').waitFor();
    await isolatedPage.goto(handoffURL); await isolatedPage.locator('[data-selection=originalText]').waitFor();
    const replayed = await state(isolatedPage);
    check('handoff refresh and replay do not duplicate matter', replayed.host.chain.matters.length === 1 && replayed.host.chain.matters[0].id === handed.host.chain.matters[0].id && !new URL(isolatedPage.url()).searchParams.has('text'));
    await isolated.close();
    await page.reload(); await page.locator('#capture-input').waitFor();
    await page.screenshot({ path: path.join(out, 'browser-home.png') });
    const corrupt = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('trace-portal-workspace-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      await new Promise((resolve, reject) => { const tx = db.transaction('workspace', 'readwrite'); tx.objectStore('workspace').put({ schemaVersion: 999, revision: 10, host: 'do not reset' }, 'current'); tx.oncomplete = resolve; tx.onabort = reject; });
      db.close();
      const m = await import('/__test/browser-workspace.mjs');
      const response = await m.browserWorkspaceRequest('/api/web/workspace');
      return { status: response.status, body: await response.json() };
    });
    check('corrupt record fails without an empty fallback', corrupt.status === 503 && corrupt.body.error.code === 'STORAGE_CORRUPT');
    await page.reload(); await page.locator('.web-status[data-state=error]').waitFor();
    check('corrupt storage blocks UI instead of resetting', await page.locator('#capture-input').count() === 0);
    const failedFirstPaint = await page.evaluate(() => ({
      loadingPosition: getComputedStyle(document.querySelector('.react-route-loading')).position,
      loadingDisplay: getComputedStyle(document.querySelector('.react-route-loading')).display,
      ornamentWidth: document.querySelector('.trace-ambient-orbit').getBoundingClientRect().width,
    }));
    check('failed first paint keeps the shell and ornaments styled', failedFirstPaint.loadingPosition === 'absolute' && failedFirstPaint.loadingDisplay === 'grid' && failedFirstPaint.ornamentWidth > 0 && failedFirstPaint.ornamentWidth < 500, failedFirstPaint);
    check('no workspace data requests leave browser', requests.length === 0);
    check('no page errors', errors.length === 0);
  } catch (error) {
    checks.push({ name: 'run error', passed: false, error: error.stack }); process.exitCode = 1; console.error(error.stack);
    if (page) { await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); fs.writeFileSync(path.join(out, 'failure-dom.txt'), await page.locator('body').innerText()); }
  } finally {
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks, errors, requests }, null, 2));
    await browser?.close(); await new Promise(resolve => server.close(resolve)); console.log('EVIDENCE ' + out);
  }
})();

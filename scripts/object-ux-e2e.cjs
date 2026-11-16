const { chromium } = require('playwright');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const repo = path.resolve(__dirname, '..');
const port = Number(process.env.TRACE_OBJECT_UX_PORT || 54921);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
const base = `http://127.0.0.1:${port}`;
const out = path.join(repo, '.test-results/object-ux', `run-${Date.now()}`);
fs.mkdirSync(out, { recursive: true });
const checks = [], errors = [];
function check(name, condition, detail) {
  checks.push({ name, passed: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`);
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const build = spawnSync(process.execPath, [path.join(repo, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: path.join(repo, 'apps/web'), windowsHide: true, env: { ...process.env, VITE_TRACE_STORAGE: 'browser', TRACE_WEB_OUT_DIR: path.join(out, 'site') }, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: path.join(repo, 'apps/web'), windowsHide: true,
    env: { ...process.env, TRACE_DESKTOP_PORT: String(port), TRACE_WEB_STATE_FILE: path.join(out, 'web.sqlite'), TRACE_WEB_DIST_DIR: path.join(out, 'site') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '', serverError, browser, page;
  server.on('error', error => { serverError = error; });
  server.stdout.on('data', chunk => { log += chunk; });
  server.stderr.on('data', chunk => { log += chunk; });
  try {
    for (let i = 0; i < 300 && !log.includes(`Trace Web: ${base}/`); i++) {
      if (serverError) throw serverError;
      if (server.exitCode !== null) throw new Error(log);
      await wait(100);
    }
    assert.ok(log.includes(`Trace Web: ${base}/`), log);
    browser = await chromium.launch({ executablePath: process.env.TRACE_CHROMIUM_EXECUTABLE || undefined, headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    const settled = async () => { await page.locator('.web-status[data-state=saved]').waitFor(); await page.waitForFunction(() => !document.querySelector('#app').inert); };
    const shot = async name => { await page.screenshot({ path: path.join(out, name + '.png') }); };
    await page.goto(base + '/app');
    await page.locator('#capture-input').fill('对象体验回归：周末把灵感整理成小作品。');
    await page.locator('#capture-form [type=submit]').click();
    await page.locator('[data-selection=originalText]').waitFor(); await settled();
    const matterId = new URL(page.url()).searchParams.get('matter');
    check('write-understanding action names its object', await page.locator('[data-action=understanding]').first().innerText() === '写下我的理解');
    check('append-expression action names its object', await page.locator('[data-action=discussion]').first().innerText() === '补充原话');
    await page.locator('[data-action=understanding]').first().click();
    await page.locator('[data-field=understanding]').waitFor();
    check('understanding editor explains original preservation', (await page.locator('.chain-root').innerText()).includes('原话会保留'));
    await page.goto(base + '/app?view=search&q=' + encodeURIComponent('对象体验回归') + '&kind=expression');
    await page.locator('[data-open]').first().waitFor();
    check('search has its own window title', await page.title() === 'Trace · 搜索');
    await page.locator('[data-open]').first().click();
    await page.locator('.web-dialog[open]').waitFor();
    check('original record is not labelled a revision', await page.locator('#react-dialog-title').innerText() === '当时留下的原话');
    check('search-to-matter resets window title', await page.title() === 'Trace · 一件事', await page.title());
    await shot('01-original-record');
    await page.locator('.web-dialog [aria-label=关闭]').click();
    await page.locator('[data-action=comparison]').first().click();
    await page.locator('.compare-root').waitFor(); await settled();
    check('comparison has its own window title', await page.title() === 'Trace · 找个对照', await page.title());
    await page.locator('.compare-top-return').click();
    await page.locator('.chain-root').waitFor();
    await page.waitForTimeout(300);
    if (await page.locator('.web-dialog[open]').count()) await page.locator('.web-dialog [aria-label=关闭]').click();
    // Only capability display is mocked. Capture, storage, search, record opening
    // and route transitions above execute the real application and isolated IndexedDB store.
    await page.evaluate(() => {
      window.__uxCapabilities = [];
      window.traceNative = { requestCapability: async request => {
        window.__uxCapabilities.push(request.operation);
        if (request.operation === 'setup.status') return { runtime: { connected: true }, project: { connected: false }, codex: { available: true } };
        if (request.operation === 'zhihu.status') return { oauth: { configured: true, status: 'not_authorized' } };
        if (request.operation === 'host.panel.read') return { connected: true, sessions: [], worker: { status: 'disabled' }, proposals: [], policies: [], orchestrations: [], trials: [] };
        throw new Error('Unexpected capability: ' + request.operation);
      } };
    });
    await page.locator('.web-context-menu').getByRole('button', { name: '个人与设置', exact: true }).click();
    await page.locator('.web-codex-setup').waitFor();
    await page.getByText('公开搜索与个人知乎内容分开使用。', { exact: true }).waitFor();
    check('advanced runtime is absent before explicit expansion', await page.locator('.web-runtime-operations').count() === 0);
    check('ordinary settings does not read management panel', !(await page.evaluate(() => window.__uxCapabilities)).includes('host.panel.read'));
    const basicText = await page.locator('.web-dialog').innerText();
    check('ordinary settings avoids internal control terms', !/disabled|runtime-guard|apply|active|发布回执|CapabilityPublisher/.test(basicText));
    await shot('02-basic-settings');
    await page.locator('.web-settings-advanced').scrollIntoViewIfNeeded().catch(() => {});
    await shot('02b-basic-settings-bottom');
    const disclosure = page.getByRole('button', { name: '高级：工作跟随与能力管理', exact: true });
    if (await disclosure.count()) {
      await disclosure.focus(); await page.keyboard.press('Enter');
      await page.locator('.web-runtime-operations').waitFor();
      await page.getByText('未启用', { exact: true }).waitFor();
      check('advanced disclosure expands with keyboard', await disclosure.getAttribute('aria-expanded') === 'true');
      check('management panel reads only after expansion', (await page.evaluate(() => window.__uxCapabilities)).filter(value => value === 'host.panel.read').length === 1);
      check('advanced controls remain available', await page.getByRole('button', { name: '确认执行保护', exact: true }).count() === 1);
      await page.locator('.web-runtime-operations').evaluate(node => node.scrollIntoView({ block: 'start' }));
      await shot('03-advanced-settings');
      await disclosure.click();
      check('advanced disclosure collapses', await page.locator('.web-runtime-operations').count() === 0 && await disclosure.getAttribute('aria-expanded') === 'false');
    } else check('advanced disclosure exists', false);
    await page.locator('.web-dialog [aria-label=关闭]').click();
    check('closing settings retains the matter', new URL(page.url()).searchParams.get('matter') === matterId);
    const state = await page.evaluate(() => new Promise((resolve, reject) => { const open = indexedDB.open('trace-portal-workspace-v1', 1); open.onerror = () => reject(open.error); open.onsuccess = () => { const db = open.result; const read = db.transaction('workspace', 'readonly').objectStore('workspace').get('current'); read.onerror = () => { db.close(); reject(read.error); }; read.onsuccess = () => { const value = read.result; db.close(); resolve(value); }; }; }));
    check('clarity changes do not create understanding or alter original', state.host.chain.matters[0].understanding === '' && state.host.chain.matters[0].originalText === '对象体验回归：周末把灵感整理成小作品。');
    check('no browser runtime errors', errors.length === 0, errors);
  } catch (error) {
    checks.push({ name: 'harness', passed: false, error: error.stack });
    console.error(error.stack);
    if (page) { await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); fs.writeFileSync(path.join(out, 'failure.txt'), await page.locator('body').innerText()); }
  } finally {
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks, errors, log }, null, 2));
    await browser?.close(); server.kill();
    if (checks.some(item => !item.passed)) process.exitCode = 1;
    console.log('EVIDENCE ' + out);
  }
})();

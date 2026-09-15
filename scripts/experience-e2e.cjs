const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const port = Number(process.env.TRACE_EXPERIENCE_PORT || 4191);
const base = `http://127.0.0.1:${port}`;
const repo = path.resolve(__dirname, '..');
const out = path.join(repo, '.test-results', 'experience', `run-${Date.now()}`);
const review = path.join(repo, 'apps', 'web', '.impeccable', 'review');
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(review, { recursive: true });
const checks = [], errors = [];
const check = (name, value, detail = {}) => { assert.ok(value, name); checks.push({ name, passed: true, ...detail }); console.log(`PASS ${name}`); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const server = spawn(process.execPath, ['server.mjs'], { cwd: path.join(repo, 'apps', 'web'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TRACE_DESKTOP_PORT: String(port), TRACE_WEB_DIST_DIR: path.join(repo, 'apps', 'web', 'dist-vercel') } });
  let log = ''; server.stdout.on('data', (chunk) => { log += chunk; }); server.stderr.on('data', (chunk) => { log += chunk; });
  let browser, page;
  try {
    for (let i = 0; i < 100 && !log.includes(`Trace Web: ${base}/`); i += 1) { if (server.exitCode !== null) throw new Error(log); await sleep(100); }
    if (!log.includes(`Trace Web: ${base}/`)) throw new Error(`server did not start: ${log}`);
    browser = await chromium.launch({ executablePath: process.env.TRACE_CHROMIUM_EXECUTABLE || undefined, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    const capabilityRequests = [];
    page.on('request', (request) => { if (/\/api\/zhihu\//.test(request.url())) capabilityRequests.push(request.url()); });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) => {
      const expectedEmptyVideoProbe = request.method() === 'HEAD' && new URL(request.url()).pathname === '/video/trace-demo.mp4';
      if (!expectedEmptyVideoProbe) errors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText || 'request failed'}`);
    });

    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#opening-title').waitFor();
    check('root opens the product thesis', /让值得思考的想法/.test(await page.locator('#opening-title').innerText()));
    const renderedIntroduction = await page.evaluate(() => ({
      openingBackground: getComputedStyle(document.querySelector('.intro-hero')).backgroundColor,
      headingFontSize: Number.parseFloat(getComputedStyle(document.querySelector('#opening-title')).fontSize),
      criticalImages: [...document.querySelectorAll('img[data-critical="true"]')].map((image) => ({ src: image.getAttribute('src'), complete: image.complete, width: image.naturalWidth })),
    }));
    check('introduction route stylesheet is applied', renderedIntroduction.headingFontSize >= 48, renderedIntroduction);
    check('introduction evidence images are loaded', renderedIntroduction.criticalImages.every((image) => image.complete && image.width > 0), renderedIntroduction);
    check('introduction links complete demo, personal space and video', await page.locator('a[href="/app/demo"]').count() >= 2 && await page.locator('a[href="/app"]').count() >= 1 && await page.locator('a[href="/video"]').count() >= 2);
    await page.locator('.format-step').nth(2).click();
    check('form-factor interaction grows from the quiet entry to a saved bubble', await page.locator('.format-preview').getAttribute('data-stage') === 'bubble');
    await page.locator('.thinking-tabs button').nth(2).click();
    check('Zhihu thinking journey exposes relation-aware comparison', await page.locator('.thinking-panel').getAttribute('data-stage') === 'compare' && await page.locator('.sample-results article').count() === 3);
    await page.locator('.work-loop-nav button').nth(3).click();
    check('work journey reaches user-confirmed understanding revision', await page.locator('.work-copy').getByText('确认以后', { exact: false }).count() === 1);
    await page.evaluate(() => scrollTo(0, 0));
    if (!process.env.TRACE_SKIP_SCREENSHOTS) await page.screenshot({ path: path.join(review, 'desktop.png'), animations: 'disabled' });

    await page.setViewportSize({ width: 2048, height: 1088 });
    await page.goto(`${base}/app/demo`, { waitUntil: 'domcontentloaded' });
    await page.locator('.demo-guide-toggle').waitFor({ timeout: 10000 });
    await page.locator('.web-status[data-state=saved]').waitFor({ timeout: 10000 });
    await page.locator('#capture-source').waitFor({ timeout: 10000 });
    const demoHome = await page.evaluate(() => {
      const box = (selector) => { const rect = document.querySelector(selector)?.getBoundingClientRect(); return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null; };
      const intersects = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const guide = box('.demo-guide');
      const bubbles = [...document.querySelectorAll('.thought-bubble[data-matter-id]')].map((item) => { const rect = item.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; });
      return {
        matters: bubbles.length,
        guideOpen: document.querySelector('.demo-guide')?.dataset.open,
        guideOverlapsBubble: bubbles.some((bubble) => intersects(guide, bubble)),
        source: document.querySelector('#capture-source')?.value,
        agent: document.querySelector('#capture-agent')?.value,
      };
    });
    check('complete demo home presents four canonical matters without guide overlap', demoHome.matters === 4 && demoHome.guideOpen === 'false' && !demoHome.guideOverlapsBubble, demoHome);
    check('complete demo labels the selected synthetic capability path', demoHome.source === 'zhihu' && demoHome.agent === 'codex-harness' && await page.getByText('演示数据 · 未联网', { exact: true }).count() === 1, demoHome);
    if (!process.env.TRACE_SKIP_SCREENSHOTS) await page.screenshot({ path: path.join(review, 'demo-home-desktop.png'), animations: 'disabled' });
    await page.locator('.demo-guide-toggle').click();
    const actionButtons = page.locator('.demo-guide nav button');
    check('complete demo exposes all six actions', await actionButtons.count() === 6);
    const expectations = [
      ['留下一点', '.chain-root', '第二大脑'],
      ['从这里接着', '.chain-root', '几周后'],
      ['找个对照', '.compare-root', '持续项目里的另一种情况'],
      ['我的理解', '.chain-root', '六个动作的数据'],
      ['带去用', '.worksite-viewport', '验证六个动作'],
      ['结果回来', '.worksite-viewport', '[data-field=result-fact]'],
    ];
    for (const [label, selector, text] of expectations) {
      await page.locator('.demo-guide nav button', { hasText: label }).click();
      await page.locator(selector).waitFor({ timeout: 10000 });
      if (text.startsWith('[')) {
        const field = page.locator(text); await field.waitFor({ timeout: 10000 });
        check(`demo action exposes the saved result fact: ${label}`, /六个动作现在都有可打开的记录/.test(await field.inputValue()));
      } else await page.getByText(text, { exact: false }).first().waitFor({ timeout: 10000 });
      check(`demo action renders its data: ${label}`, true);
    }
    if (!process.env.TRACE_SKIP_SCREENSHOTS) await page.screenshot({ path: path.join(out, 'demo-results-desktop.png'), animations: 'disabled' });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/app`, { waitUntil: 'domcontentloaded' });
    await page.locator('#capture-input').waitFor({ timeout: 10000 });
    check('personal space does not inherit demo records', await page.locator('.thought-bubble[data-matter-id]').count() === 0);
    const sourceSelect = page.locator('#capture-source');
    const agentSelect = page.locator('#capture-agent');
    const optionShape = await page.evaluate(() => ({ source: [...document.querySelectorAll('#capture-source option')].map((item) => item.textContent), agent: [...document.querySelectorAll('#capture-agent option')].map((item) => item.textContent) }));
    check('home composer exposes one source dropdown and one Agent dropdown', await sourceSelect.isVisible() && await agentSelect.isVisible() && JSON.stringify(optionShape.source) === JSON.stringify(['不联网', '知乎搜索', '全网搜索']) && JSON.stringify(optionShape.agent) === JSON.stringify(['不交给 Agent', 'Codex 原生', 'Codex Harness', '自定义 Agent']), optionShape);
    const capabilityCallsBefore = capabilityRequests.length;
    await sourceSelect.selectOption('zhihu');
    await agentSelect.selectOption('codex-native');
    check('selecting source and Agent does not call external capability APIs or open the old dashboard', capabilityRequests.length === capabilityCallsBefore && await page.locator('.web-connection-center').count() === 0 && await page.locator('.web-dialog[open]').count() === 0, { capabilityCallsBefore, capabilityCallsAfter: capabilityRequests.length });
    await page.locator('#capture-input').fill('测试一次从知乎问题到 Codex 原生交接的完整输入路径');
    await page.locator('#capture-input').press('Enter');
    await page.locator('.chain-handoff-layout').waitFor({ timeout: 10000 });
    const handoffFields = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.chain-destination [data-field]')].map((input) => [input.dataset.field, input.value])));
    check('capture saves first and opens a prefilled, unconnected Codex handoff', handoffFields.agent === 'Codex 原生' && handoffFields.project === 'Trace Web' && /接续：测试一次/.test(handoffFields.task) && capabilityRequests.length === capabilityCallsBefore, handoffFields);
    await page.goto(`${base}/app`, { waitUntil: 'domcontentloaded' });
    await page.locator('.profile-button').waitFor({ timeout: 10000 });
    await page.locator('.profile-button').click();
    await page.locator('.web-dialog[open] .web-zhihu-auth').waitFor({ timeout: 10000 });
    await page.locator('.web-auth-error').waitFor({ timeout: 10000 });
    const zhihuDialogText = await page.locator('.web-dialog').innerText();
    check('personal settings separates Zhihu account data from public search', await page.getByRole('button', { name: '连接我的知乎' }).isDisabled() && /我的知乎内容/.test(zhihuDialogText) && /公开搜索与这项设置彼此独立/.test(zhihuDialogText) && !/游客|Unexpected token|SyntaxError/.test(zhihuDialogText));

    await page.goto(`${base}/video`, { waitUntil: 'networkidle' });
    await page.locator('#video-title').waitFor();
    check('video route is reserved and explains the expected asset', await page.getByText('视频位置已经准备好', { exact: false }).count() === 1);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/app/demo`, { waitUntil: 'networkidle' });
    await page.locator('#capture-input').waitFor();
    const mobileHome = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, controls: [...document.querySelectorAll('.capture-select')].map((element) => ({ height: element.getBoundingClientRect().height, value: element.querySelector('select')?.value, clientWidth: element.querySelector('select')?.clientWidth, scrollWidth: element.querySelector('select')?.scrollWidth })) }));
    check('mobile home keeps both capability targets stable, readable and reachable', mobileHome.scrollWidth <= mobileHome.innerWidth + 1 && mobileHome.controls.length === 2 && mobileHome.controls.every((control) => control.height >= 44 && control.scrollWidth <= control.clientWidth + 1), mobileHome);
    if (!process.env.TRACE_SKIP_SCREENSHOTS) await page.screenshot({ path: path.join(review, 'demo-home-mobile.png'), animations: 'disabled' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#opening-title').waitFor();
    const mobile = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, header: document.querySelector('.site-header')?.getBoundingClientRect().height }));
    check('mobile introduction has no horizontal overflow', mobile.scrollWidth <= mobile.innerWidth + 1, mobile);
    if (!process.env.TRACE_SKIP_SCREENSHOTS) await page.screenshot({ path: path.join(review, 'mobile.png'), animations: 'disabled' });
    check('no page errors across introduction, demo, personal and video routes', errors.length === 0, { errors });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ base, checks, errors, serverLog: log }, null, 2));
    console.log(`DONE ${out}`);
  } catch (error) {
    console.error(error.stack || error); checks.push({ name: 'run error', passed: false, error: error.stack || String(error) });
    if (page && !process.env.TRACE_SKIP_SCREENSHOTS) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => undefined);
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ base, checks, errors, serverLog: log }, null, 2));
    process.exitCode = 1;
  } finally { await browser?.close(); server.kill(); console.log(`EVIDENCE ${out}`); }
})();

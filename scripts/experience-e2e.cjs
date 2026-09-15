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
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) => {
      const expectedEmptyVideoProbe = request.method() === 'HEAD' && new URL(request.url()).pathname === '/video/trace-demo.mp4';
      if (!expectedEmptyVideoProbe) errors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText || 'request failed'}`);
    });

    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#opening-title').waitFor();
    check('root opens product interaction introduction', /为什么停在这里/.test(await page.locator('#opening-title').innerText()));
    const renderedIntroduction = await page.evaluate(() => ({
      openingBackground: getComputedStyle(document.querySelector('.opening')).backgroundColor,
      headingFontSize: Number.parseFloat(getComputedStyle(document.querySelector('#opening-title')).fontSize),
      criticalImages: [...document.querySelectorAll('.origin-page, .origin-overlay')].map((image) => ({ src: image.getAttribute('src'), complete: image.complete, width: image.naturalWidth })),
    }));
    check('introduction route stylesheet is applied', renderedIntroduction.openingBackground !== 'rgba(0, 0, 0, 0)' && renderedIntroduction.headingFontSize >= 48, renderedIntroduction);
    check('introduction evidence images are loaded', renderedIntroduction.criticalImages.every((image) => image.complete && image.width > 0), renderedIntroduction);
    check('introduction links complete demo, personal space and video', await page.locator('a[href="/app/demo"]').count() >= 2 && await page.locator('a[href="/app"]').count() >= 1 && await page.locator('a[href="/video"]').count() >= 2);
    await page.locator('.origin-controls button').nth(2).click();
    check('introduction source interaction changes the real overlay state', await page.locator('.origin-overlay[data-kind=receipt]').getAttribute('data-visible') === 'true');
    await page.screenshot({ path: path.join(review, 'desktop.png'), animations: 'disabled' });

    await page.goto(`${base}/app/demo`, { waitUntil: 'domcontentloaded' });
    await page.locator('.demo-guide').waitFor({ timeout: 10000 });
    await page.locator('.web-status[data-state=saved]').waitFor({ timeout: 10000 });
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
    await page.screenshot({ path: path.join(out, 'demo-results-desktop.png'), animations: 'disabled' });

    await page.goto(`${base}/app`, { waitUntil: 'domcontentloaded' });
    await page.locator('#capture-input').waitFor({ timeout: 10000 });
    check('personal space does not inherit demo records', await page.locator('.thought-bubble[data-matter-id]').count() === 0);
    const zhihuShortcut = page.locator('.capability-pill[data-action=zhihu]');
    const agentShortcut = page.locator('.capability-pill[data-action=agent]');
    check('home composer exposes Zhihu and native Agent choices', await zhihuShortcut.isVisible() && await agentShortcut.isVisible());
    await zhihuShortcut.click();
    await page.locator('.web-dialog[open] .web-zhihu-auth').waitFor({ timeout: 10000 });
    await page.locator('.web-auth-error').waitFor({ timeout: 10000 });
    const zhihuDialogText = await page.locator('.web-dialog').innerText();
    check('Zhihu search and account access both expose their real boundaries', await page.getByRole('button', { name: '授权连接知乎' }).isDisabled() && /知乎 \/ 全网搜索/.test(zhihuDialogText) && /尚未直连/.test(zhihuDialogText) && /当前 Web 不会联网搜索/.test(zhihuDialogText) && /当前环境未启用知乎接口/.test(zhihuDialogText) && !/Unexpected token|SyntaxError/.test(zhihuDialogText));
    await page.getByRole('button', { name: '关闭' }).click();
    check('closing connection center restores trigger focus', await zhihuShortcut.evaluate((element) => document.activeElement === element));
    await agentShortcut.click();
    const agentDialogText = await page.locator('.web-dialog').innerText();
    check('native Agent choice names Codex without faking a live connection', /Codex/.test(agentDialogText) && /尚未直连/.test(agentDialogText) && /不会直接创建 Codex 任务/.test(agentDialogText));
    await page.getByRole('button', { name: '关闭' }).click();
    await page.locator('.profile-button').click();
    await page.locator('.web-dialog[open] .web-zhihu-auth').waitFor({ timeout: 10000 });
    check('personal settings keeps fail-closed Zhihu authorization controls', await page.getByRole('button', { name: '授权连接知乎' }).isDisabled());

    await page.goto(`${base}/video`, { waitUntil: 'networkidle' });
    await page.locator('#video-title').waitFor();
    check('video route is reserved and explains the expected asset', await page.getByText('视频位置已经准备好', { exact: false }).count() === 1);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/app`, { waitUntil: 'networkidle' });
    await page.locator('#capture-input').waitFor();
    const mobileHome = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, buttons: [...document.querySelectorAll('.capability-pill')].map((element) => element.getBoundingClientRect().height) }));
    check('mobile home keeps both capability targets stable and reachable', mobileHome.scrollWidth <= mobileHome.innerWidth + 1 && mobileHome.buttons.length === 2 && mobileHome.buttons.every((height) => height >= 44), mobileHome);
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#opening-title').waitFor();
    const mobile = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, header: document.querySelector('.site-header')?.getBoundingClientRect().height }));
    check('mobile introduction has no horizontal overflow', mobile.scrollWidth <= mobile.innerWidth + 1, mobile);
    await page.screenshot({ path: path.join(review, 'mobile.png'), animations: 'disabled' });
    check('no page errors across introduction, demo, personal and video routes', errors.length === 0, { errors });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ base, checks, errors, serverLog: log }, null, 2));
    console.log(`DONE ${out}`);
  } catch (error) {
    console.error(error.stack || error); checks.push({ name: 'run error', passed: false, error: error.stack || String(error) });
    if (page) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => undefined);
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ base, checks, errors, serverLog: log }, null, 2));
    process.exitCode = 1;
  } finally { await browser?.close(); server.kill(); console.log(`EVIDENCE ${out}`); }
})();

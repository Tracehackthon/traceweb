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
    page.on('request', (request) => { if (/\/api\/(?:zhihu|search)\//.test(request.url())) capabilityRequests.push(request.url()); });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) => {
      const expectedEmptyVideoProbe = request.method() === 'HEAD' && new URL(request.url()).pathname === '/video/trace-demo.mp4';
      const expectedVideoNavigationAbort = request.method() === 'GET' && new URL(request.url()).pathname === '/video/trace-demo.mp4' && request.failure()?.errorText === 'net::ERR_ABORTED';
      if (!expectedEmptyVideoProbe && !expectedVideoNavigationAbort) errors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText || 'request failed'}`);
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
    check('complete demo makes cached Zhihu participation visible without a visitor search', demoHome.source === 'zhihu' && demoHome.agent === 'codex-harness' && await page.getByText('知乎参与这件事', { exact: true }).count() === 1 && await page.getByText('2 份公开来源 · 原现场与对照', { exact: true }).count() === 1 && capabilityRequests.length === 0, demoHome);
    if (!process.env.TRACE_SKIP_SCREENSHOTS) await page.screenshot({ path: path.join(review, 'demo-home-desktop.png'), animations: 'disabled' });
    await page.locator('.demo-guide-toggle').click();
    const actionButtons = page.locator('.demo-guide nav button');
    check('complete demo exposes all six actions', await actionButtons.count() === 6);
    const expectations = [
      ['留下一点', '.chain-root', '收藏动作和回顾动作之间没有建立联系'],
      ['从这里接着', '.chain-root', '几周后'],
      ['找个对照', '.compare-root', '你收藏的东西，24小时用不上就该删'],
      ['我的理解', '.chain-root', '六个动作的数据'],
      ['带去用', '.worksite-viewport', '验证六个动作'],
      ['结果回来', '.worksite-viewport', '[data-field=result-fact]'],
    ];
    for (const [label, selector, text] of expectations) {
      if (!await page.locator('.demo-guide nav button').first().isVisible().catch(() => false)) await page.locator('.demo-guide-toggle').click();
      await page.locator('.demo-guide nav button', { hasText: label }).click();
      await page.locator(selector).waitFor({ timeout: 10000 });
      if (label === '留下一点') {
        await page.locator('.chain-source-evidence').click();
        const sourceLink = page.getByRole('link', { name: '打开知乎原文' });
        await sourceLink.waitFor({ timeout: 10000 });
        check('demo source exposes real Zhihu author, summary boundary and canonical link', /拾光者/.test(await page.locator('.chain-modal').innerText()) && (await sourceLink.getAttribute('href')) === 'https://www.zhihu.com/question/585059015/answer/2076093417847898217');
        await page.locator('.chain-modal [data-action="close-modal"]').click();
      }
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
    check('selecting source and Agent stays a local intent until capture', capabilityRequests.length === capabilityCallsBefore && await page.locator('.web-connection-center').count() === 0 && await page.locator('.web-dialog[open]').count() === 0, { capabilityCallsBefore, capabilityCallsAfter: capabilityRequests.length });
    await page.route('**/api/search/zhihu', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ protocol_version: 1, provider: 'zhihu', source: 'zhihu', query: '测试一次从知乎问题到 Codex 原生交接的完整输入路径', content_mode: 'summary', saved_to_trace: false, items: [{ id: 'external:e2e-zhihu-source', provider: 'zhihu', source: 'zhihu', title: '如何把公开经验带回正在思考的问题', author: '知乎答主', url: 'https://www.zhihu.com/question/1/answer/2', excerpt: '公开内容先作为可核对的材料，再由用户决定是否保留以及建立什么关系。', content_id: 'answer-2', content_type: 'Answer', vote_up_count: 27, comment_count: 4, authority_level: '2', edited_at: '2026-09-14T16:00:00.000Z', content_mode: 'summary', fetched_at: '2026-09-15T00:00:00.000Z' }] }) });
    });
    await page.locator('#capture-input').fill('测试一次从知乎问题到 Codex 原生交接的完整输入路径');
    await page.locator('#capture-input').press('Enter');
    await page.locator('.web-capability-flow').waitFor({ timeout: 10000 });
    await page.getByText('如何把公开经验带回正在思考的问题', { exact: true }).waitFor({ timeout: 10000 });
    if (!process.env.TRACE_SKIP_SCREENSHOTS) await page.screenshot({ path: path.join(review, 'capability-desktop.png'), animations: 'disabled' });
    const readPersonalWorkspace = () => page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('trace-portal-workspace-v1');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('workspace', 'readonly');
        const current = tx.objectStore('workspace').get('current');
        current.onerror = () => reject(current.error);
        current.onsuccess = () => { resolve(current.result); db.close(); };
      };
    }));
    const beforeKeep = await readPersonalWorkspace();
    check('capture saves the original before search while the returned source stays pending', beforeKeep.host.chain.sources.length === 0 && capabilityRequests.length === capabilityCallsBefore + 1 && /27 赞同 · 4 评论/.test(await page.locator('.web-capability-source').innerText()), { revision: beforeKeep.revision, calls: capabilityRequests.length });
    await page.getByRole('button', { name: '保留到这件事' }).click();
    await page.getByRole('button', { name: '已保留到这件事' }).waitFor({ timeout: 10000 });
    const afterKeep = await readPersonalWorkspace();
    const keptMatter = afterKeep.host.chain.matters.find((item) => item.originalText === '测试一次从知乎问题到 Codex 原生交接的完整输入路径');
    const keptSource = afterKeep.host.chain.sources.find((item) => item.id === 'external:e2e-zhihu-source');
    check('explicit keep persists Zhihu provenance without inventing a relation or understanding', keptSource?.ownerMatterId === keptMatter?.id && keptSource.voteUpCount === 27 && keptMatter.sourceIds.includes(keptSource.id) && (keptMatter.links || []).length === 0 && keptMatter.understanding === '', { keptMatterId: keptMatter?.id, sourceId: keptSource?.id });
    check('ordinary Web explains the native Agent boundary instead of issuing a fake run', /网页不会(?:读取本机登录或密钥|接触你的登录信息)/.test(await page.locator('.web-capability-flow').innerText()) && await page.getByRole('button', { name: '开始一次 Agent 讨论' }).isDisabled());
    await page.getByRole('button', { name: '完成，回到这件事' }).click();
    await page.locator('.chain-handoff-layout').waitFor({ timeout: 10000 });
    const handoffFields = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.chain-handoff-side [data-field]')].map((input) => [input.dataset.field, input.value])));
    check('capture returns to its prefilled Codex handoff without exposing system fields', /接续：测试一次/.test(handoffFields.task) && !('agent' in handoffFields) && !('project' in handoffFields), handoffFields);
    await page.goto(`${base}/app`, { waitUntil: 'domcontentloaded' });
    await page.locator('.profile-button').waitFor({ timeout: 10000 });
    await page.locator('.profile-button').click();
    await page.locator('.web-dialog[open] .web-zhihu-auth').waitFor({ timeout: 10000 });
    await page.locator('.web-auth-error').waitFor({ timeout: 10000 });
    const zhihuDialogText = await page.locator('.web-dialog').innerText();
    check('personal settings separates Zhihu account data from public search', await page.getByRole('button', { name: '连接我的知乎' }).isDisabled() && /我的知乎内容/.test(zhihuDialogText) && /公开搜索与这项设置彼此独立/.test(zhihuDialogText) && !/游客|Unexpected token|SyntaxError/.test(zhihuDialogText));

    await page.goto(`${base}/video`, { waitUntil: 'networkidle' });
    await page.locator('#video-title').waitFor();
    const publishedVideo = await page.locator('video').evaluate(async (element) => {
      if (element.readyState === 0) await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('video metadata timeout')), 10000);
        element.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve(); }, { once: true });
        element.addEventListener('error', () => { clearTimeout(timer); reject(element.error || new Error('video metadata failed')); }, { once: true });
        element.load();
      });
      return { source: element.querySelector('source')?.src, poster: element.poster, controls: element.controls, duration: element.duration, width: element.videoWidth, height: element.videoHeight };
    });
    check('video route publishes the real Trace desktop recording', publishedVideo.source?.endsWith('/video/trace-demo.mp4') && publishedVideo.poster?.endsWith('/video/trace-demo-poster.jpg') && publishedVideo.controls && publishedVideo.duration > 41 && publishedVideo.duration < 42 && publishedVideo.width === 1920 && publishedVideo.height === 1080, publishedVideo);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/app`, { waitUntil: 'domcontentloaded' });
    await page.locator('#capture-input').waitFor();
    await page.locator('#capture-source').selectOption('zhihu');
    await page.locator('#capture-agent').selectOption('none');
    await page.locator('#capture-input').fill('移动端也要能看清知乎返回的公开来源');
    await page.locator('#capture-input').press('Enter');
    await page.locator('.web-capability-source').waitFor({ timeout: 10000 });
    const mobileCapability = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, dialog: document.querySelector('.web-dialog')?.getBoundingClientRect().toJSON() }));
    check('mobile capability result stays within the viewport', mobileCapability.scrollWidth <= mobileCapability.innerWidth + 1 && mobileCapability.dialog?.width <= mobileCapability.innerWidth, mobileCapability);
    if (!process.env.TRACE_SKIP_SCREENSHOTS) await page.screenshot({ path: path.join(review, 'capability-mobile.png'), animations: 'disabled' });
    await page.goto(`${base}/app/demo`, { waitUntil: 'networkidle' });
    await page.locator('#capture-input').waitFor();
    const mobileHome = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, controls: [...document.querySelectorAll('.capture-select')].map((element) => ({ height: element.getBoundingClientRect().height, value: element.querySelector('select')?.value, clientWidth: element.querySelector('select')?.clientWidth, scrollWidth: element.querySelector('select')?.scrollWidth })) }));
    check('mobile home keeps both capability targets stable, readable and reachable', mobileHome.scrollWidth <= mobileHome.innerWidth + 1 && mobileHome.controls.length === 2 && mobileHome.controls.every((control) => control.height >= 44 && control.scrollWidth <= control.clientWidth + 1), mobileHome);
    if (!process.env.TRACE_SKIP_SCREENSHOTS) await page.screenshot({ path: path.join(review, 'demo-home-mobile.png'), animations: 'disabled' });
    await page.locator('.capture-demo-state').click();
    await page.locator('.chain-source-evidence').click();
    const mobileSourceModal = await page.locator('.chain-modal').boundingBox();
    check('mobile Zhihu source opens as a readable native-size sheet', Boolean(mobileSourceModal && mobileSourceModal.width >= 350 && mobileSourceModal.height >= 430), mobileSourceModal);
    const chromeBehindModal = await page.evaluate(() => [...document.querySelectorAll('.demo-guide,.web-status,.web-context-menu,.web-continuity')].every((element) => getComputedStyle(element).opacity === '0' && getComputedStyle(element).pointerEvents === 'none'));
    check('source sheet removes competing app chrome while open', chromeBehindModal);
    if (!process.env.TRACE_SKIP_SCREENSHOTS) await page.screenshot({ path: path.join(review, 'demo-source-mobile.png'), animations: 'disabled' });
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

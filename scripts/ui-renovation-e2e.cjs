const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const repo = path.resolve(__dirname, '..');
const webRoot = path.join(repo, 'apps', 'web');
const port = Number(process.env.TRACE_UI_PORT || 4186);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('TRACE_UI_PORT must be an integer from 1024 to 65535');
const base = `http://127.0.0.1:${port}`;
const runDir = path.join(repo, '.test-results', 'ui-renovation', `run-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });
const db = path.join(runDir, 'web.sqlite');
const checks = [];
const measurements = {};
const pageErrors = [];
let server;
let browser;
let serverLog = '';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (name, value, details = {}) => {
  assert.ok(value, name);
  checks.push({ name, passed: true, ...details });
  console.log(`PASS ${name}`);
};

async function waitForServer() {
  let error;
  for (let i = 0; i < 120; i += 1) {
    if (error) throw error;
    if (server.exitCode !== null) throw new Error(`isolated server exited: ${serverLog}`);
    if (serverLog.includes(`Trace Web: ${base}/`)) return;
    await sleep(100);
  }
  throw new Error(`isolated server did not start: ${serverLog}`);
}

async function pageFor(context, viewport = { width: 1440, height: 900 }) {
  const page = await context.newPage({ viewport });
  page.on('pageerror', (error) => pageErrors.push({ url: page.url(), message: error.message }));
  return page;
}

async function waitHome(page) {
  await page.locator('#capture-input').waitFor({ timeout: 10000 });
  await page.locator('.react-route-root[data-route=home]').waitFor({ timeout: 10000 });
}

async function waitMatters(page) {
  await page.locator('.matters-shell').waitFor({ timeout: 10000 });
  await page.locator('.react-route-root[data-route=matters]').waitFor({ timeout: 10000 });
}

async function startSamples(page) {
  await page.evaluate(() => {
    window.__traceUiSamples = [];
    window.__traceUiSampler = window.setInterval(() => {
      const app = document.querySelector('#app');
      const host = document.querySelector('.react-route-host');
      window.__traceUiSamples.push({
        t: performance.now(),
        appChildren: app?.childElementCount ?? -1,
        hostChildren: host?.childElementCount ?? -1,
        routes: [...(host?.children || [])].map((element) => element.dataset.route || element.className),
      });
    }, 16);
  });
}

async function stopSamples(page) {
  return page.evaluate(() => {
    window.clearInterval(window.__traceUiSampler);
    const rows = window.__traceUiSamples || [];
    delete window.__traceUiSampler;
    delete window.__traceUiSamples;
    return rows;
  });
}

async function resourceStats(page) {
  return page.evaluate(() => window.__traceResourceStats?.() || null);
}

async function state() {
  const response = await fetch(`${base}/api/web/workspace`);
  if (!response.ok) throw new Error(`workspace read failed: ${response.status}`);
  return response.json();
}

async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(runDir, name), animations: 'disabled' });
}

async function run() {
  server = spawn(process.execPath, ['server.mjs'], {
    cwd: webRoot,
    env: { ...process.env, TRACE_DESKTOP_PORT: String(port), TRACE_WEB_STATE_FILE: db },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });
  await waitForServer();
  browser = await chromium.launch({ executablePath: process.env.TRACE_CHROMIUM_EXECUTABLE || undefined, headless: true });

  // Cold deep-link and the initial 1440×900 visual surface.
  const coldContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const cold = await pageFor(coldContext);
  await cold.goto(`${base}/?view=home`, { waitUntil: 'domcontentloaded' });
  await waitHome(cold);
  const coldShape = await cold.evaluate(() => ({
    appChildren: document.querySelector('#app')?.childElementCount || 0,
    hostChildren: document.querySelector('.react-route-host')?.childElementCount || 0,
    hostHeight: document.querySelector('.react-route-host')?.getBoundingClientRect().height || 0,
  }));
  check('cold deep link has a mounted non-empty shell', coldShape.appChildren > 0 && coldShape.hostChildren > 0 && coldShape.hostHeight > 0, { coldShape });
  await shot(cold, 'cold-home-1440.png');

  const deepContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const deep = await pageFor(deepContext);
  await deep.goto(`${base}/?view=matters`, { waitUntil: 'domcontentloaded' });
  await waitMatters(deep);
  check('cold matters deep link keeps empty data honest', await deep.locator('.matters-empty').count() === 1 && await deep.locator('.matters-shell').getAttribute('data-demo') !== 'true');
  await shot(deep, 'cold-matters-1280.png');
  await deepContext.close();

  // A deliberately slow critical route stylesheet proves the previous screen
  // remains mounted until the incoming screen is ready.
  let delayedStyleRequests = 0;
  await cold.route('**/assets/matters-*.css', async (route) => {
    delayedStyleRequests += 1;
    await sleep(460);
    await route.continue();
  });
  await startSamples(cold);
  const transitionStarted = Date.now();
  await cold.locator('.prototype-caption[data-action=matters]').click();
  await waitMatters(cold);
  const transitionSamples = await stopSamples(cold);
  measurements.slowImageTransitionMs = Date.now() - transitionStarted;
  measurements.slowImageRequests = delayedStyleRequests;
  measurements.slowImageSamples = transitionSamples.length;
  measurements.slowImageBlankFrames = transitionSamples.filter((row) => row.appChildren === 0 || row.hostChildren === 0).length;
  check('slow route style keeps the previous screen mounted', delayedStyleRequests > 0 && transitionSamples.length > 4 && measurements.slowImageBlankFrames === 0, {
    requests: delayedStyleRequests,
    samples: transitionSamples.length,
    blankFrames: measurements.slowImageBlankFrames,
  });
  await cold.unroute('**/assets/matters-*.css');
  await shot(cold, 'matters-after-slow-image-1440.png');

  // Warm revisit uses the same image/font cache and does not grow dynamic
  // FontFace families.
  await cold.locator('.matters-brand').click();
  await waitHome(cold);
  await cold.evaluate(() => document.fonts.ready);
  const warmBefore = await resourceStats(cold);
  const facesBefore = await cold.evaluate(() => [...document.fonts].map((font) => font.family).filter((family) => /^Trace (Home|Matters|Chain|Compare|Worksite)/.test(family)).sort());
  await cold.locator('.prototype-caption[data-action=matters]').click();
  await waitMatters(cold);
  await cold.evaluate(() => document.fonts.ready);
  const warmAfter = await resourceStats(cold);
  const facesAfter = await cold.evaluate(() => [...document.fonts].map((font) => font.family).filter((family) => /^Trace (Home|Matters|Chain|Compare|Worksite)/.test(family)).sort());
  measurements.warmStats = { before: warmBefore, after: warmAfter };
  measurements.dynamicFontFamilies = { before: facesBefore, after: facesAfter };
  check('warm revisit reuses image/font resources', warmBefore && warmAfter && warmAfter.imageHits > warmBefore.imageHits && facesAfter.length === facesBefore.length, { warmBefore, warmAfter, facesBefore, facesAfter });
  await cold.setViewportSize({ width: 1280, height: 800 });
  await shot(cold, 'matters-warm-1280.png');
  await cold.setViewportSize({ width: 1680, height: 960 });
  await shot(cold, 'matters-wide-1680.png');
  await cold.locator('.matters-brand').click();
  await waitHome(cold);
  const beforeHover = await state();
  await cold.locator('.home-viewport').hover({ position: { x: 700, y: 500 } });
  await sleep(320);
  const afterHover = await state();
  check('hover and return do not mutate canonical state', beforeHover.revision === afterHover.revision && JSON.stringify(beforeHover.host) === JSON.stringify(afterHover.host));
  await coldContext.close();

  // Rapid A-B-A: the delayed B import/image must not win after returning to A.
  const rapidContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const rapid = await pageFor(rapidContext);
  await rapid.goto(`${base}/?view=home`, { waitUntil: 'domcontentloaded' });
  await waitHome(rapid);
  await rapid.route('**/matters/environment.png', async (route) => { await sleep(650); await route.continue(); });
  await rapid.locator('.prototype-caption[data-action=matters]').click();
  await sleep(40);
  await rapid.evaluate(() => history.back());
  await waitHome(rapid);
  await sleep(850);
  const rapidState = await rapid.evaluate(() => ({ route: document.querySelector('.trace-react-shell')?.dataset.route, matters: document.querySelectorAll('.matters-shell').length, roots: document.querySelectorAll('.react-route-root').length }));
  measurements.rapidABA = rapidState;
  check('rapid A-B-A cancels stale route', rapidState.route === 'home' && rapidState.matters === 0 && rapidState.roots === 1, { rapidState });
  await rapidContext.close();

  // Non-critical image errors must not replace a usable route with a global
  // recovery screen. Decorative assets can fail independently.
  const imageErrorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const imageError = await pageFor(imageErrorContext);
  await imageError.goto(`${base}/?view=home`, { waitUntil: 'domcontentloaded' });
  await waitHome(imageError);
  await imageError.route('**/matters/environment.png', async (route) => route.abort('failed'));
  await imageError.locator('.prototype-caption[data-action=matters]').click();
  await waitMatters(imageError);
  check('image failure preserves a usable route without a global error', await imageError.locator('.react-route-error').count() === 0 && await imageError.locator('.matters-shell').count() === 1 && await imageError.locator('#app').count() === 1);
  await shot(imageError, 'matters-image-error.png');
  await imageError.unroute('**/matters/environment.png');
  await imageErrorContext.close();

  // Dynamic module failure follows the same recoverable path.
  const moduleErrorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const moduleError = await pageFor(moduleErrorContext);
  await moduleError.goto(`${base}/?view=home`, { waitUntil: 'domcontentloaded' });
  await waitHome(moduleError);
  await moduleError.route('**/assets/matters-screen-*.js', async (route) => route.abort('failed'));
  await moduleError.locator('.prototype-caption[data-action=matters]').click();
  await moduleError.locator('.react-route-error').waitFor({ timeout: 10000 });
  check('module failure is recoverable without an empty root', await moduleError.locator('.react-route-error').isVisible() && await moduleError.locator('.home-viewport').count() === 1);
  await moduleError.unroute('**/assets/matters-screen-*.js');
  await moduleError.locator('.react-route-error button').click();
  await waitMatters(moduleError);
  check('module retry mounts the requested route', await moduleError.locator('.matters-shell').count() === 1);
  await moduleErrorContext.close();

  // Reduced motion changes timing, not readiness or the route content.
  const reducedContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const reduced = await pageFor(reducedContext);
  await reduced.goto(`${base}/?view=home`, { waitUntil: 'domcontentloaded' });
  await waitHome(reduced);
  await reduced.locator('.prototype-caption[data-action=matters]').click();
  await waitMatters(reduced);
  const reducedState = await reduced.evaluate(() => ({
    attr: document.documentElement.dataset.reduceMotion,
    route: document.querySelector('.trace-react-shell')?.dataset.route,
    animation: getComputedStyle(document.querySelector('.react-route-root')).animationDuration,
    roots: document.querySelectorAll('.react-route-root').length,
  }));
  measurements.reducedMotion = reducedState;
  check('reduced motion disables movement without a blank frame', reducedState.attr === 'true' && reducedState.route === 'matters' && reducedState.roots === 1 && Number.parseFloat(reducedState.animation) <= 0.001, { reducedState });
  await reducedContext.close();

  // Two submit events in the same task still create one canonical matter.
  const submitContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const submit = await pageFor(submitContext);
  await submit.goto(`${base}/?view=home`, { waitUntil: 'domcontentloaded' });
  await waitHome(submit);
  await submit.locator('#capture-input').fill('双击提交只保留一件事');
  await submit.locator('#capture-form').evaluate((form) => { form.requestSubmit(); form.requestSubmit(); });
  await submit.locator('[data-selection=originalText]').waitFor({ timeout: 10000 });
  await sleep(500);
  const submitState = await state();
  check('duplicate submit does not duplicate mutation', submitState.host.chain.matters.length === 1);

  // A real persisted matter wakes locally first.  Only an explicit action in
  // that expanded card is allowed to enter the canonical chain/work route.
  const bubbleActions = [
    ['discuss', 'discussion'],
    ['source', 'resume'],
    ['work', 'handoff'],
  ];
  const bubbleEvidence = [];
  for (const [action, expectedScreen] of bubbleActions) {
    await submit.goto(`${base}/?view=home`, { waitUntil: 'domcontentloaded' });
    await waitHome(submit);
    const bubble = submit.locator('.thought-bubble[data-matter-id]').first();
    await bubble.waitFor({ timeout: 10000 });
    await bubble.click();
    await submit.locator('#detail-card').waitFor({ timeout: 10000 });
    const localWake = await submit.evaluate(() => ({
      view: new URL(location.href).searchParams.get('view'),
      detailHidden: document.querySelector('#detail-card')?.hidden ?? true,
      actionCount: document.querySelectorAll('#detail-card [data-action]').length,
    }));
    if (action === 'discuss') { await sleep(950); await shot(submit, 'home-bubble-thinking-1440.png'); }
    await submit.locator(`#detail-card [data-action=${action}]`).click();
    await submit.locator('.chain-root').waitFor({ timeout: 10000 });
    const routed = await submit.evaluate(() => {
      const url = new URL(location.href);
      return { view: url.searchParams.get('view'), screen: url.searchParams.get('screen') };
    });
    bubbleEvidence.push({ action, localWake, routed });
    check(`homepage bubble explicit ${action} action routes canonically`, localWake.view === 'home' && !localWake.detailHidden && localWake.actionCount >= 3 && routed.view === 'chain' && routed.screen === expectedScreen, { action, localWake, routed });
  }
  measurements.homeBubbleActions = bubbleEvidence;
  await submit.goto(`${base}/?view=matters`, { waitUntil: 'domcontentloaded' });
  await waitMatters(submit);
  const matterBubble = submit.locator('.matters-bubble[data-matter-id]').first();
  await matterBubble.waitFor({ timeout: 10000 });
  const selectedMatterId = await matterBubble.getAttribute('data-matter-id');
  await matterBubble.click();
  await sleep(35);
  const growthSeen = await submit.locator('.matters-growth').count();
  await submit.locator('.matters-reentry').waitFor({ timeout: 10000 });
  const reentryState = await submit.evaluate(() => ({
    view: new URL(location.href).searchParams.get('view'),
    growth: document.querySelectorAll('.matters-growth').length,
    reentry: document.querySelectorAll('.matters-reentry').length,
  }));
  await shot(submit, 'matters-reentry-1440.png');
  check('matters bubble grows into a meaningful reentry surface', reentryState.view === 'matters' && reentryState.reentry === 1 && growthSeen >= 1, { selectedMatterId, growthSeen, reentryState });
  await submit.locator('.matters-back').click();
  await submit.locator('.matters-overview').waitFor({ timeout: 10000 });
  const returnedMatter = await submit.evaluate((id) => ({
    view: new URL(location.href).searchParams.get('view'),
    bubble: Boolean(document.querySelector(`.matters-bubble[data-matter-id="${CSS.escape(id)}"]`)),
    focused: document.activeElement?.getAttribute('data-matter-id') || null,
  }), selectedMatterId);
  check('matters return restores the original scene anchor', returnedMatter.view === 'matters' && returnedMatter.bubble && returnedMatter.focused === selectedMatterId, { returnedMatter });
  await submitContext.close();

  check('no unexpected page errors', pageErrors.length === 0, { pageErrors });
  await fs.promises.writeFile(path.join(runDir, 'results.json'), JSON.stringify({
    task: 'trace-web-ui-renovation-20260915-phase1',
    baseline: '1bb35b26833ed9451fbdee91ef57368dc10b86e8',
    contextPackageSha256: '5AB1FE6BDE20BD9F485F0B31483F648A8D7CC59CD100D0911F46FED30F995873',
    base,
    port,
    db,
    checks,
    measurements,
    pageErrors,
    serverLog,
  }, null, 2));
  console.log(`DONE ${runDir}`);
}

(async () => {
  try {
    await run();
  } catch (error) {
    checks.push({ name: 'run error', passed: false, error: error.stack || String(error) });
    await fs.promises.writeFile(path.join(runDir, 'results.json'), JSON.stringify({
      task: 'trace-web-ui-renovation-20260915-phase1',
      baseline: '1bb35b26833ed9451fbdee91ef57368dc10b86e8',
      contextPackageSha256: '5AB1FE6BDE20BD9F485F0B31483F648A8D7CC59CD100D0911F46FED30F995873',
      base,
      port,
      db,
      checks,
      measurements,
      pageErrors,
      serverLog,
    }, null, 2));
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    if (server && !server.killed) server.kill();
    console.log(`EVIDENCE ${runDir}`);
  }
})();

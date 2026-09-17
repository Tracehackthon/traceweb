const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// This is intentionally a small, deterministic interaction regression rather
// than a pixel snapshot test.  The complete-demo workspace supplies real
// Trace records for the home reader.  Candidate browsing is mounted from the
// same comparison model in a real browser because the demo workspace ends on
// the returned screen and deliberately does not fake a second search.
const repo = path.resolve(__dirname, '..');
const webRoot = path.join(repo, 'apps', 'web');
const port = Number(process.env.TRACE_CANVAS_PORT || 4188);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('TRACE_CANVAS_PORT must be an integer from 1024 to 65535');
const viewportWidth = Number(process.env.TRACE_CANVAS_WIDTH || 1600);
const viewportHeight = Number(process.env.TRACE_CANVAS_HEIGHT || 900);
if (!Number.isInteger(viewportWidth) || viewportWidth < 720 || !Number.isInteger(viewportHeight) || viewportHeight < 560) throw new Error('TRACE_CANVAS_WIDTH/HEIGHT must describe a desktop viewport');
const base = `http://127.0.0.1:${port}`;
const runDir = path.join(repo, '.test-results', 'canvas-interactions', `run-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });
const checks = [];
const errors = [];
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
  for (let index = 0; index < 120; index += 1) {
    if (server.exitCode !== null) throw new Error(`isolated server exited: ${serverLog}`);
    if (serverLog.includes(`Trace Vite dev: ${base}/`)) return;
    await sleep(100);
  }
  throw new Error(`isolated server did not start: ${serverLog}`);
}

async function waitHome(page) {
  await page.locator('#capture-input').waitFor({ timeout: 10000 });
  await page.locator('[data-canvas-viewport]').waitFor({ timeout: 10000 });
}

async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(runDir, name), animations: 'disabled' });
}

async function cameraOf(locator) {
  return locator.evaluate((element) => {
    const match = element.style.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px, 0px\) scale\(([-\d.]+)\)/);
    return match ? { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) } : null;
  });
}

async function blankCanvasPoint(page, viewport) {
  return viewport.evaluate((element) => {
    const viewportRect = element.getBoundingClientRect();
    const candidates = [
      [viewportRect.left + viewportRect.width * .78, viewportRect.top + viewportRect.height * .72],
      [viewportRect.left + viewportRect.width * .82, viewportRect.top + viewportRect.height * .45],
      [viewportRect.left + viewportRect.width * .2, viewportRect.top + viewportRect.height * .82],
      [viewportRect.left + viewportRect.width * .72, viewportRect.top + viewportRect.height * .2],
    ];
    for (const [x, y] of candidates) {
      const hit = document.elementFromPoint(x, y);
      if (hit === element || hit?.closest?.('[data-canvas-viewport]') === element
        && !hit.closest?.('button,input,textarea,select,a')) return { x, y };
    }
    return { x: viewportRect.left + viewportRect.width * .8, y: viewportRect.top + viewportRect.height * .72 };
  });
}

async function riverEdgeState(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('[data-canvas-viewport]')?.getBoundingClientRect();
    const threads = [...document.querySelectorAll('.thread-path')];
    const buffers = [...document.querySelectorAll('.river-buffer-path')];
    const point = (path, length) => {
      const value = path.getPointAtLength(length);
      return { x: Number(value.x.toFixed(3)), y: Number(value.y.toFixed(3)) };
    };
    const endpoints = threads.flatMap((path) => [
      { path: path.dataset.path, side: 'start', ...point(path, 0) },
      { path: path.dataset.path, side: 'end', ...point(path, path.getTotalLength()) },
    ]);
    const bufferSamples = buffers.flatMap((path) => {
      const length = path.getTotalLength();
      const samples = Math.max(2, Math.ceil(length / 4));
      return Array.from({ length: samples + 1 }, (_, index) => point(path, length * index / samples));
    });
    const connected = endpoints.every((endpoint) => {
      const nearThread = endpoints.some((other) => other !== endpoint && Math.hypot(other.x - endpoint.x, other.y - endpoint.y) < .75);
      const nearBuffer = bufferSamples.some((other) => Math.hypot(other.x - endpoint.x, other.y - endpoint.y) < 2.5);
      return nearThread || nearBuffer;
    });
    const edgeCoverage = viewport ? [viewport.left, viewport.right].map((edge) => buffers.some((path) => {
      const box = path.getBoundingClientRect();
      return box.left <= edge + 8 && box.right >= edge - 8;
    })) : [false, false];
    return { endpointCount: endpoints.length, bufferCount: buffers.length, connected, edgeCoverage };
  });
}

async function assertSingleReaderScroll(locator, name) {
  const scrollables = await locator.locator('*').evaluateAll((elements) => elements
    .filter((element) => {
      const style = getComputedStyle(element);
      return ['auto', 'scroll'].includes(style.overflowY) || ['auto', 'scroll'].includes(style.overflow);
    })
    .map((element) => ({ className: String(element.className || ''), tag: element.tagName })));
  // Textareas are controls, not nested material readers.  The authored long
  // content must have exactly one scroll column.
  const materialScrolls = scrollables.filter((item) => item.tag !== 'TEXTAREA' && item.tag !== 'INPUT');
  check(name, materialScrolls.length === 1 && /(?:reader-scroll|detail-context)/.test(materialScrolls[0].className), { scrollables });
}

async function mountCandidateFixture(page) {
  return page.evaluate(async () => {
    const model = await import('/src/product/comparison-model.mjs');
    const module = await import('/src/product/comparison-screen.mjs');
    let state = model.createComparisonState();
    state = model.reduceComparison(state, { type: 'SEARCH' });
    const shell = document.querySelector('.trace-react-shell');
    if (shell) shell.style.visibility = 'hidden';
    const fixture = document.createElement('div');
    fixture.id = 'canvas-candidate-fixture';
    fixture.style.cssText = 'position:fixed;inset:0;z-index:1000;background:#f9fdfc;';
    document.body.append(fixture);
    const actions = [];
    module.mountComparisonScreen({
      root: fixture,
      view: model.selectComparisonView(state),
      assets: {},
      services: {},
      onAction: (action) => actions.push(action),
    });
    window.__candidateActions = actions;
  });
}

async function run() {
  server = spawn(process.execPath, ['dev-server.mjs'], {
    cwd: webRoot,
    env: {
      ...process.env,
      TRACE_DESKTOP_PORT: String(port),
      TRACE_API_PORT: String(port + 1),
      TRACE_WEB_STATE_FILE: path.join(runDir, 'web.sqlite'),
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });
  await waitForServer();
  browser = await chromium.launch({ executablePath: process.env.TRACE_CHROMIUM_EXECUTABLE || undefined, headless: true });
  const context = await browser.newContext({ viewport: { width: viewportWidth, height: viewportHeight } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push({ url: page.url(), message: error.message }));

  // Home canvas: the authored horizontal history travels independently from
  // the fixed chrome.  The bird is a screen-space overlay, so it must not
  // follow ordinary pan/zoom until a bubble is deliberately opened.
  await page.goto(`${base}/app/demo?view=home`, { waitUntil: 'domcontentloaded' });
  await waitHome(page);
  await page.evaluate(() => document.fonts.ready);
  // The shared route host has a short entrance transform.  Let that settle so
  // fixed-chrome assertions compare the same scene frame before and after a
  // camera gesture, rather than capturing the intentional route transition.
  await page.waitForTimeout(320);
  const homeUrl = page.url();
  const homeCanvas = page.locator('[data-canvas-viewport]');
  const homeWorld = homeCanvas.locator('[data-canvas-world]');
  const composer = page.locator('.home-composer');
  const birdImage = page.locator('#scene-bird .bird-perched');
  const composerBefore = await composer.boundingBox();
  const birdBefore = await birdImage.boundingBox();
  const thought = page.locator('.thought-bubble[data-entry="thought"]');
  const viewportBox = await homeCanvas.boundingBox();
  const thoughtBox = await thought.boundingBox();
  check('latest history bubble returns near the visual middle', thoughtBox && Math.abs((thoughtBox.x + thoughtBox.width / 2) - (viewportBox.x + viewportBox.width / 2)) < 180, { thoughtBox, viewportBox });
  const initialCamera = await cameraOf(homeWorld);
  await shot(page, 'overview.png');

  await homeCanvas.locator('[data-canvas-action="zoom-in"]').click();
  check('home explicit zoom-in updates the announced scale', Number(await homeCanvas.getAttribute('aria-valuenow')) > 100);
  const afterZoom = await homeWorld.evaluate((element) => element.style.transform);
  await page.mouse.move(viewportBox.x + 760, viewportBox.y + 690);
  await page.mouse.wheel(0, -320);
  check('home pointer wheel zoom keeps a transformed world', await homeWorld.evaluate((element) => element.style.transform) !== afterZoom);
  const beforePan = await homeWorld.evaluate((element) => element.style.transform);
  const blank = await blankCanvasPoint(page, homeCanvas);
  await page.mouse.move(blank.x, blank.y);
  await page.mouse.down();
  await page.mouse.move(blank.x + 70, blank.y + 30, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(360);
  const afterPan = await homeWorld.evaluate((element) => element.style.transform);
  const composerAfter = await composer.boundingBox();
  const birdAfter = await birdImage.boundingBox();
  check('home blank-canvas drag changes camera', afterPan !== beforePan);
  check('home composer stays screen-space during history drag', Math.abs(composerAfter.x - composerBefore.x) < .5 && Math.abs(composerAfter.y - composerBefore.y) < .5 && Math.abs(composerAfter.width - composerBefore.width) < .5, { composerBefore, composerAfter });
  check('home bird stays at the composer during ordinary drag', Math.abs(birdAfter.x - birdBefore.x) < .5 && Math.abs(birdAfter.y - birdBefore.y) < .5 && await page.locator('#scene-bird').getAttribute('data-bird-anchor') === 'composer', { composerBefore, composerAfter, birdBefore, birdAfter, birdDataset: await page.locator('#scene-bird').evaluate((element) => ({ ...element.dataset, style: element.style.transform })) });
  await shot(page, 'history-drag.png');

  await homeCanvas.locator('[data-canvas-action="reset"]').click();
  await page.waitForTimeout(80);
  const baselineCamera = await cameraOf(homeWorld);
  const futureBlank = await blankCanvasPoint(page, homeCanvas);
  await page.mouse.move(futureBlank.x, futureBlank.y);
  await page.mouse.down();
  await page.mouse.move(futureBlank.x - 520, futureBlank.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(520);
  const settledCamera = await cameraOf(homeWorld);
  check('latest-side overscroll settles back to the soft future boundary', settledCamera && baselineCamera && settledCamera.x >= baselineCamera.x - 90 && settledCamera.x <= baselineCamera.x + 1, { baselineCamera, settledCamera });
  const settledThought = await thought.boundingBox();
  check('soft-boundary settle keeps the latest bubble around the middle', settledThought && Math.abs((settledThought.x + settledThought.width / 2) - (viewportBox.x + viewportBox.width / 2)) < 240, { settledThought });
  await shot(page, 'soft-boundary-settled.png');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await homeCanvas.locator('[data-canvas-action="reset"]').click();
  const reducedBaseline = await cameraOf(homeWorld);
  const reducedBlank = await blankCanvasPoint(page, homeCanvas);
  await page.mouse.move(reducedBlank.x, reducedBlank.y);
  await page.mouse.down();
  await page.mouse.move(reducedBlank.x - 520, reducedBlank.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(40);
  const reducedSettled = await cameraOf(homeWorld);
  check('reduced-motion history boundary settles without a long animation', reducedSettled && reducedBaseline && reducedSettled.x >= reducedBaseline.x - 90 && reducedSettled.x <= reducedBaseline.x + 1);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await homeCanvas.locator('[data-canvas-action="reset"]').click();
  await homeCanvas.focus();
  const beforeKeyboardPan = await homeWorld.evaluate((element) => element.style.transform);
  await page.keyboard.press('ArrowRight');
  check('home canvas supports keyboard pan', await homeWorld.evaluate((element) => element.style.transform) !== beforeKeyboardPan);
  await page.keyboard.press('f');
  const keyboardFitScale = Number(await homeCanvas.getAttribute('aria-valuenow'));
  check('home keyboard fit returns to the panorama', keyboardFitScale >= 55 && keyboardFitScale <= 100, { keyboardFitScale });

  // Move toward history so the older bubble is brought into the readable
  // range. This is a camera operation; node world coordinates never change.
  const historyBlank = await blankCanvasPoint(page, homeCanvas);
  await page.mouse.move(historyBlank.x, historyBlank.y);
  await page.mouse.down();
  await page.mouse.move(historyBlank.x + 600, historyBlank.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(430);
  const fresh = page.locator('.thought-bubble[data-entry="fresh"]');
  await fresh.scrollIntoViewIfNeeded();
  const cameraBeforeReader = await cameraOf(homeWorld);
  const freshRectBeforeReader = await fresh.boundingBox();
  await fresh.click();
  const flightAtStart = await page.locator('#scene-bird').evaluate((element) => ({ flying: element.classList.contains('flying'), state: element.dataset.state, anchor: element.dataset.birdAnchor }));
  await page.waitForTimeout(120);
  const flightMid = await page.locator('#scene-bird').evaluate((element) => ({ flying: element.classList.contains('flying'), state: element.dataset.state, anchor: element.dataset.birdAnchor }));
  await page.waitForTimeout(520);
  const flightAtArrival = await page.locator('#scene-bird').evaluate((element) => ({ flying: element.classList.contains('flying'), state: element.dataset.state, anchor: element.dataset.birdAnchor }));
  check('reader handoff keeps the flying posture until the shared camera arrival', flightAtStart.flying && flightMid.flying && !flightAtArrival.flying && flightAtArrival.anchor === 'bubble:fresh', { flightAtStart, flightMid, flightAtArrival });
  const reader = page.locator('.trace-reader-panel');
  check('home bubble opens an in-place reader without route change', page.url() === homeUrl && await reader.isVisible());
  check('home reader uses the complete matter title', !(await reader.locator('h2').textContent()).trim().endsWith('…'));
  check('home reader exposes the complete long-form sections', await reader.locator('[data-reader-section]').count() >= 7);
  check('home reader centers the selected bubble beside the panel', await homeWorld.evaluate((element) => element.style.transform) !== `translate3d(${cameraBeforeReader.x}px, ${cameraBeforeReader.y}px, 0px) scale(${cameraBeforeReader.scale})` && await page.locator('#scene-bird').getAttribute('data-anchor') === 'fresh' && await page.locator('#scene-bird').getAttribute('data-bird-anchor') === 'bubble:fresh');
  check('home reader keeps the composer available as lower chrome', await composer.isVisible() && (await composer.boundingBox()).width > 0);
  await assertSingleReaderScroll(reader, 'home reader uses one material scroll axis');
  await shot(page, 'selected-centered-reader.png');
  const readerBeforeWide = await reader.boundingBox();
  await reader.locator('[data-action="toggle-reader-wide"]').click();
  const readerAfterWide = await reader.boundingBox();
  check('home reader has an explicit wide-reading state', await reader.getAttribute('data-reader-wide') === 'true' && readerAfterWide.width > readerBeforeWide.width);
  const handle = reader.locator('[data-reader-resize]');
  check('home reader exposes an accessible width handle', await handle.count() === 1 && await handle.getAttribute('aria-valuenow') !== null);
  await shot(page, 'home-reader-wide.png');
  await reader.locator('[data-action="home"]').click();
  await page.waitForTimeout(520);
  const freshRectAfterClose = await fresh.boundingBox();
  check('home close hides reader, returns bird and restores exact camera', !await reader.isVisible() && await page.locator('#scene-bird').getAttribute('data-anchor') === 'composer' && JSON.stringify(await cameraOf(homeWorld)) === JSON.stringify(cameraBeforeReader));
  check('home close restores selected bubble screen position', freshRectBeforeReader && freshRectAfterClose && Math.abs(freshRectBeforeReader.x - freshRectAfterClose.x) < .5 && Math.abs(freshRectBeforeReader.y - freshRectAfterClose.y) < .5);
  await shot(page, 'closed-restored.png');

  // The second home posture is a deliberate full-screen roam.  It keeps the
  // same world/camera controller, but lets the chrome fade out so the line
  // reads as a continuous history rather than a component being dragged.
  await homeCanvas.locator('[data-canvas-action="reset"]').click();
  await page.waitForTimeout(80);
  const scene = page.locator('#home-scene');
  const roamEntry = scene.locator('[data-action="enter-roam"]');
  const roamExit = scene.locator('[data-action="exit-roam"]');
  check('default catch mode exposes the restrained roam entry', await roamEntry.isVisible() && await scene.getAttribute('data-roam') !== 'true');
  const riverBufferGeometry = await scene.locator('.river-buffer-path').evaluateAll((paths) => paths.map((path) => { const box = path.getBBox(); return { x: box.x, right: box.x + box.width }; }));
  check('river has authored buffer strokes past both viewport edges', riverBufferGeometry.length >= 5 && riverBufferGeometry.some((box) => box.x < 0) && riverBufferGeometry.some((box) => box.right > 1672) && await homeWorld.evaluate((element) => getComputedStyle(element).borderStyle === 'none'), { riverBufferGeometry });
  const riverEdges = await riverEdgeState(page);
  check('authored path endpoints stay joined to a continuing river segment', riverEdges.connected && riverEdges.bufferCount >= 6, { riverEdges });
  const strokeWidths = await scene.locator('.thread-path').evaluateAll((paths) => paths.map((path) => Number.parseFloat(getComputedStyle(path).strokeWidth)));
  const underStrokeWidths = await scene.locator('.river-understroke').evaluateAll((paths) => paths.map((path) => Number.parseFloat(getComputedStyle(path).strokeWidth)));
  check('river stroke hierarchy keeps mains and branches from becoming hairlines', strokeWidths.some((width) => width >= 2.2) && strokeWidths.filter((width) => width >= 1.4 && width <= 1.9).length >= 2 && underStrokeWidths.every((width) => width >= 5 && width <= 8), { strokeWidths, underStrokeWidths });
  const latestRiverOpacity = await thought.evaluate((element) => Number(element.style.getPropertyValue('--river-opacity')));
  const olderRiverOpacity = await scene.locator('.thought-bubble[data-entry="work"]').evaluate((element) => Number(element.style.getPropertyValue('--river-opacity')));
  const latestRiverGlow = await thought.evaluate((element) => Number(element.style.getPropertyValue('--river-glow')));
  const olderRiverGlow = await scene.locator('.thought-bubble[data-entry="work"]').evaluate((element) => Number(element.style.getPropertyValue('--river-glow')));
  check('distance-based river fade keeps the latest focus clearer', Number.isFinite(latestRiverOpacity) && Number.isFinite(olderRiverOpacity) && latestRiverOpacity > olderRiverOpacity);
  check('distance-based bubble focus also updates the restrained glow field', Number.isFinite(latestRiverGlow) && Number.isFinite(olderRiverGlow) && latestRiverGlow > olderRiverGlow, { latestRiverGlow, olderRiverGlow });
  const fadeProbe = scene.locator('.thought-bubble[data-entry="fresh"]');
  const fadeAtEdge = Number(await fadeProbe.evaluate((element) => element.style.getPropertyValue('--river-opacity')));
  const fadeDragDelta = Math.max(620, viewportBox.width * .58);
  const fadeBlank = await blankCanvasPoint(page, homeCanvas);
  await page.mouse.move(fadeBlank.x, fadeBlank.y);
  await page.mouse.down();
  await page.mouse.move(fadeBlank.x + fadeDragDelta, fadeBlank.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(430);
  const fadeAtCenter = Number(await fadeProbe.evaluate((element) => element.style.getPropertyValue('--river-opacity')));
  check('bubble brightness rises when the same bubble is dragged toward visual center', Number.isFinite(fadeAtEdge) && Number.isFinite(fadeAtCenter) && fadeAtCenter > fadeAtEdge + .15, { fadeAtEdge, fadeAtCenter, fadeDragDelta });
  const fadeBack = await blankCanvasPoint(page, homeCanvas);
  await page.mouse.move(fadeBack.x, fadeBack.y);
  await page.mouse.down();
  await page.mouse.move(fadeBack.x - fadeDragDelta, fadeBack.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(430);
  const fadeAtFar = Number(await fadeProbe.evaluate((element) => element.style.getPropertyValue('--river-opacity')));
  check('bubble brightness falls again when camera moves it away', Number.isFinite(fadeAtFar) && fadeAtFar < fadeAtCenter - .15, { fadeAtCenter, fadeAtFar });
  await thought.hover();
  await page.waitForTimeout(210);
  const defaultHoverBird = await page.locator('#scene-bird').evaluate((element) => ({ anchor: element.dataset.birdAnchor, intent: element.dataset.intent, state: element.dataset.state, className: element.className }));
  check('catch-mode hover prepares the bird without changing its composer anchor', defaultHoverBird.anchor === 'composer' && defaultHoverBird.intent === 'thought' && (defaultHoverBird.state === 'intent' || defaultHoverBird.state === 'intent-pending') && defaultHoverBird.className.includes('roam-intent'), { defaultHoverBird });
  await page.mouse.move(viewportBox.x + 8, viewportBox.y + 8);
  await page.waitForTimeout(80);
  check('leaving a catch-mode bubble restores the composer perch', await page.locator('#scene-bird').getAttribute('data-bird-anchor') === 'composer' && !(await page.locator('#scene-bird').getAttribute('data-intent')));
  await shot(page, 'default-catch.png');

  await roamEntry.click();
  await page.waitForTimeout(600);
  check('entering full-screen roam fades the title and composer', await scene.getAttribute('data-roam') === 'true' && await page.locator('.home-hero').evaluate((element) => Number(getComputedStyle(element).opacity)) < .1 && await composer.evaluate((element) => Number(getComputedStyle(element).opacity)) < .1);
  const roamBirdState = await page.locator('#scene-bird').evaluate((element) => ({ state: element.dataset.state, anchor: element.dataset.anchor, className: element.className, opacity: Number(getComputedStyle(element).opacity), transform: element.style.transform }));
  check('full-screen entry performs one sticky migration to the latest bubble', roamBirdState.state === 'roaming-idle' && !roamBirdState.className.includes('roam-hidden') && roamBirdState.opacity > .3 && roamBirdState.anchor === 'thought' && await page.locator('#scene-bird').getAttribute('data-bird-anchor') === 'bubble:thought', { roamBirdState });
  check('full-screen roam offers a minimal return exit', await roamExit.isVisible());
  await shot(page, 'fullscreen-entered.png');

  await thought.hover();
  await page.waitForTimeout(210);
  const roamIntent = await page.locator('#scene-bird').evaluate((element) => ({ intent: element.dataset.intent, state: element.dataset.state, target: element.dataset.target, className: element.className }));
  check('full-screen bubble hover primes the bird without rebinding its anchor', roamIntent.intent === 'thought' && (roamIntent.state === 'intent' || roamIntent.state === 'intent-pending') && roamIntent.target === 'thought' && roamIntent.className.includes('roam-intent') && await page.locator('#scene-bird').getAttribute('data-bird-anchor') === 'bubble:thought', { roamIntent });

  const roamHistoryBlank = await blankCanvasPoint(page, homeCanvas);
  await page.mouse.move(roamHistoryBlank.x, roamHistoryBlank.y);
  await page.mouse.down();
  await page.mouse.move(roamHistoryBlank.x + 460, roamHistoryBlank.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(430);
  const historyEdges = await riverEdgeState(page);
  check('full-screen history roam keeps the river buffered', await scene.locator('.river-buffer-path').count() >= 6 && historyEdges.edgeCoverage.every(Boolean) && historyEdges.connected && await homeWorld.evaluate((element) => getComputedStyle(element).borderStyle === 'none'), { historyEdges });
  await shot(page, 'fullscreen-history-roam.png');
  await shot(page, 'left-history-roam.png');

  await homeCanvas.locator('[data-canvas-action="reset"]').click();
  const roamBaseline = await cameraOf(homeWorld);
  const roamFutureBlank = await blankCanvasPoint(page, homeCanvas);
  await page.mouse.move(roamFutureBlank.x, roamFutureBlank.y);
  await page.mouse.down();
  await page.mouse.move(roamFutureBlank.x - 560, roamFutureBlank.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(520);
  const roamFutureCamera = await cameraOf(homeWorld);
  check('full-screen future direction uses a soft boundary', roamFutureCamera && roamBaseline && roamFutureCamera.x >= roamBaseline.x - 90 && roamFutureCamera.x <= roamBaseline.x + 1);
  const futureEdges = await riverEdgeState(page);
  check('future-side mist still has no viewport-hard path endpoint', futureEdges.edgeCoverage.every(Boolean) && futureEdges.connected, { futureEdges });
  await shot(page, 'fullscreen-future-mist.png');
  await shot(page, 'right-future-mist.png');
  await shot(page, 'river-edge-overscan.png');

  await homeCanvas.locator('[data-canvas-action="reset"]').click();
  const fullscreenReaderCamera = await cameraOf(homeWorld);
  await thought.click();
  await page.waitForTimeout(540);
  check('full-screen selection opens the long reader beside the river', await scene.getAttribute('data-roam') === 'true' && await reader.isVisible() && await reader.locator('[data-reader-section]').count() >= 7);
  const selectedBirdBox = await page.locator('#scene-bird .bird-perched').boundingBox();
  const selectedBubbleBox = await thought.boundingBox();
  const readerBox = await reader.boundingBox();
  const selectedBirdRight = selectedBirdBox && selectedBirdBox.x + selectedBirdBox.width;
  const selectedBirdBottom = selectedBirdBox && selectedBirdBox.y + selectedBirdBox.height;
  const selectedBubbleRight = selectedBubbleBox && selectedBubbleBox.x + selectedBubbleBox.width;
  const selectedBubbleBottom = selectedBubbleBox && selectedBubbleBox.y + selectedBubbleBox.height;
  const selectedBirdClear = selectedBirdBox && selectedBubbleBox && (selectedBirdRight <= selectedBubbleBox.x + 2 || selectedBirdBox.x >= selectedBubbleRight - 2 || selectedBirdBottom <= selectedBubbleBox.y + 2 || selectedBirdBox.y >= selectedBubbleBottom - 2);
  const selectedReaderClear = !readerBox || !selectedBirdBox || selectedBirdRight <= readerBox.x + 2 || selectedBirdBox.x >= readerBox.x + readerBox.width - 2 || selectedBirdBottom <= readerBox.y + 2 || selectedBirdBox.y >= readerBox.y + readerBox.height - 2;
  check('full-screen selection brings the bird to a clear bubble edge', await page.locator('#scene-bird').getAttribute('data-anchor') === 'thought' && await page.locator('#scene-bird').getAttribute('data-bird-anchor') === 'bubble:thought' && await page.locator('#scene-bird').getAttribute('data-state') === 'selected' && ['left', 'right', 'top', 'bottom'].includes(await page.locator('#scene-bird').getAttribute('data-edge')) && selectedBirdClear && selectedReaderClear, { selectedBirdBox, selectedBubbleBox, readerBox });
  await shot(page, 'fullscreen-selected-reader.png');
  await reader.locator('[data-action="home"]').click();
  await page.waitForTimeout(540);
  const restoredRoamBird = await page.locator('#scene-bird').evaluate((element) => ({ state: element.dataset.state, anchor: element.dataset.anchor, className: element.className, opacity: Number(getComputedStyle(element).opacity) }));
  check('closing the full-screen reader keeps the selected sticky anchor and restores exact camera', !await reader.isVisible() && restoredRoamBird.state === 'roaming-idle' && !restoredRoamBird.className.includes('roam-hidden') && restoredRoamBird.opacity > .3 && restoredRoamBird.anchor === 'thought' && await page.locator('#scene-bird').getAttribute('data-bird-anchor') === 'bubble:thought' && JSON.stringify(await cameraOf(homeWorld)) === JSON.stringify(fullscreenReaderCamera), { restoredRoamBird });
  await shot(page, 'fullscreen-restored.png');

  // Once selected, the bird follows that bubble's actual screen rect. A
  // camera move must preserve the local edge gap and must not auto-rebind to
  // whichever other bubble happens to be nearer the viewport centre.
  const stickyBefore = await page.evaluate(() => {
    const bird = document.querySelector('#scene-bird .bird-perched')?.getBoundingClientRect();
    const bubble = document.querySelector('.thought-bubble[data-entry="thought"]')?.getBoundingClientRect();
    const edge = document.querySelector('#scene-bird')?.dataset.edge;
    if (!bird || !bubble) return null;
    const gap = edge === 'right' ? bird.left - bubble.right : edge === 'top' ? bubble.top - bird.bottom : edge === 'bottom' ? bird.top - bubble.bottom : bubble.left - bird.right;
    return { edge, gap, bird: { x: bird.x, y: bird.y, width: bird.width, height: bird.height }, bubble: { x: bubble.x, y: bubble.y, width: bubble.width, height: bubble.height }, anchor: document.querySelector('#scene-bird')?.dataset.birdAnchor, viewport: document.querySelector('[data-canvas-viewport]')?.getBoundingClientRect().toJSON() };
  });
  const stickyBlank = await blankCanvasPoint(page, homeCanvas);
  await page.mouse.move(stickyBlank.x, stickyBlank.y);
  await page.mouse.down();
  await page.mouse.move(stickyBlank.x + 180, stickyBlank.y + 14, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(430);
  const stickyAfter = await page.evaluate(() => {
    const bird = document.querySelector('#scene-bird .bird-perched')?.getBoundingClientRect();
    const bubble = document.querySelector('.thought-bubble[data-entry="thought"]')?.getBoundingClientRect();
    const edge = document.querySelector('#scene-bird')?.dataset.edge;
    if (!bird || !bubble) return null;
    const gap = edge === 'right' ? bird.left - bubble.right : edge === 'top' ? bubble.top - bird.bottom : edge === 'bottom' ? bird.top - bubble.bottom : bubble.left - bird.right;
    return { edge, gap, bird: { x: bird.x, y: bird.y, width: bird.width, height: bird.height }, bubble: { x: bubble.x, y: bubble.y, width: bubble.width, height: bubble.height }, anchor: document.querySelector('#scene-bird')?.dataset.birdAnchor, viewport: document.querySelector('[data-canvas-viewport]')?.getBoundingClientRect().toJSON() };
  });
  check('selected bird follows the same bubble edge during pan', stickyBefore && stickyAfter && stickyBefore.anchor === 'bubble:thought' && stickyAfter.anchor === 'bubble:thought' && stickyAfter.edge === stickyBefore.edge && Math.abs(stickyAfter.gap - stickyBefore.gap) < 10, { stickyBefore, stickyAfter });

  const zoomStickyBefore = stickyAfter;
  const zoomPoint = { x: viewportBox.x + viewportBox.width * .78, y: viewportBox.y + viewportBox.height * .78 };
  const cameraBeforeStickyZoom = await cameraOf(homeWorld);
  await page.mouse.move(zoomPoint.x, zoomPoint.y);
  await page.mouse.wheel(0, -180);
  await page.waitForTimeout(360);
  const zoomStickyAfter = await page.evaluate(() => {
    const bird = document.querySelector('#scene-bird .bird-perched')?.getBoundingClientRect();
    const bubble = document.querySelector('.thought-bubble[data-entry="thought"]')?.getBoundingClientRect();
    const edge = document.querySelector('#scene-bird')?.dataset.edge;
    if (!bird || !bubble) return null;
    const gap = edge === 'right' ? bird.left - bubble.right : edge === 'top' ? bubble.top - bird.bottom : edge === 'bottom' ? bird.top - bubble.bottom : bubble.left - bird.right;
    return { edge, gap, anchor: document.querySelector('#scene-bird')?.dataset.birdAnchor };
  });
  check('selected bird keeps its sticky edge through zoom', cameraBeforeStickyZoom && JSON.stringify(await cameraOf(homeWorld)) !== JSON.stringify(cameraBeforeStickyZoom) && zoomStickyBefore && zoomStickyAfter && zoomStickyAfter.anchor === 'bubble:thought' && zoomStickyAfter.edge === zoomStickyBefore.edge && Math.abs(zoomStickyAfter.gap - zoomStickyBefore.gap) < 10, { zoomStickyBefore, zoomStickyAfter });

  // A deliberately high-speed gesture regression: several pointer/wheel
  // updates are delivered without a settle pause. The world and semantic
  // pointer must still finish on the same target id and sticky edge.
  const rapidBefore = await page.evaluate(() => {
    const bird = document.querySelector('#scene-bird .bird-perched')?.getBoundingClientRect();
    const bubble = document.querySelector('.thought-bubble[data-entry="thought"]')?.getBoundingClientRect();
    const edge = document.querySelector('#scene-bird')?.dataset.edge;
    if (!bird || !bubble) return null;
    const gap = edge === 'right' ? bird.left - bubble.right : edge === 'top' ? bubble.top - bird.bottom : edge === 'bottom' ? bird.top - bubble.bottom : bubble.left - bird.right;
    return { edge, gap, anchor: document.querySelector('#scene-bird')?.dataset.birdAnchor };
  });
  const rapidPoint = await blankCanvasPoint(page, homeCanvas);
  await page.mouse.move(rapidPoint.x, rapidPoint.y);
  await page.mouse.down();
  await page.mouse.move(rapidPoint.x + 210, rapidPoint.y + 18, { steps: 1 });
  await page.mouse.move(rapidPoint.x - 95, rapidPoint.y - 12, { steps: 1 });
  await page.mouse.move(rapidPoint.x + 165, rapidPoint.y + 9, { steps: 1 });
  await page.mouse.up();
  for (const delta of [-48, 44, -36, 32]) {
    await page.mouse.wheel(0, delta);
  }
  await page.waitForTimeout(160);
  const rapidAfter = await page.evaluate(() => {
    const bird = document.querySelector('#scene-bird .bird-perched')?.getBoundingClientRect();
    const bubble = document.querySelector('.thought-bubble[data-entry="thought"]')?.getBoundingClientRect();
    const edge = document.querySelector('#scene-bird')?.dataset.edge;
    if (!bird || !bubble) return null;
    const gap = edge === 'right' ? bird.left - bubble.right : edge === 'top' ? bubble.top - bird.bottom : edge === 'bottom' ? bird.top - bubble.bottom : bubble.left - bird.right;
    return { edge, gap, anchor: document.querySelector('#scene-bird')?.dataset.birdAnchor };
  });
  check('high-speed drag and wheel keep the bird on the same target edge', rapidBefore && rapidAfter && rapidBefore.anchor === 'bubble:thought' && rapidAfter.anchor === 'bubble:thought' && rapidAfter.edge === rapidBefore.edge && Math.abs(rapidAfter.gap - rapidBefore.gap) < 10, { rapidBefore, rapidAfter });

  await roamExit.click();
  await page.waitForTimeout(540);
  check('exit full-screen returns to catch mode and the latest camera', await scene.getAttribute('data-roam') === 'false' && await roamEntry.isVisible() && await composer.evaluate((element) => Number(getComputedStyle(element).opacity)) > .8 && JSON.stringify(await cameraOf(homeWorld)) === JSON.stringify(roamBaseline));
  check('exit full-screen returns the bird to the composer', await page.locator('#scene-bird').getAttribute('data-anchor') === 'composer' && await page.locator('#scene-bird').getAttribute('data-bird-anchor') === 'composer' && await page.locator('#scene-bird').getAttribute('data-state') === 'composer');
  await shot(page, 'fullscreen-exit.png');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await roamEntry.click();
  await page.waitForTimeout(80);
  const reducedRoamBird = await page.locator('#scene-bird').evaluate((element) => ({ anchor: element.dataset.birdAnchor, state: element.dataset.state, flying: element.classList.contains('flying') }));
  check('reduced-motion roam keeps sticky semantics without a flight animation', reducedRoamBird.anchor === 'bubble:thought' && reducedRoamBird.state === 'roaming-idle' && !reducedRoamBird.flying, { reducedRoamBird });
  await roamExit.click();
  await page.waitForTimeout(80);
  const reducedCatchBird = await page.locator('#scene-bird').evaluate((element) => ({ anchor: element.dataset.birdAnchor, state: element.dataset.state, flying: element.classList.contains('flying') }));
  check('reduced-motion exit returns immediately to the composer anchor', reducedCatchBird.anchor === 'composer' && reducedCatchBird.state === 'composer' && !reducedCatchBird.flying, { reducedCatchBird });
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // Candidate canvas: use the production comparison reducer/catalog in the
  // browser, then exercise the same DOM adapter as the real compare route.
  await page.goto(`${base}/app/demo?view=compare&matter=demo%3Acontinuity&session=demo%3Acomparison`, { waitUntil: 'domcontentloaded' });
  await page.locator('.compare-root').waitFor({ timeout: 10000 });
  const candidateUrl = page.url();
  await mountCandidateFixture(page);
  const fixture = page.locator('#canvas-candidate-fixture');
  const candidateCanvas = fixture.locator('.compare-canvas-viewport');
  const candidateWorld = candidateCanvas.locator('[data-canvas-world]');
  check('candidate canvas lays out the real three-card catalog', await candidateCanvas.count() === 1 && await fixture.locator('.compare-candidate').count() === 3);
  await candidateCanvas.locator('[data-canvas-action="zoom-in"]').click();
  check('candidate canvas shares explicit zoom controls', Number(await candidateCanvas.getAttribute('aria-valuenow')) > 100);
  await candidateCanvas.locator('[data-canvas-action="fit"]').click();
  const candidateCamera = await candidateWorld.evaluate((element) => element.style.transform);
  await fixture.locator('.compare-candidate button[data-action="preview-candidate"]').first().click();
  await page.waitForTimeout(100);
  check('candidate click opens an adjacent reader without route change', page.url() === candidateUrl && await fixture.locator('[data-reader-panel]').isVisible());
  check('candidate preview does not emit OPEN_CANDIDATE', !(await page.evaluate(() => window.__candidateActions.some((action) => action.type === 'OPEN_CANDIDATE'))));
  await assertSingleReaderScroll(fixture.locator('[data-reader-panel]'), 'candidate reader uses one material scroll axis');
  await shot(page, 'compare-reader.png');
  await fixture.locator('[data-reader-panel] [data-action="close-reader"]').click();
  await page.waitForTimeout(120);
  check('candidate reader close restores exact camera', !await fixture.locator('[data-reader-panel]').isVisible() && await candidateWorld.evaluate((element) => element.style.transform) === candidateCamera);
  await fixture.locator('.compare-candidate button[data-action="preview-candidate"]').last().click();
  await page.waitForTimeout(450);
  check('candidate camera reveals a far-side card beside the reader', await candidateWorld.evaluate((element) => element.style.transform) !== candidateCamera);
  await fixture.locator('[data-reader-panel] [data-action="close-reader"]').click();
  await page.waitForTimeout(450);
  check('candidate far-side reader close restores the earlier camera', await candidateWorld.evaluate((element) => element.style.transform) === candidateCamera);
  await fixture.locator('.compare-candidate button[data-action="preview-candidate"]').first().click();
  await fixture.locator('[data-reader-panel] [data-action="commit-candidate"]').click();
  await page.waitForTimeout(50);
  check('only explicit compare action emits OPEN_CANDIDATE', await page.evaluate(() => window.__candidateActions.filter((action) => action.type === 'OPEN_CANDIDATE').length === 1));
  check('candidate explicit action keeps current route until host handles it', page.url() === candidateUrl);
  await shot(page, 'compare-candidates.png');

  check('no browser page errors', errors.length === 0, { errors });
  fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify({ checks, errors, serverLog }, null, 2));
  console.log(`EVIDENCE ${runDir}`);
  await context.close();
}

run().catch(async (error) => {
  console.error(error.stack || error);
  fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify({ checks, errors, error: String(error), serverLog }, null, 2));
  process.exitCode = 1;
}).finally(() => {
  void browser?.close();
  if (server && server.exitCode === null) server.kill();
});

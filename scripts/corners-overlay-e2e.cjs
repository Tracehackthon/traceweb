// Compile and exercise the actual native overlay renderer, not a component mock.
// Both engines use an isolated local page; there is deliberately no Runtime bridge.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium, _electron: electron } = require('playwright');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.TRACE_E2E_OUTPUT_DIR || path.join(root, '.test-results/frontend-replacement/corners/overlay'));
assert.ok(out.startsWith(path.join(root, '.test-results') + path.sep));
assert.ok(!fs.existsSync(path.join(out, 'report.json')), 'Use a fresh evidence directory');
fs.mkdirSync(out, { recursive: true });
const temp = path.join(out, 'tmp'); fs.mkdirSync(temp, { recursive: true });
for (const key of ['TEMP', 'TMP', 'TMPDIR']) process.env[key] = temp;
const checks = [], measurements = [], pageErrors = [], consoleErrors = [], requests = [], external = [];
let server, browser, app;
const check = (name, condition = true) => { assert.ok(condition, name); checks.push({ name, passed: true }); console.log('PASS ' + name); };
// Electron and Playwright Chromium serialize the equivalent round keyword
// differently. Preserve the raw evidence but compare the same curve.
const isRound = shape => shape === 'round' || shape === 'superellipse(1)';

async function exercise(page, engine) {
  page.on('pageerror', e => pageErrors.push({ engine, message: e.message }));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push({ engine, text: m.text() }); });
  page.on('request', r => { requests.push({ engine, url: r.url() }); if (!['data:', 'blob:'].includes(new URL(r.url()).protocol) && new URL(r.url()).origin !== base) external.push(r.url()); });
  await page.goto(base + '/');
  await page.locator('.trace-overlay[data-trace-geometry=true]').waitFor();
  await page.locator('.trace-pet-button').dblclick();
  await page.locator('.trace-panel').waitFor();
  const geometry = await page.evaluate(() => {
    const selectors = ['.trace-panel', '.trace-section', '.trace-button', '.trace-media-button', '.trace-capture-section textarea', '.trace-runtime-controls select', '.trace-runtime-offline'];
    const targets = selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(e => e.getClientRects().length).map(e => {
      const s = getComputedStyle(e);
      return { selector, radius: s.borderTopLeftRadius, shape: s.getPropertyValue('corner-shape'), padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft], gap: [s.rowGap, s.columnGap] };
    }));
    const h = getComputedStyle(document.querySelector('#non-trace-host'));
    return { userAgent: navigator.userAgent, supports: CSS.supports('corner-shape', 'superellipse(1.25)'), targets, host: { radius: h.borderRadius, padding: h.padding, shape: h.getPropertyValue('corner-shape') } };
  });
  measurements.push({ engine, ...geometry });
  check(engine + ': actual overlay controls and disconnected panel rendered', geometry.targets.length >= 8 && (await page.locator('.trace-runtime-offline').innerText()) === '未连接');
  check(engine + ': scoped geometry leaves the non-Trace host untouched', geometry.host.radius === '3px' && geometry.host.padding === '3px' && (geometry.supports ? isRound(geometry.host.shape) : !geometry.host.shape));
  check(engine + ': visible rounded boxes and authored spacing use the 4px grid', geometry.targets.every(t => [t.radius, ...t.padding, ...t.gap].every(v => !v.endsWith('px') || Number.parseFloat(v) % 4 === 0)));
  check(engine + ': controls share the same 8px radius', geometry.targets.filter(t => ['.trace-button', '.trace-media-button', '.trace-capture-section textarea', '.trace-runtime-controls select'].includes(t.selector)).every(t => t.radius === '8px'));
  check(engine + ': continuous corners apply only when the engine supports them', geometry.targets.filter(t => !['9996px', '50%'].includes(t.radius)).every(t => geometry.supports ? t.shape === 'superellipse(1.25)' : !t.shape));
  check(engine + ': pills stay fully round', geometry.targets.some(t => t.radius === '9996px' && (geometry.supports ? isRound(t.shape) : !t.shape)));
  await page.getByRole('button', { name: '返回气泡视图', exact: true }).click();
  // Return to the real quick composer through its existing pet interaction.
  await page.locator('.trace-pet-button').click();
  await page.locator('.trace-overlay-open').waitFor({ state: 'hidden' });
  await page.locator('.trace-pet-button').click();
  await page.locator('.trace-quick-submit').waitFor();
  const circle = await page.locator('.trace-quick-submit').evaluate(e => ({ radius: getComputedStyle(e).borderRadius, shape: getComputedStyle(e).getPropertyValue('corner-shape') }));
  check(engine + ': quick-submit circle remains round', circle.radius === '50%' && (geometry.supports ? isRound(circle.shape) : !circle.shape));
  if (engine === 'electron') {
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      if (image.isEmpty()) throw Error('Empty native overlay capture');
      return image.toPNG().toString('base64');
    });
    fs.writeFileSync(path.join(out, 'electron-current-overlay.png'), Buffer.from(png, 'base64'));
  } else await page.screenshot({ path: path.join(out, 'chromium-current-overlay.png') });
}

let base;
(async () => { try {
  await build({ absWorkingDir: path.join(root, 'apps/desktop-pet'), entryPoints: ['src/desktop/renderer.tsx'], outfile: path.join(out, 'renderer.js'), bundle: true, format: 'iife', platform: 'browser', target: 'chrome140', loader: { '.css': 'text', '.png': 'dataurl' }, minify: true, sourcemap: false, legalComments: 'none' });
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><button id="non-trace-host" style="border-radius:3px;padding:3px;position:absolute;left:16px;top:16px">Non-Trace host sentinel</button><div id="trace-native-root"></div><script src="/renderer.js"></script></body></html>'); return; }
    if (pathname === '/renderer.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); fs.createReadStream(path.join(out, 'renderer.js')).pipe(res); return; }
    res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":"No real service is connected in this overlay geometry test"}');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => ['data:', 'blob:'].includes(new URL(route.request().url()).protocol) || new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await exercise(await context.newPage(), 'chromium'); await browser.close(); browser = undefined;
  const profile = path.join(out, 'profile'); fs.mkdirSync(profile, { recursive: true });
  const main = path.join(out, 'electron-main.mjs');
  fs.writeFileSync(main, `import {app,BrowserWindow,session} from 'electron';app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(async()=>{const origin=${JSON.stringify(base)};session.defaultSession.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!['data:','blob:'].includes(new URL(d.url).protocol)&&new URL(d.url).origin!==origin}));const w=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});await w.loadURL(origin);});`);
  app = await electron.launch({ executablePath: path.join(root, 'apps/desktop-pet/node_modules/electron/dist/electron.exe'), args: [main], env: { ...process.env, APPDATA: path.join(profile, 'appdata'), LOCALAPPDATA: path.join(profile, 'localappdata') } });
  const page = await app.firstWindow(); await page.emulateMedia({ reducedMotion: 'reduce' }); await exercise(page, 'electron');
  check('no renderer JavaScript exceptions', pageErrors.length === 0);
  check('no console errors or external requests', consoleErrors.length === 0 && external.length === 0);
} catch (error) { process.exitCode = 1; console.error(error); fs.writeFileSync(path.join(out, 'failure.txt'), error.stack || String(error)); }
finally { if (app) await app.close().catch(() => {}); if (browser) await browser.close(); if (server) await new Promise(r => server.close(r)); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ passed: !process.exitCode, checks, measurements, pageErrors, consoleErrors, requests, external, limits: ['Actual current overlay renderer compiled from source, not packaged desktop main/supervisor/installer', 'Explicitly disconnected; no Runtime bridge, live Agent, user data, or source retrieval', 'Host sentinel checks geometry isolation, not every existing host style'] }, null, 2)); }
})();

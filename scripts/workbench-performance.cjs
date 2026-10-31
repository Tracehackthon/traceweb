// Isolated measurements of the real workbench, not a list/menu benchmark.
// The seed helper bundles the production Browser adapter and fixed Product
// rules. Only the synthetic fixture creation is test-only.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { build } = require('esbuild');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.TRACE_E2E_OUTPUT_DIR || path.join(root, '.test-results/frontend-replacement/workbench/performance'));
assert.ok(out.startsWith(path.join(root, '.test-results') + path.sep));
assert.ok(!fs.existsSync(path.join(out, 'report.json')), 'Choose a fresh evidence directory');
fs.mkdirSync(path.join(out, 'tmp'), { recursive: true });
for (const key of ['TEMP', 'TMP', 'TMPDIR']) process.env[key] = path.join(out, 'tmp');
const dist = path.join(root, 'apps/web/dist-vercel');
assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'Finish the Browser build first');
const errors = [], checks = [], samples = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push({ name, passed: true }); console.log('PASS ' + name); };
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240"><rect width="480" height="240" fill="#e9ece9"/><path d="M30 180L130 110L230 150L360 60L450 130" fill="none" stroke="#677970" stroke-width="8"/><text x="24" y="218" font-size="16">Trace / self-authored measurement fixture</text></svg>';
let server, browser, base, parityStore;
async function snapshot(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('trace-portal-workspace-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const read = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { const tx = db.transaction(['workspace', 'canvases'], 'readonly'); const [p, c] = await Promise.all([read(tx.objectStore('workspace').get('current')), read(tx.objectStore('canvases').get('canvas-main'))]); return { contentRevision: p.revision, materials: Object.keys(p.host.materials).length, canvas: c, host:p.host }; }
    finally { db.close(); }
  });
}
async function saved(page) { await page.waitForFunction(() => document.querySelector('.wb-save-status')?.textContent.includes('已保存内容')); }
async function startFrames(page) {
  await page.evaluate(() => { const result = window.__traceFrames = { intervals: [], last: performance.now(), running: true }; const frame = now => { result.intervals.push(now - result.last); result.last = now; if (result.running) requestAnimationFrame(frame); }; requestAnimationFrame(frame); });
}
async function stopFrames(page) {
  return page.evaluate(() => { const f = window.__traceFrames; f.running = false; const values = f.intervals.slice(1).sort((a, b) => a - b); return { frames: values.length, medianMs: values[Math.floor(values.length / 2)] || null, p95Ms: values[Math.floor(values.length * .95)] || null, maxMs: values.at(-1) || null, intervalsMs: f.intervals }; });
}
(async () => { try {
  await build({ absWorkingDir: root, stdin: { contents: "export {browserProductCommand, browserCanvasCommand, saveBrowserResource} from './apps/web/src/product/workbench-browser.mjs';", resolveDir: root }, outfile: path.join(out, 'seed-helper.mjs'), bundle: true, format: 'esm', platform: 'browser', target: 'chrome140', sourcemap: false });
  const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/seed') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Isolated fixture seed</title>'); return; }
    const file = pathname === '/seed-helper.mjs' ? path.join(out, 'seed-helper.mjs') : path.resolve(dist, '.' + (['/', '/app'].includes(pathname) ? '/index.html' : pathname));
    if (!(file.startsWith(dist + path.sep) || file === path.join(out, 'seed-helper.mjs')) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true });
  for (const count of [50, 200]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push({ count, type: 'JavaScript', message: e.message }));
    page.on('console', m => { if (m.type() === 'error') errors.push({ count, type: 'console', message: m.text() }); });
    page.on('response', r => { if (r.status() >= 400) errors.push({ count, type: 'HTTP', url: r.url(), status: r.status() }); });
    await context.route('**/*', route => { const u = new URL(route.request().url()); if (!['blob:', 'data:'].includes(u.protocol) && u.origin !== base) { errors.push({ count, type: 'external', url: u.href }); return route.abort(); } return route.continue(); });
    await page.goto(base + '/seed');
    const seeded=await page.evaluate(async ({ count, svg }) => {
      const { browserProductCommand, browserCanvasCommand, saveBrowserResource } = await import('/seed-helper.mjs');
      const original = await saveBrowserResource(new Blob([svg], { type: 'image/svg+xml' }));
      const operations = [{ type: 'workspace.upgrade' }, { type: 'resource.register', resource: original }];
      const nodes = [];
      for (let i = 0; i < count; i++) {
        const image = i % 5 === 0, id = 'perf-material-' + i;
        operations.push({ type: 'material.create', id, kind: image ? 'image' : 'text', title: '自产测量材料 ' + (i + 1), value: { text: image ? '图像原件与材料身份分别保存。' : '这是用于测量实际画布拖动与缩放的中文材料；不是模型输出，也不是用户资料。'.repeat(2), resourceId: image ? original.id : null, origin: image ? { kind: 'local', fileName: 'self-authored.svg' } : { kind: 'manual' } } });
        nodes.push({ id: 'perf-node-' + i, ref: { kind: 'material', id, version: null }, position: { x: 48 + (i % 10) * 344, y: 40 + Math.floor(i / 10) * 276 }, width: 304, height: 232, groupId: null, label: '' });
      }
      const content={ protocolVersion: 1, commandId: 'perf-content', expectedRevision: 0, operations },title={ protocolVersion: 1, commandId: 'perf-title', expectedRevision: 0, action: 'rename', title: count + ' 张材料 · 隔离测量' },layout={ protocolVersion: 1, commandId: 'perf-layout', expectedRevision: 1, action: 'replace', scene: { nodes, connections: [] } };
      await browserProductCommand(content);await browserCanvasCommand('canvas-main',title);await browserCanvasCommand('canvas-main',layout);return{content,title,layout,original};
    }, { count, svg });
    const begin = performance.now(); await page.goto(base + '/app?view=canvas'); await page.locator('[data-workbench-ready=true]').waitFor();
    await page.waitForFunction(n => document.querySelectorAll('.wb-node').length === n, count); await saved(page);
    const loadedMs = performance.now() - begin; await page.locator('.wb-node img').first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.wb-node img')].every(i => i.complete && i.naturalWidth > 0));
    const originalsLoadedMs = performance.now() - begin;
    const before = await snapshot(page), node = page.locator('[data-node-id="perf-node-0"]'), box = await node.locator('header strong').boundingBox();
    if(count===50){
      const {createProductWorkspace}=await import('@trace/product-workspace/node');parityStore=createProductWorkspace({file:path.join(out,'same-command-parity.sqlite')});
      assert.deepEqual(parityStore.canvasResources.saveResource(Buffer.from(svg),'image/svg+xml'),seeded.original);
      parityStore.execute(seeded.content);parityStore.canvasResources.executeCanvas('canvas-main',seeded.title);parityStore.canvasResources.executeCanvas('canvas-main',seeded.layout);
      assert.deepEqual(parityStore.read().host,before.host);assert.deepEqual(parityStore.canvasResources.getCanvas('canvas-main'),before.canvas);
      check('identical content/resource/layout commands yield identical Browser and SQLite state',true);
      const invalid={protocolVersion:1,commandId:'parity-bad-ref',expectedRevision:before.contentRevision,operations:[{type:'thinking.create',id:'invalid-scope',title:'不存在的引用不能启用',refs:[{kind:'material',id:'absent',version:1}],excluded:[]}]};
      const browserFailure=await page.evaluate(async command=>{const{browserProductCommand}=await import('/seed-helper.mjs');try{await browserProductCommand(command);return null;}catch(error){return error.code;}},invalid);let sqliteFailure;try{parityStore.execute(invalid);}catch(error){sqliteFailure=error.code;}
      check('both actual storage owners reject invalid scope without advancing revision',browserFailure&&browserFailure===sqliteFailure&&(await snapshot(page)).contentRevision===before.contentRevision&&parityStore.read().revision===before.contentRevision);
      parityStore.close();parityStore=null;
    }
    await startFrames(page); const dragStart = performance.now();
    await page.mouse.move(box.x + 28, box.y + 12); await page.mouse.down(); await page.mouse.move(box.x + 108, box.y + 52, { steps: 30 }); await page.mouse.up(); await saved(page); await page.waitForTimeout(120);
    const dragElapsedMs = performance.now() - dragStart, dragFrames = await stopFrames(page), afterDrag = await snapshot(page);
    check(count + ' actual material nodes render with decoded originals', before.materials === count && before.canvas.nodes.length === count);
    check(count + ' actual pointer drag mutates one layout revision, not content', afterDrag.contentRevision === before.contentRevision && afterDrag.canvas.revision === before.canvas.revision + 1 && afterDrag.canvas.nodes[0].position.x !== before.canvas.nodes[0].position.x);
    if (await page.getByRole('button', { name: '关闭线索详情', exact: true }).isVisible()) await page.getByRole('button', { name: '关闭线索详情', exact: true }).click();
    const area = await page.locator('.wb-ic-viewport').boundingBox(), transform = await page.locator('.wb-ic-world').getAttribute('style');
    const zoomTarget=await page.locator('.wb-ic-viewport').evaluate(e=>{const r=e.getBoundingClientRect();for(let y=r.y+32;y<r.bottom-160;y+=24)for(let x=r.x+24;x<r.right-24;x+=24){const hit=document.elementFromPoint(x,y);if(hit?.closest('.wb-ic-viewport')&&!hit.closest('[data-node-id],[data-canvas-no-zoom]'))return{x,y};}throw Error('No exposed canvas background for actual wheel input');});
    await page.mouse.move(zoomTarget.x,zoomTarget.y); await startFrames(page); const zoomStart = performance.now();
    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, i < 5 ? 80 : -60); await page.waitForTimeout(24); }
    const zoomElapsedMs = performance.now() - zoomStart, zoomFrames = await stopFrames(page), afterZoom = await snapshot(page);
    check(count + ' real wheel zoom changes camera only', (await page.locator('.wb-ic-world').getAttribute('style')) !== transform && afterZoom.canvas.revision === afterDrag.canvas.revision && afterZoom.contentRevision === before.contentRevision);
    const metrics = await page.evaluate(() => ({ usedJSHeapSize: performance.memory?.usedJSHeapSize || null, devicePixelRatio, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, documentWidth: document.documentElement.scrollWidth, innerWidth, animations: document.getAnimations().length }));
    check(count + ' material scene has no page horizontal overflow or entry animations', metrics.documentWidth <= metrics.innerWidth && metrics.animations === 0);
    samples.push({ count, imageMaterials: Math.ceil(count / 5), uniqueOriginals: 1, textMaterials: count - Math.ceil(count / 5), loadedMs, originalsLoadedMs, dragElapsedMs, dragFrames, zoomElapsedMs, zoomFrames, zoomTarget, metrics });
    await page.screenshot({ path: path.join(out, count + '-materials-current.png') });
    await context.close();
  }
  check('no JavaScript, HTTP, console or external request errors in measurements', errors.length === 0);
} catch (error) { process.exitCode = 1; errors.push({ type: 'test', message: error.stack || String(error) }); console.error(error); }
finally {
  if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve));parityStore?.close();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ passed: !process.exitCode, runtime: 'actual current Browser build + formal IDB/Blob and Product rules', checks, samples, errors, limits: ['Single isolated sample per count, not a capacity promise or a production performance baseline', 'Media mix: 20% real decoded image nodes sharing one self-authored original; no 200 unique videos/PDFs claimed', 'Approximate JS heap, not total process/GPU memory', 'No original user data, real Agent or external network', 'Desktop performance and physical input/hardware remain separately unverified'] }, null, 2));
} })();

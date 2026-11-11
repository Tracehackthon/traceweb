import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.resolve(root, '../../.test-results/canvas-lab');
const run = path.join(evidence, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(run, { recursive: true });
const tmp = path.join(evidence, 'browser-tmp'); fs.mkdirSync(tmp, { recursive: true });
process.env.TEMP = tmp; process.env.TMP = tmp; process.env.TMPDIR = tmp;
const dist = path.join(root, 'dist');
if (!fs.existsSync(path.join(dist, 'fixtures/clip.webm'))) throw new Error('Run npm run fixtures and npm run build before verification.');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webm': 'video/webm', '.wav': 'audio/wav', '.pdf': 'application/pdf', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  try {
    const rel = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const file = path.resolve(dist, `.${rel === '/' ? '/index.html' : rel}`);
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    const buffer = fs.readFileSync(file); res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Accept-Ranges', 'bytes');
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : buffer.length - 1, buffer.length - 1);
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${buffer.length}` }).end(); return; }
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${buffer.length}`, 'Content-Length': end - start + 1 }); res.end(buffer.subarray(start, end + 1)); return;
    }
    res.setHeader('Content-Length', buffer.length); res.end(buffer);
  } catch { res.writeHead(400).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const report = { startedAt: new Date().toISOString(), base, browser: browser.version(), viewport: { width: 1600, height: 1000 }, results: {}, note: 'Synthetic local fixtures and fixed mock replies only; no real AI or user storage.' };
const sourceFiles = ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'vendor/drawnix/UPSTREAM.json', 'vendor/drawnix/TRACE-LAB.patch', ...fs.readdirSync(path.join(root, 'src')).map(name => `src/${name}`)];
report.labSourceHashes = Object.fromEntries(sourceFiles.map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')]));
const shot = async (page, name) => { await page.screenshot({ path: path.join(run, name), animations: 'disabled' }); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const state = page => page.evaluate(() => window.__canvasLab.getState());
const snap = page => page.evaluate(() => window.__canvasLab.snapshot());
const nodes = (snapshot, engine) => engine === 'drawnix' ? snapshot.children : snapshot.nodes;
const loc = (snapshot, engine, id) => { const n = nodes(snapshot, engine).find(n => (n.materialId || n.data?.materialId) === id); return engine === 'drawnix' ? n?.points : n?.position; };
const lines = (snapshot, engine) => engine === 'drawnix' ? snapshot.children.filter(n => n.type === 'arrow-line') : snapshot.edges;
async function ready(page, engine, count = 7) {
  await page.waitForFunction(({ engine, count }) => window.__canvasLab?.ready && window.__canvasLab.engine === engine && Object.keys(window.__canvasLab.getState().materials).length === count, { engine, count }, { timeout: 20000 });
  await page.locator('[data-save-state]').filter({ hasText: '已保存' }).waitFor({ timeout: 10000 });
  await page.evaluate(() => document.fonts.ready);
}
async function pick(page, ids) {
  const checked = page.locator('.material-list input:checked');
  while (await checked.count()) await checked.first().uncheck();
  for (const id of ids) await page.locator('.material-list label').filter({ has: page.locator('small', { hasText: new RegExp(`^${id}$`) }) }).locator('input').check();
  await page.waitForFunction(ids => JSON.stringify(window.__canvasLab.selected().sort()) === JSON.stringify(ids.sort()), ids);
}
async function dragGrip(page, id, dx, dy) {
  const rect = await page.locator(`[data-grip="${id}"]`).boundingBox(); assert.ok(rect);
  const x = rect.x + rect.width / 2, y = rect.y + Math.min(rect.height / 2, 20);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 15 }); await page.mouse.up(); await wait(120);
}
try {
  for (const engine of (process.env.LAB_ENGINE ? [process.env.LAB_ENGINE] : ['drawnix', 'reactflow'])) {
    const context = await browser.newContext({ viewport: report.viewport, acceptDownloads: true });
    const page = await context.newPage(); const result = { checks: [], errors: [], externalRequests: [], metrics: [] }; report.results[engine] = result;
    page.on('pageerror', e => result.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') result.errors.push(`${m.type()}: ${m.text()}`); });
    page.on('request', req => { if (!req.url().startsWith(base) && !/^(blob:|data:)/.test(req.url())) result.externalRequests.push(req.url()); });
    const check = (name, condition, details = {}) => { assert.ok(condition, `${name} ${JSON.stringify(details)}`); result.checks.push({ name, passed: true, ...details }); console.log(`PASS ${engine} ${name}`); };
    try {
      const navigationStart = performance.now(); await page.goto(`${base}/?engine=${engine}`); await ready(page, engine); result.firstMountAndSaveMs = performance.now() - navigationStart;
      check('clean baseline mounts one engine and seven materials', await page.locator('[data-engine-surface]').count() === 1 && Object.keys((await state(page)).materials).length === 7);
      await shot(page, `${engine}-overview.png`);
      if (process.env.LAB_SMOKE) continue;
      const rawBefore = (await state(page)).materials;
      check('empty selection cannot start mock collaboration', await page.locator('[data-action=discuss]').isDisabled());
      const notePos = loc(await snap(page), engine, 'm001');
      await page.getByLabel('m001 批注', { exact: true }).fill('这里是用户自己的批注，不覆盖原稿。');
      check('native input edits note without dragging or replacing original', (await state(page)).materials.m001.note.includes('用户自己的批注') && JSON.stringify(loc(await snap(page), engine, 'm001')) === JSON.stringify(notePos) && (await state(page)).materials.m001.original === rawBefore.m001.original);
      for (const id of ['m002', 'm003', 'm004', 'm005', 'm006', 'm007']) {
        // Native fit/zoom changes visibility, so locate the source via the material card.
        const button = page.locator(`[data-source="${id}"]`);
        if (!(await button.isVisible())) await page.locator('[data-action=fit]').click();
        await button.click(); await page.locator('dialog[open]').waitFor();
        if (id === 'm003' || id === 'm004') {
          const media = page.locator('dialog video,dialog audio'); await media.evaluate(el => el.readyState >= 1 ? null : new Promise(resolve => el.addEventListener('loadedmetadata', resolve, { once: true })));
          const m = (await state(page)).materials[id]; const mediaState = await media.evaluate(el => ({ currentTime: el.currentTime, duration: el.duration, readyState: el.readyState, seeking: el.seeking, error: el.error?.message })); check(`${id} source seeks exact clip start`, Math.abs(mediaState.currentTime - m.source.start) < .1, mediaState);
          await media.evaluate(el => el.play()); await wait(350); check(`${id} playable locally`, await media.evaluate(el => !el.paused && el.currentTime > 0));
        }
        if (id === 'm006') { check('PDF retains page, region and original', (await page.locator('[data-source-range]').textContent()).includes('第 1 页') && (await page.locator('dialog a').getAttribute('href')).endsWith('paper.pdf#page=1')); await shot(page, `${engine}-source.png`); }
        if (id === 'm007') check('unavailable source is explicit; retained excerpt survives', await page.locator('dialog .warning').isVisible() && (await page.locator('dialog').textContent()).includes(rawBefore.m007.original));
        await page.getByRole('button', { name: '关闭出处' }).click();
      }
      check('all source assets exist', (await Promise.all(['/fixtures/screenshot.png', '/fixtures/clip.webm', '/fixtures/tone.wav', '/fixtures/paper.pdf', '/fixtures/source.html'].map(async p => (await page.request.get(base + p)).ok()))).every(Boolean));
      // Opening a low card can scroll a native SVG viewport. Restore it through
      // the engine's fit command before pointer tests, not off-screen coordinates.
      await page.locator('[data-action=fit]').click(); await wait(150);
      const boxes = await Promise.all(['m001', 'm002'].map(id => page.locator(`[data-material="${id}"]`).boundingBox()));
      const left = Math.min(...boxes.map(r => r.x)) - 9, top = Math.min(...boxes.map(r => r.y)) - 9, right = Math.max(...boxes.map(r => r.x + r.width)) + 9, bottom = Math.max(...boxes.map(r => r.y + r.height)) + 9;
      await page.mouse.move(left, top); await page.mouse.down(); await page.mouse.move(right, bottom, { steps: 20 }); await page.mouse.up(); await wait(100);
      check('native box selection selects the two intended materials', JSON.stringify(await page.evaluate(() => window.__canvasLab.selected().sort())) === JSON.stringify(['m001', 'm002']));
      await pick(page, ['m001', 'm002']);
      await page.locator('[data-action=connect]').click(); await wait(120);
      check('relation connects selected native shapes', lines(await snap(page), engine).length === 1);
      const before = loc(await snap(page), engine, 'm001');
      const edgeBefore = await page.locator(engine === 'reactflow' ? '.react-flow__edge-path' : '.element-host').evaluate(el => el.outerHTML).catch(() => '');
      await dragGrip(page, 'm001', 80, 50);
      check('pointer drag moves native material', JSON.stringify(loc(await snap(page), engine, 'm001')) !== JSON.stringify(before), { before, after: loc(await snap(page), engine, 'm001'), diagnostics: await page.evaluate(() => window.__canvasLab.diagnostics()) });
      const movedLines = lines(await snap(page), engine);
      const edgeAfter = await page.locator(engine === 'reactflow' ? '.react-flow__edge-path' : '.element-host').evaluate(el => el.outerHTML).catch(() => '');
      check('bound edge survives movement', movedLines.length === 1 && (movedLines[0].source?.boundId || movedLines[0].source) === 'm001' && (movedLines[0].target?.boundId || movedLines[0].target) === 'm002' && Boolean(edgeBefore) && edgeBefore !== edgeAfter);
      await page.locator('[data-action=undo]').click(); await wait(100);
      check('native/history adapter undo restores position', JSON.stringify(loc(await snap(page), engine, 'm001')) === JSON.stringify(before));
      await page.locator('[data-action=redo]').click(); await wait(100);
      check('redo reapplies move', JSON.stringify(loc(await snap(page), engine, 'm001')) !== JSON.stringify(before));
      await pick(page, ['m001', 'm002']); await page.locator('[data-action=group]').click(); await wait(100);
      check('native grouping creates group', nodes(await snap(page), engine).some(n => n.type === 'group'));
      await page.locator('[data-action=ungroup]').click(); await wait(100);
      check('ungroup retains materials', !nodes(await snap(page), engine).some(n => n.type === 'group') && Object.keys((await state(page)).materials).length === 7);
      await page.locator('[data-tool=ink]').click();
      const surface = await page.locator('[data-engine-surface]').boundingBox(); const x = surface.x + surface.width * .78, y = surface.y + surface.height * .8;
      const inkHit = await page.evaluate(({ x, y }) => ({ tag: document.elementFromPoint(x, y)?.tagName, classes: document.elementFromPoint(x, y)?.getAttribute('class'), material: document.elementFromPoint(x, y)?.closest('[data-material]')?.getAttribute('data-material') }), { x, y });
      await page.mouse.move(x, y); await page.mouse.down();
      for (let i = 1; i < 20; i++) await page.mouse.move(x + i * 3, y + Math.sin(i / 4) * 20);
      await page.mouse.up(); await wait(120);
      check('pointer freehand adds retained stroke', nodes(await snap(page), engine).some(n => n.type === 'ink' || n.type === 'freehand'), { inkHit, diagnostics: await page.evaluate(() => window.__canvasLab.diagnostics()), types: nodes(await snap(page), engine).map(n => n.type) });
      await page.locator('[data-tool=select]').click();
      await pick(page, ['m001', 'm003']); await page.locator('[data-action=discuss]').click();
      let session = await state(page);
      check('mock receives only explicitly selected originals and notes', session.request.ids.join(',') === 'm001,m003' && session.request.materials.length === 2 && session.request.materials[0].original === rawBefore.m001.original);
      let proposals = page.locator('[data-proposal]');
      await proposals.first().getByRole('button', { name: '采纳原建议', exact: true }).click();
      await proposals.nth(1).getByRole('button', { name: '暂存', exact: true }).click();
      session = await state(page);
      check('accept returns a distinct sourced material; defer does not', Object.keys(session.materials).length === 8 && session.suggestions[0].status === 'accepted' && session.suggestions[1].status === 'deferred' && session.materials[session.suggestions[0].adoptedId].source.fromIds.join(',') === 'm001,m003');
      await page.locator('[data-action=discuss]').click();
      await proposals.nth(2).locator('textarea').fill('用户改写后的判断：先保留差异，不急着下结论。');
      await proposals.nth(2).getByRole('button', { name: '改写并接回', exact: true }).click();
      await proposals.nth(3).getByRole('button', { name: '拒绝', exact: true }).click();
      session = await state(page);
      check('rewrite and reject preserve raw proposal and original materials', Object.keys(session.materials).length === 9 && session.materials[session.suggestions[2].adoptedId].origin === 'user-edited-proposal' && session.suggestions[2].text !== session.materials[session.suggestions[2].adoptedId].original && session.suggestions[3].status === 'rejected' && Object.keys(rawBefore).every(id => session.materials[id].original === rawBefore[id].original));
      await page.locator('[data-action=undo]').click(); await wait(100);
      check('undoing returned placement does not delete canonical material', Object.keys((await state(page)).materials).length === 9 && await page.locator('[data-restore]').count() > 0);
      await page.locator('[data-save-state]').filter({ hasText: '已保存' }).waitFor();
      await page.reload(); await ready(page, engine, 9);
      const unplaced = await page.locator('[data-restore]').count();
      check('unplaced materials survive reload and remain recoverable', unplaced > 0);
      while (await page.locator('[data-restore]').count()) { await page.locator('[data-restore]').first().click(); await wait(50); }
      check('explicitly restoring placement reuses identity without duplication', Object.keys((await state(page)).materials).length === 9 && nodes(await snap(page), engine).filter(n => n.materialId || n.data?.materialId).length === 9);
      await page.locator('[data-action=unlink]').click(); await wait(100);
      check('unlink retains both endpoint materials', lines(await snap(page), engine).length === 0 && Object.keys((await state(page)).materials).length === 9);
      await pick(page, ['m001', 'm002']); await page.locator('[data-action=connect]').click(); await wait(100);
      await page.locator('[data-save-state]').filter({ hasText: '已保存' }).waitFor();
      const preserved = await state(page); await page.reload(); await ready(page, engine, 9);
      check('refresh restores originals, sources, notes, relationships and adoption', JSON.stringify(await state(page)) === JSON.stringify(preserved));
      const downloadPromise = page.waitForEvent('download'); await page.locator('[data-action=export]').click(); const download = await downloadPromise;
      const exportPath = path.join(run, `${engine}-export.json`); await download.saveAs(exportPath);
      await page.getByLabel('材料数量').selectOption('7'); await ready(page, engine, 7);
      await page.getByLabel('导入样例文件', { exact: true }).setInputFiles(exportPath); await ready(page, engine, 9);
      check('export/import roundtrip retains independent domain and native layout', JSON.stringify((await state(page)).materials) === JSON.stringify(preserved.materials) && (await state(page)).suggestions.length === preserved.suggestions.length);
      const beforeBad = JSON.stringify(await state(page));
      await page.getByLabel('导入样例文件', { exact: true }).setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":1,"engine":"' + engine + '","materials":{}}') });
      await page.locator('[data-message]').filter({ hasText: '未导入' }).waitFor();
      check('corrupt import does not overwrite current state', JSON.stringify(await state(page)) === beforeBad);
      const corruptLayout = structuredClone(await state(page));
      if (engine === 'drawnix') corruptLayout.layout.children[0].points = [[null, 3], [4, 5]]; else corruptLayout.layout.nodes[0].position.x = 'not-a-number';
      await page.getByLabel('导入样例文件', { exact: true }).setInputFiles({ name: 'bad-layout.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(corruptLayout)) });
      await page.locator('[data-message]').filter({ hasText: '未导入' }).waitFor();
      check('invalid native coordinates rejected before mutation', JSON.stringify(await state(page)) === beforeBad);
      for (const count of [50, 200]) {
        const started = performance.now(); await page.getByLabel('材料数量').selectOption(String(count)); await ready(page, engine, count);
        const loadMs = performance.now() - started;
        await page.evaluate(() => { window.__observer?.disconnect(); window.__frames = []; window.__longTasks = []; let last = performance.now(); window.__tracking = true; const tick = now => { if (window.__tracking) { window.__frames.push(now - last); last = now; requestAnimationFrame(tick); } }; requestAnimationFrame(tick); window.__observer = new PerformanceObserver(list => window.__longTasks.push(...list.getEntries().map(e => e.duration))); window.__observer.observe({ type: 'longtask' }); });
        await page.locator('[data-tool=pan]').click(); const rect = await page.locator('[data-engine-surface]').boundingBox();
        const viewportBeforePan = (await snap(page)).viewport;
        await page.mouse.move(rect.x + rect.width * .84, rect.y + rect.height * .6); await page.mouse.down(); await page.mouse.move(rect.x + rect.width * .84 + 150, rect.y + rect.height * .6 + 70, { steps: 40 }); await page.mouse.up();
        await wait(100); const viewportAfterPan = (await snap(page)).viewport;
        check(`${count} native pan changes viewport`, JSON.stringify(viewportBeforePan) !== JSON.stringify(viewportAfterPan), { before: viewportBeforePan, after: viewportAfterPan, diagnostics: await page.evaluate(() => window.__canvasLab.diagnostics()) });
        await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control'); await wait(250);
        const viewportAfterZoom = (await snap(page)).viewport;
        check(`${count} native zoom changes scale`, (viewportAfterZoom.zoom ?? 0) !== (viewportAfterPan.zoom ?? 0));
        const timing = await page.evaluate(() => { window.__tracking = false; window.__observer?.disconnect(); const a = window.__frames.sort((x, y) => x - y); return { frameP50Ms: a[Math.floor(a.length * .5)], frameP95Ms: a[Math.floor(a.length * .95)], longTasksMs: window.__longTasks, renderedMaterialCards: document.querySelectorAll('[data-material]').length }; });
        const cdp = await context.newCDPSession(page); const heap = await cdp.send('Runtime.getHeapUsage'); await cdp.detach();
        result.metrics.push({ count, loadAndSaveMs: loadMs, ...timing, usedJSHeapBytes: heap.usedSize });
        check(`${count} materials remain after pan/zoom`, Object.keys((await state(page)).materials).length === count);
      }
      // Deliberately corrupt ONLY this browser context's lab database.
      const corrupt = { schema: 'broken-sentinel', preserve: 'do-not-overwrite' };
      await page.evaluate(async ({ engine, corrupt }) => {
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open('trace-canvas-lab-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        await new Promise((resolve, reject) => { const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put(corrupt, engine); tx.oncomplete = resolve; tx.onerror = reject; }); db.close();
      }, { engine, corrupt });
      await page.reload(); await page.locator('[data-message]').filter({ hasText: '暂停自动保存' }).waitFor(); await wait(400);
      const retained = await page.evaluate(async engine => { const r = indexedDB.open('trace-canvas-lab-v1', 1); const db = await new Promise(resolve => r.onsuccess = () => resolve(r.result)); const result = await new Promise(resolve => { const q = db.transaction('sessions').objectStore('sessions').get(engine); q.onsuccess = () => resolve(q.result); }); db.close(); return result; }, engine);
      check('damaged stored session is protected, not silently reseeded', JSON.stringify(retained) === JSON.stringify(corrupt));
      await page.getByRole('button', { name: '明确重置损坏的测试场景' }).click(); await ready(page, engine);
      check('explicit reset recovers only the lab session', Object.keys((await state(page)).materials).length === 7);
      await page.setViewportSize({ width: 720, height: 1000 });
      check('narrow layout does not overflow the page', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await shot(page, `${engine}-narrow.png`);
      await page.setViewportSize(report.viewport);
      check('no page/console errors or warnings', result.errors.length === 0, { errors: result.errors });
      check('no external browser requests or paid services', result.externalRequests.length === 0);
      result.passed = true;
    } catch (e) {
      result.passed = false; result.failure = e.stack; console.error(`FAIL ${engine}: ${e.message}`); await shot(page, `${engine}-failure.png`).catch(() => {});
      fs.writeFileSync(path.join(run, `${engine}-state.json`), JSON.stringify(await state(page).catch(() => null), null, 2));
    } finally { await context.close(); }
  }
} finally {
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(run, 'results.json'), JSON.stringify(report, null, 2)); fs.writeFileSync(path.join(evidence, 'latest.json'), JSON.stringify({ run, ...report }, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
console.log('Evidence:', run);
if (Object.values(report.results).some(result => !result.passed) && !process.env.LAB_SMOKE) process.exitCode = 1;

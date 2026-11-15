// Focused W1 evidence: actual Electron renderer + actual discussion preload +
// actual native client + Product HTTP/SQLite. Not an installer or Agent test.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { once } = require('node:events');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const workspace = path.dirname(root);
const out = path.resolve(process.env.TRACE_E2E_OUTPUT_DIR || path.join(root, '.test-results/frontend-replacement/w1-authority/desktop-save'));
assert.ok(out.startsWith(path.join(root, '.test-results') + path.sep));
fs.mkdirSync(out, { recursive: true });
const profile = path.join(out, 'electron-profile');
const temp = path.join(out, 'tmp');
const selectedProject = path.join(out, 'synthetic-project');
for (const p of [profile, temp, selectedProject]) fs.mkdirSync(p, { recursive: true });
const file = path.join(out, 'product.sqlite');
assert.ok(!fs.existsSync(file), 'Use a clean evidence directory; do not overwrite a previous test database');
const dist = path.join(root, 'apps/web/dist-vercel');
const preload = path.join(root, 'apps/desktop-pet/src/desktop/discussion-preload.cjs');
const clientURL = pathToFileURL(path.join(root, 'apps/desktop-pet/src/desktop/runtime-client.mjs')).href;
const productURL = pathToFileURL(path.join(workspace, 'trace-runtime/packages/product/workspace/src/workspace.mjs')).href;
const executablePath = process.env.TRACE_ELECTRON_EXECUTABLE || path.join(root, 'apps/desktop-pet/node_modules/electron/dist/electron.exe');
const checks = [], requests = [], replies = [], pageErrors = [], consoleErrors = [], ipc = [], externalRequests = [], unexpectedDialogs = [];
let product, server, app, page, origin, held = null, holdNextDraft = false;
const check = (name, condition = true) => { assert.ok(condition, name); checks.push({ name, passed: true }); console.log(`PASS ${name}`); };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mjs': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
async function until(condition, message, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error(message);
}
const read = () => product.read();
const harness = path.join(out, 'electron-main.mjs');
fs.writeFileSync(harness, `
import { app, BrowserWindow, ipcMain, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createRuntimeCapabilityClient } from ${JSON.stringify(clientURL)};
app.setPath('userData', process.env.TRACE_E2E_PROFILE);
app.commandLine.appendSwitch('no-first-run');
// Finish loading the ESM entry before awaiting Electron's readiness.
app.whenReady().then(async () => {
const origin = process.env.TRACE_E2E_ORIGIN;
const events = [];
const client = createRuntimeCapabilityClient({ origin, cloudOrigin:'https://disabled.example', projectDir:process.env.TRACE_E2E_PROJECT,
  fetchImpl:(url,options) => { if(new URL(url).origin !== origin) throw Error('External network forbidden'); return fetch(url,options); },
  cloudFetchImpl:() => { throw Error('Cloud services disabled for this test'); } });
session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
  const url = new URL(details.url);
  const blocked = !['data:','blob:'].includes(url.protocol) && url.origin !== origin;
  if(blocked) events.push({kind:'blocked-network',url:details.url});
  callback({cancel:blocked});
});
session.defaultSession.on('will-download', (_event,item) => {
  const name = item.getFilename();
  if(!/^Trace-recovery-\\d+\\.json$/.test(name)) { item.cancel(); return; }
  item.setSavePath(path.join(process.env.TRACE_E2E_OUTPUT,'recovery-download.json'));
});
let window;
const demandSender = event => {
  if(event.sender !== window?.webContents || new URL(event.sender.getURL()).origin !== origin) throw Error('Not the isolated Trace renderer');
};
ipcMain.on('trace-native:runtime-status', (event) => { event.returnValue = {connected:true,state:'ready',bundled:false}; });
ipcMain.handle('trace-native:workspace', async(event,payload) => {
  demandSender(event); events.push({kind:'workspace',pathname:payload.pathname,method:payload.options?.method||'GET'});
  return client.request({operation:'workspace.request',pathname:payload.pathname,method:payload.options?.method||'GET',...(payload.options?.body ? {body:payload.options.body}:{})});
});
ipcMain.handle('trace-native:capability', async(event,request) => {
  demandSender(event); events.push({kind:'capability',operation:request.operation});
  if(request.operation === 'product.command') return client.request(request);
  // Explicit disabled service configuration, not fabricated execution results.
  if(request.operation === 'capabilities') return {connected:true,search:{enabled:false},agent:{enabled:false,profiles:[]}};
  if(request.operation === 'work.environment') return {connected:false,projectName:'合成测试项目',agentLabel:'Codex',locationLabel:'Agent 未连接'};
  if(request.operation === 'desktop.setup.status') return {runtime:{connected:true,bundled:false},project:{connected:false},codex:{available:false,ready:false}};
  if(request.operation === 'zhihu.status') return {enabled:false,oauth:{configured:false,status:'disabled'}};
  throw Error('This service is explicitly disabled in the isolated save test');
});
window = new BrowserWindow({show:false,width:1440,height:940,webPreferences:{preload:${JSON.stringify(preload)},contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
await window.loadURL(origin+'/app');
globalThis.traceEvidence = {events};
app.on('before-quit', () => { client.close(); fs.writeFileSync(path.join(process.env.TRACE_E2E_OUTPUT,'ipc-events.json'),JSON.stringify(events,null,2)); });
}).catch(error => { fs.writeFileSync(path.join(process.env.TRACE_E2E_OUTPUT,'electron-boot-error.txt'),error.stack||String(error)); app.exit(1); });
`, 'utf8');

async function launch() {
  app = await electron.launch({ executablePath, args: [harness], timeout: 25000, env: { ...process.env,
    TRACE_E2E_ORIGIN: origin, TRACE_E2E_OUTPUT: out, TRACE_E2E_PROFILE: profile, TRACE_E2E_PROJECT: selectedProject,
    APPDATA: path.join(profile, 'appdata'), LOCALAPPDATA: path.join(profile, 'localappdata'), TEMP: temp, TMP: temp, TMPDIR: temp,
  } });
  page = await app.firstWindow({ timeout: 15000 });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('dialog', dialog => { unexpectedDialogs.push({type:dialog.type(),message:dialog.message()}); void dialog.dismiss().catch(() => {}); });
  page.on('console', event => { if (event.type() === 'error') consoleErrors.push(event.text()); });
  page.on('request', request => { const url = new URL(request.url()); if (!['blob:','data:'].includes(url.protocol) && url.origin !== origin) externalRequests.push(request.url()); });
  await page.locator('#capture-input').waitFor();
}

(async () => {
  try {
    const { createProductWorkspace } = await import(productURL);
    const open = () => createProductWorkspace({ file, installationId:'frontend-replacement-w1-test', workspaceId:'frontend-replacement-w1-test' });
    product = open();
    server = http.createServer(async (request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname.startsWith('/api/')) {
        let raw = '';
        request.on('data', chunk => { raw += chunk; });
        const originalEnd = response.end.bind(response);
        response.end = (...args) => {
          let body; try { body = JSON.parse(raw); } catch { body = null; }
          if (body) requests.push({ path:pathname, body });
          let reply; try { reply = JSON.parse(String(args[0])); } catch { reply = null; }
          if (reply) replies.push({ path:pathname, status:response.statusCode, body:reply });
          if (holdNextDraft && body?.operations?.some(operation => operation.type === 'capture.draft')) {
            holdNextDraft = false; held = { reply, release:() => originalEnd(...args) }; return response;
          }
          return originalEnd(...args);
        };
        if (!await product.handle(request, response)) { response.writeHead(404); response.end('{}'); }
        return;
      }
      const target = pathname === '/app' || pathname === '/' ? '/index.html' : pathname;
      const p = path.resolve(dist, '.' + target);
      if (!p.startsWith(dist + path.sep) || !fs.existsSync(p) || !fs.statSync(p).isFile()) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'content-type':mime[path.extname(p)] || 'application/octet-stream', 'cache-control':'no-store' });
      fs.createReadStream(p).pipe(response);
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); origin = `http://127.0.0.1:${server.address().port}`;
    await launch();
    check('isolated Electron starts with a real empty Product SQLite workspace', read().revision === 0 && read().host === null);
    const original = '桌面隔离保存：限定于本次测试的原话。';
    await page.locator('#capture-input').fill(original);
    await page.locator('#capture-form [type=submit]').click();
    await page.locator('[data-selection=originalText]').waitFor();
    await until(() => read().host?.chain.matters.length === 1, 'native capture not committed');
    const id = read().host.chain.matters[0].id;
    check('native capture follows authority identity and object route', read().host.chain.matters[0].originalText === original && new URL(page.url()).searchParams.get('matter') === id);
    await page.getByRole('button', { name:'个人与设置', exact:true }).click();
    await page.locator('.web-dialog input[name=name]').fill('桌面权威保存验证');
    await page.locator('.web-dialog [type=submit]').click();
    await until(() => read().host.preferences?.displayName === '桌面权威保存验证', 'preferences not committed');
    // Disk commit precedes renderer ACK. Do not navigate while its successful
    // continuation is still pending, or bypass the real beforeunload guard.
    await page.locator('.web-dialog').waitFor({state:'hidden'});
    await page.locator('.web-status[data-state=saved]').waitFor({state:'attached'});
    await page.goto(origin+'/app?view=home'); await page.locator('#capture-input').waitFor();
    holdNextDraft = true;
    await page.locator('#capture-input').fill('旧请求已经落盘但尚未收到回执 A');
    await until(() => held !== null, 'draft response was not held');
    check('held acknowledgement follows a real completed SQLite transaction', read().host.chain.capture.text.endsWith(' A'));
    await page.locator('#capture-input').fill('保存期间继续输入的新草稿 B');
    await page.waitForTimeout(600); // Let the first debounce expire while pending.
    held.release(); held = null;
    await until(() => read().host.chain.capture.text === '保存期间继续输入的新草稿 B', 'new draft was stranded after old ACK');
    check('native old acknowledgement never overwrites new typing and debounce resumes', await page.locator('#capture-input').inputValue() === '保存期间继续输入的新草稿 B');
    await page.locator('.web-status[data-state=saved]').waitFor({state:'attached'});
    const beforeConflict = read();
    product.execute({protocolVersion:1,commandId:'independent-test-writer',expectedRevision:beforeConflict.revision,operations:[{type:'preferences.update',displayName:'另一窗口已保存的名称',reduceMotion:false}]});
    await page.locator('#capture-input').fill('冲突后仍须保留的本地草稿 C');
    await page.locator('.web-status[data-state=error]').waitFor();
    check('real native 409 envelope preserves both disk head and local draft', read().host.preferences.displayName === '另一窗口已保存的名称' && read().host.chain.capture.text === '保存期间继续输入的新草稿 B' && await page.locator('#capture-input').inputValue() === '冲突后仍须保留的本地草稿 C');
    await page.locator('[data-export]').click();
    const download = path.join(out, 'recovery-download.json');
    await until(() => fs.existsSync(download) && fs.statSync(download).size > 0, 'recovery download not written inside project');
    const exported = JSON.parse(fs.readFileSync(download, 'utf8'));
    check('actual desktop recovery download retains current draft and frozen command', exported.host.chain.capture.text === '冲突后仍须保留的本地草稿 C' && exported.recoveryDetails.command.operations[0].text === '冲突后仍须保留的本地草稿 C');
    await page.screenshot({path:path.join(out,'conflict-recovery.png')});
    await page.locator('[data-load]').click();
    await page.locator('.web-dialog').getByRole('button',{name:'载入已保存版本',exact:true}).click();
    await until(async () => await page.locator('#capture-input').inputValue() === '保存期间继续输入的新草稿 B', 'explicit recovery did not load authority');
    check('explicit desktop recovery installs the real saved head without rewriting it', read().revision === beforeConflict.revision + 1 && read().host.chain.matters[0].id === id);
    await page.screenshot({path:path.join(out,'desktop-saved.png')});
    ipc.push(...await app.evaluate(() => globalThis.traceEvidence.events));
    await app.close(); app = null;
    const saved = read(); product.close(); product = open();
    assert.deepEqual(read(), saved);
    await launch();
    check('new Electron process and reopened SQLite retain the same object and draft', await page.locator('#capture-input').inputValue() === '保存期间继续输入的新草稿 B' && read().host.chain.matters[0].id === id);
    check('renderer writes are command-shaped, never whole-host overwrites', requests.filter(request => request.path === '/api/product/commands').length >= 5 && requests.every(request => !Object.hasOwn(request.body, 'host')));
    check('real Product successes carry matching committed receipt and head', replies.filter(reply => reply.path === '/api/product/commands' && reply.status === 200).every(reply => reply.body.receipt?.status === 'committed' && reply.body.headRevision === reply.body.revision && reply.body.receipt.afterRevision === reply.body.revision));
    check('no Agent execution or non-local network request occurred', !ipc.some(event => /^(agent\.run|work\.run|zhihu\.oauth)/.test(event.operation || '')) && externalRequests.length === 0 && !ipc.some(event => event.kind === 'blocked-network'));
    check('no renderer JavaScript errors', pageErrors.length === 0);
    fs.writeFileSync(path.join(out,'final-state.json'),JSON.stringify(read(),null,2));
  } catch (error) {
    checks.push({name:'run error',passed:false,error:error.stack}); process.exitCode = 1; console.error(error.stack);
    if (page) { await page.screenshot({path:path.join(out,'failure.png')}).catch(() => {}); fs.writeFileSync(path.join(out,'failure-dom.txt'),await page.locator('body').innerText().catch(() => 'unavailable')); }
  } finally {
    if (held) held.release();
    await app?.close().catch(() => {});
    if (server) await new Promise(resolve => server.close(resolve));
    product?.close();
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({scope:'Actual isolated Electron renderer/preload/native-client/Product SQLite save path; NOT packaged main, installer, real Agent, or final new frontend acceptance',checks,requests,replies,pageErrors,consoleErrors,ipc,externalRequests,unexpectedDialogs},null,2));
    console.log('EVIDENCE '+out);
  }
})();

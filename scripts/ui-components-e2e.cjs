// Actual built Trace routes, isolated Browser/IndexedDB or Electron + production
// preload/client + fixed Product SQLite. No user profile, real Agent or secrets.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium, _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const desktop = process.argv.includes('--desktop');
const out = path.resolve(process.env.TRACE_E2E_OUTPUT_DIR || path.join(root, '.test-results/frontend-replacement/ui-resources', desktop ? 'desktop' : 'browser'));
assert.ok(out.startsWith(path.join(root, '.test-results') + path.sep));
assert.ok(!fs.existsSync(path.join(out, 'report.json')), 'Use a fresh evidence directory');
fs.mkdirSync(out, { recursive: true });
const temp=path.join(out,'tmp');fs.mkdirSync(temp,{recursive:true});
for(const key of ['TEMP','TMP','TMPDIR'])process.env[key]=temp;
const checks=[], pageErrors=[], consoleErrors=[], failures=[], requests=[], external=[], measurements=[];
const check=(name,value=true)=>{ assert.ok(value,name); checks.push({name,passed:true}); console.log('PASS '+name); };
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf','.txt':'text/plain'};
let server, browser, app, context, page, product, base, fixture, before, searchFailure=false;

async function capture(page, name) {
  if(desktop) {
    // Hidden Windows Electron surfaces can stop painting after native resize.
    // Use the installed Electron's actual hidden-page capture API, not a fake
    // screenshot or a visible window on the user's desktop.
    const png=await app.evaluate(async({BrowserWindow})=>{
      const image=await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
      if(image.isEmpty())throw Error('Electron returned an empty native capture');
      return image.toPNG().toString('base64');
    });
    fs.writeFileSync(path.join(out,name),Buffer.from(png,'base64'));
  } else await page.screenshot({path:path.join(out,name)});
}

async function exercise(page, state) {
  await page.goto(base+'/app?view=chain&matter=ui-main&screen=resume');
  await page.locator('.web-context-menu').waitFor();
  const menu=page.getByRole('button',{name:'事项更多操作',exact:true});
  await menu.focus(); await page.keyboard.press('Enter');
  await page.getByRole('menuitem',{name:'查看这项理解的演变'}).waitFor();
  const quality = await page.evaluate(() => {
    const m=document.querySelector('.tu-menu'), item=m.querySelector('.tu-menu-item');
    const ms=getComputedStyle(m), is=getComputedStyle(item);
    const buttons=[...document.querySelectorAll('.trace-ui .tu-icon-button')].filter(e=>e.getBoundingClientRect().width);
    return {outer:parseFloat(ms.borderRadius),inner:parseFloat(is.borderRadius),padding:parseFloat(ms.paddingLeft),border:parseFloat(ms.borderLeftWidth),easing:ms.animationTimingFunction,numeric:ms.fontVariantNumeric,buttons:buttons.map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,icon:e.querySelector('svg')?.getBoundingClientRect().width||0}))};
  });
  measurements.push({fivePrinciples:quality});
  check('real menu nested radii match inset',quality.inner===Math.max(0,quality.outer-quality.padding-quality.border));
  check('real menu fast-start soft-landing easing',quality.easing==='cubic-bezier(0.22, 1, 0.36, 1)');
  check('portaled menu preserves tabular numerals',quality.numeric==='tabular-nums');

  await capture(page,'five-principles-menu.png');
  await page.keyboard.press('Escape');
  // Radix restores focus after the portal closes. Hidden Electron capture can
  // finish before that scheduled work; observe the eventual real focus instead
  // of forcing focus or assuming a synchronous close.
  await page.waitForFunction(e=>document.activeElement===e,await menu.elementHandle(),{timeout:5000});
  check('Radix menu Escape restores the original trigger focus',await menu.evaluate(e=>e===document.activeElement));
  await menu.click(); await page.getByRole('menuitem',{name:'查看这项理解的演变'}).click();
  await page.getByRole('tab',{name:'演变',exact:true}).waitFor();
  check('real matter menu opens scoped evolution in the actual lookup route',new URL(page.url()).searchParams.get('matter')==='ui-main' && await page.getByRole('tab',{name:'演变',exact:true}).getAttribute('aria-selected')==='true');
  check('evolution never offers upstream one-click rollback',await page.getByRole('button',{name:/Revert|恢复版本|回滚/}).count()===0);
  await page.getByRole('button',{name:/理解修订 · v2/}).click();
  check('actual persisted revision exposes before and after',(await page.locator('.tu-revision-compare').innerText()).includes('修改前 · v1') && (await page.locator('.tu-revision-compare').innerText()).includes('修改后 · v2'));
  const readonly=await state();
  check('viewing and comparing history leave Product content untouched',JSON.stringify(readonly.host.chain.matters)===JSON.stringify(before.host.chain.matters));
  const hitBoxes=await page.locator('.trace-ui .tu-icon-button').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().width).map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height,i:e.querySelector('svg')?.getBoundingClientRect().width||0})));
  check('visible lookup icons have larger actual hit boxes',hitBoxes.length>0&&hitBoxes.every(b=>b.w>=32&&b.h>=32&&b.w>b.i));
  await capture(page,'lookup-evolution.png');
  await page.getByRole('tab',{name:'内容',exact:true}).click();
  const input=page.getByRole('searchbox',{name:'搜索全部痕迹'});
  await input.fill('没有这组词');
  await page.getByRole('heading',{name:'没有找到匹配内容'}).waitFor();
  check('no-match search is explicit and not replaced with demo rows',await page.locator('[data-result-select]').count()===0);
  await page.getByRole('button',{name:'清除筛选',exact:true}).click();
  await input.dispatchEvent('compositionstart'); await input.fill('先观察'); await input.press('Enter');
  check('IME composition does not submit or replace the route query',new URL(page.url()).searchParams.get('q')!== '先观察');
  await input.dispatchEvent('compositionend',{data:'先观察'});
  await page.waitForURL(url=>url.searchParams.get('q')==='先观察');
  check('IME commit applies the real search once it is complete',await page.locator('[data-result-select]').count()>0);
  await input.press('ArrowDown');
  check('keyboard can enter results from the search field',await page.evaluate(()=>document.activeElement?.hasAttribute('data-result-select')));
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  const selected=new URL(page.url()).searchParams.get('selected');
  check('keyboard selection retains a stable content ID',Boolean(selected));
  await page.reload(); await page.locator('.tu-record-detail h2').waitFor();
  check('refresh restores query and selected identity',new URL(page.url()).searchParams.get('selected')===selected && await input.inputValue()==='先观察');
  await page.getByRole('button',{name:'回到原处继续',exact:true}).click();
  await page.locator('.web-context-menu').waitFor();
  // Exact historical/original re-entry deliberately keeps the existing record dialog.
  await page.locator('.web-dialog[open]').waitFor(); await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.locator('.chain-root [data-action=comparison]').filter({visible:true}).first().click();
  await page.waitForURL(url=>url.searchParams.get('view')==='compare');
  check('lookup navigation does not leak UI-only fields into real comparison commands',Object.keys((await state()).host.comparisons).length>0);
  await page.locator('.web-continuity button').first().click();
  await page.waitForURL(url=>url.searchParams.get('view')==='chain');
  await page.locator('.web-dialog[open]').waitFor(); await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:/返回搜索结果|返回全部痕迹/}).click();
  await page.locator('.tu-record-detail h2').waitFor();
  check('return from the original preserves search position and selection',new URL(page.url()).searchParams.get('selected')===selected && await input.inputValue()==='先观察');
  await input.fill('');
  await page.getByRole('button',{name:'材料',exact:true}).click();
  const sources=page.locator('[data-result-select]');
  await sources.filter({hasText:'本地截图局部'}).click();
  check('missing source is explicit while the captured excerpt remains visible',(await page.locator('.tu-record-detail').innerText()).includes('未记录可打开的原出处') && (await page.locator('.tu-record-detail').innerText()).includes('截图中的原始摘录'));
  await sources.filter({hasText:'公开材料定位'}).click();
  const link=page.getByRole('link',{name:'查看原出处'});
  check('original-source link preserves exact locator',await link.getAttribute('href')==='https://example.test/article#fragment-18');
  // Long Chinese data is made through Product capture; no HTML fixture view.
  await page.getByRole('button',{name:'原表达',exact:true}).click();
  await input.fill('长标题'); await page.locator('[data-result-select]').first().click();
  check('full long Chinese content is available beyond row truncation',(await page.locator('.tu-read-section p').first().innerText()).length>600);
  const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth>innerWidth || [...document.querySelectorAll('.tu-library,.tu-record-detail')].some(e=>e.scrollWidth>e.clientWidth+2));
  check('desktop long content does not cause horizontal overflow',!await overflow());
  await capture(page,'lookup-long-content.png');
  {
    if(desktop) await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(390,844)); else await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>innerWidth===390);
    check('narrow window shows only the selected work surface',await page.locator('.tu-record-detail').isVisible() && !await page.locator('.tu-find-panel').isVisible());
    await page.getByRole('button',{name:'返回查找结果',exact:true}).click();
    check('narrow return restores editable query and list without losing selection',await input.isVisible() && await input.inputValue()==='长标题');
    await page.locator('[data-result-select]').first().click();
    check('narrow Chinese content has no horizontal overflow',!await overflow());
    await capture(page,'lookup-narrow.png');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.getByRole('button',{name:'更多查找操作',exact:true}).click();
    check('reduced motion disables menu entrance animation',await page.getByRole('menu').evaluate(e=>getComputedStyle(e).animationName)==='none');
    await page.keyboard.press('Escape');
    if(desktop) await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,940)); else await page.setViewportSize({width:1440,height:940});
  }
  if(desktop) {
    const normalDpr=await page.evaluate(()=>devicePixelRatio);
    for(const factor of [1.25,2]) {
      await app.evaluate(({BrowserWindow},factor)=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor),factor);
      await page.waitForFunction(expected=>Math.abs(devicePixelRatio-expected)<0.1,normalDpr*factor);
      check(`Electron actual ${factor*100}% zoom preserves the work surface without horizontal overflow`,!await overflow());
      await capture(page,`lookup-zoom-${factor*100}.png`);
    }
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  }
  await page.getByRole('button',{name:'个人与设置',exact:true}).click();
  await page.locator('.web-dialog input[name=name]').fill('UI 真实保存验证');
  await page.locator('.web-dialog [type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('.web-status')?.getAttribute('data-state')==='saved');
  await page.waitForTimeout(200);
  check('shared controls do not break actual persisted settings',(await state()).host.preferences.displayName==='UI 真实保存验证');
}

(async()=>{
  try {
    const {applyProductOperations,validateProductOperations}=await import('@trace/product-workspace');
    const operations= (await import('./helpers/ui-fixture.mjs')).uiFixtureOperations();
    operations.forEach((op,index)=>{try{validateProductOperations([op]);}catch(cause){throw Error('Fixture operation '+index+' rejected: '+JSON.stringify(op),{cause});}});
    fixture=applyProductOperations(null,operations);
    if(desktop) {
      const {createProductWorkspace}=await import('@trace/product-workspace/node');
      const file=path.join(out,'product.sqlite');assert.ok(!fs.existsSync(file));
      product=createProductWorkspace({file});product.execute({protocolVersion:1,commandId:'ui-synthetic-seed',expectedRevision:0,operations});
    }
    server=http.createServer(async(req,res)=>{
      const pathname=new URL(req.url,'http://localhost').pathname;
      if(pathname==='/api/zhihu/status') {res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({enabled:false,oauth:{configured:false,status:'disabled'}}));return;}
      if(pathname.startsWith('/api/search/')) {res.writeHead(searchFailure?503:200,{'content-type':'application/json'});res.end(JSON.stringify({error:'Explicitly disabled test search service',items:[]}));return;}
      if(desktop && pathname.startsWith('/api/')) { if(!await product.handle(req,res)){res.writeHead(404);res.end('{}');}return; }
      const dist=path.join(root,'apps/web/dist-vercel');
      const file=pathname==='/__test/browser-workspace.mjs'?path.join(root,'apps/web/src/product/browser-workspace.mjs'):path.resolve(dist,'.'+(['/','/app'].includes(pathname)?'/index.html':pathname));
      if((!file.startsWith(dist+path.sep)&&pathname!=='/__test/browser-workspace.mjs')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
      res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(file).pipe(res);
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
    if(desktop) {
      const preload=path.join(root,'apps/desktop-pet/src/desktop/discussion-preload.cjs');
      const client=pathToFileURL(path.join(root,'apps/desktop-pet/src/desktop/runtime-client.mjs')).href;
      const profile=path.join(out,'profile');fs.mkdirSync(profile,{recursive:true});
      const harness=path.join(out,'electron-main.mjs');
      fs.writeFileSync(harness,`import {app,BrowserWindow,ipcMain,session} from 'electron'; import {createRuntimeCapabilityClient} from ${JSON.stringify(client)};
app.setPath('userData',${JSON.stringify(profile)}); app.whenReady().then(async()=>{const origin=${JSON.stringify(base)}; const client=createRuntimeCapabilityClient({origin,cloudOrigin:'https://disabled.example',projectDir:${JSON.stringify(out)},fetchImpl:(url,options)=>{if(new URL(url).origin!==origin) throw Error('External request blocked');return fetch(url,options);},cloudFetchImpl:()=>{throw Error('Cloud disabled');}});let w;
session.defaultSession.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!['blob:','data:'].includes(new URL(d.url).protocol)&&new URL(d.url).origin!==origin}));
ipcMain.on('trace-native:runtime-status',e=>{e.returnValue={connected:true,state:'ready',bundled:false};});
ipcMain.handle('trace-native:workspace',(e,p)=>{if(e.sender!==w.webContents)throw Error('sender');return client.request({operation:'workspace.request',pathname:p.pathname,method:p.options?.method||'GET',...(p.options?.body?{body:p.options.body}:{})});});
ipcMain.handle('trace-native:capability',(e,p)=>{if(e.sender!==w.webContents)throw Error('sender');if(p.operation==='product.command')return client.request(p);if(p.operation==='capabilities')return {agent:{enabled:false,profiles:[]}};if(p.operation==='zhihu.status')return {enabled:false,oauth:{configured:false}};if(p.operation==='work.environment')return {connected:false};throw Error('Explicitly disabled test capability: '+p.operation);});
w=new BrowserWindow({show:false,width:1440,height:940,webPreferences:{preload:${JSON.stringify(preload)},contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});await w.loadURL(origin+'/app?view=all');});`);
      app=await electron.launch({executablePath:path.join(root,'apps/desktop-pet/node_modules/electron/dist/electron.exe'),args:[harness],env:{...process.env,APPDATA:path.join(profile,'appdata'),LOCALAPPDATA:path.join(profile,'localappdata'),TEMP:path.join(out,'tmp'),TMP:path.join(out,'tmp')}});
      page=await app.firstWindow();
    } else {
      browser=await chromium.launch({headless:true});context=await browser.newContext({viewport:{width:1440,height:940}});page=await context.newPage();
    }
    page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push({text:m.text(),location:m.location()});});
    page.on('request',r=>{requests.push({url:r.url(),method:r.method()});const u=new URL(r.url());if(!['blob:','data:'].includes(u.protocol)&&u.origin!==base)external.push(r.url());});
    page.on('response',r=>{if(r.status()>=400)failures.push({url:r.url(),status:r.status()});});
    const state=()=>desktop?Promise.resolve(product.read()):page.evaluate(async()=> (await import('/__test/browser-workspace.mjs')).readBrowserWorkspace());
    if(!desktop) {
      await page.goto(base+'/app');
      await page.locator('#capture-input').waitFor();
      await page.evaluate(async host=> (await import('/__test/browser-workspace.mjs')).putBrowserWorkspace({expectedRevision:0,commandId:'ui-synthetic-seed',host}),fixture);
    }
    before=await state();
    await exercise(page,state);
    if(!desktop) {
      // Two display densities, measured in the built product; not an isolated kit gallery.
      const dense=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:2});
      const p=await dense.newPage();await p.goto(base+'/app');await p.locator('#capture-input').waitFor();
      await p.evaluate(async host=>(await import('/__test/browser-workspace.mjs')).putBrowserWorkspace({expectedRevision:0,commandId:'density-seed',host}),fixture);
      await p.goto(base+'/app?view=all');await p.locator('.tu-library').waitFor();await p.screenshot({path:path.join(out,'lookup-dpr2.png')});
      check('DPR2 uses the same readable control border and typography',await p.locator('.tu-search-field').evaluate(e=>getComputedStyle(e).borderTopWidth)==='1px');
      await dense.close();
      for(const count of [50,200]) {
        const c=await browser.newContext({viewport:{width:1440,height:940}}),p=await c.newPage();await p.goto(base+'/app');await p.locator('#capture-input').waitFor();
        const many=structuredClone(fixture);for(let i=many.chain.sources.length;i<count;i++)many.chain.sources.push({id:'measure-'+i,ownerMatterId:'ui-main',title:`测量材料 ${i+1}`,excerpt:'自产测量内容；没有自动采用或交给 Agent。',url:null,origin:'user-paste'});
        await p.evaluate(async host=>(await import('/__test/browser-workspace.mjs')).putBrowserWorkspace({expectedRevision:0,commandId:'measure-seed',host}),many);
        const start=performance.now();await p.goto(base+'/app?view=search&kind=source');await p.locator('[data-result-select]').nth(count-1).waitFor();
        const loadMs=performance.now()-start;
        const render=await p.evaluate(async()=>{const frames=[];let prior=performance.now();for(let i=0;i<30;i++){await new Promise(requestAnimationFrame);const now=performance.now();frames.push(now-prior);prior=now;document.querySelector('.tu-find-panel').scrollTop+=20;}return {frames,heapBytes:performance.memory?.usedJSHeapSize||null,rows:document.querySelectorAll('[data-result-select]').length};});
        const trigger=p.getByRole('button',{name:'更多查找操作',exact:true});const t=performance.now();await trigger.click();await p.getByRole('menuitem',{name:'全部痕迹',exact:true}).waitFor();
        measurements.push({materialCount:count,loadMs,menuReadyMs:performance.now()-t,...render});
        check(`${count}-material lookup renders without node entrance animations`,await p.locator('.tu-result').first().evaluate(e=>getComputedStyle(e).animationName)==='none');
        await c.close();
      }
    }
    searchFailure=true;
    await page.goto(base+'/app?view=home'); await page.locator('#capture-input').waitFor();
    await page.locator('#capture-source').selectOption('zhihu');
    await page.locator('#capture-input').fill('验证失败状态：原话不因搜索失败而丢失。');
    await page.locator('#capture-form [type=submit]').click();
    await page.locator('.web-dialog [data-phase=error]').waitFor();
    check('failed collaboration search is an explicit error, not fabricated results',await page.locator('.web-dialog .web-capability-source').count()===0);
    check('reference summary contains the actual submitted input',(await page.getByRole('region',{name:'本次提交的原话'}).innerText()).includes('验证失败状态'));
    check('search failure preserves the saved original',(await state()).host.chain.matters.some(m=>m.originalText==='验证失败状态：原话不因搜索失败而丢失。'));
    if(!desktop){searchFailure=false;await page.getByRole('button',{name:'重新查找',exact:true}).click();await page.locator('.web-dialog [data-phase=idle]').waitFor();check('search retry reports empty results without invented candidates',(await page.locator('.web-dialog [data-phase=idle]').innerText()).includes('没有找到'));}
    await capture(page,'collaboration-search-failure-or-retry.png');
    check('no renderer JavaScript exceptions',pageErrors.length===0);
    check('no unexpected external requests or real model calls',external.length===0);
    const expectedFailure=u=>new URL(u).pathname.startsWith('/api/search/');
    check('no unexpected HTTP or console errors',failures.every(f=>expectedFailure(f.url)&&f.status===503)&&consoleErrors.every(e=>e.location?.url&&expectedFailure(e.location.url)));
  } catch(error) {console.error(error);process.exitCode=1;fs.writeFileSync(path.join(out,'failure.txt'),error.stack||String(error));}
  finally {
    if(app)await app.close().catch(()=>{});if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));product?.close();
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({mode:desktop?'isolated-electron-production-preload-fixed-product-sqlite':'chromium-built-browser-indexeddb',passed:!process.exitCode,checks,pageErrors,consoleErrors,httpFailures:failures,requests,externalRequests:external,measurements,limits:['Not packaged desktop main/supervisor/installer','No live Agent/model/search services','200-material measurements cover lookup and menu UI, not canvas engine capacity','IME events simulated, not physical Windows IME','DPR2 browser context / Electron zoom are software display checks, not a physical multi-monitor matrix','Screenshots and automated checks are not final user experience acceptance']},null,2));
  }
})();

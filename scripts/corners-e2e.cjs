const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,firefox,webkit}=require('playwright');
const postcss=require('postcss');
const root=path.resolve(__dirname,'..');
const out=path.resolve(process.env.TRACE_E2E_OUTPUT_DIR||path.join(root,'.test-results/frontend-replacement/corners/browser'));
assert.ok(out.startsWith(path.join(root,'.test-results')+path.sep));assert.ok(!fs.existsSync(path.join(out,'report.json')),'Use a fresh evidence directory');
fs.mkdirSync(out,{recursive:true});const temp=path.join(out,'tmp');fs.mkdirSync(temp,{recursive:true});for(const key of ['TMP','TEMP','TMPDIR'])process.env[key]=temp;
const checks=[],screens=[],errors=[],network=[],violations=[],httpFailures=[],consoleErrors=[];
const check=(name,value=true)=>{assert.ok(value,name);checks.push({name,passed:true});console.log('PASS '+name);};
const dist=path.join(root,'apps/web/dist-vercel'),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.mjs':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf'};
let server,browser;
async function geometry(page,name,selectors){
  const result=await page.evaluate(selectors=>{
    const found=[];const problems=[];
    for(const selector of selectors)for(const element of document.querySelectorAll(selector)){
      if(!element.getClientRects().length)continue;
      const s=getComputedStyle(element),r=s.borderTopLeftRadius;
      const entry={selector,radius:r,shape:s.getPropertyValue('corner-shape'),padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft],gap:[s.rowGap,s.columnGap]};found.push(entry);
      if(r.endsWith('px')&&parseFloat(r)>0&&parseFloat(r)<100&&((parseFloat(r)%4)>0.01||parseFloat(r)<4))problems.push({...entry,reason:'radius-not-grid'});
      for(const value of [...entry.padding,...entry.gap])if(value.endsWith('px')&&Math.abs(parseFloat(value)/4-Math.round(parseFloat(value)/4))>0.01)problems.push({...entry,reason:'spacing-not-grid',value});
    }
    return {found,problems,supports:CSS.supports('corner-shape','superellipse(1.25)')};
  },selectors);
  screens.push({name,url:page.url(),...result});violations.push(...result.problems.map(p=>({screen:name,...p})));
  check(name+' has actual geometry targets',result.found.length>0);
  check(name+' authored targets use 4px radii and spacing',result.problems.length===0);
}
(async()=>{try{
  const {applyProductOperations}=await import('@trace/product-workspace');const {uiFixtureOperations}=await import('./helpers/ui-fixture.mjs');const fixture=applyProductOperations(null,uiFixtureOperations());
  server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');const route=url.pathname;
    if(route==='/api/zhihu/status'){res.writeHead(200,{'content-type':'application/json'});res.end('{"enabled":false,"oauth":{"configured":false}}');return;}
    if(route.startsWith('/api/')){res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"Explicitly disabled isolated geometry-test service"}');return;}
    const file=route==='/__test/browser-workspace.mjs'?path.join(root,'apps/web/src/product/browser-workspace.mjs'):path.resolve(dist,'.'+(['/','/app','/video'].includes(route)?'/index.html':route));
    if((!file.startsWith(dist+path.sep)&&route!=='/__test/browser-workspace.mjs')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(file).pipe(res);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:940}}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>network.push(r.url()));page.on('response',r=>{if(r.status()>=400)httpFailures.push({url:r.url(),status:r.status()});});page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  await page.goto(base+'/app');await page.locator('#capture-input').waitFor();await page.evaluate(async host=>(await import('/__test/browser-workspace.mjs')).putBrowserWorkspace({expectedRevision:0,commandId:'geometry-test-seed',host}),fixture);
  const routes=[
    ['home','/app?view=home','#capture-input',['.project-pill','.capture-select','.trace-canvas-controls button']],
    ['matters','/app?view=matters','.matters-shell',['.matters-bubble','.matters-search-input']],
    ['chain','/app?view=chain&matter=ui-main&screen=understanding','.chain-root',['.chain-button','.chain-field','.chain-glass']],
    ['worksite','/app?view=worksite&work=ui-work&matter=ui-main&screen=overview','.worksite-root',['.worksite-button','.worksite-glass']],
    ['lookup','/app?view=search','.tu-library',['.tu-button','.tu-search-field','.tu-result','.tu-badge']],
  ];
  for(const [name,url,ready,selectors]of routes){await page.goto(base+url);await page.locator(ready).first().waitFor();await geometry(page,name,selectors);await page.screenshot({path:path.join(out,name+'.png')});}
  await page.getByRole('button',{name:'更多查找操作',exact:true}).click();await page.getByRole('menu').waitFor();await page.getByRole('menu').evaluate(async e=>Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{}))));await geometry(page,'lookup-menu',['.tu-menu','.tu-menu-item']);
  const menu=await page.getByRole('menu').evaluate(e=>{const c=e.querySelector('[role=menuitem]'),s=getComputedStyle(e),i=getComputedStyle(c),a=e.getBoundingClientRect(),b=c.getBoundingClientRect();return {outer:parseFloat(s.borderTopLeftRadius),inner:parseFloat(i.borderTopLeftRadius),padding:parseFloat(s.paddingLeft),border:parseFloat(s.borderLeftWidth),insetX:b.left-a.left,insetY:b.top-a.top,shape:s.getPropertyValue('corner-shape')};});
  screens.push({name:'menu-concentric',...menu});console.log('MENU '+JSON.stringify(menu));check('menu radius follows R minus padding and its real side inset',Math.abs(menu.outer-menu.padding-menu.inner)<0.05&&Math.abs(menu.insetX-menu.padding)<0.05&&menu.border===0);
  await page.screenshot({path:path.join(out,'menu-concentric.png')});await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'个人与设置',exact:true}).click();await page.locator('.web-dialog[open]').waitFor();await geometry(page,'settings',['.web-dialog','.web-dialog input[type=text]','.web-shell-button']);await page.screenshot({path:path.join(out,'settings.png')});await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.goto(base+'/app?view=chain&matter=ui-main&screen=understanding');await page.locator('.chain-root').waitFor();await page.locator('[data-action=comparison]').filter({visible:true}).first().click();await page.waitForURL(u=>u.searchParams.get('view')==='compare');await page.locator('.compare-root').waitFor();await geometry(page,'comparison',['.compare-button','.compare-query-strip','.compare-scopes-button']);await page.screenshot({path:path.join(out,'comparison.png')});
  await page.goto(base+'/legacy.html?view=discussion');await page.locator('.desktop-shell').waitFor();await geometry(page,'legacy-discussion',['.quiet-button','.primary-button','.message-content','.composer-input']);await page.screenshot({path:path.join(out,'legacy-discussion.png')});
  await page.goto(base+'/');await page.locator('.site-header').waitFor();await geometry(page,'introduction',['.site-header','.hero-copy','.proof-section']);
  await page.goto(base+'/video');await page.locator('.video-shell').waitFor();await geometry(page,'video',['.video-shell header','.video-stage']);
  await page.setViewportSize({width:390,height:844});await page.goto(base+'/app?view=search');await page.locator('.tu-library').waitFor();await geometry(page,'lookup-narrow',['.tu-search-field','.tu-result','.tu-button']);await page.screenshot({path:path.join(out,'lookup-narrow.png')});
  // Exercise the ordinary-radius branch without pretending this is Safari.
  const fallback=await browser.newContext({viewport:{width:1440,height:940}});await fallback.route('**/*.css',async route=>{const response=await route.fetch();const ast=postcss.parse(await response.text());ast.walkAtRules('supports',a=>{if(a.params.includes('corner-shape'))a.remove();});await route.fulfill({response,body:ast.toString()});});const fp=await fallback.newPage();await fp.goto(base+'/app?view=search');await fp.locator('.tu-library').waitFor();await fp.getByRole('button',{name:'更多查找操作',exact:true}).click();await fp.getByRole('menu').waitFor();
  check('fallback retains the same menu radius without the enhancement',await fp.getByRole('menu').evaluate(e=>getComputedStyle(e).borderTopLeftRadius==='12px'&&getComputedStyle(e).getPropertyValue('corner-shape')==='round'));
  await fp.screenshot({path:path.join(out,'ordinary-radius-fallback.png')});await fallback.close();
  check('no renderer JavaScript exceptions',errors.length===0);
  check('current route assets load without HTTP or console errors',httpFailures.length===0&&consoleErrors.length===0);
}catch(error){process.exitCode=1;console.error(error);fs.writeFileSync(path.join(out,'failure.txt'),error.stack||String(error));}finally{await browser?.close();if(server)await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:!process.exitCode,checks,screens,violations,pageErrors:errors,httpFailures,consoleErrors,network,availableEngines:{firefox:fs.existsSync(firefox.executablePath()),webkit:fs.existsSync(webkit.executablePath())},limits:['Fallback branch is explicitly simulated by removing the enhancement, not a Safari/Firefox engine certification','No real Agent/service calls, user data, or package installation','Desktop overlay and native wrapper require their separate evidence']},null,2));}}
)();

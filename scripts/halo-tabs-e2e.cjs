const {selectValue}=require('./helpers/select-control.cjs');
// Full built app, isolated browser storage, authoritative IndexedDB verification.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'apps/web/dist');
const out=path.join(root,'.test-results/component-prompts',process.env.TRACE_HALO_TABS_RUN||'halo-tabs');
assert(!fs.existsSync(path.join(out,'report.json')),'Choose a new run identity');fs.mkdirSync(out,{recursive:true});
const temp=path.join(out,'tmp');fs.mkdirSync(temp,{recursive:true});for(const k of ['TEMP','TMP','TMPDIR'])process.env[k]=temp;
const checks=[],errors=[];let browser,server;
const check=(name,value)=>{assert(value,name);checks.push(name);console.log('PASS '+name);};
(async()=>{try{
  server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost'),file=path.resolve(dist,'.'+(u.pathname.startsWith('/app')||u.pathname==='/'?'/index.html':u.pathname));if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}const ext=path.extname(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.woff2':'font/woff2','.wasm':'application/wasm'})[ext]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:940}}),page=await context.newPage();page.setDefaultTimeout(8000);
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await page.goto(base+'/app?view=canvas');await page.getByRole('button',{name:'开始画布',exact:true}).click();await page.locator('[data-workbench-ready=true]').waitFor();
  await page.getByRole('button',{name:'写下第一点想法',exact:true}).click();
  const body=page.getByRole('textbox',{name:'我的表达',exact:true});await body.fill('Halo 栏目切换不改变当前表达');await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.getByText('修改已保存',{exact:true}).waitFor();
  const list=page.getByRole('tablist',{name:'详情栏目'}),tab=name=>list.getByRole('tab',{name,exact:true});
  await tab('来源').click();await page.getByRole('button',{name:'写一条摘记',exact:true}).click();await page.getByRole('button',{name:'保存摘记',exact:true}).waitFor();check('pointer selects real source panel',await tab('来源').getAttribute('aria-selected')==='true');
  await tab('来源').press('End');await list.locator('[data-state=active]').filter({hasText:'演变'}).waitFor();
  check('End selects last tab and moves focus',await tab('演变').getAttribute('aria-selected')==='true'&&await tab('演变').evaluate(e=>e===document.activeElement));
  await tab('演变').press('Home');await body.waitFor();check('Home selects content with unchanged persisted body',await body.inputValue()==='Halo 栏目切换不改变当前表达');
  await tab('内容').press('ArrowRight');await list.locator('[data-state=active]').filter({hasText:'来源'}).waitFor();check('arrow key activates adjacent panel',await tab('来源').getAttribute('aria-selected')==='true');
  check('exactly one tab is in tab order',await list.locator('[tabindex="0"]').count()===1);
  check('active panel has valid ARIA links',await page.getByRole('tabpanel').evaluate(e=>{const t=document.getElementById(e.getAttribute('aria-labelledby'));return !!t&&t.getAttribute('aria-controls')===e.id&&t.getAttribute('aria-selected')==='true';}));
  for(const theme of ['light','dark']){
    await page.getByRole('button',{name:'设置',exact:true}).click();await selectValue(page.getByRole('combobox',{name:'外观',exact:true}),theme);await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
    await tab('来源').click();await page.screenshot({path:path.join(out,theme+'-tabs.png')});
    check(theme+' active tab is visually distinct',await tab('来源').evaluate(e=>getComputedStyle(e).backgroundColor!==getComputedStyle(e.parentElement).backgroundColor));
    check(theme+' tab switches without animation',await tab('来源').evaluate(e=>getComputedStyle(e).transitionDuration==='0s'&&getComputedStyle(e).animationName==='none'));
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:844});await tab('内容').click();await body.waitFor();
  check('narrow touch targets at least 44px',await list.getByRole('tab').evaluateAll(es=>es.every(e=>e.getBoundingClientRect().height>=44)));
  check('narrow tabs remain in viewport',await list.evaluate(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth;}));await page.screenshot({path:path.join(out,'narrow-tabs.png')});
  await page.reload();await page.locator('[data-workbench-ready=true]').waitFor();await tab('内容').click();await body.waitFor();
  check('reload restores authoritative saved text',await body.inputValue()==='Halo 栏目切换不改变当前表达');
  check('no browser errors',errors.length===0);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,checks,errors,entrySha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(dist,'index.html'))).digest('hex')},null,2));
}catch(e){fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:false,checks,errors,error:e.stack},null,2));throw e;}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});

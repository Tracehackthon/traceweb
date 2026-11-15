const {selectValue}=require('./helpers/select-control.cjs');
// Full built app, isolated browser storage, authoritative IndexedDB verification.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),dist=path.resolve(process.env.TRACE_E2E_DIST_DIR||path.join(root,'apps/web/dist'));
const out=path.join(root,'.test-results/component-prompts',process.env.TRACE_EXPRESSIVE_RUN||'browser');
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
  const quick=page.getByRole('searchbox',{name:'快速搜索当前资料'}),trigger=page.locator('.wb-gooey-trigger');
  await trigger.click();await quick.fill('仅本轮的检索词');await quick.press('Escape');check('Escape collapses and restores focus without clearing query',await trigger.evaluate(e=>e===document.activeElement));await trigger.click();check('reopen retains query',await quick.inputValue()==='仅本轮的检索词');await quick.dispatchEvent('compositionstart');await quick.press('Enter');check('IME Enter does not submit search',await page.getByRole('dialog',{name:'找回内容'}).count()===0);await quick.dispatchEvent('compositionend');await quick.press('Enter');
  await page.getByRole('dialog',{name:'找回内容'}).waitFor();check('gooey submits into the real search dialog',await page.getByRole('textbox',{name:'搜索当前内容',exact:true}).inputValue()==='仅本轮的检索词');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Agent 协作',exact:true}).click();await page.getByRole('button',{name:'开始一段共同思考',exact:true}).click();
  const input=page.getByRole('textbox',{name:'继续共同思考'});await input.fill('本轮组件接入的真实讨论记录');await page.getByRole('button',{name:'留下这段思考',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.wb-messages')?.textContent.includes('本轮组件接入的真实讨论记录'));
  await input.press('ArrowUp');await page.getByRole('listbox',{name:'历史输入'}).waitFor();await input.press('Enter');check('input history retrieves without auto-sending',await input.inputValue()==='本轮组件接入的真实讨论记录'&&await page.locator('.wb-messages article').count()===1);
  await input.fill(Array(14).fill('长中文输入自适应高度').join('\n'));check('multiline composer stays bounded',await input.evaluate(e=>e.getBoundingClientRect().height<=innerHeight*.24+2));
  await input.fill('');
  for(const theme of ['light','dark']){
    await page.getByRole('button',{name:'设置',exact:true}).click();await selectValue(page.getByRole('combobox',{name:'外观',exact:true}),theme);await page.getByRole('button',{name:'关闭对话框',exact:true}).click();await page.reload();await page.locator('.wb-list-row').filter({hasText:'围绕当前内容继续思考'}).click();await input.waitFor();
    check(theme+' theme restores',await page.evaluate(()=>document.documentElement.dataset.traceAppearance)===theme);
    await page.screenshot({path:path.join(out,theme+'-composer.png')});
    await page.getByRole('button',{name:'能力库',exact:true}).click();await page.getByRole('button',{name:'新建能力',exact:true}).click();await page.getByRole('textbox',{name:'名称',exact:true}).fill('玻璃按钮保存-'+theme);await page.getByRole('button',{name:'保存草稿版本',exact:true}).scrollIntoViewIfNeeded();await page.getByRole('button',{name:'保存草稿版本',exact:true}).click();await page.getByText('草稿已保存',{exact:true}).waitFor();await page.screenshot({path:path.join(out,theme+'-glass.png')});
    check(theme+' glass label uses readable theme foreground',await page.locator('.wb-liquid-label:visible').first().evaluate(e=>{const probe=document.createElement('span');probe.style.color='var(--trace-text-primary)';e.append(probe);const expected=getComputedStyle(probe).color;probe.remove();return getComputedStyle(e).color===expected;}));
    check(theme+' material has visible label and glass layers',await page.locator('.wb-liquid-button:visible .wb-liquid-label').count()>0);
    await page.getByRole('button',{name:'Agent 协作',exact:true}).click();
  }
  const persisted=await page.evaluate(async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('trace-portal-workspace-v1');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});return new Promise((res,rej)=>{const r=db.transaction('workspace').objectStore('workspace').get('current');r.onsuccess=()=>{db.close();res(r.result);};r.onerror=()=>rej(r.error);});});
  check('glass submit persists real capability revisions',Object.values(persisted.host.capabilities).filter(c=>c.versions[c.version].title?.startsWith('玻璃按钮保存-')).length===2);
  check('saved message exists exactly once in authoritative storage',Object.values(persisted.host.sessions).flatMap(s=>s.messages).filter(m=>m.text==='本轮组件接入的真实讨论记录').length===1);
  await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:844});await trigger.click();await quick.fill('窄屏搜索');await page.screenshot({path:path.join(out,'narrow-reduced.png')});
  check('narrow gooey stays inside viewport',await page.locator('.wb-gooey-search').evaluate(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth;}));
  check('reduced motion disables gooey transitions',await page.locator('.wb-gooey-surfaces i').first().evaluate(e=>getComputedStyle(e).transitionDuration==='0s'));
  check('no duplicate SVG filter ids',await page.evaluate(()=>{const a=[...document.querySelectorAll('filter[id]')].map(e=>e.id);return new Set(a).size===a.length;}));
  check('no browser errors',errors.length===0);
  fs.writeFileSync(path.join(out,'storage.json'),JSON.stringify(persisted,null,2));
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,checks,errors,entrySha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(dist,'index.html'))).digest('hex')},null,2));
}catch(e){fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:false,checks,errors,error:e.stack},null,2));throw e;}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});

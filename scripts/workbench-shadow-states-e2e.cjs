const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base='http://127.0.0.1:4326',out=path.resolve(__dirname,'../.test-results/workbench-shadow-states',process.env.TRACE_SHADOW_RUN||'browser');
assert(!fs.existsSync(path.join(out,'report.json')),'Choose a fresh run name');fs.mkdirSync(path.join(out,'tmp'),{recursive:true});for(const k of ['TEMP','TMP','TMPDIR'])process.env[k]=path.join(out,'tmp');
const checks=[],errors=[];let browser;
const check=(name,ok)=>{assert(ok,name);checks.push(name);console.log('PASS '+name);};
const shaded=e=>{const s=getComputedStyle(e);return s.outlineStyle==='none'&&s.boxShadow!=='none'&&(s.borderTopColor==='rgba(0, 0, 0, 0)'||parseFloat(s.borderTopWidth)===0);};
(async()=>{try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:940}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/app?view=canvas');await page.getByRole('button',{name:'开始画布',exact:true}).click();await page.getByRole('button',{name:'写下第一点想法',exact:true}).click();await page.locator('.wb-node[data-selected]').waitFor();
  for(const theme of ['light','dark']){
    await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('combobox',{name:'外观',exact:true}).selectOption(theme);const name=page.getByRole('textbox',{name:'显示名称',exact:true});await name.focus();
    check(theme+' settings input uses a shaded surface, not an outline',await name.evaluate(e=>{const p=e.closest('.wb-halo-control'),s=getComputedStyle(p||e);return getComputedStyle(e).outlineStyle==='none'&&s.outlineStyle==='none'&&s.boxShadow!=='none';}));
    check(theme+' dialog has no visible frame',await page.getByRole('dialog').evaluate(e=>getComputedStyle(e).borderTopColor==='rgba(0, 0, 0, 0)'));
    await page.screenshot({path:path.join(out,theme+'-settings.png')});await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
    check(theme+' selected canvas card is shaded without a border',await page.locator('.wb-node[data-selected]').evaluate(shaded));
    const tabs=page.getByRole('tablist',{name:'详情栏目'});await tabs.getByRole('tab',{name:'内容',exact:true}).click();
    check(theme+' detail selection has shadow instead of a frame',await tabs.getByRole('tab',{selected:true}).evaluate(shaded));
    await tabs.getByRole('tab',{selected:true}).press('End');await page.waitForFunction(()=>document.querySelector('[role=tab][data-state=active]')?.textContent==='演变');check(theme+' tab keyboard semantics stay intact',await tabs.getByRole('tab',{name:'演变',exact:true}).getAttribute('aria-selected')==='true');
    check(theme+' keyboard tab focus has a shadow, not a ring',await tabs.getByRole('tab',{selected:true}).evaluate(shaded));
    await tabs.getByRole('tab',{name:'内容',exact:true}).click();await page.screenshot({path:path.join(out,theme+'-canvas.png')});
    const custom=await page.locator('.wb-node[data-selected]').evaluate(e=>{const before=getComputedStyle(e).boxShadow,bounds=e.getBoundingClientRect();document.documentElement.style.setProperty('--trace-selection-tint','#8d6e9a');const after=getComputedStyle(e).boxShadow,next=e.getBoundingClientRect();document.documentElement.style.removeProperty('--trace-selection-tint');return before!==after&&bounds.width===next.width&&bounds.height===next.height;});check(theme+' custom tint changes shadow without changing geometry',custom);
    await page.getByRole('button',{name:'能力库',exact:true}).click();await page.getByRole('button',{name:'新建能力',exact:true}).click();const field=page.getByRole('textbox',{name:'名称',exact:true});await page.waitForFunction(()=>document.querySelector('.wb-capability-detail input')?.value==='新的方法');await field.fill('阴影选中-'+theme);await field.focus();
    check(theme+' capability field has no stroke',await field.evaluate(e=>getComputedStyle(e).borderTopColor==='rgba(0, 0, 0, 0)'&&getComputedStyle(e).outlineStyle==='none'));
    await page.getByRole('button',{name:'保存草稿版本',exact:true}).click();await page.getByText('草稿已保存',{exact:true}).waitFor();check(theme+' selected capability has shadow and still saves',await page.locator('.wb-capability-summary[aria-current=true]').evaluate(shaded));
    await page.screenshot({path:path.join(out,theme+'-capability.png')});await page.getByRole('button',{name:'思考画布',exact:true}).click();
  }
  await page.getByRole('button',{name:'Agent 协作',exact:true}).click();await page.getByRole('button',{name:'新建共同思考',exact:true}).click();check('current discussion has semantic selection and shadow',await page.locator('.wb-list-row[aria-current=true]').evaluate(shaded));
  await page.getByRole('textbox',{name:'继续共同思考'}).fill('选中以颜色阴影呈现，不依赖线框。');await page.screenshot({path:path.join(out,'discussion.png')});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'narrow.png')});check('narrow layout has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.emulateMedia({forcedColors:'active'});const input=page.getByRole('textbox',{name:'继续共同思考'});await input.focus();check('forced-colors retains system focus affordance',await input.evaluate(e=>getComputedStyle(e.closest('form')).outlineStyle!=='none'));
  const stored=await page.evaluate(async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('trace-portal-workspace-v1');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});return new Promise((res,rej)=>{const r=db.transaction('workspace').objectStore('workspace').get('current');r.onsuccess=()=>{db.close();res(r.result.host);};r.onerror=()=>rej(r.error);});});check('both capability edits reach authoritative storage', ['light','dark'].every(t=>Object.values(stored.capabilities).some(c=>c.versions[c.version].title==='阴影选中-'+t)));
  check('no renderer errors',errors.length===0);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,build:await(await page.request.get(base+'/api/web/build')).json(),checks,errors},null,2));
}catch(e){fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:false,checks,errors,error:e.stack},null,2));throw e;}finally{await browser?.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

const {selectValue}=require('./helpers/select-control.cjs');
// Actual packaged main/preload + native IPC + on-disk SQLite, with an isolated
// user-data directory. No replacement server, renderer store or fake receipts.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{once}=require('node:events'),{chromium}=require('playwright'),{DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),exe=path.resolve(process.env.TRACE_DESKTOP_EXE||path.join(root,'apps/desktop-pet/release/0.2.15/win-unpacked/Trace.exe'));
const out=path.join(root,'.test-results/desktop-halo-release',process.env.TRACE_DESKTOP_HALO_RUN||'candidate-01');
assert(!fs.existsSync(path.join(out,'report.json')),'Use a fresh run identity');fs.mkdirSync(out,{recursive:true});
const profile=path.join(out,'profile'),project=path.join(out,'project'),tmp=path.join(out,'tmp');for(const p of [profile,project,tmp])fs.mkdirSync(p,{recursive:true});
const dbFile=path.join(profile,'state/workbench/web.sqlite');
const checks=[],errors=[];let instance,lock;const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const check=(name,ok)=>{assert(ok,name);checks.push(name);console.log('PASS '+name);};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=60000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch(e){last=e;}await delay(150);}throw last||Error('Timed out waiting for packaged app');}
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function launch(label){
  const debug=await port(),log=path.join(out,label+'.log'),fd=fs.openSync(log,'a');
  const child=spawn(exe,[`--user-data-dir=${profile}`,'--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${debug}`],{cwd:path.dirname(exe),detached:true,windowsHide:true,stdio:['ignore',fd,fd],env:{...process.env,TEMP:tmp,TMP:tmp,TMPDIR:tmp,TRACE_AGENT_ENABLED:'0',TRACE_CLOUD_ORIGIN:'https://127.0.0.1:1',TRACE_PROJECT_DIR:project,TRACE_DESKTOP_INTEGRATIONS_FILE:path.join(out,'no-integrations.json')}});child.unref();fs.closeSync(fd);
  await until(async()=>{const r=await fetch(`http://127.0.0.1:${debug}/json/list`);return(await r.json()).some(p=>p.url.startsWith('trace-app://'));});
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${debug}`),page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('trace-app://'));
  page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  return {child,browser,page};
}
async function stop(i){if(!i)return;await i.browser.close().catch(()=>{});const child=spawn(exe,[`--user-data-dir=${profile}`,'--trace-shutdown-for-update'],{windowsHide:true,stdio:'ignore',env:{...process.env,TEMP:tmp,TMP:tmp}});await Promise.race([once(child,'exit'),delay(10000)]);await until(()=>{try{process.kill(i.child.pid,0);return false;}catch{return true;}},15000);}
const read=()=>instance.page.evaluate(()=>window.traceNative.requestCapability({operation:'workbench.request',pathname:'/api/product/workspace',method:'GET'}));
const saved=()=>instance.page.waitForFunction(()=>document.querySelector('.wb-save-status')?.textContent.includes('已保存内容'));
async function lockDatabase(){
  const code=`const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');console.log('LOCKED');process.stdin.once('data',()=>{db.exec('ROLLBACK');db.close();process.exit(0);});`;
  lock=spawn(process.execPath,['-e',code,dbFile],{windowsHide:true,stdio:['pipe','pipe','pipe']});await until(()=>new Promise((resolve,reject)=>{lock.stdout.once('data',b=>resolve(b.toString().includes('LOCKED')));lock.once('error',reject);}));
}
async function unlock(){if(lock){lock.stdin.write('release\n');await once(lock,'exit');lock=null;}}
(async()=>{try{
  instance=await launch('first');let page=instance.page;
  check('packaged launcher opens the actual native workbench',new URL(page.url()).searchParams.get('view')==='canvas');
  await page.getByRole('button',{name:'开始画布',exact:true}).click();await page.locator('[data-workbench-ready=true]').waitFor();await saved();
  let snapshot=await read();check('native store uses SQLite with schema 2',snapshot.host.schemaVersion===2&&snapshot.storage.kind==='sqlite'&&fs.existsSync(dbFile));
  check('native result does not expose a filesystem path',!JSON.stringify(snapshot.storage).includes(profile)&&!JSON.stringify(snapshot.storage).includes('location'));
  const legacy=await page.evaluate(()=>window.traceNative.requestWorkspace('/api/web/workspace',{method:'GET'}));
  const legacyRevision=legacy.revision;
  const denied=await page.evaluate(async()=>{try{await window.traceNative.requestCapability({operation:'workbench.request',pathname:'/api/web/workspace',method:'PUT',body:{}});return false;}catch{return true;}});check('native workbench refuses legacy whole-host write routing',denied);
  const nav=name=>page.getByRole('navigation',{name:'三大工作区'}).getByRole('button',{name,exact:true});
  await nav('能力库').click();await page.getByRole('button',{name:'新建能力',exact:true}).click();const title=page.getByRole('textbox',{name:'名称',exact:true}),purpose=page.getByRole('textbox',{name:'解决什么需要',exact:true}),save=page.getByRole('button',{name:'保存草稿版本',exact:true});
  await title.fill('桌面：区分观察和解释');await purpose.fill('先保留实际观察，再讨论解释；验证桌面原生保存与重启接续。');await save.click();await page.getByText('草稿已保存',{exact:true}).waitFor();snapshot=await read();const cap=Object.values(snapshot.host.capabilities)[0];check('desktop form saves exactly one canonical capability revision',cap.version===2&&cap.title==='桌面：区分观察和解释');
  await purpose.fill('失败恢复后应保存的修改');await lockDatabase();await save.click();await page.locator('.wb-halo-notice[data-tone=error]').waitFor();
  check('a real SQLite writer lock produces a persistent error and keeps input',await purpose.inputValue()==='失败恢复后应保存的修改'&&await page.getByText('草稿已保存',{exact:true}).count()===0);
  check('failed write does not advance authoritative revision',(await read()).host.capabilities[cap.id].version===2);
  await page.screenshot({path:path.join(out,'sqlite-lock-recovery.png')});await unlock();
  await page.getByRole('button',{name:'核对并重试原命令',exact:true}).click();await page.getByText('草稿已保存',{exact:true}).waitFor();snapshot=await read();check('releasing lock and retrying commits exactly one version and clears stale error',snapshot.host.capabilities[cap.id].version===3&&await page.locator('.wb-halo-notice[data-tone=error]').count()===0);
  await nav('思考画布').click();const original='桌面原件：用户打开设置，然后返回画布。';await page.locator('input[type=file]').setInputFiles({name:'桌面访谈.txt',mimeType:'text/plain',buffer:Buffer.from(original)});
  await page.locator('.wb-import-row[data-phase=done]').waitFor();await page.getByRole('button',{name:'移除队列记录 桌面访谈.txt'}).click();await page.getByRole('tab',{name:'来源',exact:true}).click();
  await page.getByRole('button',{name:'写一条摘记',exact:true}).click();const note=page.getByRole('textbox',{name:'我的摘记',exact:true});await note.fill('保留这个观察，暂不推断动机。');await note.press('Escape');await page.getByRole('button',{name:'编辑我的摘记',exact:true}).click();check('desktop collapse and reopen preserves the annotation draft',await note.inputValue()==='保留这个观察，暂不推断动机。');
  await page.getByRole('button',{name:'保存摘记',exact:true}).click();await page.getByText('摘记已保存',{exact:true}).waitFor();snapshot=await read();const material=Object.values(snapshot.host.materials)[0],resource=material.versions[material.version].resourceId;
  const bytes=await page.evaluate(id=>window.traceNative.requestCapability({operation:'product.resource.read',resourceId:id}),resource);check('native original bytes round-trip through the packaged SQLite/resource owner',Buffer.from(bytes.bytes).toString('utf8')===original);
  await page.screenshot({path:path.join(out,'native-source-note.png')});await page.getByRole('button',{name:'围绕这条线索讨论',exact:true}).click();const input=page.getByRole('textbox',{name:'继续共同思考'});await input.fill('桌面讨论：这次只保留观察和未决。');await page.getByRole('button',{name:'留下这段思考',exact:true}).click();await page.locator('.wb-messages article').waitFor();
  const group=page.getByRole('radiogroup',{name:'协作记录类型'});await group.getByRole('radio',{name:'外部任务',exact:true}).click();await page.getByRole('textbox',{name:'外部任务目标'}).fill('桌面任务准备，不对外发送。');await page.getByRole('button',{name:'保存任务准备',exact:true}).click();await page.locator('.wb-task-detail').waitFor();await group.getByRole('radio',{name:'Trace 内思考',exact:true}).click();check('native workspace switch preserves the saved discussion',await page.locator('.wb-messages article').innerText()==='桌面讨论：这次只保留观察和未决。');
  await page.getByRole('button',{name:'设置',exact:true}).click();await selectValue(page.getByRole('combobox',{name:'外观',exact:true}),'dark');await page.getByRole('button',{name:'关闭对话框',exact:true}).click();await page.screenshot({path:path.join(out,'native-collaboration.png')});
  snapshot=await read();fs.writeFileSync(path.join(out,'before-restart.json'),JSON.stringify(snapshot,null,2));const revision=snapshot.revision;
  const unchanged=await page.evaluate(()=>window.traceNative.requestWorkspace('/api/web/workspace',{method:'GET'}));check('new workbench never mutates the independent legacy content revision',unchanged.revision===legacyRevision);
  await page.getByRole('button',{name:'工作台更多操作',exact:true}).click();await page.getByRole('menuitem',{name:'打开旧版内容（独立保留）',exact:true}).click();const legacyPage=await until(()=>instance.browser.contexts().flatMap(c=>c.pages()).find(p=>new URL(p.url()).searchParams.get('view')==='home'));await legacyPage.locator('.trace-react-shell[data-ready=true]').waitFor();check('legacy content remains reachable in its own native window',true);
  await stop(instance);instance=null;const db=new DatabaseSync(dbFile,{readOnly:true});check('SQLite is intact after graceful packaged shutdown',db.prepare('PRAGMA integrity_check').get().integrity_check==='ok');db.close();
  instance=await launch('restart');page=instance.page;await page.locator('[data-workbench-ready=true]').waitFor();snapshot=await read();check('real process restart restores the same content revision and identities',snapshot.revision===revision&&snapshot.host.capabilities[cap.id].version===3&&snapshot.host.materials[material.id].versions[1].resourceId===resource);
  check('saved messages, tasks and annotation survive process restart',Object.values(snapshot.host.sessions)[0].messages.length===1&&Object.values(snapshot.host.tasks).length===1&&Object.values(snapshot.host.expressions).filter(e=>e.kind==='annotation').length===1);
  check('desktop appearance restores before the new workbench settles',await page.evaluate(()=>document.documentElement.dataset.traceAppearance)==='dark');
  const reread=await page.evaluate(id=>window.traceNative.requestCapability({operation:'product.resource.read',resourceId:id}),resource);check('original resource remains readable after native restart',Buffer.from(reread.bytes).toString('utf8')===original);
  check('no renderer or resource loading errors',errors.length===0);
  fs.writeFileSync(path.join(out,'after-restart.json'),JSON.stringify(snapshot,null,2));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,checks,errors,exe,appAsarSha256:hash(path.join(path.dirname(exe),'resources/app.asar')),profile,dbFile,fault:'External SQLite BEGIN IMMEDIATE lock; no fake renderer response or receipt'},null,2));
}catch(e){if(instance)await instance.page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:false,checks,errors,error:e.stack},null,2));throw e;}finally{await unlock().catch(()=>{});await stop(instance).catch(()=>{});}})().catch(e=>{console.error(e);process.exitCode=1;});

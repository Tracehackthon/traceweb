// Full native app and real isolated SQLite/Runtime. Never replaces the bridge.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),{once}=require('node:events'),net=require('node:net');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.TRACE_COMPANION_OUT||path.join(root,'.test-results/desktop-companion-rebuild/self-01'));
assert(out.startsWith(path.join(root,'.test-results')+path.sep));assert(!fs.existsSync(path.join(out,'report.json')),'Use a fresh output');fs.mkdirSync(out,{recursive:true});
const executable=process.env.TRACE_COMPANION_EXE||'C:/Trace/Trace.exe',preview=process.env.TRACE_COMPANION_PREVIEW;
const checks=[],errors=[];let app,page,child;
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name)};
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
async function launch(){
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const debug=server.address().port;await new Promise(r=>server.close(r));
 const env={...process.env,TRACE_AGENT_ENABLED:'0',TRACE_CLOUD_ORIGIN:'https://127.0.0.1:1',TRACE_PROJECT_DIR:'',TRACE_DESKTOP_INTEGRATIONS_FILE:path.join(out,'no-integrations.json')};delete env.ELECTRON_RUN_AS_NODE;
 const fd=fs.openSync(path.join(out,'native.log'),'a');child=spawn(executable,['--user-data-dir='+path.join(out,'profile'),'--remote-debugging-address=127.0.0.1','--remote-debugging-port='+debug],{env,cwd:path.dirname(executable),windowsHide:true,detached:true,stdio:['ignore',fd,fd]});child.unref();fs.closeSync(fd);
 const until=Date.now()+90000;while(Date.now()<until){try{const list=await(await fetch('http://127.0.0.1:'+debug+'/json/list')).json();if(list.some(p=>p.type==='page'&&p.url.includes('index.html')))break}catch{}await new Promise(r=>setTimeout(r,200))}
 app=await chromium.connectOverCDP('http://127.0.0.1:'+debug);
 console.log('PAGES',app.contexts().flatMap(c=>c.pages()).map(p=>p.url()));
 page=app.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('index.html')&&!p.url().startsWith('trace-app://'));assert(page,'native overlay ready');
 page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 if(preview)await page.goto(require('node:url').pathToFileURL(path.join(preview,'index.html')).href);
 await page.locator('.trace-pet-button').waitFor();
}
const button=name=>page.getByRole('button',{name,exact:true}),input=()=>page.getByRole('textbox',{name:'此刻的想法',exact:true});
async function shot(name){await page.screenshot({path:path.join(out,name+'.png')});const surface=page.locator('.trace-companion-surface:visible,.trace-panel:visible').first();if(await surface.count())await surface.screenshot({path:path.join(out,name+'-surface.png')})}
let storageLock;
async function blockStorage(){const file=path.join(out,'profile/state/web.sqlite');storageLock=spawn(process.execPath,['-e',`const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');console.log('LOCKED');process.stdin.once('data',()=>{db.exec('ROLLBACK');db.close()});`,file],{windowsHide:true,stdio:['pipe','pipe','pipe']});await once(storageLock.stdout,'data')}
async function releaseStorage(){if(storageLock){storageLock.stdin.end('release');await once(storageLock,'exit');storageLock=null}}
async function close(){if(!app)return;await app.close().catch(()=>{});app=null;const stop=spawn(executable,['--user-data-dir='+path.join(out,'profile'),'--trace-shutdown-for-update'],{windowsHide:true,stdio:'ignore'});await Promise.race([once(stop,'exit'),new Promise(r=>setTimeout(r,10000))]);}
(async()=>{try{
 await launch();
 await button('打开 Trace').click();await input().waitFor();check('single click opens without arbitrary pet relocation',await page.getByRole('dialog',{name:'Trace 随手记录'}).isVisible());
 await input().fill('桌面随手记录：原话应完整保存。\n第二行不自动提交。');check('plain Enter remains multiline',await input().inputValue()==='桌面随手记录：原话应完整保存。\n第二行不自动提交。');
 await button('打开 Trace 悬浮窗').click();check('quick composer and floating panel use the exact same draft',await input().inputValue()==='桌面随手记录：原话应完整保存。\n第二行不自动提交。');
 await button('返回快速记录').click();await button('收起 Trace').first().click();await button('打开 Trace').click();check('collapse and reopen never clears a draft',await input().inputValue().then(x=>x.includes('第二行')));
 await button('保存记录').click();await page.getByText('已保存到本机收集区。',{exact:true}).waitFor({timeout:60000});
 const snapshot=await page.evaluate(()=>window.traceNative.requestCapability({operation:'workspace.summary'}));check('real Product command stores one exact multiline original',snapshot.observations.filter(x=>x.text==='桌面随手记录：原话应完整保存。\n第二行不自动提交。').length===1);check('only an authoritative receipt clears the submitted draft',await input().inputValue()==='');
 await input().fill('重启后仍未保存的新草稿');await close();await launch();await button('打开 Trace').click();check('actual process restart restores unsubmitted draft without auto-save',await input().inputValue()==='重启后仍未保存的新草稿'&&(await page.evaluate(()=>window.traceNative.requestCapability({operation:'workspace.summary'}))).observations.length===snapshot.observations.length);
 await input().fill('失败时真正提交的原请求');await blockStorage();await button('保存记录').click();await page.getByText('待确认的原请求',{exact:true}).waitFor();await input().fill('失败后继续输入的较新草稿');await page.locator('.trace-receipt-error').waitFor({timeout:60000});
 check('real SQLite failure keeps one persistent alert and exact original request',await page.getByRole('alert').count()===1&&(await page.evaluate(()=>JSON.parse(localStorage.getItem('trace-companion:v2:pending')))).text==='失败时真正提交的原请求');
 await shot('real-save-failure');await releaseStorage();await close();await launch();await button('打开 Trace').click();check('failed original and newer draft survive actual native process restart',await input().inputValue()==='失败后继续输入的较新草稿'&&(await page.evaluate(()=>JSON.parse(localStorage.getItem('trace-companion:v2:pending')))).text==='失败时真正提交的原请求');
 await button('重试原请求').click();await page.getByText('原请求已保存；后来的输入仍是草稿。',{exact:true}).waitFor({timeout:60000});let recovered=await page.evaluate(()=>window.traceNative.requestCapability({operation:'workspace.summary'}));check('manual original replay saves exactly once without submitting newer text',recovered.observations.filter(x=>x.text==='失败时真正提交的原请求').length===1&&recovered.observations.every(x=>x.text!=='失败后继续输入的较新草稿')&&await input().inputValue()==='失败后继续输入的较新草稿');
 await button('保存记录').click();await page.getByText('已保存到本机收集区。',{exact:true}).waitFor();await input().fill('重启后仍未保存的新草稿');
 await page.getByRole('tab',{name:/最近记录/}).click();check('recent shelf displays real stored original',await page.locator('.trace-shelf-item').count()>=1);await page.locator('.trace-shelf-item').first().click();check('shelf opens selected record in the floating panel',await page.getByRole('button',{name:/继续这条讨论/}).count()===1);
 await page.getByRole('tab',{name:'记录',exact:true}).click();check('record navigation preserves the newer input',await input().inputValue()==='重启后仍未保存的新草稿');await shot('floating-record');
 await page.getByRole('tab',{name:'来源与 Agent',exact:true}).click();check('removed mock audio and image controls cannot fabricate captures',await page.getByRole('button',{name:/模拟语音|选择图片/}).count()===0);await shot('floating-tools');
 await page.keyboard.press('Escape');check('Escape collapses and returns focus to the pet',await page.locator('.trace-detail-panel').count()===0&&await button('打开 Trace').evaluate(e=>document.activeElement===e));
 await button('打开 Trace').click();await shot('quick-draft');
 const before=await page.locator('.trace-pet-button').boundingBox();await page.mouse.move(before.x+35,before.y+35);await page.mouse.down();await page.mouse.move(80,120,{steps:8});await page.mouse.up();const after=await page.locator('.trace-pet-button').boundingBox();check('dragging moves the pet without activating its click action',after.x<before.x&&await page.getByRole('dialog',{name:'Trace 随手记录'}).isVisible());
 const placement=await page.evaluate(()=>window.traceNative.getPlacement());check('native placement persists the dragged position',Math.abs(placement.x-after.x)<2&&Math.abs(placement.y-after.y)<2);
 await shot('dragged-top-left');
 await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await shot('dark-reduced');check('dark surface uses its own readable palette',await page.locator('.trace-overlay').evaluate(e=>getComputedStyle(e).getPropertyValue('--trace-ink').trim()==='#e0e8eb'));
 check('no fullscreen backdrop steals unrelated desktop clicks',await page.locator('.trace-gesture-backdrop,[data-trace-interactive-region=backdrop]').count()===0);
 check('renderer has no runtime exceptions',errors.length===0);
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,checks,errors,executable,preview,rendererSha256:preview?hash(path.join(preview,'renderer.js')):null,additionalModelTurns:0,appAsarSha256:hash(path.join(path.dirname(executable),'resources/app.asar')),driverSha256:hash(__filename)},null,2));
 }catch(e){fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:false,checks,errors,error:e.stack},null,2));if(page)await shot('failure').catch(()=>{});throw e}finally{await releaseStorage();await close()}})().catch(e=>{console.error(e);process.exitCode=1});


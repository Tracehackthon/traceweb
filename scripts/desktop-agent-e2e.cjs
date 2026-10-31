// Actual packaged main/preload + native IPC + on-disk SQLite, with an isolated
// user-data directory. No replacement server, renderer store or fake receipts.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync,spawn}=require('node:child_process'),{once}=require('node:events'),{chromium}=require('playwright'),{DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),exe=path.resolve(process.env.TRACE_DESKTOP_EXE||path.join(root,'apps/desktop-pet/release/0.2.14/win-unpacked/Trace.exe'));
const out=path.join(root,'.test-results/desktop-agent-release',process.env.TRACE_DESKTOP_AGENT_RUN||'candidate-01');
assert(!fs.existsSync(path.join(out,'report.json')),'Use a fresh run identity');fs.mkdirSync(out,{recursive:true});
const profile=path.join(out,'profile'),project=path.join(out,'project'),tmp=path.join(out,'tmp');for(const p of [profile,project,tmp])fs.mkdirSync(p,{recursive:true});
const dbFile=path.join(profile,'state/workbench/web.sqlite');
assert(process.env.TRACE_DESKTOP_AGENT_LIVE==='1','Explicit live-model opt-in is required');
const checks=[],errors=[];let instance,lock;const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const check=(name,ok)=>{assert(ok,name);checks.push(name);console.log('PASS '+name);};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=60000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch(e){last=e;}await delay(150);}throw last||Error('Timed out waiting for packaged app');}
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function launch(label,broken=false){
  const debug=await port(),log=path.join(out,label+'.log'),fd=fs.openSync(log,'a');
  const child=spawn(exe,[`--user-data-dir=${profile}`,'--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${debug}`],{cwd:path.dirname(exe),detached:true,windowsHide:true,stdio:['ignore',fd,fd],env:{...process.env,TEMP:tmp,TMP:tmp,TMPDIR:tmp,TRACE_AGENT_ENABLED:'0',...(broken?{TRACE_CODEX_MODEL:'trace-test-nonexistent-model'}:{}),TRACE_CLOUD_ORIGIN:'https://127.0.0.1:1',TRACE_PROJECT_DIR:project,TRACE_DESKTOP_INTEGRATIONS_FILE:path.join(out,'no-integrations.json')}});child.unref();fs.closeSync(fd);
  await until(async()=>{const r=await fetch(`http://127.0.0.1:${debug}/json/list`);return(await r.json()).some(p=>p.url.startsWith('trace-app://'));});
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${debug}`),page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('trace-app://'));
  page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  return {child,browser,page};
}
async function stop(i){if(!i)return;await i.browser.close().catch(()=>{});const child=spawn(exe,[`--user-data-dir=${profile}`,'--trace-shutdown-for-update'],{windowsHide:true,stdio:'ignore',env:{...process.env,TEMP:tmp,TMP:tmp}});await Promise.race([once(child,'exit'),delay(10000)]);await until(()=>{try{process.kill(i.child.pid,0);return false;}catch{return true;}},15000);}
const read=()=>instance.page.evaluate(()=>window.traceNative.requestCapability({operation:'workbench.request',pathname:'/api/product/workspace',method:'GET'}));
const saved=()=>instance.page.waitForFunction(()=>document.querySelector('.wb-save-status')?.textContent.includes('已保存内容'));
const jobs=()=>instance.page.evaluate(()=>window.traceNative.requestCapability({operation:'workbench.agent.list'}));
async function waitRun(status,timeout=240000){const end=Date.now()+timeout;while(Date.now()<end){const r=(await jobs()).items.at(-1);if(r?.status===status)return r;if(r&&['failed','cancelled','timed_out','interrupted'].includes(r.status))throw Error('Unexpected terminal status: '+r.status+' '+r.error);await delay(250);}throw Error('Run did not reach '+status);}
(async()=>{try{
  const projectMarker='PROJECT-'+crypto.randomUUID(),materialMarker='MATERIAL-'+crypto.randomUUID();
  fs.writeFileSync(path.join(project,'README.md'),projectMarker+'\nSynthetic Trace live-model validation project.\n');
  fs.writeFileSync(path.join(project,'AGENTS.md'),'# Isolated live Agent validation\nRead only README.md and explicit Trace context tools. Do not modify files unless the current user explicitly authorizes one named output file. Do not run builds, access the network, or spawn other agents. Return the requested structured answer.\n');
  execFileSync('git',['init','-q',project]);execFileSync('git',['-C',project,'add','README.md','AGENTS.md']);execFileSync('git',['-C',project,'-c','user.name=Trace E2E','-c','user.email=trace-e2e@localhost','commit','-qm','synthetic read-only fixture']);
  const fixtureHash=hash(path.join(project,'README.md'));
  instance=await launch('first-provider-failure',true);let page=instance.page;
  await page.getByRole('button',{name:'开始画布',exact:true}).click();await saved();await page.locator('input[type=file]').setInputFiles({name:'本次明确材料.txt',mimeType:'text/plain',buffer:Buffer.from(materialMarker+'\n只有本次选定材料可以提交。')});
  await page.locator('.wb-import-row[data-phase=done]').waitFor();await page.getByRole('button',{name:'移除队列记录 本次明确材料.txt'}).click();
  await page.getByRole('navigation',{name:'三大工作区'}).getByRole('button',{name:'Agent 协作',exact:true}).click();await page.getByRole('radio',{name:'外部任务',exact:true}).click();
  const goal='请读取当前项目README.md的第一行编号，再用trace_context_read读取本次明确引用的材料编号。逐字返回这两个编号，分别说明来自项目文件和Trace材料；不要修改文件，不要联网，简短回答。';
  await page.getByRole('textbox',{name:'外部任务目标'}).fill(goal);await page.getByRole('button',{name:'保存任务准备',exact:true}).click();await page.getByRole('button',{name:'提交并执行',exact:true}).waitFor();
  const before=await read(),task=Object.values(before.host.tasks)[0];
  check('task preparation alone never starts a model run',(await jobs()).items.length===0);
  await page.getByRole('button',{name:'提交并执行',exact:true}).click();const failed=await waitRun('failed');
  check('an actual unavailable-model request becomes a durable failure, not a result',!failed.result&&failed.error&&failed.runtime.version);
  check('frozen task goal and exact material version are recorded',failed.scope.goal===goal&&failed.scope.refs[0].version===1&&/^[a-f0-9]{64}$/.test(failed.inputHash));
  await page.screenshot({path:path.join(out,'real-provider-failure.png')});await stop(instance);instance=null;
  instance=await launch('retry-with-default-model');page=instance.page;
  await page.getByRole('navigation',{name:'三大工作区'}).getByRole('button',{name:'Agent 协作',exact:true}).click();await page.getByRole('button',{name:'核对后重试此任务',exact:true}).waitFor();
  check('failed execution reopens on the same task after process restart',(await jobs()).items[0].id===failed.id);
  await page.getByRole('button',{name:'核对后重试此任务',exact:true}).click();const completed=await waitRun('succeeded');
  check('retry uses a new attempt with the identical frozen input',completed.number===2&&completed.taskId===task.id&&completed.inputHash===failed.inputHash);
  check('real Codex returned both unpredictable project and material markers',completed.result.answer.includes(projectMarker)&&completed.result.answer.includes(materialMarker));
  check('real provider thread and turn receipts are present',completed.runtime.threadId&&completed.runtime.turnId&&completed.runtime.version);
  check('Trace fragment tool read was actually observed',completed.events.some(e=>e.type==='tool.completed'&&e.tool==='trace_context_read'&&e.contextIds.length));
  const replay=await page.evaluate(id=>window.traceNative.requestCapability({operation:'workbench.agent.submit',taskId:id,requestId:'submit-'+id,mode:'read-only'}),task.id);check('replaying original submission does not create another run',replay.id===failed.id&&(await jobs()).items.length===2);
  await until(()=>page.getByRole('region',{name:'Agent返回结果'}).count());
  await page.getByRole('textbox',{name:'结果复核备注'}).fill('已核对两个随机编号；只保留在任务中，不改写材料。');await page.getByRole('button',{name:'确认结果，仅保留在任务',exact:true}).click();await until(async()=>(await jobs()).items.at(-1)?.review?.decision==='accepted');
  check('review is bound to the returned result hash',(await jobs()).items.at(-1).review.resultHash===completed.resultHash);
  check('review never overwrites the original Product content',(await read()).revision===before.revision&&hash(path.join(project,'README.md'))===fixtureHash);
  await page.evaluate(revision=>{window.__traceTestRevision=revision;},(await read()).revision);
  for(const op of [{type:'task.cancel',id:task.id},{type:'task.execution',id:task.id,execution:null}]){const blocked=await page.evaluate(op=>window.traceNative.requestCapability({operation:'workbench.request',pathname:'/api/product/commands',method:'POST',body:{protocolVersion:1,commandId:crypto.randomUUID(),expectedRevision:window.__traceTestRevision,operations:[op]}}).then(()=>false,e=>e.message.includes('已有本机执行记录')),op);check('existing native attempt prevents '+op.type,blocked);}
  await page.screenshot({path:path.join(out,'real-result-reviewed.png')});
  await page.getByRole('textbox',{name:'外部任务目标'}).fill(goal+'这是另一次只读核对。');await page.getByRole('button',{name:'保存任务准备',exact:true}).click();await page.getByRole('button',{name:'提交并执行',exact:true}).click();
  const inflight=await until(async()=>{const r=(await jobs()).items.at(-1);if(r&&['failed','timed_out'].includes(r.status))throw Error(r.error);return r?.status==='running'&&r.runtime.turnId?r:false;},90000);check('restart interruption targets an actual native model turn',Boolean(inflight.runtime.threadId&&inflight.runtime.turnId));await stop(instance);instance=null;
  instance=await launch('interrupted-recovery');page=instance.page;await page.getByRole('navigation',{name:'三大工作区'}).getByRole('button',{name:'Agent 协作',exact:true}).click();
  const interrupted=(await jobs()).items.find(r=>r.id===inflight.id);check('shutdown persists an interrupted run instead of inventing success',interrupted.status==='interrupted'&&!interrupted.result);
  const countBefore=(await jobs()).items.length;await delay(1500);check('restart does not automatically spend on a duplicate execution',(await jobs()).items.length===countBefore);
  await page.getByRole('button',{name:'核对后重试此任务',exact:true}).click();const resumed=await waitRun('succeeded');
  check('explicit retry continues the same frozen task after interruption',resumed.taskId===inflight.taskId&&resumed.inputHash===inflight.inputHash&&resumed.number===2&&resumed.result.answer.includes(projectMarker));
  await stop(instance);instance=null;instance=await launch('completed-restart');page=instance.page;
  const persisted=(await jobs()).items;check('completed output and prior review survive another full restart',persisted.find(r=>r.id===completed.id)?.review?.decision==='accepted'&&persisted.find(r=>r.id===resumed.id)?.resultHash===resumed.resultHash);
  check('read-only live runs leave project and Product content unchanged',hash(path.join(project,'README.md'))===fixtureHash&&(await read()).host.materials[task.refs[0].id].versions[1].text.includes(materialMarker));
  await page.getByRole('navigation',{name:'三大工作区'}).getByRole('button',{name:'Agent 协作',exact:true}).click();
  const writeMarker='WRITE-'+crypto.randomUUID();
  await page.getByRole('textbox',{name:'外部任务目标'}).fill('本次明确授权只创建项目根目录agent-proof.txt，内容必须精确为'+writeMarker+'，无换行；不得修改其他文件。创建后读回文件核对，在answer返回该编号。无需引用Trace材料，citations请为空。不要联网。');
  await page.getByRole('button',{name:'保存任务准备',exact:true}).click();await page.getByRole('checkbox',{name:'允许本次任务修改所选项目文件（默认只读）'}).check();await page.getByRole('button',{name:'提交并执行',exact:true}).click();
  const written=await waitRun('succeeded');
  check('explicit opt-in executes a real project write and returns its receipt',written.mode==='workspace-write'&&written.runtime.turnId&&written.result.answer.includes(writeMarker)&&fs.readFileSync(path.join(project,'agent-proof.txt'),'utf8')===writeMarker);
  check('write opt-in does not alter the original project file',hash(path.join(project,'README.md'))===fixtureHash);
  const denied=await page.evaluate(id=>window.traceNative.requestCapability({operation:'workbench.agent.review',runId:id,resultHash:'wrong-version',decision:'accepted',note:''}).then(()=>false,()=>true),written.id);
  check('review rejects a stale or mismatched result hash',denied);
  await page.screenshot({path:path.join(out,'real-project-write.png')});
  await stop(instance);instance=null;instance=await launch('write-restart');
  const finalRuns=(await jobs()).items;check('project write and its validated result persist after restart',finalRuns.at(-1).resultHash===written.resultHash&&fs.readFileSync(path.join(project,'agent-proof.txt'),'utf8')===writeMarker);
  page=instance.page;await page.getByRole('navigation',{name:'三大工作区'}).getByRole('button',{name:'Agent 协作',exact:true}).click();
  await page.locator('.wb-list-pane .wb-list-row').nth(0).click();await page.locator('.wb-execution[data-run-id="'+completed.id+'"]').waitFor();
  check('switching back restores the reviewed result in the actual UI',(await page.getByRole('textbox',{name:'结果复核备注'}).inputValue()).includes('两个随机编号')&&(await page.getByRole('region',{name:'Agent返回结果'}).innerText()).includes(materialMarker));
  await page.locator('.wb-list-pane .wb-list-row').nth(2).click();await page.locator('.wb-execution[data-run-id="'+written.id+'"]').waitFor();
  check('switching tasks never reuses the previous task result',(await page.getByRole('region',{name:'Agent返回结果'}).innerText()).includes(writeMarker));
  check('no renderer errors',errors.length===0);
  fs.writeFileSync(path.join(out,'runs.json'),JSON.stringify(finalRuns,null,2));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,checks,errors,exe,appAsarSha256:hash(path.join(path.dirname(exe),'resources/app.asar')),profile,liveModel:true,providerFailure:'First process selects a deliberately unavailable model; retries restore the user-default model. No provider responses are mocked.',projectMarker,materialMarker,writeMarker},null,2));
}catch(e){if(instance)await instance.page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:false,checks,errors,error:e.stack},null,2));throw e;}finally{await stop(instance).catch(()=>{});}})().catch(e=>{console.error(e);process.exitCode=1;});

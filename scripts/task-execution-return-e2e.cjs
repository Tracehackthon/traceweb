const {selectValue}=require('./helpers/select-control.cjs');
// Full native application, production main/preload/SQLite and actual Codex turns.
// No replacement provider, status writes, UI injected receipts or timed success.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync,spawn}=require('node:child_process'),net=require('node:net'),{DatabaseSync}=require('node:sqlite'),{_electron:electron,chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.TRACE_TASK_OUTPUT||path.join(root,'.test-results/task-execution-return/live-01'));
assert(process.env.TRACE_TASK_LIVE==='1','Explicit opt-in for real Codex model execution is required');
assert(out.startsWith(path.join(root,'.test-results')+path.sep)&&!fs.existsSync(path.join(out,'report.json')),'Use a fresh project evidence directory');
fs.mkdirSync(out,{recursive:true});const profile=path.join(out,'profile'),project=path.join(out,'project'),tmp=path.join(out,'tmp');for(const p of [profile,project,tmp])fs.mkdirSync(p,{recursive:true});
const checks=[],errors=[],logs=[],hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');let app,page,browser,child;
const artifact=path.join(root,'apps/desktop-pet/lib/desktop'),entry=path.join(artifact,'discussion/index.html');
const exe=process.env.TRACE_TASK_EXE?path.resolve(process.env.TRACE_TASK_EXE):null;
const identity=exe?{mode:'actual packaged native main/preload',exe:hash(exe),appAsar:hash(path.join(path.dirname(exe),'resources/app.asar'))}:{mode:'production source main/preload',main:hash(path.join(artifact,'main.mjs')),agent:hash(path.join(artifact,'workbench-agent.mjs')),store:hash(path.join(artifact,'workbench-store.mjs')),preload:hash(path.join(artifact,'discussion-preload.cjs')),entry:hash(entry)};
const check=(name,ok=true)=>{assert(ok,name);checks.push(name);console.log('PASS '+name);};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=60000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch(e){last=e;}await delay(150);}throw last||Error('Timed out waiting for authoritative state');}
const invoke=(operation,body={})=>page.evaluate(({operation,body})=>window.traceNative.requestCapability({operation,...body}),{operation,body});
const read=()=>invoke('workbench.request',{pathname:'/api/product/workspace',method:'GET'});
const jobs=async()=>(await invoke('workbench.agent.list')).items;
const btn=name=>page.getByRole('button',{name,exact:true}),box=name=>page.getByRole('textbox',{name,exact:true});
const nav=name=>page.getByRole('navigation',{name:'三大工作区'}).getByRole('button',{name,exact:true});
const saved=()=>page.waitForFunction(()=>document.querySelector('.wb-save-status')?.textContent.includes('已保存内容'));
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;}
async function launch(){
 const env={...process.env,TEMP:tmp,TMP:tmp,TMPDIR:tmp,TRACE_DESKTOP_OPEN_ON_START:'1',TRACE_PROJECT_DIR:project,TRACE_BACKEND_ORIGIN:'http://127.0.0.1:1',TRACE_AGENT_ENABLED:'0',TRACE_CLOUD_ORIGIN:'https://127.0.0.1:1',TRACE_DESKTOP_INTEGRATIONS_FILE:path.join(out,'no-integrations.json')};
 if(exe){const debug=await port();child=spawn(exe,['--user-data-dir='+profile,'--remote-debugging-address=127.0.0.1','--remote-debugging-port='+debug],{cwd:path.dirname(exe),windowsHide:true,env});child.stdout?.on('data',x=>logs.push(x.toString()));child.stderr?.on('data',x=>logs.push(x.toString()));await until(async()=>{const r=await fetch('http://127.0.0.1:'+debug+'/json/list');return(await r.json()).some(p=>p.url.startsWith('trace-app://'));});browser=await chromium.connectOverCDP('http://127.0.0.1:'+debug);page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('trace-app://'));}
 else{app=await electron.launch({executablePath:path.join(root,'apps/desktop-pet/node_modules/electron/dist/electron.exe'),args:[path.join(artifact,'main.mjs'),'--user-data-dir='+profile],cwd:root,env});app.process().stdout?.on('data',x=>logs.push(x.toString()));app.process().stderr?.on('data',x=>logs.push(x.toString()));page=await until(()=>app.windows().find(p=>p.url().startsWith('trace-app://')));}
 page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.locator('.wb-shell').waitFor();
}
async function stop(){if(app){await app.close();app=null;}if(child){await browser?.close();browser=null;const helper=spawn(exe,['--user-data-dir='+profile,'--trace-shutdown-for-update'],{windowsHide:true,stdio:'ignore',env:{...process.env,TEMP:tmp,TMP:tmp}});await until(()=>helper.exitCode!==null||helper.signalCode,15000);await until(()=>child.exitCode!==null||child.signalCode,20000);child=null;}}
async function terminal(id){return until(async()=>{const run=(await jobs()).find(r=>r.id===id);return run&&!['queued','running','waiting_input','waiting_approval','cancelling'].includes(run.status)?run:null;},300000);}
async function prepare(goal){await box('外部任务目标').fill(goal);const count=Object.keys((await read()).host.tasks).length;await btn('保存任务准备').click();await until(async()=>Object.keys((await read()).host.tasks).length===count+1);await btn('提交并执行').waitFor();return Object.values((await read()).host.tasks).at(-1);}
(async()=>{try{
 if(process.argv.includes('--adopt-existing')){
  const source=path.resolve(process.env.TRACE_TASK_BASE||'');assert(source.startsWith(path.join(root,'.test-results')+path.sep)&&source!==out,'Select a prior isolated evidence profile');
  const baseline=JSON.parse(fs.readFileSync(path.join(source,'report.json'),'utf8'));assert(baseline.passed&&baseline.identity.appAsar===identity.appAsar,'The real successful run must belong to this same fixed application');
  fs.cpSync(path.join(source,'profile'),profile,{recursive:true});await launch();await nav('Agent 协作').click();await page.getByRole('radio',{name:'外部任务',exact:true}).click();await page.locator('.wb-list-pane .wb-list-row').first().click();
  const prior=await jobs(),run=prior.find(r=>r.kind==='task'&&r.status==='succeeded');assert(run&&run.review?.decision==='accepted'&&run.scope.refs.length,'A real reviewed external-task result is required');
  await page.locator('.wb-execution[data-run-id="'+run.id+'"]').waitFor();const before=await read(),materialId=run.scope.refs[0].id,original=JSON.stringify(before.host.materials[materialId]),item=page.getByRole('region',{name:'逐项采纳',exact:true}).locator('.wb-adoption-item').first();
  check('adoption opens the same actual external task and validated result from the live baseline',await page.getByRole('region',{name:'Agent返回结果'}).innerText().then(t=>t.includes(run.result.answer)));
  const reviewed=await item.getByRole('textbox',{name:'本项采纳正文'}).inputValue()+'\n用户明确采用到本任务材料摘记。';await item.getByRole('textbox',{name:'本项采纳正文'}).fill(reviewed);await selectValue(item.getByRole('combobox',{name:'采纳位置'}),'material:'+materialId);
  check('editable result preview and explicit destination do not write Product content',(await read()).revision===before.revision);
  await item.getByRole('button',{name:'确认采纳本项',exact:true}).click();const receipt=await until(async()=>(await jobs()).find(r=>r.id===run.id).adoptions.find(a=>a.status==='committed'));
  const after=await read(),annotation=after.host.expressions['adopted-'+materialId],archive=after.host.expressions['ai-'+run.id];
  check('explicit external-task adoption writes the reviewed annotation with a real Product receipt',after.revision===before.revision+1&&annotation.versions[annotation.version].text===reviewed&&receipt.receipt.status==='committed');
  check('external result adoption preserves original material and unmodified full AI output',JSON.stringify(after.host.materials[materialId])===original&&archive.versions[1].text===run.result.answer&&annotation.versions[annotation.version].refs.some(r=>r.id===archive.id&&r.version===1));
  await invoke('workbench.agent.adoption.retry',{runId:run.id,adoptionId:receipt.id});check('replaying the confirmed external adoption cannot duplicate a content revision',(await read()).revision===after.revision);
  await item.screenshot({path:path.join(out,'external-result-adopted.png')});await stop();await launch();const restored=await read(),restoredRuns=await jobs();
  check('full restart preserves this external task adoption and exact stored content',restored.revision===after.revision&&restored.host.expressions[annotation.id].versions[annotation.version].text===reviewed&&restoredRuns.find(r=>r.id===run.id).adoptions.some(a=>a.id===receipt.id&&a.status==='committed'));
  check('adoption and restart start zero additional model runs',restoredRuns.length===prior.length&&restoredRuns.every(r=>prior.some(p=>p.id===r.id)));
  check('no renderer errors during external result adoption',errors.length===0);check('the installed application stayed fixed',identity.appAsar===hash(path.join(path.dirname(exe),'resources/app.asar')));
  fs.writeFileSync(path.join(out,'runs.json'),JSON.stringify(restoredRuns,null,2));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,checks,errors,identity,sourceBaseline:source,runId:run.id,resultHash:run.resultHash,adoptionId:receipt.id,additionalModelTurns:0,scope:'Real external task produced by the earlier live E2E, copied isolated profile, explicit UI adoption with production main/preload/Product SQLite; no synthesized result'},null,2));return;
 }
 const projectMarker='PROJECT-'+crypto.randomUUID(),materialMarker='SCOPE-'+crypto.randomUUID(),instructionMarker='FROZEN-'+crypto.randomUUID(),laterMarker='LATER-'+crypto.randomUUID(),changedMarker='CHANGED-'+crypto.randomUUID();
 fs.writeFileSync(path.join(project,'README.md'),projectMarker+'\nSynthetic native execution E2E; do not write files.\n');fs.writeFileSync(path.join(project,'AGENTS.md'),'# Isolated Trace acceptance\nOnly use README.md and the explicit Trace context tools. Do not modify files, access the network or spawn other agents. Follow the current user and return the requested structured result.\n');execFileSync('git',['init','-q',project]);
 await launch();await btn('开始画布').click();await saved();await page.locator('input[type=file]').setInputFiles({name:'冻结材料.txt',mimeType:'text/plain',buffer:Buffer.from(materialMarker+'\nThis is the only saved reference for the first task.')});await page.locator('.wb-import-row[data-phase=done]').waitFor();await btn('移除队列记录 冻结材料.txt').click();
 await nav('Agent 协作').click();await page.getByRole('radio',{name:'外部任务',exact:true}).click();
 await btn('AI 指令（0）').click();await btn('新建指令').click();await box('指令名称').fill('冻结指令验证');await box('指令正文').fill('In your answer include this exact instruction marker: '+instructionMarker+'. Keep the answer brief.');await btn('保存指令').click();await page.getByRole('checkbox',{name:'选用指令 冻结指令验证',exact:true}).check();await btn('保存本次指令选择').click();
 const plan=page.getByRole('region',{name:'任务准备步骤',exact:true});await plan.getByRole('button',{name:'添加步骤',exact:true}).click();await box('步骤 1 正文').fill('读取已冻结的项目与Trace材料，保留原文和指令版本。');
 const task=await prepare('只读核验：读取项目README.md第一行，并用trace_context_read读取本次明确的Trace材料和指令。answer逐字返回项目编号、材料编号，并遵守本次AI指令。不要修改文件或联网。replacement为null；Trace引用必须来自真实工具读取。');
 check('preparation freezes one exact reference, instruction version and real plan without executing',task.refs.length===1&&task.instructions.length===1&&task.instructions[0].version===1&&task.plan[0].text.includes('保留原文')&&(await jobs()).length===0);
 const instruction=task.instructions[0];await nav('能力库').click();await page.locator('.wb-capability-summary').filter({hasText:'冻结指令验证'}).click();await box('指令正文').fill('This later instruction has marker '+changedMarker+'.');await btn('保存草稿版本').click();await page.getByText('草稿已保存',{exact:true}).waitFor();
 await nav('思考画布').click();await page.locator('input[type=file]').setInputFiles({name:'任务保存后新增.txt',mimeType:'text/plain',buffer:Buffer.from(laterMarker)});await page.locator('.wb-import-row[data-phase=done]').waitFor();await btn('移除队列记录 任务保存后新增.txt').click();
 await nav('Agent 协作').click();await page.locator('.wb-list-pane .wb-list-row').first().click();const before=await read();await btn('提交并执行').click();
 const submitted=await until(async()=>(await jobs()).find(r=>r.taskId===task.id));const completed=await terminal(submitted.id);
 check('actual native model returned a validated successful run',completed.status==='succeeded'&&completed.runtime.threadId&&completed.runtime.turnId&&completed.resultHash?.length===64);
 const agentDb=new DatabaseSync(path.join(profile,'state/workbench/executions/agent.sqlite'),{readOnly:true});let payload;try{payload=JSON.parse(agentDb.prepare('SELECT payload FROM attempts WHERE id=?').get(completed.id).payload);}finally{agentDb.close();}
 check('executor payload uses saved v1 instruction body rather than later library v2',payload.fragments.find(f=>f.role==='instruction').text.includes(instructionMarker)&&!JSON.stringify(payload).includes(changedMarker)&&(await read()).host.capabilities[instruction.id].version===2);
 check('material added after preparation is not sent to the executor',!JSON.stringify(payload).includes(laterMarker)&&payload.task.refs.length===1);
 check('actual model answer proves both scope and frozen instruction consumption',[projectMarker,materialMarker,instructionMarker].every(v=>completed.result.answer.includes(v))&&!completed.result.answer.includes(changedMarker));
 check('actual Trace context read is recorded',completed.events.some(e=>e.type==='tool.completed'&&e.tool==='trace_context_read'));
 check('returned success does not mutate Product content',(await read()).revision===before.revision&&(await read()).host.tasks[task.id].results.length===0);
 await page.getByRole('region',{name:'Agent返回结果'}).waitFor();await page.screenshot({path:path.join(out,'actual-result-before-adoption.png')});
 const replay=await invoke('workbench.agent.submit',{taskId:task.id,requestId:'submit-'+task.id,mode:'read-only'});check('submission replay returns the same native run without a second model turn',replay.id===completed.id&&(await jobs()).length===1);
 await box('结果复核备注').fill('核对冻结范围和指令；复核本身不改业务内容。');await btn('确认结果，仅保留在任务').click();await until(async()=>(await jobs())[0].review?.decision==='accepted');check('review only persists a hash-bound decision without content adoption',(await read()).revision===before.revision);
 // Current single-writer adoption UI continues below when present. This test
 // never fabricates a successful result to reach the adoption screen.
 const adoption=page.getByRole('region',{name:'逐项采纳',exact:true});await adoption.waitFor();
 check('actual returned output is presented for explicit item adoption',await adoption.getByRole('textbox',{name:'本项采纳正文'}).count()>0&&(await read()).revision===before.revision);
 await adoption.getByRole('button',{name:'仅保留本项',exact:true}).first().click();await until(async()=>(await jobs())[0].adoptions?.some(a=>a.decision==='saved'));
 check('keeping an item does not write content',(await read()).revision===before.revision);
 // Actual task cancellation targets a new real model turn, not preparation.
 const cancelTask=await prepare('只读取消验收：请先读取README.md，随后运行一个只读等待命令等待60秒，再返回读到的编号。不要修改文件。这个任务将由用户中途停止，停止后不要继续。');
 await btn('提交并执行').click();const running=await until(async()=>{const r=(await jobs()).find(r=>r.taskId===cancelTask.id);if(r&&['failed','succeeded','timed_out'].includes(r.status))throw Error('Cancellation did not reach a live turn: '+r.status+' '+r.error);return r?.status==='running'&&r.runtime.turnId?r:null;},120000);
 const cancelBefore=await read();await btn('停止本次执行').click();const cancelled=await terminal(running.id);
 check('explicit stop ends an actual native model turn as cancelled',cancelled.status==='cancelled'&&cancelled.runtime.turnId&&!cancelled.result&&!cancelled.resultHash);
 check('cancellation has a persisted terminal lifecycle receipt',cancelled.events.some(e=>e.type==='run.cancelled'));
 check('cancellation never writes Product content',(await read()).revision===cancelBefore.revision);
 const blocked=await invoke('workbench.agent.adopt',{runId:cancelled.id,resultHash:'0'.repeat(64),requestId:crypto.randomUUID()}).then(()=>false,()=>true);check('cancelled run cannot be adopted',blocked);
 const runCount=(await jobs()).length;await page.reload();await page.locator('.wb-shell').waitFor();await until(async()=>(await jobs()).length===runCount);check('reload preserves terminal run identities without an automatic retry',(await jobs()).find(r=>r.id===cancelled.id)?.status==='cancelled');
 await stop();await launch();check('full app restart preserves successful result and cancellation',(await jobs()).some(r=>r.id===completed.id&&r.resultHash===completed.resultHash)&&(await jobs()).some(r=>r.id===cancelled.id&&r.status==='cancelled'));
 check('read-only execution leaves the project original unchanged',fs.readFileSync(path.join(project,'README.md'),'utf8').startsWith(projectMarker+'\n')&&execFileSync('git',['-C',project,'status','--porcelain']).toString().split('\n').filter(Boolean).every(l=>l.includes('README.md')||l.includes('AGENTS.md')));
 check('no renderer errors',errors.length===0);check('tested entry and production execution files stayed fixed',exe?identity.appAsar===hash(path.join(path.dirname(exe),'resources/app.asar')):identity.entry===hash(entry)&&identity.agent===hash(path.join(artifact,'workbench-agent.mjs'))&&identity.main===hash(path.join(artifact,'main.mjs')));
 fs.writeFileSync(path.join(out,'runs.json'),JSON.stringify(await jobs(),null,2));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,checks,errors,identity,liveModel:true,scope:'Actual Electron production main/preload + Product/Agent SQLite + live Codex, isolated synthetic project; not installer verification'},null,2));
}catch(e){if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:false,checks,errors,identity,error:e.stack},null,2));throw e;}finally{await stop().catch(()=>{});fs.writeFileSync(path.join(out,'main.log'),logs.join(''));}})().catch(e=>{console.error(e);process.exitCode=1;});

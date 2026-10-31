import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'

const activeStates=['queued','running','waiting_approval','waiting_input','cancelling']
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const identity=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,180}$/.test(x)
const now=()=>new Date().toISOString()
const guard=(condition,message)=>{if(!condition)throw Error(message)}

// Execution attempts own provider status/output/review, not another copy of the
// content catalog. taskSnapshot is the immutable boundary from the Product owner.
export function createWorkbenchAgent({directory,runtimeRoot,store,getExecutable,getProject,onChange=()=>{}}){
  fs.mkdirSync(directory,{recursive:true})
  const file=path.join(directory,'agent.sqlite'),applicationId=0x54574131
  if(fs.existsSync(file)){const probe=new DatabaseSync(file,{readOnly:true});try{guard(probe.prepare('PRAGMA application_id').get().application_id===applicationId,'Agent运行库身份不正确，未覆盖。')}finally{probe.close()}}
  const db=new DatabaseSync(file);db.exec(`PRAGMA application_id=${applicationId};PRAGMA journal_mode=WAL;PRAGMA busy_timeout=2000;
    CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,number INTEGER NOT NULL,request_key TEXT UNIQUE NOT NULL,input_hash TEXT NOT NULL,payload TEXT NOT NULL,project TEXT NOT NULL,mode TEXT NOT NULL,status TEXT NOT NULL,runtime TEXT NOT NULL DEFAULT '{}',events TEXT NOT NULL DEFAULT '[]',result TEXT,result_hash TEXT,error TEXT,review TEXT,created TEXT NOT NULL,finished TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS attempt_number ON attempts(task_id,number);`)
  db.prepare(`UPDATE attempts SET status='interrupted',finished=?,error='上次进程已退出。请核对项目现状后再明确重试；不会自动重跑。' WHERE status IN (${activeStates.map(()=>'?').join(',')})`).run(now(),...activeStates)
  let closed=false,active=null,loading=null
  const row=id=>db.prepare('SELECT * FROM attempts WHERE id=?').get(id)
  const publicRow=r=>r&&({id:r.id,taskId:r.task_id,number:r.number,status:r.status,mode:r.mode,projectName:path.basename(r.project),inputHash:r.input_hash,scope:JSON.parse(r.payload).task,
    runtime:JSON.parse(r.runtime),events:JSON.parse(r.events),result:r.result?JSON.parse(r.result):null,resultHash:r.result_hash,error:r.error,review:r.review?JSON.parse(r.review):null,created:r.created,finished:r.finished})
  const notify=()=>{try{onChange()}catch{}}
  const update=(id,patch)=>{if(closed)return;const fields=Object.keys(patch);db.prepare(`UPDATE attempts SET ${fields.map(k=>k+'=?').join(',')} WHERE id=?`).run(...Object.values(patch),id);notify()}
  const latest=task=>db.prepare('SELECT * FROM attempts WHERE task_id=? ORDER BY number DESC LIMIT 1').get(task)
  async function modules(){return loading ||= Promise.all(['apps/agent/codex.mjs','apps/agent/protocol.mjs','native/qualify-codex-app-server.mjs'].map(p=>import(pathToFileURL(path.join(runtimeRoot,p)).href)))}
  const env=()=>({...process.env,TEMP:path.join(directory,'tmp'),TMP:path.join(directory,'tmp'),TRACE_CODEX_QUALIFICATION_RECORD:path.join(directory,'codex-qualification.json')})
  function project(){const value=getProject();guard(typeof value==='string'&&path.isAbsolute(value)&&fs.statSync(value).isDirectory(),'请先选择一个存在的执行项目。');return fs.realpathSync(value)}
  function adapter(module,cwd,mode){const executable=getExecutable();guard(executable,'未找到本机Codex，请先安装并登录Codex。');return module.createCodexAdapter({executable,mode:'native',projectCwd:cwd,env:env(),providerConfig:{sandbox_mode:mode,'sandbox_workspace_write.network_access':false,'features.multi_agent':false,'agents.enabled':false}})}
  async function qualify(cwd,signal){
    const [codex,,qualifier]=await modules();fs.mkdirSync(path.join(directory,'tmp'),{recursive:true})
    await qualifier.qualifyCodexAppServer({executable:getExecutable(),command:getExecutable(),projectCwd:cwd,timeoutMs:60000,signal,env:env(),recordPath:path.join(directory,'codex-qualification.json'),schemaCacheRoot:path.join(directory,'schemas'),tempRoot:path.join(directory,'tmp')})
    const checked=await adapter(codex,cwd,'read-only').check({signal});guard(checked.authenticated,'Codex尚未登录。请在Codex完成登录后重试。');return checked
  }
  function event(id,type,data){
    if(type==='output.delta')return
    if(closed||!active||active.id!==id)return
    const r=row(id);if(!activeStates.includes(r.status))return
    const runtime=JSON.parse(r.runtime),events=JSON.parse(r.events)
    if(['runtime.checked','runtime.connected','runtime.started'].includes(type))Object.assign(runtime,{threadId:data.threadId||runtime.threadId,turnId:data.turnId||runtime.turnId,version:data.runtimeVersion||runtime.version,model:data.model||runtime.model})
    if(type==='runtime.approval.required'||type==='runtime.input.required')runtime.interaction=data.interaction
    if(type==='runtime.interaction.resolved')delete runtime.interaction
    if(type!=='output.delta')events.push({type,at:now(),...(data.tool?{tool:data.tool,contextIds:data.contextIds||[]}:{}),...(data.phase?{phase:data.phase}:{}),...(data.itemType?{itemType:data.itemType}:{})})
    const status=type==='runtime.approval.required'?'waiting_approval':type==='runtime.input.required'?'waiting_input':type==='runtime.interaction.resolved'?'running':r.status
    update(id,{runtime:JSON.stringify(runtime),events:JSON.stringify(events.slice(-100)),status})
  }
  async function run(r){
    const controller=new AbortController();active={id:r.id,controller,adapter:null,promise:null}
    const work=async()=>{let timer;try{
      update(r.id,{status:'running'});const checked=await qualify(r.project,controller.signal);event(r.id,'runtime.checked',{runtimeVersion:checked.version})
      const [codex,protocol]=await modules(),payload=JSON.parse(r.payload),task=payload.task
      const context={protocolVersion:1,matterId:task.id,baseRevision:0,contextMode:'fresh',contextEpoch:0,target:{},fragments:payload.fragments,omitted:task.excluded,externalRetrieval:'disabled',contextHash:r.input_hash}
      const request={purpose:'discuss',matterId:task.id,contextEpoch:0,input:task.goal+'\n\n结果协议：citations只能引用通过trace_context_read实际读取过的Trace片段，并且quote必须逐字来自该片段。项目文件依据写在answer中，不得为项目文件虚构contextId；未引用Trace片段时citations必须为空。非修订任务replacement必须为null。\n本次执行步骤：'+JSON.stringify(task.plan||[])+'\n本次明确选择的AI指令：'+payload.fragments.filter(f=>f.role==='instruction').map(f=>f.text).join('\n')}
      const executor=adapter(codex,r.project,r.mode);active.adapter=executor
      timer=setTimeout(()=>controller.abort(),300000)
      const outcome=await executor.execute({runId:r.id,request,context,signal:controller.signal,isCurrent:()=>!closed&&!controller.signal.aborted&&active?.id===r.id&&activeStates.includes(row(r.id).status),onEvent:(type,data)=>event(r.id,type,data)})
      const result=protocol.validateOutput(outcome.raw,{...context,fragments:outcome.providedFragments||context.fragments},request)
      if(!closed&&row(r.id).status!=='interrupted')update(r.id,{status:'succeeded',result:JSON.stringify(result),result_hash:hash(result),finished:now(),error:null,runtime:JSON.stringify({...JSON.parse(row(r.id).runtime),threadId:outcome.threadId,turnId:outcome.turnId,version:outcome.runtimeVersion})})
    }catch(error){if(!closed&&row(r.id).status!=='interrupted')update(r.id,{status:row(r.id).status==='cancelling'?'cancelled':controller.signal.aborted?'timed_out':'failed',finished:now(),error:String(error.message||'执行未完成。').replace(/[A-Za-z]:[\\/][^\s，。]+/g,'[本机路径]').slice(0,800)})}finally{clearTimeout(timer);if(active?.id===r.id)active=null}}
    const promise=work();if(active)active.promise=promise;await promise
  }
  async function pump(){if(active||closed)return;const r=db.prepare("SELECT * FROM attempts WHERE status='queued' ORDER BY created LIMIT 1").get();if(!r)return;await run(r);if(!closed)void pump()}
  function submit(request,retry=false){
    guard(identity(request.taskId)&&identity(request.requestId),'任务或请求身份不正确。')
    const previous=latest(request.taskId),known=db.prepare('SELECT * FROM attempts WHERE request_key=?').get(request.requestId)
    if(known){guard(known.task_id===request.taskId,'请求身份已用于另一任务。');return publicRow(known)}
    if(!retry&&previous)return publicRow(previous)
    if(retry)guard(previous&&previous.id===request.previousId&&['failed','interrupted','cancelled','timed_out'].includes(previous.status),'只能重试该任务最近一次未完成运行。')
    const payload=store.taskSnapshot(request.taskId),cwd=retry?previous.project:project(),mode=retry?previous.mode:request.mode||'read-only'
    guard(['read-only','workspace-write'].includes(mode),'不支持这个执行权限。')
    if(retry)guard(hash(payload)===previous.input_hash,'任务或引用状态已变化。请核对后另存新的任务准备。')
    const id='run-'+randomUUID(),number=(previous?.number||0)+1
    db.prepare('INSERT INTO attempts(id,task_id,number,request_key,input_hash,payload,project,mode,status,created) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,request.taskId,number,request.requestId,hash(payload),JSON.stringify(payload),cwd,mode,'queued',now());notify();setImmediate(()=>void pump());return publicRow(row(id))
  }
  return {
    hasAttempt:task=>!!latest(task),
    async request(req){
      guard(!closed,'执行记录已关闭。')
      if(req.operation==='workbench.agent.status'){let cwd;try{cwd=project()}catch{}return {available:Boolean(getExecutable()),projectName:cwd?path.basename(cwd):null,projectSelected:Boolean(cwd)}}
      if(req.operation==='workbench.agent.check'){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),65000);try{return {ready:true,...await qualify(project(),controller.signal)}}finally{clearTimeout(timer)}}
      if(req.operation==='workbench.agent.list')return {items:db.prepare('SELECT * FROM attempts ORDER BY created').all().map(publicRow)}
      if(req.operation==='workbench.agent.submit')return submit(req)
      if(req.operation==='workbench.agent.retry')return submit(req,true)
      const r=row(req.runId);guard(r,'没有这个运行记录。')
      if(req.operation==='workbench.agent.cancel'){
        guard(activeStates.includes(r.status),'运行已结束，请复核已有结果。')
        if(r.status==='queued')update(r.id,{status:'cancelled',finished:now()});else{update(r.id,{status:'cancelling'});active?.id===r.id&&active.controller.abort()}
        return publicRow(row(r.id))
      }
      if(req.operation==='workbench.agent.respond'){
        guard(active?.id===r.id&&active.adapter,'交互已失效，未授予任何权限。')
        const interaction=JSON.parse(r.runtime).interaction;guard(interaction&&interaction.interactionId===req.interactionId,'交互不属于当前运行。')
        guard(identity(req.requestId),'交互请求身份不正确。')
        if(req.answers)guard(interaction.method==='item/tool/requestUserInput','当前交互不接受补充回答。')
        else guard(['accept','decline'].includes(req.decision),'只允许本次同意或拒绝，不授予会话权限。')
        // Permission/MCP escalation is not granted by the generic approval UI.
        if(req.decision==='accept')guard(false,'本版本不授予额外运行权限。项目内写入需在提交前明确勾选；额外授权请求可拒绝或停止。')
        const body={interactionId:interaction.interactionId,idempotencyKey:req.requestId,expectedRevision:0,...(req.answers?{answers:req.answers}:{decision:req.decision})}
        active.adapter.respondInteraction(r.id,interaction.interactionId,body);return publicRow(row(r.id))
      }
      if(req.operation==='workbench.agent.review'){
        guard(r.status==='succeeded'&&r.result_hash===req.resultHash&&['accepted','rejected','needs_work'].includes(req.decision)&&typeof req.note==='string'&&req.note.length<=8000,'复核目标、结果版本或内容不正确。')
        update(r.id,{review:JSON.stringify({decision:req.decision,note:req.note,resultHash:r.result_hash,at:now()})});return publicRow(row(r.id))
      }
      throw Error('不支持这个执行操作。')
    },
    async close(){if(closed)return;const pending=active?.promise;if(active){update(active.id,{status:'interrupted',finished:now(),error:'应用已退出。请核对项目现状后再明确重试。'});active.controller.abort()}closed=true;await Promise.race([pending||Promise.resolve(),new Promise(r=>setTimeout(r,5000))]);db.close()},
  }
}

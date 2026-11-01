import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {resultItems} from '../../../../shared/workbench-result-items.mjs'

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
    CREATE UNIQUE INDEX IF NOT EXISTS attempt_number ON attempts(task_id,number);
    CREATE TABLE IF NOT EXISTS adoptions(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,item_id TEXT NOT NULL,request_key TEXT UNIQUE NOT NULL,fingerprint TEXT NOT NULL,decision TEXT NOT NULL,status TEXT NOT NULL,plan TEXT,receipt TEXT,error TEXT,created TEXT NOT NULL);`)
  db.prepare(`UPDATE attempts SET status='interrupted',finished=?,error='上次进程已退出。请核对项目现状后再明确重试；不会自动重跑。' WHERE status IN (${activeStates.map(()=>'?').join(',')})`).run(now(),...activeStates)
  let closed=false,active=null,loading=null
  const row=id=>db.prepare('SELECT * FROM attempts WHERE id=?').get(id)
  const publicAdoption=r=>{
    const plan=r.plan?JSON.parse(r.plan):null,target=plan?.command?.operations?.find(op=>op.id===plan.targetRef.id&&['expression.create','expression.edit','capability.create','capability.edit','relation.create'].includes(op.type));
    return {id:r.id,itemId:r.item_id,decision:r.decision,status:r.status,plan:plan?{targetRef:plan.targetRef,targetName:target?.title||target?.value?.title||(plan.targetRef.kind==='relation'?'内容之间的关系':'已核对的内容'),source:plan.source,reviewedText:plan.reviewedText,relationRef:plan.relationRef}:null,receipt:r.receipt?JSON.parse(r.receipt):null,error:r.error,created:r.created};
  }
  const storedReturn=r=>{
    guard(r&&r.result,'原始返回暂不可用，未使用另一结果替代。');
    const payload=JSON.parse(r.payload),result=JSON.parse(r.result);
    guard(hash(payload)===r.input_hash&&hash(result)===r.result_hash,'原始输入或返回完整性不一致，未将其作为可核验来源。');
    return {payload,result};
  };
  const presentation=r=>{if(!r.result&&r.status!=='succeeded')return {result:null,sourceRefs:null,sourceError:''};try{const {payload,result}=storedReturn(r);return {result,sourceRefs:payload.fragments.filter(f=>f.ref).map(f=>f.ref),sourceError:''};}catch{return {result:null,sourceRefs:null,sourceError:'原始输入或返回不可用或完整性不一致；已存状态/回执仍保留，不将损坏正文当作已核验来源。'};}};
  const publicRow=r=>{if(!r)return r;const checked=presentation(r);return ({id:r.id,taskId:r.task_id,kind:JSON.parse(r.payload).kind||'task',sessionId:JSON.parse(r.payload).sessionId,messageId:JSON.parse(r.payload).messageId,number:r.number,status:r.status,mode:r.mode,projectName:JSON.parse(r.payload).kind==='thinking'?'仅本讨论':path.basename(r.project),inputHash:r.input_hash,scope:JSON.parse(r.payload).task,adoptions:db.prepare('SELECT * FROM adoptions WHERE run_id=? ORDER BY rowid').all(r.id).map(publicAdoption),
    runtime:JSON.parse(r.runtime),events:JSON.parse(r.events),result:checked.result,sourceRefs:checked.sourceRefs,sourceError:checked.sourceError,resultHash:r.result_hash,error:r.error,review:r.review?JSON.parse(r.review):null,created:r.created,finished:r.finished});}
  // Re-read the exact immutable source, both when recording and when viewing.
  // A matching metadata hash alone cannot validate a damaged stored result.
  const feedbackSource=context=>{
    guard(!closed,'运行库已关闭；反馈来源未读取。');
    guard(identity(context.runId)&&identity(context.taskId)&&/^[a-f0-9]{64}$/.test(context.inputHash)&&/^[a-f0-9]{64}$/.test(context.resultHash),'反馈来源身份不正确。');
    const r=row(context.runId);
    guard(r&&r.status==='succeeded'&&r.task_id===context.taskId&&r.input_hash===context.inputHash&&r.result_hash===context.resultHash,'运行、输入或返回版本不一致；没有使用相似结果替代。');
    const {payload,result}=storedReturn(r);
    const refs=payload.fragments.filter(f=>f.ref).map(f=>f.ref).filter((r,i,a)=>a.findIndex(x=>JSON.stringify(x)===JSON.stringify(r))===i);
    return {status:r.status,result,context:{kind:'native-result',runId:r.id,taskId:r.task_id,inputHash:r.input_hash,resultHash:r.result_hash,verifiedAt:now(),refs,...(payload.kind==='thinking'?{sessionId:payload.sessionId,messageId:payload.messageId}:{})}};
  };
  store.configureFeedbackEvidenceResolver?.(context=>feedbackSource(context).context);
  const notify=()=>{try{onChange()}catch{}}
  const update=(id,patch)=>{if(closed)return;const previous=row(id);if(patch.status&&patch.status!==previous.status){const events=JSON.parse(patch.events||previous.events);events.push({sequence:(events.at(-1)?.sequence||0)+1,type:'run.'+patch.status,at:now()});patch.events=JSON.stringify(events);if(!activeStates.includes(patch.status)){const runtime=JSON.parse(patch.runtime||previous.runtime);delete runtime.interaction;patch.runtime=JSON.stringify(runtime)}}const fields=Object.keys(patch);db.prepare(`UPDATE attempts SET ${fields.map(k=>k+'=?').join(',')} WHERE id=?`).run(...Object.values(patch),id);notify()}
  const latest=task=>db.prepare('SELECT * FROM attempts WHERE task_id=? ORDER BY number DESC LIMIT 1').get(task)
  async function modules(){return loading ||= Promise.all(['apps/agent/codex.mjs','apps/agent/protocol.mjs','native/qualify-codex-app-server.mjs'].map(p=>import(pathToFileURL(path.join(runtimeRoot,p)).href)))}
  const env=()=>({...process.env,TEMP:path.join(directory,'tmp'),TMP:path.join(directory,'tmp'),TRACE_CODEX_QUALIFICATION_RECORD:path.join(directory,'codex-qualification.json')})
  function project(){const value=getProject();guard(typeof value==='string'&&path.isAbsolute(value)&&fs.statSync(value).isDirectory(),'请先选择一个存在的执行项目。');return fs.realpathSync(value)}
  function adapter(module,cwd,mode){const executable=getExecutable();guard(executable,'未找到本机Codex，请先安装并登录Codex。');return module.createCodexAdapter({executable,mode:'native',runtimeRoot:path.join(directory,'bounded'),projectCwd:cwd,env:env(),providerConfig:{...(mode==='thinking'?module.BOUNDED_CONFIG:{}),sandbox_mode:'read-only',...(mode==='workspace-write'?{sandbox_mode:mode}:{}),'sandbox_workspace_write.network_access':false,'features.multi_agent':false,'agents.enabled':false}})}
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
    events.push({sequence:(events.at(-1)?.sequence||0)+1,type,at:now(),...(data.tool?{tool:data.tool,contextIds:data.contextIds||[]}:{}),...(data.phase?{phase:data.phase}:{}),...(data.itemType?{itemType:data.itemType}:{})})
    const status=type==='runtime.approval.required'?'waiting_approval':type==='runtime.input.required'?'waiting_input':type==='runtime.interaction.resolved'?'running':r.status
    update(id,{runtime:JSON.stringify(runtime),events:JSON.stringify(events),status:r.status==='cancelling'?'cancelling':status})
  }
  async function run(r){
    const controller=new AbortController();active={id:r.id,controller,adapter:null,promise:null}
    const work=async()=>{let timer;try{
      update(r.id,{status:'running'});const checked=await qualify(r.project,controller.signal);guard(checked.authenticated,'Codex尚未登录。');event(r.id,'runtime.checked',{runtimeVersion:checked.version})
      const [codex,protocol]=await modules(),payload=JSON.parse(r.payload),task=payload.task
      const context={protocolVersion:1,matterId:task.id,baseRevision:0,contextMode:'fresh',contextEpoch:0,target:{},fragments:payload.fragments,omitted:task.excluded,externalRetrieval:'disabled',contextHash:r.input_hash}
      const request={purpose:'discuss',matterId:task.id,contextEpoch:0,input:task.goal+'\n\n结果协议：citations只能引用通过trace_context_read实际读取过的Trace片段，并且quote必须逐字来自该片段。项目文件依据写在answer中，不得为项目文件虚构contextId；未引用Trace片段时citations必须为空。非修订任务replacement必须为null。\n本次执行步骤：'+JSON.stringify(task.plan||[])+'\n本次明确选择的AI指令：'+payload.fragments.filter(f=>f.role==='instruction').map(f=>f.text).join('\n')}
      const executor=adapter(codex,r.project,r.mode);active.adapter=executor
      timer=setTimeout(()=>controller.abort(),300000)
      const outcome=await executor.execute({runId:r.id,request,context,signal:controller.signal,isCurrent:()=>!closed&&!controller.signal.aborted&&active?.id===r.id&&activeStates.includes(row(r.id).status),onEvent:(type,data)=>event(r.id,type,data)})
      const result=protocol.validateOutput(outcome.raw,{...context,fragments:outcome.providedFragments||context.fragments},request)
      if(controller.signal.aborted||row(r.id).status==='cancelling')throw Error('执行已停止，迟到结果未采用。')
      if(!closed&&row(r.id).status!=='interrupted')update(r.id,{status:'succeeded',result:JSON.stringify(result),result_hash:hash(result),finished:now(),error:null,runtime:JSON.stringify({...JSON.parse(row(r.id).runtime),threadId:outcome.threadId,turnId:outcome.turnId,version:outcome.runtimeVersion})})
    }catch(error){if(!closed&&row(r.id).status!=='interrupted')update(r.id,{status:row(r.id).status==='cancelling'?'cancelled':controller.signal.aborted?'timed_out':'failed',finished:now(),error:String(error.message||'执行未完成。').replace(/[A-Za-z]:[\\/][^\s，。]+/g,'[本机路径]').slice(0,800)})}finally{clearTimeout(timer);if(active?.id===r.id)active=null}}
    const promise=work();if(active)active.promise=promise;await promise
  }
  async function pump(){if(active||closed)return;const r=db.prepare("SELECT * FROM attempts WHERE status='queued' ORDER BY created LIMIT 1").get();if(!r)return;await run(r);if(!closed)void pump()}
  function inputFor(request,original=null) {
    const thinking=original?original.kind==='thinking':request.operation==='workbench.agent.think'||Boolean(request.sessionId);
    const payload=thinking?store.thinkingSnapshot(original?.sessionId||request.sessionId,original?.messageId||request.messageId,{legacy:Boolean(original&&!original.messageScope)}):store.taskSnapshot(request.taskId);
    if(thinking){payload.previous=original?.previous||[];payload.fragments.push(...payload.previous);guard(Buffer.byteLength(JSON.stringify(payload))<=256*1024,'讨论上下文超过256 KiB，请缩小范围。')}
    return payload;
  }
  function submit(request,retry=false){
    guard(identity(request.taskId)&&identity(request.requestId),'任务或请求身份不正确。')
    const previous=latest(request.taskId),known=db.prepare('SELECT * FROM attempts WHERE request_key=?').get(request.requestId)
    if(known){guard(known.task_id===request.taskId,'请求身份已用于另一任务。');return publicRow(known)}
    if(!retry&&previous)return publicRow(previous)
    if(retry)guard(previous&&previous.id===request.previousId&&['failed','interrupted','cancelled','timed_out'].includes(previous.status),'只能重试该任务最近一次未完成运行。')
    const thinking=retry?JSON.parse(previous.payload).kind==='thinking':request.operation==='workbench.agent.think'
    const original=retry?JSON.parse(previous.payload):null
    const payload=inputFor(request,original)
    if(request.expectedInputHash!==undefined)guard(request.expectedInputHash===hash(payload),'刚才核对的发送范围已变化，请重新读取实际输入；没有开始执行。')
    const cwd=retry?previous.project:thinking?path.join(directory,'thinking-project'):project(),mode=thinking?'thinking':retry?previous.mode:request.mode||'read-only'
    if(thinking)fs.mkdirSync(path.join(cwd,'.git'),{recursive:true})
    guard(['thinking','read-only','workspace-write'].includes(mode),'不支持这个执行权限。')
    if(retry)guard(hash(payload)===previous.input_hash,'任务或引用状态已变化。请核对后另存新的任务准备。')
    const id='run-'+randomUUID(),number=(previous?.number||0)+1
    db.prepare('INSERT INTO attempts(id,task_id,number,request_key,input_hash,payload,project,mode,status,created,events) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,request.taskId,number,request.requestId,hash(payload),JSON.stringify(payload),cwd,mode,'queued',now(),JSON.stringify([{sequence:1,type:'run.queued',at:now()}]));notify();setImmediate(()=>void pump());return publicRow(row(id))
  }
  const adoptionWrites=new Map();
  function applyAdoption(a,{cancel=false}={}){
    const previous=adoptionWrites.get(a.id)||Promise.resolve();
    const operation=previous.catch(()=>{}).then(async()=>{
      const current=db.prepare('SELECT * FROM adoptions WHERE id=?').get(a.id);
      if(current.status==='committed'||current.status==='cancelled')return publicAdoption(current);
      guard(current.status==='prepared','此项已处理；不会重复写入。');
      try{
        const plan=JSON.parse(current.plan),committed=await store.committedAdoption(plan.command.commandId);
        // Existing Product receipts take priority over a lost acknowledgement.
        // execute still verifies the exact original command fingerprint.
        if(cancel&&!committed)db.prepare("UPDATE adoptions SET status='cancelled',error=NULL WHERE id=?").run(current.id);
        else{
          if(!committed){
            const run=row(current.run_id);guard(run?.status==='succeeded'&&JSON.parse(run.review||'null')?.decision==='accepted','这份返回尚未明确认可，未重试写入；原请求和草稿仍保留。');
            const {payload,result}=storedReturn(run);
            if(plan.evidence)guard(plan.evidence.runId===run.id&&plan.evidence.inputHash===run.input_hash&&plan.evidence.resultHash===run.result_hash,'原请求冻结的输入或返回版本不一致，未重试写入。');
            store.verifyAdoptionSource({runId:run.id,answer:result.answer,refs:payload.fragments.filter(f=>f.ref).map(f=>f.ref),plan});
          }
          const outcome=store.execute(plan.command);db.prepare("UPDATE adoptions SET status='committed',receipt=?,error=NULL WHERE id=?").run(JSON.stringify(outcome.receipt),current.id);
        }
      }catch(error){db.prepare('UPDATE adoptions SET status=?,error=? WHERE id=?').run(['CONTENT_CONFLICT','REVISION_CONFLICT'].includes(error.code)?'conflict':'prepared',String(error.message||'写入未确认，请重试原采纳请求。').slice(0,600),current.id);}
      notify();return publicAdoption(db.prepare('SELECT * FROM adoptions WHERE id=?').get(current.id));
    });
    adoptionWrites.set(a.id,operation);return operation.finally(()=>{if(adoptionWrites.get(a.id)===operation)adoptionWrites.delete(a.id);});
  }
  function adopt(req,r){
    guard(r.status==='succeeded'&&r.result_hash===req.resultHash&&JSON.parse(r.review||'null')?.decision==='accepted','请先确认这份准确版本的返回结果，再逐项采纳。')
    storedReturn(r);
    const item=resultItems(JSON.parse(r.result).answer).find(x=>x.id===req.itemId);guard(item&&identity(req.requestId)&&['adopt','saved','rejected'].includes(req.decision),'采纳条目或请求身份不正确。')
    const fingerprint=hash({runId:r.id,resultHash:req.resultHash,itemId:req.itemId,decision:req.decision,target:req.target,expectedVersion:req.expectedVersion,text:req.text,title:req.title,...(req.selection?{selection:req.selection}:{})}),known=db.prepare('SELECT * FROM adoptions WHERE request_key=?').get(req.requestId)
    if(known){guard(known.fingerprint===fingerprint,'同一采纳请求不能更换内容或目标。');return known.status==='prepared'?applyAdoption(known):publicAdoption(known)}
    const prior=db.prepare('SELECT * FROM adoptions WHERE run_id=? AND item_id=? ORDER BY rowid DESC LIMIT 1').get(r.id,item.id)
    guard(!prior||prior.status!=='prepared','本项有尚未确认的写入，请先重试原采纳请求。')
    guard(!prior||prior.status!=='committed','本项已采纳，不重复写入。')
    const id='adopt-'+randomUUID();let plan=null
    if(req.decision==='adopt'){
      guard(typeof req.text==='string'&&req.text.trim()&&req.text.length<=64000&&typeof req.title==='string'&&req.title.trim()&&req.title.length<=200&&Number.isSafeInteger(req.expectedVersion)&&req.expectedVersion>=0,'请核对要采纳的正文、标题和目标版本。')
      let start=0,end=item.text.length;
      if(req.selection){({start,end}=req.selection);const split=n=>n>0&&n<item.text.length&&/[\uD800-\uDBFF]/.test(item.text[n-1])&&/[\uDC00-\uDFFF]/.test(item.text[n]);guard(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&end>start&&end<=item.text.length&&!split(start)&&!split(end),'原稿选段超出范围或切断完整字符；没有写回。');}
      const sourceAnchor=Number.isSafeInteger(item.start)?{type:'text',start:item.start+start,end:item.start+end}:undefined;
      guard(!req.selection||sourceAnchor,'合并尾段无法证明全文中的准确位置，请保留完整原稿或选择前面的独立段落。');
      const refs=JSON.parse(r.payload).fragments.filter(f=>f.ref).map(f=>f.ref)
      plan={...store.planAdoption({id,runId:r.id,answer:JSON.parse(r.result).answer,refs,target:req.target,expectedVersion:req.expectedVersion,text:req.text,title:req.title,sourceAnchor}),reviewedText:req.text,evidence:{runId:r.id,inputHash:r.input_hash,resultHash:r.result_hash}}
    }
    db.prepare('INSERT INTO adoptions(id,run_id,item_id,request_key,fingerprint,decision,status,plan,created) VALUES(?,?,?,?,?,?,?,?,?)').run(id,r.id,item.id,req.requestId,fingerprint,req.decision,plan?'prepared':'decided',plan?JSON.stringify(plan):null,now());notify()
    const a=db.prepare('SELECT * FROM adoptions WHERE id=?').get(id);return plan?applyAdoption(a):publicAdoption(a)
  }
  return {
    hasAttempt:task=>!!latest(task),
    async request(req){
      guard(!closed,'执行记录已关闭。')
      if(req.operation==='workbench.agent.status'){let cwd;try{cwd=project()}catch{}return {available:Boolean(getExecutable()),projectName:cwd?path.basename(cwd):null,projectSelected:Boolean(cwd)}}
      if(req.operation==='workbench.agent.check'){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),65000);try{return {ready:true,...await qualify(project(),controller.signal)}}finally{clearTimeout(timer)}}
      if(req.operation==='workbench.agent.input.preview'){const payload=inputFor(req);return {payload,inputHash:hash(payload),executionStarted:false};}
      if(req.operation==='workbench.agent.feedback.source')return feedbackSource(req)
      if(req.operation==='workbench.agent.list')return {items:db.prepare('SELECT * FROM attempts ORDER BY created').all().map(publicRow)}
      if(req.operation==='workbench.agent.submit')return submit(req)
      if(req.operation==='workbench.agent.think'){guard(identity(req.sessionId)&&identity(req.messageId),'讨论身份不正确。');return submit({...req,taskId:'thinking-'+req.sessionId+'-'+req.messageId,mode:'thinking'})}
      if(req.operation==='workbench.agent.retry')return submit(req,true)
      const r=row(req.runId);guard(r,'没有这个运行记录。')
      if(req.operation==='workbench.agent.adopt')return adopt(req,r)
      if(req.operation==='workbench.agent.archive'){
        guard(r.status==='succeeded'&&r.result_hash===req.resultHash,'请先核对这份准确版本的真实返回。');
        const {payload,result}=storedReturn(r),refs=payload.fragments.filter(f=>f.ref).map(f=>f.ref);
        const receipt=store.archiveResult({runId:r.id,answer:result.answer,refs});notify();return receipt;
      }
      if(req.operation==='workbench.agent.adoption.retry'){const a=db.prepare('SELECT * FROM adoptions WHERE id=? AND run_id=?').get(req.adoptionId,r.id);guard(a,'没有这份采纳请求。');return a.status==='committed'?publicAdoption(a):applyAdoption(a)}
      if(req.operation==='workbench.agent.adoption.cancel'){const a=db.prepare('SELECT * FROM adoptions WHERE id=? AND run_id=?').get(req.adoptionId,r.id);guard(a,'没有这份采纳请求。');return applyAdoption(a,{cancel:true});}
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
        guard(req.decision==='accepted'||!db.prepare("SELECT id FROM adoptions WHERE run_id=? AND status IN ('prepared','committed') LIMIT 1").get(r.id),'已有采纳或待确认请求；复核不会撤回内容，请到内容版本继续处理。')
        guard(r.status==='succeeded'&&r.result_hash===req.resultHash&&['accepted','rejected','needs_work'].includes(req.decision)&&typeof req.note==='string'&&req.note.length<=8000,'复核目标、结果版本或内容不正确。')
        if(req.decision==='accepted')storedReturn(r);
        update(r.id,{review:JSON.stringify({decision:req.decision,note:req.note,resultHash:r.result_hash,at:now()})});return publicRow(row(r.id))
      }
      throw Error('不支持这个执行操作。')
    },
    async close(){if(closed)return;const pending=active?.promise;if(active){update(active.id,{status:'interrupted',finished:now(),error:'应用已退出。请核对项目现状后再明确重试。'});active.controller.abort()}closed=true;await Promise.race([pending||Promise.resolve(),new Promise(r=>setTimeout(r,5000))]);db.close()},
  }
}

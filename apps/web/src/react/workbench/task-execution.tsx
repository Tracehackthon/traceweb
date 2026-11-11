import React,{useCallback,useEffect,useRef,useState} from 'react';
import type {Task,Thinking,WorkbenchClient} from './client';
import {HaloBadge,HaloNotice,HaloProgress,type HaloTone} from './halo-surfaces';
import {TraceIcon,type IconName} from '../ui/icon';
import {LiquidButton} from './expressive-controls';
import {CodeBlock} from './code-block';
import {ExecutionLog} from './execution-log';
import {ResultAdoption,ResultOriginal,UnavailableWritebacks} from './result-adoption';
import {ReferenceViewer} from './reference-scope';
import type {ContentRef} from './client';
import {HaloField,HaloInput,HaloTextarea,HaloSelect} from './halo-controls';
import {HaloDisclosure} from './halo-disclosure';
import './task-execution.css';

export type Run={kind?:string;activationId?:string;sessionId?:string;messageId?:string;adoptions:any[];id:string;taskId:string;number:number;status:string;mode:string;projectName:string;inputHash:string;scope:Task;runtime:any;events:any[];result:any;resultHash:string;rawAvailable?:boolean;rawHash?:string;rawComplete?:boolean|null;sourceRefs?:ContentRef[]|null;sourceError?:string;adoption?:any;error:string;review?:{decision:string;note:string};created:string;finished:string};
const labels:Record<string,string>={queued:'等待执行',running:'正在执行',waiting_approval:'等待你的审批',waiting_input:'等待你的回答',cancelling:'正在停止',cancelled:'执行已停止',interrupted:'执行已中断',timed_out:'执行超时',failed:'执行失败',succeeded:'结果已返回，待复核'};
const active=['queued','running','waiting_approval','waiting_input','cancelling'];
const bridge=()=> (window as any).traceNative;
const call=(operation:string,body:Record<string,unknown>={})=>bridge().requestCapability({operation:'workbench.agent.'+operation,...body});
export function useAgentRuns(){
  const [runs,setRuns]=useState<Run[]>([]),[ready,setReady]=useState(!bridge()),[error,setError]=useState(''),alive=useRef(true),sequence=useRef(0);
  const refresh=useCallback(async()=>{if(!bridge())return;const n=++sequence.current;try{const result=await call('list');if(alive.current&&n===sequence.current){setRuns(result.items);setReady(true);setError('');}}catch(e){if(alive.current&&n===sequence.current)setError(e.message||'执行记录读取失败，未清空。');}},[]);
  useEffect(()=>{alive.current=true;void refresh();const remove=bridge()?.onAgentTasksChanged?.(refresh),timer=window.setInterval(refresh,3000);return()=>{alive.current=false;remove?.();clearInterval(timer);};},[refresh]);
  return {runs,ready,error,refresh};
}
const currentTaskRun=(task:Task,runs:Run[])=>task.dispatch?runs.find(r=>r.taskId===task.id&&r.id===task.dispatch!.runId):runs.filter(r=>r.taskId===task.id).at(-1);
export function agentTaskLabel(task:Task,runs:Run[],ready:boolean,error=''){if(task.dispatch?.source==='codex')return task.dispatch.revokedAt?'后续外部许可已撤销':task.handoff?.returns.length?'外部结果已接回，待复核':task.dispatch.receivedAt?'已领取，执行状态未知':'已授权，等待外部领取';const run=currentTaskRun(task,runs);return error?'读取中断，当前状态未知':run?.sourceError?'原始返回暂不可核验':run?(run.adoptions?.some(a=>a.status==='committed')?'部分结果已采纳':run.review?'结果已复核':labels[run.status]||run.status):!ready?'读取执行状态…':task.status!=='prepared'?'已取消准备':task.dispatch?'已预留派发，运行回执待核对':'准备已保存，尚未提交';}

// Presentation only: neither a provider terminal state nor a review is an adoption receipt.
function agentBadgeAppearance(run:Run|undefined,ready:boolean,error='',preparationCancelled=false):{tone:HaloTone;icon:IconName}{
  if(error)return{tone:'warning',icon:'error'};
  if(!ready)return{tone:'neutral',icon:'pending'};
  if(run?.sourceError)return{tone:'warning',icon:'error'};
  if(!run)return{tone:'neutral',icon:preparationCancelled?'idle':'document'};
  if(run.adoptions?.some(a=>a.status==='committed'))return{tone:'success',icon:'check'};
  if(run.review)return{tone:'accent',icon:'document'};
  if(run.status==='failed'||run.status==='timed_out')return{tone:'error',icon:'error'};
  if(run.status==='succeeded')return{tone:'warning',icon:'document'};
  if(['waiting_approval','waiting_input','interrupted'].includes(run.status))return{tone:'warning',icon:'pending'};
  return{tone:active.includes(run.status)?'accent':'neutral',icon:active.includes(run.status)?'pending':'idle'};
}
export function AgentTaskBadge({task,runs,ready,error=''}:{task:Task;runs:Run[];ready:boolean;error?:string}){
  if(task.dispatch?.source==='codex')return <HaloBadge tone="neutral" icon="work" data-task-state={task.status}>{agentTaskLabel(task,runs,ready,error)}</HaloBadge>;
  const run=currentTaskRun(task,runs);
  return <HaloBadge {...agentBadgeAppearance(run,ready,error,task.status==='cancelled')} data-task-state={task.status} data-run-state={run?.status}>{agentTaskLabel(task,runs,ready,error)}</HaloBadge>;
}

function NativeRawReturn({run}:{run:Run}){
  const [raw,setRaw]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),sequence=useRef(0);
  useEffect(()=>()=>{sequence.current++;},[]);
  if(!run.rawAvailable||!run.rawHash)return null;
  const read=async()=>{const n=++sequence.current;setBusy(true);setError('');try{
    const result=await call('result.original',{runId:run.id,rawHash:run.rawHash});
    if(result?.runId!==run.id||result.hash!==run.rawHash||typeof result.raw!=='string')throw Error('原始输出身份不一致，没有换成其它返回。');
    if(n===sequence.current)setRaw(result.raw);
  }catch(e){if(n===sequence.current)setError(e.message||'原始输出暂不可核对，已有记录未覆盖。');}finally{if(n===sequence.current)setBusy(false);}};
  return <HaloDisclosure title="本次原始输出（只读，不代表成功或采用）"><p>按本次运行与原始输出指纹核对。解析失败、停止或来源资格变化都不把这份记录变成已采用内容。{run.rawComplete===false?'这次只捕获到中断前的部分输出，不能当作完整返回。':run.rawComplete==null?'这份旧记录没有完整输出标记，不据此推断生成已完成。':''}</p><button type="button" className="wb-button" disabled={busy} aria-busy={busy} onClick={()=>void read()}>{busy?'正在核对原始输出…':raw===null?'核对并读取本次原始输出':'重新核对原始输出'}</button>{error&&<HaloNotice tone="warning" title="原始输出暂不可核验" description={error}/>} {raw!==null&&<CodeBlock code={raw} title="执行器原始输出（未自动采用）"/>}</HaloDisclosure>;
}

function NativeInputPreview({taskId,thinking,client,onVerified}:{taskId:string;thinking?:{sessionId:string;messageId:string};client:WorkbenchClient;onVerified:(hash:string|null)=>void}){
 const [value,setValue]=useState<any>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[view,setView]=useState<ContentRef|null>(null),sequence=useRef(0);
 useEffect(()=>()=>{sequence.current++;},[]);
 const read=async()=>{const n=++sequence.current;setLoading(true);setError('');setValue(null);onVerified(null);try{const result=await call('input.preview',thinking||{taskId});if(!result||!Array.isArray(result.payload?.fragments)||!/^[a-f0-9]{64}$/.test(result.inputHash)||result.executionStarted!==false)throw Error('当前宿主没有返回可核对的只读输入；未伪造预览或启动执行。');if(n===sequence.current){setValue(result);onVerified(result.inputHash);}}catch(e){if(n===sequence.current)setError(e.message||'实际输入读取失败，原消息和准备仍保留。');}finally{if(n===sequence.current)setLoading(false);}};
 return <HaloDisclosure title="本次会发送哪些内容？"><div className="wb-reference-detail"><p>只读核对后端实际构建的发送片段，不创建运行、不启动模型。不会自动补其它画布、全部历史、AI回复或原件文件；正文中手动保留的文字仍属于本次问题。</p><button type="button" className="wb-button" disabled={loading} aria-busy={loading} onClick={()=>void read()}>核对实际发送范围（不执行）</button>{loading&&<HaloProgress label="正在读取实际发送范围…"/>}{error&&<HaloNotice tone="warning" title="实际输入暂不可读取" description={error}/>} {value&&<section aria-label="后端实际发送片段"><h4>这次保存的问题</h4><p className="wb-preserve">{value.payload.task.goal}</p>{value.payload.task.plan?.length>0&&<ol>{value.payload.task.plan.map(step=><li key={step.id}>{step.text}</li>)}</ol>}<p>已读取 {value.payload.fragments.length} 个实际片段。预览不是运行回执；提交时后端还会重算指纹并检查有效状态。</p>{value.payload.fragments.map((fragment,i)=><HaloDisclosure key={fragment.id||i} title={String(fragment.title||'片段')+' · '+({reference:'明确引用',instruction:'AI指令',user:'用户原话',agent:'AI原稿'}[fragment.role]||fragment.role)}><p className="wb-preserve">{fragment.text}</p>{fragment.ref&&<button type="button" className="wb-button" onClick={()=>setView(fragment.ref)}>核对这份准确来源 v{fragment.ref.version}</button>}</HaloDisclosure>)}<HaloDisclosure title="本次输入指纹"><code className="wb-preserve" style={{overflowWrap:'anywhere'}}>{value.inputHash}</code></HaloDisclosure><HaloDisclosure title="完整冻结输入（只读）"><CodeBlock code={JSON.stringify(value.payload,null,2)} language="json"/></HaloDisclosure></section>}{view&&<ReferenceViewer client={client} reference={view} onClose={()=>setView(null)}/>}</div></HaloDisclosure>;
}
export function TaskExecution({task,client,executions,onCancelPreparation,thinking,onFeedbackResult,onOpenWriteback,onPlaceWriteback,legacyScope=false}:{task:Task;client:WorkbenchClient;executions:ReturnType<typeof useAgentRuns>;onCancelPreparation:()=>void;thinking?:{sessionId:string;messageId:string};onFeedbackResult?:(run:Run)=>void;onOpenWriteback?:(ref:ContentRef)=>void;onPlaceWriteback?:(ref:ContentRef,stillHere:()=>boolean)=>Promise<void>;legacyScope?:boolean}){
  const {runs,refresh,ready,error}=executions,history=runs.filter(r=>r.taskId===task.id),run=currentTaskRun(task,runs),previousRuns=history.filter(r=>r.id!==run?.id);
  const [inputHash,setInputHash]=useState<string|null>(null);
  const [setup,setSetup]=useState<any>(null),[notice,setNotice]=useState(''),[noticeError,setNoticeError]=useState(false),[busy,setBusy]=useState(false),[write,setWrite]=useState(false),[note,setNote]=useState(''),[answers,setAnswers]=useState<Record<string,string>>({});
  useEffect(()=>{if(bridge())void call('status').then(setSetup).catch(e=>{setNoticeError(true);setNotice(e.message);});},[]);
  useEffect(()=>{setNote(run?.review?.note||'');setAnswers({});},[run?.id]);
  const action=async(fn:()=>Promise<any>)=>{if(busy)return;setBusy(true);setNotice('');setNoticeError(false);let failed=false;try{await fn();}catch(e){failed=true;setNoticeError(true);setNotice(e.message||'操作未完成，请保留当前内容后重试。');}finally{await refresh();if(!thinking)try{await client.refreshContent();}catch(e){if(!failed){setNoticeError(true);setNotice('操作后的内容尚未核对：'+e.message);}}setBusy(false);}};
  if(!thinking&&task.dispatch?.source==='codex')return <p className="wb-muted">这份任务已有明确外部派发；从外部接续面板核对原交付，不再提交本机执行。</p>;
  if(!bridge())return <p className="wb-muted">真实执行需使用桌面版；本页只保存任务准备。</p>;
  if(task.execution)return <p className="wb-muted">本任务已有其他执行回执，请从既有回执面板继续核验；不会重复提交。</p>;
  const interaction=run?.runtime?.interaction,adopted=Boolean(run?.adoptions?.some(a=>a.status==='committed'));
  return <section className="wb-execution" aria-label="任务执行与结果复核" data-status={run?.status||(task.dispatch&&task.status==='prepared'?'dispatch-unconfirmed':task.status)} data-run-id={run?.id}>
    <header><h3>{thinking?'Trace 内 AI 思考':'本机 Codex 执行'}</h3>{(run||thinking||task.dispatch||error||!ready)&&<HaloBadge {...agentBadgeAppearance(run,ready,error,task.status==='cancelled')} data-execution-status={error?'unknown':run?.status||task.status}>{error?'读取中断，当前状态未知':run?run.sourceError?'原始返回暂不可核验':adopted?'部分结果已采纳':run.review?'结果已复核':labels[run.status]:ready?task.status==='cancelled'?'准备已取消':task.dispatch?'派发归属已保存，运行回执待核对':'尚未提交':'正在核对执行记录'}</HaloBadge>}</header>
    {!run&&<>
      {!thinking&&task.dispatch&&task.status==='prepared'&&<HaloNotice tone="warning" title="已保留本机派发，尚无运行回执" description="这不是已经执行。刷新不会自动建立运行；可核对原派发后继续，或确认从未排队再取消。" actions={<><p className="wb-preserve">原项目：{task.dispatch.projectDir} · {task.dispatch.mode==='workspace-write'?'允许项目内写入':'只读'} · 输入版本 {task.dispatch.inputVersion}</p><button className="wb-button" disabled={busy} onClick={()=>action(async()=>{await client.refreshContent();})}>核对原派发与运行记录</button><button className="wb-button" disabled={busy||!ready||Boolean(error)} onClick={()=>action(()=>call('dispatch.cancel',{taskId:task.id,dispatchId:task.dispatch!.id}))}>核验未开始后取消这份准备</button></>}/>}
      <p>{thinking?'仅使用这段原话、明确选择的引用和历史原话，不读取项目文件或自动补AI回复。':'执行项目：'+(task.dispatch?.projectDir||setup?.projectName||'尚未选择')+'。'}提交后才会运行，并可能使用你的 Codex 额度。</p>
      {setup&&!setup.available&&<HaloNotice tone="warning" title="未连接可用的Codex执行器" description="可以继续手工思考、准备任务和只读核对发送范围；这里没有开始模型运行，也不将预览当作执行成功。"/>}
      {!thinking&&<div className="wb-actions">{!task.dispatch&&<button className="wb-button" disabled={busy} onClick={()=>action(async()=>setSetup(await call('project.select')))}>选择执行项目</button>}<button className="wb-button" disabled={busy||(!task.dispatch&&!setup?.projectSelected)} onClick={()=>action(async()=>{await call('check',task.dispatch?{taskId:task.id}:{});setNotice('Codex已登录并通过连接检查；尚未执行任务。');})}>检查 Codex 连接</button></div>}
      <NativeInputPreview taskId={task.id} thinking={thinking} client={client} onVerified={setInputHash}/>
      {!thinking&&<label className="wb-check"><input type="checkbox" disabled={Boolean(task.dispatch)} checked={task.dispatch?task.dispatch.mode==='workspace-write':write} onChange={e=>setWrite(e.target.checked)}/>允许本次任务修改所选项目文件（默认只读）</label>}
      {!thinking&&!task.dispatch&&task.status==='prepared'&&client.getSnapshot().features.includes('task-dispatch-v1')&&<button type="button" className="wb-button" disabled={busy||!inputHash||!ready||Boolean(error)||!setup?.projectSelected||Boolean(client.getSnapshot().pending)} onClick={()=>action(async()=>{await call('dispatch.prepare',{taskId:task.id,requestId:'submit-'+task.id,expectedInputHash:inputHash,mode:write?'workspace-write':'read-only'});setNotice('本机派发归属已保存，没有排队或启动执行。');})}>预留给本机，稍后执行（不启动）</button>}
      <div className="wb-actions"><LiquidButton className="wb-button wb-primary" disabled={busy||legacyScope||!inputHash||!ready||Boolean(error)||!setup?.available||(!thinking&&!task.dispatch&&!setup?.projectSelected)||task.status!=='prepared'||Boolean(client.getSnapshot().pending)} onClick={()=>action(()=>thinking?call('think',{...thinking,requestId:'submit-'+task.id,expectedInputHash:inputHash}):call('submit',{taskId:task.id,requestId:task.dispatch?.requestId||'submit-'+task.id,expectedInputHash:inputHash,mode:task.dispatch?.mode||(write?'workspace-write':'read-only')}))}><TraceIcon name="work"/>{thinking?'请 AI 回应这段思考':task.dispatch?'提交原派发并执行':'提交并执行'}</LiquidButton>{!thinking&&!task.dispatch&&task.status==='prepared'&&<button className="wb-button" disabled={busy} onClick={onCancelPreparation}>取消尚未交接的准备</button>}</div>
    </>}
    {run&&<>
      <p>第 {run.number} 次运行 · 项目 {run.projectName} · {run.mode==='thinking'?'限本讨论的只读思考':run.mode==='read-only'?'只读':'可修改项目内文件'}。{run.sourceError?'原始记录当前无法核验，不将保存元信息当作可用来源。':'输入与引用已冻结，结果只回到这个任务。'}</p>
      {!error&&active.includes(run.status)&&<HaloProgress label={labels[run.status]||'正在执行'}/>}
      {run.runtime.threadId&&<p className="wb-execution-receipt">Codex thread：{run.runtime.threadId}{run.runtime.turnId&&<> / turn：{run.runtime.turnId}</>}</p>}
      {run.sourceError&&<HaloNotice tone="warning" title="原始返回暂不可核验" description={run.sourceError}/>}
      {run.runtime.inputUseRestricted&&<HaloNotice tone="warning" title="返回已保留，来源资格已变化" description="这是原派发的历史返回，不代表停用的能力重新生效。继续调用和写回会重新检查当前资格；可以只保留或不采用。"/>}
      <NativeRawReturn key={run.id+':'+run.rawHash} run={run}/>
      {run.error&&!error&&!noticeError&&<HaloNotice tone="error" title={run.error} description="输入、原引用和已有回执仍保留。先前执行可能已产生项目改动；重试前请核对，不会自动回滚文件。"/>}
      {['failed','interrupted','cancelled','timed_out'].includes(run.status)&&<button className="wb-button" disabled={busy} onClick={()=>action(()=>call('retry',{taskId:task.id,previousId:run.id,requestId:'retry-'+run.id}))}>核对后重试此任务</button>}
      {active.includes(run.status)&&<button className="wb-button wb-danger" disabled={busy||run.status==='cancelling'} onClick={()=>action(()=>call('cancel',{runId:run.id}))}>停止本次执行</button>}
      {interaction&&['waiting_approval','waiting_input'].includes(run.status)&&<section className="wb-execution-interaction" aria-label="运行交互">
        <h4>{run.status==='waiting_input'?'Codex需要补充信息':'Codex请求审批'}</h4><pre>{JSON.stringify(interaction,null,2)}</pre>
        {run.status==='waiting_input'?(interaction.questions||[]).map(q=><HaloField key={q.id} label={q.question||q.id}><HaloInput type={q.isSecret?'password':'text'} value={answers[q.id]||''} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})}/></HaloField>):<p>本版本不授予额外运行权限、联网或MCP授权。项目内写入需提交前明确勾选；此请求可拒绝或停止。</p>}
        <div className="wb-actions">{run.status==='waiting_input'?<button className="wb-button" disabled={busy} onClick={()=>action(()=>call('respond',{runId:run.id,interactionId:interaction.interactionId,requestId:crypto.randomUUID(),answers:Object.fromEntries(Object.entries(answers).map(([id,value])=>[id,{answers:[value]}]))}))}>提交本次回答</button>:null}
          <button className="wb-button" disabled={busy} onClick={()=>action(()=>run.status==='waiting_input'?call('cancel',{runId:run.id}):call('respond',{runId:run.id,interactionId:interaction.interactionId,requestId:crypto.randomUUID(),decision:'decline'}))}>拒绝本次请求</button></div>
      </section>}
      {!run.sourceError&&<HaloDisclosure title="本次冻结的输入与范围"><p>目标：{run.scope.goal}</p><p>输入指纹：{run.inputHash}</p><p>明确引用 {run.scope.refs.length} 项 · 排除 {run.scope.excluded.length} 项 · AI 指令 {run.scope.instructions?.length||0} 项；均取保存的准确版本。</p>{run.scope.plan?.map(step=><p key={step.id}>{step.text}</p>)}</HaloDisclosure>}
      {run.result&&<section aria-label="Agent返回结果" className="wb-execution-result"><h4>{adopted?'返回结果（采用回执已保存）':'返回结果（尚未写入材料或能力）'}</h4><CodeBlock code={run.result.answer} title="执行返回正文（未自动采用）"/><ResultOriginal run={run} client={client} onOpen={onOpenWriteback}/>{run.result.citations?.length>0&&<section><h4>本次引用</h4>{run.result.citations.map((c,i)=><blockquote key={i}><small>{c.contextId}</small><p>{c.quote}</p></blockquote>)}</section>}{run.result.uncertainties?.length>0&&<section><h4>仍不确定</h4><ul>{run.result.uncertainties.map((u,i)=><li key={i}>{u}</li>)}</ul></section>}
        {onFeedbackResult&&run.status==='succeeded'&&<button className="wb-button" disabled={Boolean(error)} onClick={()=>onFeedbackResult(run)}>记录这次结果的版本反馈</button>}
        <HaloField label="复核备注"><HaloTextarea aria-label="结果复核备注" value={note} onChange={e=>setNote(e.target.value)} rows={3}/></HaloField>
        <div className="wb-actions">{([['accepted','确认结果，仅保留在任务'],['needs_work','需要继续核对'],['rejected','不采用此结果']]as const).map(([decision,label])=><button key={decision} className="wb-button" disabled={busy||Boolean(adopted)||Boolean(error)} onClick={()=>action(()=>call('review',{runId:run.id,resultHash:run.resultHash,decision,note}))}>{label}</button>)}</div>
        {!adopted&&run.review&&<HaloNotice title="复核已保存" description={`${({accepted:'确认保留',needs_work:'需要继续核对',rejected:'不采用'}as any)[run.review.decision]}。复核本身不改写内容；逐项采纳记录见下方。`}/>} </section>}
      {!error&&run.review?.decision==='accepted'&&run.result&&<ResultAdoption run={run} client={client} refresh={refresh} onOpen={onOpenWriteback} onPlace={onPlaceWriteback}/>}
      {!error&&(!run.result||run.review?.decision!=='accepted')&&<UnavailableWritebacks run={run} client={client} refresh={refresh} onOpen={onOpenWriteback}/>}
      <ExecutionLog events={run.events} title="已记录的执行事件"/>
    </>}
    {previousRuns.length>0&&<HaloDisclosure title={<>此前运行与回执（{previousRuns.length}）</>}>{previousRuns.map(old=><section key={old.id}><strong>第 {old.number} 次：{labels[old.status]}</strong><p>{old.sourceError||old.error||old.result?.answer||'没有已确认结果'}</p><small>{old.runtime.threadId||old.id}</small><NativeRawReturn key={old.id+':'+old.rawHash} run={old}/></section>)}</HaloDisclosure>}
    {error&&<div className="wb-execution-recovery"><HaloNotice tone="error" title="当前执行状态未确认" description={error+' 上次记录仍保留，不代表当前执行状态。'}/><button className="wb-button" onClick={()=>void refresh()}>重新读取执行记录</button></div>}{!error&&(busy||notice)&&<HaloNotice pending={busy} tone={busy?'neutral':noticeError?'error':'success'} title={busy?'正在核对执行回执…':notice}/>}
  </section>;
}

export function ThinkingExecution({session,client,executions,onFeedbackResult,onContinue,onOpenWriteback,onPlaceWriteback}:{session:Thinking;client:WorkbenchClient;executions:ReturnType<typeof useAgentRuns>;onFeedbackResult?:(run:Run)=>void;onContinue?:(messageId:string)=>void;onOpenWriteback?:(ref:ContentRef)=>void;onPlaceWriteback?:(ref:ContentRef,stillHere:()=>boolean)=>Promise<void>}){
 const [selected,setSelected]=useState(session.messages.at(-1)?.id||'');
 useEffect(()=>{setSelected(session.messages.at(-1)?.id||'');},[session.messages.length]);
 const message=session.messages.find(m=>m.id===selected);
 if(!message)return <p className="wb-muted">先留下问题或想法，再明确请AI回应；不会自动发送。</p>;
 const task={id:'thinking-'+session.id+'-'+message.id,title:session.title,goal:message.text,refs:message.scope?.refs||session.refs,excluded:message.scope?.excluded||session.excluded,instructions:message.instructions||[],status:'prepared',destination:'Trace 内只读思考',results:[]}as Task;
 return <section aria-label="Trace 内真实AI">{!message.scope&&<HaloNotice tone="warning" title="旧消息未独立记录当次引用范围" description="原话和既有回执仍保留；新的调用需先将这段原话带入草稿核对，不会后台修改历史。"/>}{onContinue&&<button type="button" className="wb-button" onClick={()=>onContinue(message.id)}>将这段原话带入新草稿</button>}<label>回应哪段原话<HaloSelect aria-label="选择思考消息" value={selected} onValueChange={value=>setSelected(value)}>{session.messages.map((m,i)=><option key={m.id} value={m.id}>第 {i+1} 段：{m.text.slice(0,55)}</option>)}</HaloSelect></label><TaskExecution key={task.id} task={task} client={client} executions={executions} thinking={{sessionId:session.id,messageId:message.id}} legacyScope={!message.scope} onFeedbackResult={onFeedbackResult} onOpenWriteback={onOpenWriteback} onPlaceWriteback={onPlaceWriteback} onCancelPreparation={()=>{}}/></section>;
}

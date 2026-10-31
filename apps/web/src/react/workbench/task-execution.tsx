import React,{useCallback,useEffect,useRef,useState} from 'react';
import type {Task,Thinking,WorkbenchClient} from './client';
import {HaloBadge,HaloNotice,HaloProgress} from './halo-surfaces';
import {LiquidButton} from './expressive-controls';
import {CodeBlock} from './code-block';
import {ExecutionLog} from './execution-log';
import {ResultAdoption} from './result-adoption';
import './task-execution.css';

export type Run={kind?:string;sessionId?:string;messageId?:string;adoptions:any[];id:string;taskId:string;number:number;status:string;mode:string;projectName:string;inputHash:string;scope:Task;runtime:any;events:any[];result:any;resultHash:string;adoption?:any;error:string;review?:{decision:string;note:string};created:string;finished:string};
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
export function agentTaskLabel(task:Task,runs:Run[],ready:boolean,error=''){const run=runs.filter(r=>r.taskId===task.id).at(-1);return error?'读取中断，当前状态未知':run?(run.adoptions?.some(a=>a.status==='committed')?'部分结果已采纳':run.review?'结果已复核':labels[run.status]||run.status):!ready?'读取执行状态…':task.status==='prepared'?'准备已保存，尚未提交':'已取消准备';}

export function TaskExecution({task,client,executions,onCancelPreparation,thinking}:{task:Task;client:WorkbenchClient;executions:ReturnType<typeof useAgentRuns>;onCancelPreparation:()=>void;thinking?:{sessionId:string;messageId:string}}){
  const {runs,refresh,ready,error}=executions,history=runs.filter(r=>r.taskId===task.id),run=history.at(-1);
  const [setup,setSetup]=useState<any>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[write,setWrite]=useState(false),[note,setNote]=useState(''),[answers,setAnswers]=useState<Record<string,string>>({});
  useEffect(()=>{if(bridge())void call('status').then(setSetup).catch(e=>setNotice(e.message));},[]);
  useEffect(()=>{setNote(run?.review?.note||'');setAnswers({});},[run?.id]);
  const action=async(fn:()=>Promise<any>)=>{if(busy)return;setBusy(true);setNotice('');try{await fn();await refresh();}catch(e){setNotice(e.message||'操作未完成，请保留当前内容后重试。');}finally{setBusy(false);}};
  if(!bridge())return <p className="wb-muted">真实执行需使用桌面版；本页只保存任务准备。</p>;
  if(task.execution)return <p className="wb-muted">本任务已有其他执行回执，请从既有回执面板继续核验；不会重复提交。</p>;
  const interaction=run?.runtime?.interaction,adopted=Boolean(run?.adoptions?.some(a=>a.status==='committed'));
  return <section className="wb-execution" aria-label="任务执行与结果复核" data-status={run?.status||'prepared'} data-run-id={run?.id}>
    <header><h3>{thinking?'Trace 内 AI 思考':'本机 Codex 执行'}</h3><HaloBadge tone={!error&&run?.status==='failed'?'error':!error&&run?.status==='succeeded'?'success':'neutral'}>{error?'读取中断，当前状态未知':run?adopted?'部分结果已采纳':run.review?'结果已复核':labels[run.status]:ready?'尚未提交':'正在核对执行记录'}</HaloBadge></header>
    {!run&&<>
      <p>{thinking?'仅使用本讨论原话、已选引用和此前AI回复，不读取项目文件。':'项目：'+(setup?.projectName||'尚未选择')+'。'}只有点击提交才会运行模型，可能使用你的 Codex 额度。</p>
      {!thinking&&<div className="wb-actions"><button className="wb-button" disabled={busy} onClick={()=>action(async()=>setSetup(await call('project.select')))}>选择执行项目</button><button className="wb-button" disabled={busy||!setup?.projectSelected} onClick={()=>action(async()=>{await call('check');setNotice('Codex已登录并通过连接检查；尚未执行任务。');})}>检查 Codex 连接</button></div>}
      <p>本次仅带入已保存的任务目标、步骤、选定指令和 {task.refs.length} 项准确版本引用；不自动发送整个画布、其他讨论或原件文件。项目工具限于所选项目。</p>
      {!thinking&&<label className="wb-check"><input type="checkbox" checked={write} onChange={e=>setWrite(e.target.checked)}/>允许本次任务修改所选项目文件（默认只读）</label>}
      <div className="wb-actions"><LiquidButton className="wb-button wb-primary" disabled={busy||!ready||Boolean(error)||!setup?.available||(!thinking&&!setup?.projectSelected)||task.status!=='prepared'||Boolean(client.getSnapshot().pending)} onClick={()=>action(()=>thinking?call('think',{...thinking,requestId:'submit-'+task.id}):call('submit',{taskId:task.id,requestId:'submit-'+task.id,mode:write?'workspace-write':'read-only'}))}>{thinking?'请 AI 回应这段思考':'提交并执行'}</LiquidButton>{!thinking&&task.status==='prepared'&&<button className="wb-button" disabled={busy} onClick={onCancelPreparation}>取消尚未交接的准备</button>}</div>
    </>}
    {run&&<>
      <p>第 {run.number} 次运行 · 项目 {run.projectName} · {run.mode==='thinking'?'限本讨论的只读思考':run.mode==='read-only'?'只读':'可修改项目内文件'}。输入与引用已冻结，结果只回到这个任务。</p>
      {!error&&active.includes(run.status)&&<HaloProgress label={labels[run.status]||'正在执行'}/>}
      {run.runtime.threadId&&<p className="wb-execution-receipt">Codex thread：{run.runtime.threadId}{run.runtime.turnId&&<> / turn：{run.runtime.turnId}</>}</p>}
      {run.error&&<HaloNotice tone="error" title={run.error} description="输入、原引用和已有回执仍保留。先前执行可能已产生项目改动；重试前请核对，不会自动回滚文件。"/>}
      {['failed','interrupted','cancelled','timed_out'].includes(run.status)&&<button className="wb-button" disabled={busy} onClick={()=>action(()=>call('retry',{taskId:task.id,previousId:run.id,requestId:'retry-'+run.id}))}>核对后重试此任务</button>}
      {active.includes(run.status)&&<button className="wb-button" disabled={busy||run.status==='cancelling'} onClick={()=>action(()=>call('cancel',{runId:run.id}))}>停止本次执行</button>}
      {interaction&&['waiting_approval','waiting_input'].includes(run.status)&&<section className="wb-execution-interaction" aria-label="运行交互">
        <h4>{run.status==='waiting_input'?'Codex需要补充信息':'Codex请求审批'}</h4><pre>{JSON.stringify(interaction,null,2)}</pre>
        {run.status==='waiting_input'?(interaction.questions||[]).map(q=><label key={q.id}>{q.question||q.id}<input type={q.isSecret?'password':'text'} value={answers[q.id]||''} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})}/></label>):<p>本版本不授予额外运行权限、联网或MCP授权。项目内写入需提交前明确勾选；此请求可拒绝或停止。</p>}
        <div className="wb-actions">{run.status==='waiting_input'?<button className="wb-button" disabled={busy} onClick={()=>action(()=>call('respond',{runId:run.id,interactionId:interaction.interactionId,requestId:crypto.randomUUID(),answers:Object.fromEntries(Object.entries(answers).map(([id,value])=>[id,{answers:[value]}]))}))}>提交本次回答</button>:null}
          <button className="wb-button" disabled={busy} onClick={()=>action(()=>run.status==='waiting_input'?call('cancel',{runId:run.id}):call('respond',{runId:run.id,interactionId:interaction.interactionId,requestId:crypto.randomUUID(),decision:'decline'}))}>拒绝本次请求</button></div>
      </section>}
      <details><summary>本次冻结的输入与范围</summary><p>目标：{run.scope.goal}</p><p>输入指纹：{run.inputHash}</p><p>明确引用 {run.scope.refs.length} 项 · 排除 {run.scope.excluded.length} 项 · AI 指令 {run.scope.instructions?.length||0} 项；均取保存的准确版本。</p>{run.scope.plan?.map(step=><p key={step.id}>{step.text}</p>)}</details>
      {run.result&&<section aria-label="Agent返回结果" className="wb-execution-result"><h4>{adopted?'返回结果（采用回执已保存）':'返回结果（尚未写入材料或能力）'}</h4><CodeBlock code={run.result.answer} title="执行返回正文（未自动采用）"/>{run.result.citations?.length>0&&<section><h4>本次引用</h4>{run.result.citations.map((c,i)=><blockquote key={i}><small>{c.contextId}</small><p>{c.quote}</p></blockquote>)}</section>}{run.result.uncertainties?.length>0&&<section><h4>仍不确定</h4><ul>{run.result.uncertainties.map((u,i)=><li key={i}>{u}</li>)}</ul></section>}
        <label>复核备注<textarea aria-label="结果复核备注" value={note} onChange={e=>setNote(e.target.value)} rows={3}/></label>
        <div className="wb-actions">{([['accepted','确认结果，仅保留在任务'],['needs_work','需要继续核对'],['rejected','不采用此结果']]as const).map(([decision,label])=><button key={decision} className="wb-button" disabled={busy||Boolean(adopted)||Boolean(error)} onClick={()=>action(()=>call('review',{runId:run.id,resultHash:run.resultHash,decision,note}))}>{label}</button>)}</div>
        {!adopted&&run.review&&<HaloNotice title="复核已保存" description={`${({accepted:'确认保留',needs_work:'需要继续核对',rejected:'不采用'}as any)[run.review.decision]}。复核本身不改写内容；逐项采纳记录见下方。`}/>} </section>}
      {!error&&run.review?.decision==='accepted'&&run.result&&<ResultAdoption run={run} client={client} refresh={refresh}/>}
      {history.length>1&&<details><summary>此前运行与回执（{history.length-1}）</summary>{history.slice(0,-1).map(old=><section key={old.id}><strong>第 {old.number} 次：{labels[old.status]}</strong><p>{old.error||old.result?.answer||'没有已确认结果'}</p><small>{old.runtime.threadId||old.id}</small></section>)}</details>}
      <ExecutionLog events={run.events} title="已记录的执行事件"/>
    </>}
    {error&&<p role="alert">{error} 上次记录仍保留，不代表当前执行状态。<button className="wb-button" onClick={()=>void refresh()}>重新读取执行记录</button></p>}{notice&&<p role="status">{notice}</p>}
  </section>;
}

export function ThinkingExecution({session,client,executions}:{session:Thinking;client:WorkbenchClient;executions:ReturnType<typeof useAgentRuns>}){
 const [selected,setSelected]=useState(session.messages.at(-1)?.id||'');
 useEffect(()=>{setSelected(session.messages.at(-1)?.id||'');},[session.messages.length]);
 const message=session.messages.find(m=>m.id===selected);
 if(!message)return <p className="wb-muted">先留下问题或想法，再明确请AI回应；不会自动发送。</p>;
 const task={id:'thinking-'+session.id+'-'+message.id,title:session.title,goal:message.text,refs:session.refs,excluded:session.excluded,instructions:message.instructions||[],status:'prepared',destination:'Trace 内只读思考',results:[]}as Task;
 return <section aria-label="Trace 内真实AI"><label>回应哪段原话<select aria-label="选择思考消息" value={selected} onChange={e=>setSelected(e.target.value)}>{session.messages.map((m,i)=><option key={m.id} value={m.id}>第 {i+1} 段：{m.text.slice(0,55)}</option>)}</select></label><TaskExecution key={task.id} task={task} client={client} executions={executions} thinking={{sessionId:session.id,messageId:message.id}} onCancelPreparation={()=>{}}/></section>;
}

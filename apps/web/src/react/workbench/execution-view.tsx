import {ExecutionLog} from './execution-log';
import React,{useEffect,useRef,useState} from 'react';
import {WorkbenchClient,type Task} from './client';
import {HaloField,HaloInput} from './halo-controls';
import {HaloBadge} from './halo-surfaces';
import {CodeBlock} from './code-block';
import './execution-view.css';

type Run={protocolVersion:number;runId:string;requestId:string;contextHash:string;matterId:string;workId?:string;status:string;lastEventId:number;createdAt?:string;startedAt?:string;finishedAt?:string;resultHash?:string;result?:{answer?:string;adoption?:string;kind?:string};error?:{message?:string};usableAsCurrent?:boolean;canonicalStateChanged?:boolean;runtime?:{pendingInteraction?:{state:string}}};
type Event={runId:string;sequence:number;contextHash:string;type:string;at:string;data:unknown};
type Receipt={protocolVersion:number;run:Run;events:Event[];after:number;next:number;hasMore:boolean};
const labels:Record<string,string>={queued:'等待执行',running:'执行中',succeeded:'运行已完成',failed:'运行失败',cancelled:'运行已取消',stale:'上下文已失效',timed_out:'运行超时',interrupted:'运行已中断'};
const terminal=new Set(['succeeded','failed','cancelled','stale','timed_out','interrupted']);
async function readReceipt(runId:string,after:number,signal:AbortSignal):Promise<Receipt> {
  const native=(window as any).traceNative;
  let result;
  if(native?.requestCapability){result=await native.requestCapability({operation:'agent.run.receipt',runId,after});if(result?.ok===false)throw Error(result.error?.message||'本机回执读取失败。');}
  else {const response=await fetch('/api/agent/runs/'+encodeURIComponent(runId)+'/receipt?after='+after,{signal,cache:'no-store',redirect:'error'});if(!response.ok)throw Error(response.status===404?'当前同源服务没有这份执行回执，或尚未支持回执接口。':'执行回执暂时无法读取（'+response.status+'）。');result=await response.json();}
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  if(result?.protocolVersion!==1||result.run?.runId!==runId||result.run.protocolVersion!==1||!Object.hasOwn(labels,result.run.status)||!Number.isSafeInteger(result.run.lastEventId)||!Array.isArray(result.events)||result.events.length>512||result.after!==after||!Number.isSafeInteger(result.next)||result.next<after||result.next>result.run.lastEventId||typeof result.hasMore!=='boolean')throw Error('回执格式或运行身份不正确，未据此推断状态。');
  let cursor=after;for(const event of result.events){if(event.runId!==runId||event.contextHash!==result.run.contextHash||event.sequence!==cursor+1||typeof event.type!=='string'||typeof event.at!=='string')throw Error('事件身份或顺序不连续；未跳过缺失日志。');cursor=event.sequence;}if(cursor!==result.next||result.hasMore!==(result.next<result.run.lastEventId)||result.hasMore&&!result.events.length)throw Error('回执游标不一致。');if(!/^[a-f0-9]{64}$/.test(result.run.contextHash)||typeof result.run.requestId!=='string'||result.run.status==='succeeded'&&(!/^[a-f0-9]{64}$/.test(result.run.resultHash)||typeof result.run.result?.answer!=='string'||!Number.isFinite(Date.parse(result.run.finishedAt))))throw Error('终态身份或结果回执不完整，未显示成功。');
  return result;
}
export function TaskState({task}:{task:Task}) {return <HaloBadge icon={task.status==='prepared'?'document':'idle'} tone="neutral">{task.status==='prepared'?'准备已保存，尚未交接':'准备已取消'}</HaloBadge>;}

export function ExecutionView({client,task}:{client:WorkbenchClient;task:Task}) {
  const [input,setInput]=useState(task.execution?.runId||''),[runId,setRunId]=useState(task.execution?.runId||''),[receipt,setReceipt]=useState<Receipt|null>(null),[events,setEvents]=useState<Event[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[retry,setRetry]=useState(0),[busy,setBusy]=useState(false),[auto,setAuto]=useState(true);
  const lastIdentity=useRef('');const current=useRef({taskId:task.id,runId});current.current={taskId:task.id,runId};
  useEffect(()=>{if(!runId)return;let alive=true,timer:number|undefined,cursor=0;const controller=new AbortController();if(lastIdentity.current!==runId){setReceipt(null);setEvents([]);lastIdentity.current=runId;}setError('');
    const load=async()=>{try{const next=await readReceipt(runId,cursor,controller.signal);if(!alive)return;const linked=task.execution;if(linked&&linked.runId===runId&&(linked.requestId!==next.run.requestId||linked.contextHash!==next.run.contextHash))throw Error('回执与已关联身份不一致，未替换为另一次运行。');setReceipt(next);const firstPage=cursor===0;setEvents(old=>(firstPage?next.events:[...old,...next.events]).slice(-2000));cursor=next.next;setError('');if(next.hasMore)timer=window.setTimeout(load,0);else if(auto&&!terminal.has(next.run.status))timer=window.setTimeout(load,1500);}catch(e){if(alive&&!controller.signal.aborted)setError(e.message||'读取失败，运行状态未知。');}};
    void load();return()=>{alive=false;controller.abort();if(timer!==undefined)clearTimeout(timer);};
  },[runId,retry,auto,task.id,task.execution?.contextHash,task.execution?.requestId]);
  const run=receipt?.run,observed=run&&labels[run.status],status=error?'读取中断，当前状态未知':observed||'尚未读取运行回执';
  return <section className="wb-execution-view" aria-label="真实执行回执"><div className="wb-actions"><span>任务准备：</span><TaskState task={task}/>{task.execution&&task.status==='prepared'&&<button type="button" className="wb-button" onClick={()=>{void client.command([{type:'task.cancel',id:task.id}]).catch(e=>setNotice(e.message));}}>取消尚未交接的准备</button>}</div><header><h3>执行记录</h3><HaloBadge icon={error||run?.status==='failed'?'error':'document'} tone={error?'warning':run?.status==='failed'?'error':'neutral'}>{status}</HaloBadge></header><p className="wb-halo-hint">只读取同源 Trace Agent Runtime 的运行记录。不启动新执行、不自动采纳结果；手动关联不证明该运行采用了此任务的范围。</p>
    <form className="wb-execution-lookup" onSubmit={e=>{e.preventDefault();if(!/^[a-zA-Z0-9-]{1,200}$/.test(input)){setNotice('请填写有效的 Trace 运行 ID，不接受 URL。');return;}setNotice('');setRunId(input);setRetry(n=>n+1);}}><HaloField label="执行运行 ID"><HaloInput value={input} onChange={e=>setInput(e.target.value)} placeholder="已有运行的 runId"/></HaloField><button type="submit" className="wb-button">读取运行回执</button></form>
    {runId&&<div className="wb-actions"><button type="button" className="wb-button" onClick={()=>setRetry(n=>n+1)}>重新读取执行回执</button><label><input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)}/>自动读取新事件</label></div>}
    {error&&<p role="alert">{error} {run&&`最后一次已知状态：${labels[run.status]}。`}</p>}{notice&&<p role="status">{notice}</p>}
    {run&&<><dl className="wb-execution-meta"><dt>运行身份</dt><dd>{run.runId}</dd><dt>原始范围</dt><dd>事项 {run.matterId}{run.workId?' / 工作现场 '+run.workId:''}</dd><dt>上下文指纹</dt><dd>{run.contextHash}</dd><dt>真实事件</dt><dd>已读取至 #{receipt?.next} / {run.lastEventId}，显示最近 {events.length} 条，不换算完成百分比</dd>{run.finishedAt&&<><dt>终态时间</dt><dd>{run.finishedAt}</dd></>}</dl>
      <button type="button" className="wb-button" disabled={busy||run.runId!==runId||Boolean(error)||!receipt||receipt.hasMore||!run.requestId||!/^[a-f0-9]{64}$/.test(run.contextHash)} onClick={()=>{setBusy(true);setNotice('');const identity={source:'trace-agent-runtime',runId:run.runId,requestId:run.requestId,contextHash:run.contextHash},target=task.id;void client.command([{type:'task.execution',id:target,execution:identity}]).then(()=>{if(current.current.taskId===target)setNotice('运行身份已关联；任务准备状态和结果采用状态未改变。');}).catch(e=>setNotice(e.message)).finally(()=>setBusy(false));}}>关联这份真实运行记录</button>
      {task.execution&&<button type="button" className="wb-button" disabled={busy} onClick={()=>{setBusy(true);void client.command([{type:'task.execution',id:task.id,execution:null}]).catch(e=>setNotice(e.message)).finally(()=>setBusy(false));}}>解除关联，不删除执行记录</button>}
      {task.status==='cancelled'&&!terminal.has(run.status)&&<p role="status">取消任务准备不等于停止此运行；此处没有代为取消执行。</p>}{run.runtime?.pendingInteraction?.state==='waiting'&&<p role="status">执行方正在等待审批或输入。此处只读，请回原执行入口处理，不会自动批准。</p>}
      {run.error?.message&&<p role="status">执行回执：{run.error.message}</p>}
      {run.status==='succeeded'&&<p className="wb-halo-hint">运行终态已记录；{run.canonicalStateChanged?'执行方报告原范围已有变更，请回原范围核验。':'不代表本任务结果已采用或正文已修改。'}{run.usableAsCurrent===false?'原范围已变化，不能视为当前建议。':''}</p>}
      <ExecutionLog events={events}/>
      {run.result?.answer&&<CodeBlock title="执行返回正文（未自动采用）" code={run.result.answer} language="text"/>}
    </>}
  </section>;
}

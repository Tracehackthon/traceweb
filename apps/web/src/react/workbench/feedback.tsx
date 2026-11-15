import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {HaloNotice} from './halo-surfaces';
import {HaloDisclosure} from './halo-disclosure';
import {HaloSelect} from './halo-controls';
import {TraceIcon} from '../ui/icon';
import type {WorkbenchClient,WorkbenchState,PendingWrite} from './client';
import {samePendingWrite} from './pending-recovery';
import './feedback.css';

// Registration only decides where to show a receipt. It never owns a command,
// clears a pending write, or changes the authoritative success/failure state.
const FeedbackOwners=createContext<{owners:Set<string>;register:(owner:string)=>()=>void}>({owners:new Set(),register:()=>()=>{}});
export function FeedbackProvider({children}:{children:React.ReactNode}){
  const [owners,setOwners]=useState<Set<string>>(()=>new Set());
  const register=useCallback((owner:string)=>{setOwners(old=>new Set(old).add(owner));return()=>setOwners(old=>{const next=new Set(old);next.delete(owner);return next;});},[]);
  const value=useMemo(()=>({owners,register}),[owners,register]);
  return <FeedbackOwners.Provider value={value}>{children}</FeedbackOwners.Provider>;
}

function exportRecovery(raw:string,name:string){const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const commandId=(pending:PendingWrite)=>(pending.body as {commandId:string}).commandId;
function RecoveryFeedback({client,state,compact=false}:{client:WorkbenchClient;state:WorkbenchState;compact?:boolean}){
  const pending=state.pending;if(!pending)return null;
  return <section className="wb-feedback-recovery" data-pending-owner={pending.owner||'workspace'} aria-label="未确认操作恢复" aria-busy={state.saving}>
    <HaloNotice compact={compact} tone={state.saving?'neutral':'error'} pending={state.saving} title={state.saving?'正在核对原命令…':'保存尚未确认'} description="草稿和完整原请求仍保留。重试只发送下面这份请求，不使用后来编辑的正文。"/>
    {state.pendingWrites.length>1&&<HaloSelect aria-label="选择待核对的原命令" value={String(state.pendingWrites.findIndex(request=>samePendingWrite(request,pending)))} disabled={state.saving} onValueChange={value=>client.selectPending(state.pendingWrites[Number(value)])}>{state.pendingWrites.map((request,index)=><option key={index} value={String(index)}>{index+1} · {request.owner||'工作台'} · {commandId(request)}</option>)}</HaloSelect>}
    <div className="wb-actions"><button type="button" className="wb-button" disabled={state.saving||state.pendingRecovery.length>0} onClick={()=>void client.retry(pending)}><TraceIcon name="history"/>核对并重试原命令</button></div>
    <HaloDisclosure title="失败详情与其他恢复方式"><p className="wb-feedback-detail">{state.error}</p><p className="wb-feedback-detail">原命令：{commandId(pending)}</p><pre className="wb-feedback-command" aria-label="本次重试的完整原请求">{JSON.stringify(pending,null,2)}</pre><div className="wb-actions"><button type="button" className="wb-button" disabled={state.saving} onClick={()=>exportRecovery(JSON.stringify(pending,null,2),'Trace-unconfirmed-command.json')}>导出未确认操作</button><button type="button" className="wb-button" disabled={state.saving} onClick={()=>void client.reloadAfterConflict()}>保留本地草稿，读取当前版本</button><button type="button" className="wb-button" disabled={state.saving} onClick={()=>{if(window.confirm('请先导出这份原请求。停止本地重试不会取消服务器命令、撤销已保存内容或删除草稿；原请求可能已经提交。明确只移除这份本地重试记录？'))void client.forgetPending(pending);}}>停止重试这份本地请求</button></div><p className="wb-halo-hint">重新读取只核对已保存内容，仍保留未确认原请求。停止本地重试也不表示服务器未收到或取消了它。</p></HaloDisclosure>
  </section>;
}
function UnreadableRecovery({client,state}:{client:WorkbenchClient;state:WorkbenchState}){
  return <section className="wb-feedback-recovery" aria-label="无法识别的操作恢复"><HaloNotice tone="error" title="本地恢复记录需要处理" description="原始记录仍保留，已阻止新写入和重试；已保存内容仍可读取，草稿可继续编辑。"/>{state.pendingRecovery.map(issue=><HaloDisclosure key={issue.key} title="查看原始恢复记录与处理方式" defaultOpen><p className="wb-feedback-detail">{issue.reason}</p><pre className="wb-feedback-command" aria-label="未覆盖的原始恢复记录">{issue.raw??'本地存储暂不可读取，没有取得可导出的原始内容。'}</pre><div className="wb-actions"><button className="wb-button" disabled={issue.raw===null} onClick={()=>exportRecovery(issue.raw!,'Trace-unreadable-recovery.json')}>原样导出恢复记录</button><button className="wb-button" disabled={state.saving||issue.raw===null} onClick={()=>{if(window.confirm('请先原样导出这份无法识别的记录。明确只重置这份本地恢复记录？这不会撤销已保存内容、删除草稿或取消服务器命令。'))void client.resetRecoveryRecord(issue);}}>明确重置这份本地恢复记录</button></div></HaloDisclosure>)}<div className="wb-actions"><button className="wb-button" disabled={state.saving} onClick={()=>client.rereadRecovery()}>重新读取本地恢复记录</button><button className="wb-button" disabled={state.loading} onClick={()=>void client.reloadAfterConflict()}>重新读取已保存内容</button></div></section>;
}

export function FormFeedback({client,owner,busy=false,pendingLabel='正在保存…',message='',error=false,dirty=false}:{client:WorkbenchClient;owner:string;busy?:boolean;pendingLabel?:string;message?:string;error?:boolean;dirty?:boolean}){
  const {register}=useContext(FeedbackOwners),state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot);
  const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(true);
  useEffect(()=>{let release:(()=>void)|undefined;const update=()=>{const shown=!ref.current?.closest('[hidden],[inert],details:not([open])');setVisible(shown);if(shown&&!release)release=register(owner);else if(!shown&&release){release();release=undefined;}};update();const observer=new MutationObserver(update);observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['hidden','inert','open']});return()=>{observer.disconnect();release?.();};},[owner,register]);
  const own=state.pending?.owner===owner;
  return <div ref={ref} className="wb-feedback-slot" data-feedback-owner={owner}>
    {visible&&(own?<RecoveryFeedback client={client} state={state}/>:busy?<HaloNotice pending tone="neutral" title={pendingLabel}/>:state.pending?null:error&&message?<HaloNotice tone="error" title={message}/>:dirty?<HaloNotice tone="neutral" title="草稿有未保存修改"/>:message?<HaloNotice title={message}/>:null)}
  </div>;
}

export function GlobalFeedback({client,notice,onDismiss}:{client:WorkbenchClient;notice:string;onDismiss:()=>void}){
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot),{owners}=useContext(FeedbackOwners);
  if(state.pendingRecovery.length)return <div className="wb-feedback-global"><UnreadableRecovery client={client} state={state}/></div>;
  if(state.pending){if(state.pendingWrites.length===1&&state.pending.owner&&owners.has(state.pending.owner))return null;return <div className="wb-feedback-global"><RecoveryFeedback compact client={client} state={state}/></div>;}
  if(!state.error&&!notice)return null;
  return <div className="wb-feedback-global"><HaloNotice tone="warning" title={state.error||notice} onDismiss={state.error?undefined:onDismiss} actions={state.error?<button type="button" className="wb-button" disabled={state.loading} onClick={()=>void client.reloadAfterConflict()}>重新读取已保存内容</button>:undefined}/></div>;
}

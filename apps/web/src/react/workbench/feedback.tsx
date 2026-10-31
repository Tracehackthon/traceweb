import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {HaloNotice} from './halo-surfaces';
import {HaloDisclosure} from './halo-disclosure';
import {TraceIcon} from '../ui/icon';
import type {WorkbenchClient,WorkbenchState} from './client';
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

function RecoveryFeedback({client,state}:{client:WorkbenchClient;state:WorkbenchState}){
  const exportCommand=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(state.pending,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='Trace-unconfirmed-command.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <section className="wb-feedback-recovery" data-pending-owner={state.pending?.owner||'workspace'} aria-label="未确认操作恢复" aria-busy={state.saving}>
    <HaloNotice tone={state.saving?'neutral':'error'} pending={state.saving} title={state.saving?'正在核对原命令…':'保存尚未确认'} description="草稿仍保留。核对原命令后再继续，不要重复提交。"/>
    <div className="wb-actions"><button type="button" className="wb-button" disabled={state.saving} onClick={()=>void client.retry()}><TraceIcon name="history"/>核对并重试原命令</button></div>
    <HaloDisclosure title="失败详情与其他恢复方式"><p className="wb-feedback-detail">{state.error}</p><div className="wb-actions"><button type="button" className="wb-button" disabled={state.saving} onClick={exportCommand}>导出未确认操作</button><button type="button" className="wb-button" disabled={state.saving} onClick={()=>void client.reloadAfterConflict()}>保留本地草稿，读取当前版本</button></div><p className="wb-halo-hint">重新读取只核对已保存内容，不会自动提交当前编辑。</p></HaloDisclosure>
  </section>;
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
  if(state.pending){if(state.pending.owner&&owners.has(state.pending.owner))return null;return <div className="wb-feedback-global"><RecoveryFeedback client={client} state={state}/></div>;}
  if(!state.error&&!notice)return null;
  return <div className="wb-feedback-global"><HaloNotice tone="warning" title={state.error||notice} onDismiss={state.error?undefined:onDismiss} actions={state.error?<button type="button" className="wb-button" disabled={state.loading} onClick={()=>void client.reloadAfterConflict()}>重新读取已保存内容</button>:undefined}/></div>;
}

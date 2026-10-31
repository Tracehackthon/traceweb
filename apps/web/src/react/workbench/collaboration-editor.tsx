import {FormFeedback} from './feedback';
import {stableWorkbenchJson} from '@trace/product-workspace';
import React,{useEffect,useRef,useState} from 'react';
import {WorkbenchClient,makeId,type ContentRef,type Thinking,type StepItem,type ContentEntry,type ContentValue} from './client';
import {ThinkingComposer} from './thinking-composer';
import {HaloField,HaloTextarea} from './halo-controls';
import {LiquidButton} from './expressive-controls';
import {TemplateLibrary,InstructionPicker,StepEditor,templateText,appendDraft,capabilityRef,InstructionSnapshot} from './capability-tools';

type Draft={submissionId?:string;schemaVersion:1;text:string;template?:ContentRef;instructions:ContentRef[];plan:StepItem[]};
function useToolDraft(name:string) {
  const key='trace-workbench:'+(location.pathname.startsWith('/app/demo')?'demo':'personal')+':tools:'+name;
  const [error,setError]=useState(''),[blocked,setBlocked]=useState(false);
  const [draft,setDraft]=useState<Draft>(()=>{const empty:Draft={schemaVersion:1,text:'',instructions:[],plan:[]};try{const raw=localStorage.getItem(key);if(raw===null)return empty;const value=JSON.parse(raw);if(value?.schemaVersion!==1||typeof value.text!=='string'||!Array.isArray(value.instructions)||!Array.isArray(value.plan)||!value.plan.every(row=>typeof row?.id==='string'&&typeof row.text==='string'&&typeof row.checked==='boolean')||!value.instructions.every(ref=>ref?.kind==='capability'&&typeof ref.id==='string'&&Number.isSafeInteger(ref.version)&&ref.version>0))throw Error('草稿格式无法识别，原记录未覆盖。');return value;}catch(e){setError(e.message||'草稿无法读取，未覆盖原记录。');setBlocked(true);return empty;}});
  const update=(next:Draft)=>{if(blocked)return;setDraft(next);try{localStorage.setItem(key,JSON.stringify(next));setError('');}catch{setError('本地草稿暂未落盘，请复制内容后再关闭。');}};
  return {draft,update,error,blocked};
}

function LegacyDraft({name,onRecover}:{name:string;onRecover:(text:string)=>void}) {
  const [old]=useState(()=>{try{const raw=localStorage.getItem('trace-workbench:'+(location.pathname.startsWith('/app/demo')?'demo':'personal')+':draft:'+name),value=raw===null?'':JSON.parse(raw);return typeof value==='string'?value:'';}catch{return '';}}),[recovered,setRecovered]=useState(false);
  return old.trim()&&!recovered?<button type="button" className="wb-button" onClick={()=>{onRecover(old);setRecovered(true);}}>取回旧版未分配草稿</button>:null;
}

export function SessionComposer({client,session}:{client:WorkbenchClient;session:Thinking}) {
  const {draft,update,error,blocked}=useToolDraft('session:'+session.id),live=useRef(draft);live.current=draft;
  const [notice,setNotice]=useState(''),[noticeError,setNoticeError]=useState(false),[saving,setSaving]=useState(false);
  useEffect(()=>{const current=live.current,sent=session.messages.find(message=>message.id===current.submissionId);if(sent&&sent.text===current.text&&stableWorkbenchJson(sent.template)===stableWorkbenchJson(current.template)){update({...current,text:'',template:undefined,submissionId:undefined});setNotice('已核对原消息，保存完成；没有重复新增。');}},[session.messages.length]);
  const insert=(entry:ContentEntry,value:ContentValue)=>{update({...live.current,text:appendDraft(live.current.text,templateText(value)),template:capabilityRef(entry)});setNotice('模板已追加到当前讨论草稿，尚未发送。');};
  return <><ThinkingComposer messages={session.messages} value={draft.text} onChange={text=>{update({...live.current,text});if(!client.getSnapshot().pending){setNotice('');setNoticeError(false);}}} tools={<><LegacyDraft name="thinking-composer" onRecover={text=>update({...live.current,text:appendDraft(live.current.text,text)})}/><TemplateLibrary client={client} onInsert={insert}/><InstructionPicker client={client} selected={session.instructions||[]} scope="仅当前讨论的后续记录，不影响历史和其他讨论" onApply={refs=>client.command([{type:'thinking.instructions',id:session.id,instructions:refs}])}/></>} onSave={async text=>{
    if(blocked)throw Error('请先恢复本地草稿。');setSaving(true);setNotice('');const template=live.current.template;
    try{const existing=live.current.submissionId?session.messages.find(m=>m.id===live.current.submissionId):null,id=existing&&(existing.text!==text||stableWorkbenchJson(existing.template)!==stableWorkbenchJson(template))?makeId('message'):live.current.submissionId||makeId('message');update({...live.current,submissionId:id});if(!existing||existing.id!==id)await client.command([{type:'thinking.message',id:session.id,messageId:id,text,author:'user',...(template?{template}:{})}],'session:'+session.id);setNoticeError(false);setNotice('思考记录已保存');if(live.current.text===text)update({...live.current,text:'',template:undefined,submissionId:undefined});}catch(e){setNoticeError(true);setNotice(e.message);throw e;}finally{setSaving(false);}
  }}/><FormFeedback client={client} owner={'session:'+session.id} busy={saving} message={error||notice} error={Boolean(error)||noticeError}/></>;
}

export function TaskPreparation({client,refs,onSaved}:{client:WorkbenchClient;refs:ContentRef[];onSaved:(id:string)=>void}) {
  const {draft,update,error,blocked}=useToolDraft('task-preparation'),live=useRef(draft);live.current=draft;
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[noticeError,setNoticeError]=useState(false),savedId=useRef<string|null>(draft.submissionId||null),confirmed=useRef<string|null>(null);
  const fingerprint=(value:any)=>stableWorkbenchJson({text:value.text??value.goal,plan:value.plan||[],instructions:value.instructions||[],template:value.template,refs:value.refs||refs});
  useEffect(()=>{const id=live.current.submissionId,task=id&&client.getSnapshot().host?.tasks[id];if(!busy&&task){confirmed.current=fingerprint(task);savedId.current=null;update({...live.current,submissionId:undefined});onSaved(task.id);setNoticeError(false);setNotice(fingerprint(task)===fingerprint(live.current)?'任务准备已保存，尚未交接；指令和步骤已按本次内容冻结。':'上次准备已保存；当前编辑仍是草稿。');}},[client.getSnapshot().revision,busy]);
  return <form className="wb-editor wb-task-preparation" aria-label="外部任务准备" onSubmit={e=>{e.preventDefault();if(busy||blocked||!draft.text.trim()||client.getSnapshot().pending)return;setBusy(true);setNotice('');const submitted=structuredClone(draft),known=savedId.current?client.getSnapshot().host?.tasks[savedId.current]:null;const same=known&&stableWorkbenchJson(known.refs)===stableWorkbenchJson(refs)&&known.goal===submitted.text&&stableWorkbenchJson(known.plan||[])===stableWorkbenchJson(submitted.plan)&&stableWorkbenchJson(known.instructions||[])===stableWorkbenchJson(submitted.instructions)&&stableWorkbenchJson(known.template)===stableWorkbenchJson(submitted.template);const id=known&&!same?makeId('task'):savedId.current||makeId('task');savedId.current=id;update({...live.current,submissionId:id});void (client.getSnapshot().host?.tasks[id]?Promise.resolve():client.command([{type:'task.prepare',id,title:submitted.text.slice(0,60),goal:submitted.text,refs,excluded:[],destination:'尚未选择执行方',instructions:submitted.instructions,plan:submitted.plan,...(submitted.template?{template:submitted.template}:{})}],'task-preparation')).then(()=>{confirmed.current=fingerprint({...submitted,refs});savedId.current=null;update({...live.current,submissionId:undefined});onSaved(id);setNoticeError(false);setNotice('任务准备已保存，尚未交接；指令和步骤已按本次内容冻结。');}).catch(e=>{setNoticeError(true);setNotice(e.message);}).finally(()=>setBusy(false));}}>
    <LegacyDraft name="task-goal" onRecover={text=>update({...live.current,text:appendDraft(live.current.text,text)})}/><TemplateLibrary client={client} onInsert={(entry,value)=>{const incoming=value.stepItems||(value.steps?[{id:makeId('step'),text:value.steps,checked:false}]:[]);update({...live.current,text:appendDraft(live.current.text,templateText(value)),template:capabilityRef(entry),plan:[...live.current.plan,...incoming.map(row=>({...row,id:makeId('step'),checked:false}))]});}}/>
    <HaloField label="要交给外部 Agent 的问题"><HaloTextarea aria-label="外部任务目标" rows={5} value={draft.text} readOnly={blocked} onChange={e=>update({...live.current,text:e.target.value})}/></HaloField>
    <InstructionPicker client={client} selected={draft.instructions} scope="仅当前任务准备，保存后按准确版本冻结" onApply={async instructions=>{if(blocked)throw Error('请先恢复本地草稿。');update({...live.current,instructions});}}/>
    <StepEditor label="任务准备步骤" checkable items={draft.plan} onChange={plan=>update({...live.current,plan})}/>
    <p className="wb-halo-hint">本次引用 {refs.length} 项。勾选表示人工核对，不代表 Agent 已执行；保存不会交接任务。</p>
    <LiquidButton type="submit" className="wb-button wb-primary" disabled={busy||blocked||!draft.text.trim()||Boolean(client.getSnapshot().pending)}>{busy?'正在保存…':'保存任务准备'}</LiquidButton><FormFeedback client={client} owner="task-preparation" busy={busy} message={error||notice} error={Boolean(error)||noticeError} dirty={Boolean(confirmed.current)&&confirmed.current!==fingerprint(draft)}/>
  </form>;
}

export function SavedTaskPlan({client,instructions=[],plan=[]}:{client:WorkbenchClient;instructions?:ContentRef[];plan?:StepItem[]}) {
  return <><InstructionSnapshot client={client} refs={instructions}/>{plan.length>0&&<section aria-label="已保存的任务步骤"><h3>本次步骤（只读快照）</h3><ol>{plan.map(item=><li key={item.id}><span>{item.checked?'已人工核对：':''}</span>{item.text}</li>)}</ol></section>}</>;
}

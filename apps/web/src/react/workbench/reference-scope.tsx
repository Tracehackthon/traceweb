import React,{useState} from 'react';
import {createPortal} from 'react-dom';
import {contentReferencesOverlap,resolveContentRef,stableWorkbenchJson} from '@trace/product-workspace';
import {WorkbenchClient,type ContentRef,type MessageScope,type Thinking} from './client';
import {ReferencePicker,newReferencePickerState,selectReference,referenceTitle,referenceLocator,projectReference,type ReferencePickerState} from './reference-picker';
import {WorkbenchModal} from './modal';
import {MaterialPreview,OriginalViewer} from './source-preview';
import {CapabilityPacketBody} from './capability-sharing';
import {HaloNotice} from './halo-surfaces';
import {HaloDisclosure} from './halo-disclosure';
import {HaloSearchInput} from './halo-controls';

export type ReferenceEditor={picker:ReferencePickerState;target:'include'|'exclude'};
export const newReferenceEditor=():ReferenceEditor=>({picker:newReferencePickerState(),target:'include'});
const same=(a:unknown,b:unknown)=>stableWorkbenchJson(a)===stableWorkbenchJson(b);
const unique=(refs:ContentRef[])=>refs.filter((r,i,a)=>a.findIndex(x=>same(x,r))===i);

// Read only: never shares the pending-write recovery owner of its parent.
export function ReferenceViewer({client,reference,onClose}:{client:WorkbenchClient;reference:ContentRef;onClose:()=>void}){
 const host=client.getSnapshot().host!,item=host[{material:'materials',expression:'expressions',capability:'capabilities'}[reference.kind]]?.[reference.id],body=item?.versions[reference.version];
 const [original,setOriginal]=useState(false);
 return createPortal(<WorkbenchModal title="准确引用（只读）" className="wb-review-dialog" onClose={onClose}><div className="wb-reference-detail"><h3>{referenceTitle(host,reference)} · v{reference.version}</h3><p>{referenceLocator(host,reference)}</p><p className="wb-halo-hint">历史/停用状态不因查看而恢复；读取不会提交、执行或核对其它未确认写入。</p>{body&&item?reference.kind==='capability'?<CapabilityPacketBody value={body} label="准确引用能力正文"/>:<><MaterialPreview client={client} entry={item} value={projectReference(body,reference)}/><p className="wb-preserve" aria-label="准确引用的保存文字">{reference.anchor?.type==='text'?body.text?.slice(Number(reference.anchor.start),Number(reference.anchor.end)):body.text}</p>{(body.resourceId||body.origin?.kind==='thinking-message')&&<button type="button" className="wb-button" onClick={()=>setOriginal(true)}>查看这份引用的原件</button>}</>:<HaloNotice tone="warning" title="这个准确版本暂不可用" description="没有改选当前版或相似对象；已保存的引用仍保留。"/>}<button type="button" className="wb-button" onClick={onClose}>返回当前工作</button></div>{original&&item&&body&&<OriginalViewer entry={item} value={body} anchor={reference.anchor} client={client} onClose={()=>setOriginal(false)}/>}</WorkbenchModal>,document.body);
}

export function ReferenceScopeSnapshot({client,scope,messages=[]}:{client:WorkbenchClient;scope?:MessageScope;messages?:Thinking['messages']}){
 const [view,setView]=useState<ContentRef|null>(null),host=client.getSnapshot().host!;
 return <><HaloDisclosure title={scope?`当次保存范围：${scope.refs.length} 项引用，${scope.historyIds.length} 段历史`:'旧消息：未独立记录当次范围'}>{scope?<div className="wb-reference-detail"><p className="wb-halo-hint">这是当次不可变范围，不随下一段草稿或当前能力版本改变。保存范围不证明AI已经执行。</p>{scope.refs.map((r,i)=><button type="button" key={'in'+i} className="wb-reference" onClick={()=>setView(r)}>{referenceTitle(host,r)} · v{r.version}<small>{referenceLocator(host,r)}</small></button>)}{!scope.refs.length&&<p>没有额外材料引用。</p>}{scope.excluded.map((r,i)=><button type="button" key={'out'+i} className="wb-reference" onClick={()=>setView(r)}>当次排除：{referenceTitle(host,r)} · v{r.version}<small>{referenceLocator(host,r)}</small></button>)}{scope.historyIds.map(id=><p key={id} className="wb-preserve">明确带入的原话：{messages.find(m=>m.id===id)?.text||'原消息暂不可用；没有替换。'}</p>)}</div>:<p>旧原话和原运行保留，不能据当前讨论默认值伪造过去的准确范围；可将原话带入新草稿重新核对。</p>}</HaloDisclosure>{view&&<ReferenceViewer client={client} reference={view} onClose={()=>setView(null)}/>}</>;
}

export function ReferenceScopeEditor({client,scope,editor,onChange,purpose,disabled=false,messages}:{client:WorkbenchClient;scope:MessageScope;editor:ReferenceEditor;onChange:(scope:MessageScope,editor:ReferenceEditor)=>void;purpose:'thinking'|'task';disabled?:boolean;messages?:Thinking['messages']}){
 const [open,setOpen]=useState(false),[view,setView]=useState<ContentRef|null>(null),[error,setError]=useState(''),[query,setQuery]=useState(''),host=client.getSnapshot().host!;
 const update=(next:MessageScope,nextEditor=editor)=>{
  if(disabled)return;
  if(next.refs.length>256||next.excluded.length>256||next.historyIds.length>256){setError('本次最多保留256项引用、排除或历史原话；请先整理范围。');return;}
  if(next.refs.some(r=>next.excluded.some(e=>contentReferencesOverlap(r,e)))){setError('包含与排除的范围相交；请明确缩小或移除其中一项，不会自动裁切。');return;}
  onChange(next,nextEditor);setError('');
 };
 const start=(target:'include'|'exclude',replacing:ContentRef|null=null)=>{
  let picker={...editor.picker,replacing};
  if(replacing){const record=host[{material:'materials',expression:'expressions',capability:'capabilities'}[replacing.kind]]?.[replacing.id];picker=selectReference(editor.picker,replacing,record?.versions[replacing.version],replacing);}
  onChange(scope,{picker,target});setOpen(true);setError('');
 };
 const attach=(ref:ContentRef)=>{
  const old=editor.picker.replacing,list=editor.target==='include'?scope.refs:scope.excluded;
  if(old&&!list.some(r=>same(r,old)))throw Error('原引用已改变，未覆盖草稿；请重新选择。');
  const next={...scope,[editor.target==='include'?'refs':'excluded']:unique(old?list.map(r=>same(r,old)?ref:r):[...list,ref])};
  if(next.refs.length>256||next.excluded.length>256)throw Error('一段范围最多保留256项包含或排除；请先整理。');
  if(next.refs.some(r=>next.excluded.some(e=>contentReferencesOverlap(r,e))))throw Error('这个范围与另一侧相交；先明确缩小或移除冲突项，不自动修改其它引用。');
  onChange(next,{...editor,picker:{...editor.picker,replacing:null}});setError('');
 };
 const rows=(list:ContentRef[],target:'include'|'exclude')=>list.map((r,i)=><article key={target+stableWorkbenchJson(r)}><strong>{referenceTitle(host,r)} · v{r.version}</strong><p className="wb-halo-hint">{referenceLocator(host,r)}</p><div className="wb-actions"><button type="button" className="wb-button" onClick={()=>setView(r)}>查看引用原稿</button><button type="button" disabled={disabled} className="wb-button" onClick={()=>start(target,r)}>调整这份范围</button><button type="button" disabled={disabled} className="wb-button" onClick={()=>update({...scope,[target==='include'?'refs':'excluded']:list.filter((_,at)=>at!==i)})}>从本次草稿移除</button><button type="button" disabled={disabled} className="wb-button" onClick={()=>{try{if(target==='exclude')resolveContentRef(host,r,{forUse:true});update({...scope,refs:target==='include'?scope.refs.filter(x=>!same(x,r)):unique([...scope.refs,r]),excluded:target==='include'?unique([...scope.excluded,r]):scope.excluded.filter(x=>!same(x,r))});}catch(e){setError(e.message);}}}>{target==='include'?'本次排除这份引用':'明确重新包含'}</button></div></article>);
 return <section className="wb-feedback-attachments" aria-label="本次协作引用范围"><header><h3>本次引用 {scope.refs.length} 项</h3><div className="wb-actions"><button type="button" className="wb-button" disabled={disabled} onClick={()=>start('include')}>选择本次准确引用</button><button type="button" className="wb-button" disabled={disabled} onClick={()=>start('exclude')}>明确排除内容</button></div></header><p className="wb-halo-hint">只改当前草稿，保存后才冻结。不会自动取整个画布、所有历史或AI返回；排除引用不等于删掉已经手动写入正文的文字，请核对正文。</p>{rows(scope.refs,'include')}{!scope.refs.length&&<p>未带额外材料，可以独立留下问题或想法。</p>}<HaloDisclosure title={`明确排除 ${scope.excluded.length} 项`}>{rows(scope.excluded,'exclude')}{!scope.excluded.length&&<p>尚无排除项；未选择的材料不会自动带入。</p>}</HaloDisclosure>
 {purpose==='thinking'&&messages&&<HaloDisclosure title={`本次带入的历史原话（${scope.historyIds.length}）`}><p>仅带明确勾选的用户原话，不展开这些消息的其它引用，也不自动带AI回复。保存的AI原稿可在上面的引用选择中另选。</p><HaloSearchInput label="查找可带入的历史原话" value={query} onValueChange={setQuery}/>{messages.filter(m=>m.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0,100).map((m,i)=><label className="wb-check" key={m.id}><input type="checkbox" disabled={disabled} checked={scope.historyIds.includes(m.id)} onChange={e=>update({...scope,historyIds:e.target.checked?[...scope.historyIds,m.id]:scope.historyIds.filter(id=>id!==m.id)})}/>第 {messages.indexOf(m)+1} 段：{Array.from(m.text).slice(0,140).join('')}</label>)}{!messages.some(m=>m.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()))&&<p>没有匹配的已保存原话。</p>}{messages.length>100&&<p className="wb-halo-hint">显示前100项，可用查询找到其它保存原话。</p>}</HaloDisclosure>}
 {error&&<HaloNotice tone="warning" title="本次范围没有改变" description={error}/>}{open&&<ReferencePicker client={client} purpose={purpose} intent={editor.target} value={editor.picker} onChange={picker=>onChange(scope,{...editor,picker})} attached={editor.target==='include'?scope.refs:scope.excluded} onAttach={attach} onClose={()=>setOpen(false)}/>} {view&&<ReferenceViewer client={client} reference={view} onClose={()=>setView(null)}/>}</section>;
}

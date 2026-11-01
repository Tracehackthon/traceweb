import {useLayoutEffect,useRef,useState} from 'react';
import {validContentRef} from '@trace/product-workspace';
import type {ContentHost,ContentRef} from './client';
import {newReferencePickerState,validReferencePickerState,type ReferencePickerState} from './reference-picker';

export type WritebackDraft={schemaVersion:1;text:string;title:string;target:string;baseVersion:number|null;mode:'append'|'replace';from:ContentRef|null;to:ContentRef|null;relationKind:string;evidence:string;difference:string;uncertainty:string;selection:{start:number;end:number}|null;picker:ReferencePickerState};
export const writebackExpressionLabels={note:'线索',question:'未决问题',understanding:'理解',attempt:'尝试'};
export const writebackRelationLabels={supplement:'补充',support:'支持',limit:'限定',challenge:'挑战',alternative:'另一种解释',branch:'旁支',unknown:'暂不定义'};
const targets=['new-expression:note','new-expression:question','new-expression:understanding','new-expression:attempt','branch:note','branch:question','branch:understanding','branch:attempt','relation','new-capability'];
export const validWritebackTarget=(x:unknown):x is string=>typeof x==='string'&&(targets.includes(x)||/^(material|capability|expression):[^\x00-\x1f]{1,512}$/.test(x));
// Only the first colon separates the destination kind. Imported stable content
// identities may themselves contain colons, including a matching prefix object.
export function parseWritebackTarget(target:string){const separator=target.indexOf(':');return separator<0?{kind:target,id:undefined}:{kind:target.slice(0,separator),id:target.slice(separator+1)};}
export function writebackEntry(host:ContentHost,target:string){const {kind,id}=parseWritebackTarget(target);return kind==='material'?host.expressions['adopted-'+id]:kind==='capability'?host.capabilities[id]:kind==='expression'?host.expressions[id]:undefined;}
export function writebackVersion(host:ContentHost,target:string):number|null {const {kind}=parseWritebackTarget(target);return ['material','capability','expression'].includes(kind)?writebackEntry(host,target)?.version||(kind==='material'?0:null):0;}
function valid(value:any):value is WritebackDraft {
 return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>['schemaVersion','text','title','target','baseVersion','mode','from','to','relationKind','evidence','difference','uncertainty','selection','picker'].includes(k))&&value.schemaVersion===1&&['text','title','evidence','difference','uncertainty'].every(k=>typeof value[k]==='string'&&value[k].length<=1000000)&&validWritebackTarget(value.target)&&(value.baseVersion===null||Number.isSafeInteger(value.baseVersion)&&value.baseVersion>=0)&&['append','replace'].includes(value.mode)&&[value.from,value.to].every(r=>r===null||validContentRef(r))&&['supplement','support','limit','challenge','alternative','branch','unknown'].includes(value.relationKind)&&(value.selection===null||value.selection&&Object.keys(value.selection).every(k=>['start','end'].includes(k))&&Number.isSafeInteger(value.selection.start)&&Number.isSafeInteger(value.selection.end)&&value.selection.start>=0&&value.selection.end>value.selection.start)&&validReferencePickerState(value.picker);
}
export function useWritebackDraft(runId:string,item:{id:string;text:string},host:ContentHost){
 const key='trace-adoption:'+runId+':'+item.id;
 const empty=():WritebackDraft=>({schemaVersion:1,text:item.text,title:item.text.slice(0,40),target:'new-expression:note',baseVersion:0,mode:'replace',from:null,to:null,relationKind:'unknown',evidence:'',difference:'',uncertainty:'',selection:null,picker:newReferencePickerState()});
 const [initial]=useState(()=>{let raw:string|null=null;try{raw=localStorage.getItem(key);if(raw===null)return{value:empty(),raw,error:''};const value=JSON.parse(raw);if(valid(value))return{value,raw,error:''};
  // Preserve the prior three-field draft, but do not invent its preview base.
  if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>['text','title','target'].includes(k))&&['text','title','target'].every(k=>typeof value[k]==='string')&&validWritebackTarget(value.target))return{value:{...empty(),...value,baseVersion:['material','capability','expression'].includes(parseWritebackTarget(value.target).kind)?null:0},raw,error:''};
  throw Error('写回草稿格式无法识别；原始记录未覆盖。');
 }catch(e){return{value:empty(),raw,error:e.message||'写回草稿无法读取；没有覆盖原记录。'};}});
 const [value,setValue]=useState<WritebackDraft>(initial.value),[error,setError]=useState(initial.error),[blocked,setBlocked]=useState(Boolean(initial.error));
 const current=useRef(value);current.current=value;
 const owner=useRef(false);useLayoutEffect(()=>{owner.current=true;return()=>{owner.current=false;};},[key]);
 const isCurrent=()=>owner.current;
 const write=(next:WritebackDraft)=>{if(!isCurrent())return;current.current=next;setValue(next);try{localStorage.setItem(key,JSON.stringify(next));setError('');}catch{setError('写回草稿暂未落盘；请先复制正文或导出，再关闭。');}};
 return {value,error,blocked,raw:initial.raw,isCurrent,latest:()=>current.current,update:(next:WritebackDraft)=>{if(!blocked)write(next);},restart:()=>{if(window.confirm('明确重新开始此项写回草稿？请先导出原记录；已保存原稿、内容和采纳回执不会删除。')){setBlocked(false);write(empty());}}};
}

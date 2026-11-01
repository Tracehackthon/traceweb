import React,{useState} from 'react';
import type {ContentEntry,ContentRef,ContentValue} from './client';
import {HaloSelect} from './halo-controls';
import {HaloBadge,HaloSurface,HaloNotice,CapabilityStatus} from './halo-surfaces';
import {HaloDisclosure} from './halo-disclosure';
import {WorkbenchModal} from './modal';
import {CapabilityPacketBody} from './capability-sharing';
import {TraceIcon} from '../ui/icon';
import './workspace-search.css';

const fields:{key:keyof ContentValue;label:string}[]=[{key:'purpose',label:'解决什么需要'},{key:'scope',label:'适用范围与限制'},{key:'steps',label:'使用方法'},{key:'prompt',label:'提示或指令正文'},{key:'evidence',label:'依据'},{key:'examples',label:'示例'}];
function Snapshot({value,label}:{value:ContentValue;label:string}){
  return <section aria-label={label} className="wb-capability-snapshot"><h2>{value.title||'未命名能力'}</h2>{fields.map(field=><section key={field.key}><h3>{field.label}</h3><p>{String(value[field.key]||'此版本未填写')}</p></section>)}<p className="wb-halo-hint">此版本引用 {value.refs?.length||0} 项已保存内容；这里不会自动展开或发送来源正文。</p></section>;
}

// Choosing a baseline changes only the explicit local draft. A later Product
// save still checks the version/revision, including changes not yet read here.
export function CapabilityDraftReview({entry,draft,baseVersion,blocked,onResolve,onClose}:{entry:ContentEntry;draft:ContentValue;baseVersion:number;blocked:boolean;onResolve:(choice:'draft'|'current',version:number)=>void;onClose:()=>void}){
  const [reviewedVersion,setReviewedVersion]=useState(entry.version),[confirmed,setConfirmed]=useState(false),changed=reviewedVersion!==entry.version;
  const snapshot=(value:ContentValue,label:string)=><section><CapabilityPacketBody value={value} label={label} caption={label}/><HaloDisclosure title={`准确引用与定位（${value.refs?.length||0}）`}>{value.refs?.length?value.refs.map((ref,index)=><p className="wb-preserve" key={index}>{JSON.stringify(ref)}</p>):<p>这份正文没有附加引用。</p>}</HaloDisclosure></section>;
  const exportDraft=()=>{const blob=new Blob([JSON.stringify({schemaVersion:1,capabilityId:entry.id,baseVersion,value:draft},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Trace-capability-local-draft.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <WorkbenchModal title="能力草稿冲突核对" context={(entry.title||'未命名能力')+' · 草稿基于 v'+baseVersion+' ｜已读取当前 v'+entry.version} className="wb-review-dialog" onClose={onClose}><div className="wb-capability-packet">
    <p>保留草稿会以已读取的当前版本为基准继续编辑，不自动合并。使用当前版本会替换本地未保存内容；可以先导出草稿。两种选择都不会保存、发布或修改能力库，之后仍需明确保存。</p>
    <div className="wb-version-compare">{snapshot(draft,`本地草稿 · 基于 v${baseVersion}`)}{snapshot(entry.versions[entry.version],`已读取当前 · v${entry.version}`)}</div>
    {changed&&<HaloNotice tone="warning" title="已读取的当前版本又改变了" description="原比较确认已失效；未替换草稿或写入能力库。" actions={<button className="wb-button" onClick={()=>{setReviewedVersion(entry.version);setConfirmed(false);}}>核对新的当前版本</button>}/>}
    {blocked&&<p role="status">先回原编辑器核对尚未确认的写入；当前草稿和比较仍保留。</p>}
    <label className="wb-check"><input type="checkbox" checked={!changed&&confirmed} disabled={changed||blocked} onChange={e=>setConfirmed(e.target.checked)}/>已比较差异，明确选择以下处理方式</label>
    <div className="wb-actions"><button className="wb-button" onClick={exportDraft}>导出这份本地草稿</button><button className="wb-button wb-primary" disabled={changed||blocked||!confirmed} onClick={()=>onResolve('draft',reviewedVersion)}>保留这份草稿，继续编辑</button><button className="wb-button" disabled={changed||blocked||!confirmed} onClick={()=>onResolve('current',reviewedVersion)}>使用当前版本替换本地草稿</button><button className="wb-button" onClick={onClose}>取消，保留原草稿</button></div>
  </div></WorkbenchModal>;
}

// Historical text remains immutable. Switching back remounts the existing
// versioned editor, which restores its own saved draft rather than the snapshot.
export function CapabilityHistory({entry,version,onVersion,onUseVersion,onShareVersion,onOpenSource,sourceTitle,children}:{entry:ContentEntry;version:number|null;onVersion:(version:number|null)=>void;onUseVersion:(ref:ContentRef)=>void;onShareVersion?:(ref:ContentRef)=>void;onOpenSource?:(ref:ContentRef)=>void;sourceTitle?:(ref:ContentRef)=>string;children:React.ReactNode}){
  const selected=version??entry.version,value=entry.versions[selected],[compare,setCompare]=useState(false),historical=selected!==entry.version;
  return <div className="wb-capability-history wb-search-destination" tabIndex={-1} data-search-destination={`capability:${entry.id}:${selected}`}>
    <div className="wb-search-version-bar"><label>查看保存版本<HaloSelect aria-label="查看能力版本" value={String(selected)} onValueChange={value=>{onVersion(Number(value));setCompare(false);}}>{Object.keys(entry.versions).map(Number).sort((a,b)=>b-a).map(v=><option key={v} value={String(v)}>v{v}{v===entry.version?' 当前正文':''}{entry.publishedVersions?.includes(v)?' · 曾发布':''}</option>)}</HaloSelect></label>{onShareVersion&&<button className="wb-button" onClick={()=>onShareVersion({kind:'capability',id:entry.id,version:selected})}>分享此版本</button>}{historical&&<button className="wb-button" onClick={()=>{onVersion(null);setCompare(false);}}><TraceIcon name="forward"/>返回当前版本</button>}</div>
    {value?.refs?.length&&onOpenSource?<section className="wb-reference-summary" aria-label="能力依据来源"><h3>本版本的来源（{value.refs.length}）</h3>{value.refs.map((ref,index)=><button key={index} className="wb-reference" onClick={()=>onOpenSource(ref)}>{sourceTitle?.(ref)||'查看来源 '+(index+1)} · v{ref.version}</button>)}</section>:null}
    {!value?<HaloSurface><h2>此准确版本不可用</h2><p>没有以当前版替代历史结果；可以明确返回当前版本。</p></HaloSurface>:historical?<HaloSurface><div className="wb-page-heading"><div><HaloBadge icon="history">v{selected} 历史只读</HaloBadge><p>对象当前状态：<CapabilityStatus status={entry.status}/></p></div></div><p className="wb-halo-hint">回看不会覆盖当前 v{entry.version}，也不会恢复或发布此版本。正文差异只用于比较，不代表历史状态被重写。</p><label className="wb-check"><input type="checkbox" checked={compare} onChange={event=>setCompare(event.target.checked)}/>与当前 v{entry.version} 对照</label><div className={compare?'wb-version-compare':''}><Snapshot value={value} label={`能力 v${selected} 历史正文`}/>{compare&&<Snapshot value={entry.versions[entry.version]} label={`能力 v${entry.version} 当前正文`}/>}</div><div className="wb-actions"><button className="wb-button" disabled={entry.status==='disabled'||entry.status==='received'} onClick={()=>onUseVersion({kind:'capability',id:entry.id,version:selected})}><TraceIcon name="discussion"/>以此版本开始讨论</button></div>{entry.status==='disabled'&&<p className="wb-halo-hint">此能力已停用，只能回看。恢复需回到当前版本明确操作。</p>}</HaloSurface>:children}
  </div>;
}

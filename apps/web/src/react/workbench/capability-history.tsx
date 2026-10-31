import React,{useState} from 'react';
import type {ContentEntry,ContentRef,ContentValue} from './client';
import {HaloSelect} from './halo-controls';
import {HaloBadge,HaloSurface,CapabilityStatus} from './halo-surfaces';
import {TraceIcon} from '../ui/icon';
import './workspace-search.css';

const fields:{key:keyof ContentValue;label:string}[]=[{key:'purpose',label:'解决什么需要'},{key:'scope',label:'适用范围与限制'},{key:'steps',label:'使用方法'},{key:'prompt',label:'提示或指令正文'},{key:'evidence',label:'依据'},{key:'examples',label:'示例'}];
function Snapshot({value,label}:{value:ContentValue;label:string}){
  return <section aria-label={label} className="wb-capability-snapshot"><h2>{value.title||'未命名能力'}</h2>{fields.map(field=><section key={field.key}><h3>{field.label}</h3><p>{String(value[field.key]||'此版本未填写')}</p></section>)}<p className="wb-halo-hint">此版本引用 {value.refs?.length||0} 项已保存内容；这里不会自动展开或发送来源正文。</p></section>;
}

// Historical text remains immutable. Switching back remounts the existing
// versioned editor, which restores its own saved draft rather than the snapshot.
export function CapabilityHistory({entry,version,onVersion,onUseVersion,children}:{entry:ContentEntry;version:number|null;onVersion:(version:number|null)=>void;onUseVersion:(ref:ContentRef)=>void;children:React.ReactNode}){
  const selected=version??entry.version,value=entry.versions[selected],[compare,setCompare]=useState(false),historical=selected!==entry.version;
  return <div className="wb-capability-history wb-search-destination" tabIndex={-1} data-search-destination={`capability:${entry.id}:${selected}`}>
    <div className="wb-search-version-bar"><label>查看保存版本<HaloSelect aria-label="查看能力版本" value={String(selected)} onValueChange={value=>{onVersion(Number(value));setCompare(false);}}>{Object.keys(entry.versions).map(Number).sort((a,b)=>b-a).map(v=><option key={v} value={String(v)}>v{v}{v===entry.version?' 当前正文':''}{entry.publishedVersions?.includes(v)?' · 曾发布':''}</option>)}</HaloSelect></label>{historical&&<button className="wb-button" onClick={()=>{onVersion(null);setCompare(false);}}><TraceIcon name="forward"/>返回当前版本</button>}</div>
    {!value?<HaloSurface><h2>此准确版本不可用</h2><p>没有以当前版替代历史结果；可以明确返回当前版本。</p></HaloSurface>:historical?<HaloSurface><div className="wb-page-heading"><div><HaloBadge icon="history">v{selected} 历史只读</HaloBadge><p>对象当前状态：<CapabilityStatus status={entry.status}/></p></div></div><p className="wb-halo-hint">回看不会覆盖当前 v{entry.version}，也不会恢复或发布此版本。正文差异只用于比较，不代表历史状态被重写。</p><label className="wb-check"><input type="checkbox" checked={compare} onChange={event=>setCompare(event.target.checked)}/>与当前 v{entry.version} 对照</label><div className={compare?'wb-version-compare':''}><Snapshot value={value} label={`能力 v${selected} 历史正文`}/>{compare&&<Snapshot value={entry.versions[entry.version]} label={`能力 v${entry.version} 当前正文`}/>}</div><div className="wb-actions"><button className="wb-button" disabled={entry.status==='disabled'} onClick={()=>onUseVersion({kind:'capability',id:entry.id,version:selected})}><TraceIcon name="discussion"/>以此版本开始讨论</button></div>{entry.status==='disabled'&&<p className="wb-halo-hint">此能力已停用，只能回看。恢复需回到当前版本明确操作。</p>}</HaloSurface>:children}
  </div>;
}

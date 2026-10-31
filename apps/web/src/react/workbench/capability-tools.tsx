import {HaloDisclosure,HaloCollapse} from './halo-disclosure';
import {stableWorkbenchJson} from '@trace/product-workspace';
import {createPortal} from 'react-dom';
import React,{useRef,useState,useSyncExternalStore} from 'react';
import {WorkbenchClient,makeId,type ContentEntry,type ContentRef,type ContentValue,type StepItem} from './client';
import {WorkbenchModal} from './modal';
import {HaloField,HaloInput,HaloTextarea,HaloSearchInput,HaloSelect} from './halo-controls';
import {LiquidButton} from './expressive-controls';
import './capability-tools.css';

export const appendDraft=(current:string,incoming:string)=>!incoming?current:!current?incoming:current+'\n\n'+incoming;
export const templateText=(value:ContentValue)=>value.prompt || [value.title,value.purpose,value.scope,value.steps,value.evidence,value.examples].filter(Boolean).join('\n\n');
export const capabilityRef=(entry:ContentEntry):ContentRef=>({kind:'capability',id:entry.id,version:entry.version});
export function InstructionSnapshot({refs,client}:{refs:ContentRef[];client:WorkbenchClient}) {
  const host=client.getSnapshot().host;
  return refs.length>0&&<HaloDisclosure className="wb-instruction-snapshot" title={<>本条记录的指令快照（{refs.length}）</>}>{refs.map(ref=>{const value=host?.capabilities[ref.id]?.versions[ref.version];return <section key={ref.id}><strong>{value?.title||ref.id} · v{ref.version}</strong><p>{value?.prompt||'此准确版本不可用，未用当前版本替换。'}</p></section>;})}<small>仅随本条记录保留；不代表已发送给外部 Agent。</small></HaloDisclosure>;
}

export function TemplateLibrary({client,onInsert,label='模板库',actionLabel='插入草稿末尾'}:{client:WorkbenchClient;onInsert:(entry:ContentEntry,value:ContentValue)=>void;label?:string;actionLabel?:string}) {
  const [open,setOpen]=useState(false);
  return <><button type="button" className="wb-button" onClick={()=>setOpen(true)}>{label}</button>{open&&createPortal(<LibraryDialog client={client} mode="template" actionLabel={actionLabel} onClose={()=>setOpen(false)} onInsert={(entry,value)=>{onInsert(entry,value);setOpen(false);}}/>,document.body)}</>;
}

export function InstructionPicker({client,selected,onApply,scope}:{client:WorkbenchClient;selected:ContentRef[];onApply:(refs:ContentRef[])=>Promise<unknown>;scope:string}) {
  const [open,setOpen]=useState(false);
  return <div className="wb-instruction-picker"><button type="button" className="wb-button" onClick={()=>setOpen(true)}>AI 指令（{selected.length}）</button><span className="wb-halo-hint">{scope}</span><div className="wb-instruction-tags">{selected.map(ref=><span key={ref.id}>{client.getSnapshot().host?.capabilities[ref.id]?.versions[ref.version]?.title||ref.id} · v{ref.version}</span>)}</div>{open&&createPortal(<LibraryDialog client={client} mode="instruction" selected={selected} onClose={()=>setOpen(false)} onApply={async refs=>{await onApply(refs);setOpen(false);}}/>,document.body)}</div>;
}

function LibraryDialog({client,mode,selected=[],onClose,onInsert,onApply,actionLabel='插入草稿末尾'}:{client:WorkbenchClient;actionLabel?:string;mode:'template'|'instruction';selected?:ContentRef[];onClose:()=>void;onInsert?:(entry:ContentEntry,value:ContentValue)=>void;onApply?:(refs:ContentRef[])=>Promise<unknown>}) {
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot),host=state.host!;
  const [query,setQuery]=useState(''),[group,setGroup]=useState('all'),[preview,setPreview]=useState<string|null>(null),[picks,setPicks]=useState(selected),[creating,setCreating]=useState(false),[title,setTitle]=useState(''),[prompt,setPrompt]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const createId=useRef(makeId(mode));
  const entries=Object.values(host.capabilities).filter(entry=>{const value=entry.versions[entry.version];return mode==='instruction'?(value.usage==='instruction'||selected.some(ref=>ref.id===entry.id)):value.usage!=='instruction';});
  const visible=entries.filter(entry=>{const value=entry.versions[entry.version];return(group==='all'||(value.usage||'method')===group)&&(value.title+' '+value.purpose+' '+(value.prompt||'')).toLocaleLowerCase().includes(query.toLocaleLowerCase());});
  const chosen=host.capabilities[preview||''],value=chosen?.versions[chosen.version];
  const create=async()=>{if(!title.trim()||!prompt.trim()){setError('名称和正文都需要填写；草稿仍保留。');return;}setBusy(true);setError('');try{const value:ContentValue={title:title.trim(),purpose:'',scope:'',steps:'',evidence:'',examples:'',refs:[],usage:mode,prompt},known=client.getSnapshot().host?.capabilities[createId.current];if(!known)await client.command([{type:'capability.create',id:createId.current,value}]);else if(stableWorkbenchJson(known.versions[known.version])!==stableWorkbenchJson(value))await client.command([{type:'capability.edit',id:known.id,expectedVersion:known.version,value,reason:'核对原创建命令后保存继续编辑的内容'}]);setCreating(false);setPreview(createId.current);createId.current=makeId(mode);setTitle('');setPrompt('');}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <WorkbenchModal title={mode==='template'?'模板库':'本次 AI 指令'} onClose={()=>{if(!busy)onClose();}}><div className="wb-library-dialog">
    {creating?<form className="wb-editor" onSubmit={e=>{e.preventDefault();e.stopPropagation();void create();}}><HaloField label={mode==='template'?'模板名称':'指令名称'}><HaloInput autoFocus value={title} onChange={e=>setTitle(e.target.value)}/></HaloField><HaloField label={mode==='template'?'模板正文':'指令正文'} hint="保存在当前能力库，不修改系统指令或全局设置。"><HaloTextarea rows={6} value={prompt} onChange={e=>setPrompt(e.target.value)}/></HaloField><div className="wb-actions"><button type="button" className="wb-button" disabled={busy} onClick={()=>setCreating(false)}>返回列表，保留填写</button><LiquidButton type="submit" className="wb-button" disabled={busy||Boolean(state.pending)}>{busy?'正在保存…':mode==='template'?'保存模板':'保存指令'}</LiquidButton></div></form>:<>
      <HaloSearchInput autoFocus label={mode==='template'?'搜索模板':'搜索指令'} value={query} onValueChange={setQuery} placeholder="按名称、用途或正文搜索"/>
      {mode==='template'&&<label>模板分组<HaloSelect aria-label="模板分组" value={group} onValueChange={value=>setGroup(value)}><option value="all">全部</option><option value="template">提示模板</option><option value="method">已有方法</option></HaloSelect></label>}
      <p className="wb-halo-hint">{mode==='template'?'选择后先预览；插入只追加到草稿，不会自动发送或覆盖原稿。':'只影响当前讨论的后续记录，或当前任务准备；历史记录和其他讨论不变。最多选择32条。停用指令不可新选，已选项仍可移除。'}</p>
      <div className="wb-library-picker-grid"><section className="wb-template-list" aria-label={mode==='template'?'可用模板':'可用指令'}>{visible.map(entry=>{const v=entry.versions[entry.version],picked=picks.find(ref=>ref.id===entry.id),disabled=entry.status==='disabled'||(mode==='instruction'&&v.usage!=='instruction')||!(mode==='instruction'?(v.prompt||''):templateText(v)).trim();return <div className="wb-template-row" key={entry.id}>
        {mode==='instruction'&&<label className="wb-library-check"><input type="checkbox" aria-label={'选用指令 '+v.title} checked={Boolean(picked)} disabled={!picked&&(disabled||picks.length>=32)} onChange={e=>setPicks(e.target.checked?[...picks,capabilityRef(entry)]:picks.filter(ref=>ref.id!==entry.id))}/></label>}
        <button type="button" aria-pressed={preview===entry.id} onClick={()=>setPreview(entry.id)}><strong>{v.title}</strong><small>{v.usage==='instruction'?'指令':v.usage==='template'?'模板':'方法'} · v{entry.version}{disabled?' · 不可新选':''}</small>{picked&&picked.version!==entry.version&&<small>当前选用 v{picked.version}；重新勾选才更新版本</small>}</button>
      </div>;})}{!visible.length&&<p>没有匹配内容。可在这里创建，也可在能力库编辑。</p>}</section><section className="wb-template-preview" aria-label="所选内容预览">{value?<><h3>{value.title}</h3><p className="wb-preserve">{templateText(value)}</p>{mode==='template'&&<LiquidButton type="button" className="wb-button" disabled={chosen.status==='disabled'||!templateText(value).trim()} onClick={()=>onInsert?.(chosen,value)}>{actionLabel}</LiquidButton>}</>:<p>选择一项查看完整正文</p>}</section></div>
      <div className="wb-actions"><button type="button" className="wb-button" onClick={()=>setCreating(true)}>{mode==='template'?'新建模板':'新建指令'}</button>{mode==='instruction'&&<LiquidButton type="button" className="wb-button" disabled={busy||Boolean(state.pending)} onClick={()=>{setBusy(true);setError('');void onApply?.(picks).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>{busy?'正在保存…':'保存本次指令选择'}</LiquidButton>}</div>
    </>}{error&&<p role="alert" className="wb-halo-error">{error}</p>}
  </div></WorkbenchModal>;
}

export function StepEditor({items,onChange,label='步骤',checkable=false}:{items:StepItem[];onChange:(items:StepItem[])=>void;label?:string;checkable?:boolean}) {
  const [expanded,setExpanded]=useState<string|null>(null),[dragging,setDragging]=useState<string|null>(null),[announcement,setAnnouncement]=useState(''),drag=useRef<string|null>(null);
  const move=(id:string,to:number)=>{const from=items.findIndex(item=>item.id===id);if(from<0||from===to||to<0||to>=items.length)return;const next=[...items],item=next.splice(from,1)[0];next.splice(to,0,item);onChange(next);setAnnouncement(`步骤已移动到第 ${to+1} 位，尚未保存。`);};
  return <section className="wb-step-editor" aria-label={label}><header><h3>{label}（{items.length}）</h3><button type="button" className="wb-button" disabled={items.length>=256} onClick={()=>{const id=makeId('step');onChange([...items,{id,text:'',checked:false}]);setExpanded(id);}}>添加步骤</button></header><span role="status" className="wb-visually-hidden">{announcement}</span><ol>{items.map((item,index)=><li key={item.id} data-step-id={item.id} data-dragging={dragging===item.id} onDragOver={e=>{if(drag.current){e.preventDefault();e.dataTransfer.dropEffect='move';}}} onDrop={e=>{if(!drag.current)return;e.preventDefault();move(drag.current,index);drag.current=null;setDragging(null);}}>
    <div className="wb-step-heading"><button type="button" draggable aria-label={`拖动步骤 ${index+1}`} onDragStart={e=>{drag.current=item.id;setDragging(item.id);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-trace-step',item.id);}} onDragEnd={()=>{drag.current=null;setDragging(null);}} onKeyDown={e=>{if(e.key==='Escape'){drag.current=null;setDragging(null);}}}>⠿</button>{checkable&&<label className="wb-library-check"><input type="checkbox" aria-label={`核对步骤 ${index+1}`} checked={item.checked} onChange={e=>onChange(items.map(row=>row.id===item.id?{...row,checked:e.target.checked}:row))}/></label>}<button type="button" className="wb-step-expand" aria-expanded={expanded===item.id} onClick={()=>setExpanded(expanded===item.id?null:item.id)}><strong>{index+1}. {item.text.split('\n')[0]||'未填写步骤'}</strong></button><button type="button" className="wb-button" aria-label={`上移步骤 ${index+1}`} disabled={index===0} onClick={()=>move(item.id,index-1)}>↑</button><button type="button" className="wb-button" aria-label={`下移步骤 ${index+1}`} disabled={index===items.length-1} onClick={()=>move(item.id,index+1)}>↓</button><button type="button" className="wb-button" aria-label={`删除步骤 ${index+1}`} onClick={()=>onChange(items.filter(row=>row.id!==item.id))}>移除</button></div>
    <HaloCollapse instant focusOnOpen open={expanded===item.id}><HaloField label={`步骤 ${index+1} 正文`}><HaloTextarea rows={3} value={item.text} onChange={e=>onChange(items.map(row=>row.id===item.id?{...row,text:e.target.value}:row))}/></HaloField></HaloCollapse>
  </li>)}</ol>{!items.length&&<p className="wb-halo-hint">还没有步骤。添加后可拖动，或用上移/下移按钮排序。</p>}</section>;
}

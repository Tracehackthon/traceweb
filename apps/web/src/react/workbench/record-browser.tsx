import React,{useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {Thinking,Task} from './client';
import {HaloSearchInput,HaloSelect} from './halo-controls';
import {ItemList,revealNeighbour} from './list-navigation';
import {TraceIcon} from '../ui/icon';
import {TraceTooltip} from '../ui/controls';
import {HaloEmptyState} from './halo-surfaces';
import './history-browser.css';

export type RecordBrowseState={query:string;order:'newest'|'oldest';page:number;scroll:number};
export const defaultRecordBrowse:RecordBrowseState={query:'',order:'newest',page:0,scroll:0};
const valid=(v:RecordBrowseState)=>v&&typeof v.query==='string'&&v.query.length<=200&&['newest','oldest'].includes(v.order)&&Number.isSafeInteger(v.page)&&v.page>=0&&Number.isFinite(v.scroll)&&v.scroll>=0;
const SIZE=30;
const snippet=(s:string,query='')=>{const hits=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).map(term=>s.toLocaleLowerCase().indexOf(term)).filter(at=>at>=0);let from=hits.length?Math.max(0,Math.min(...hits)-32):0;if(/[\uDC00-\uDFFF]/.test(s[from]||''))from=Math.max(0,from-1);const text=s.slice(from,from+180).replace(/[\uD800-\uDBFF]$/,'').replace(/\s+/g,' ');return (from?'…':'')+text+(from+180<s.length?'…':'');};

// Derived only from saved records. View metadata never becomes a business write
// or a persisted copy of message bodies. All filtering happens before paging.
export function RecordBrowser({records,kind,activeId,onSelect,renderStatus,initial,remember}:{records:(Thinking|Task)[];kind:'thinking'|'task';activeId:string|null;onSelect:(id:string)=>void;renderStatus:(record:Thinking|Task)=>React.ReactNode;initial?:()=>RecordBrowseState;remember:(state:RecordBrowseState)=>void}){
  const [view,setView]=useState<RecordBrowseState>(()=>{const saved=initial?.();return valid(saved!)?saved!:defaultRecordBrowse;}),[locating,setLocating]=useState(false),root=useRef<HTMLDivElement>(null),live=useRef(view),interacted=useRef(false);
  live.current=view;
  const indexed=useMemo(()=>records.map(record=>{const parts='messages'in record?record.messages.map(m=>m.text):[record.goal,...(record.plan||[]).map(p=>p.text)];return{record,parts,preview:parts.at(-1)||'还没有保存内容',search:(record.title+'\n'+parts.join('\n')).toLocaleLowerCase()};}),[records]);
  const terms=view.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean),matches=indexed.filter(row=>terms.every(term=>row.search.includes(term)));
  if(view.order==='newest')matches.reverse();
  const pages=Math.max(1,Math.ceil(matches.length/SIZE)),page=Math.min(view.page,pages-1),visible=matches.slice(page*SIZE,(page+1)*SIZE);
  const list=()=>root.current?.querySelector<HTMLElement>('.wb-record-list');
  const update=(next:RecordBrowseState)=>{interacted.current=true;live.current=next;setView(next);remember(next);if(list())list()!.scrollTop=0;};
  useLayoutEffect(()=>{const frame=requestAnimationFrame(()=>{if(!interacted.current&&list())list()!.scrollTop=view.scroll;});return()=>{cancelAnimationFrame(frame);remember({...live.current,scroll:list()?.scrollTop||0});};},[]);
  useLayoutEffect(()=>{if(!locating)return;const frame=requestAnimationFrame(()=>{const container=list(),row=root.current?.querySelector<HTMLElement>('[data-record-id="'+CSS.escape(activeId||'')+'"]');if(container&&row){row.focus({preventScroll:true});revealNeighbour(container,row);}setLocating(false);});return()=>cancelAnimationFrame(frame);},[locating,page,view.query,view.order,activeId]);
  const locate=()=>{setLocating(true);const at=matches.findIndex(row=>row.record.id===activeId);if(at>=0)update({...view,page:Math.floor(at/SIZE),scroll:0});else{const rows=view.order==='newest'?[...indexed].reverse():indexed;update({...view,query:'',page:Math.max(0,Math.floor(rows.findIndex(row=>row.record.id===activeId)/SIZE)),scroll:0});}};
  if(!records.length)return null;
  return <div className="wb-records-browser" ref={root} onPointerDownCapture={()=>{interacted.current=true;}} onKeyDownCapture={()=>{interacted.current=true;}}>
    <HaloSearchInput label="查找协作记录" value={view.query} maxLength={200} onValueChange={query=>update({...view,query,page:0,scroll:0})} placeholder={kind==='thinking'?'按讨论原话或标题查找':'按任务目标、标题或步骤查找'} onKeyDown={event=>{if(event.key==='ArrowDown'&&!event.nativeEvent.isComposing&&event.nativeEvent.keyCode!==229){const first=list()?.querySelector<HTMLElement>('[data-list-item]');if(first){event.preventDefault();first.focus();}}}}/>
    <div className="wb-records-meta"><div className="wb-records-count"><span role="status">{matches.length} / {records.length} 条</span>{activeId&&records.some(row=>row.id===activeId)&&<TraceTooltip content={matches.some(row=>row.record.id===activeId)?'定位当前打开的记录':'清除筛选并定位当前记录'}><button className="wb-icon-button wb-record-locate" aria-label={matches.some(row=>row.record.id===activeId)?'定位当前打开的记录':'清除筛选并定位当前记录'} onClick={locate}><TraceIcon name="fit"/></button></TraceTooltip>}</div><HaloSelect aria-label="协作记录顺序" value={view.order} onValueChange={order=>update({...view,order:order as RecordBrowseState['order'],page:0,scroll:0})}><option value="newest">新建在前</option><option value="oldest">较早在前</option></HaloSelect></div>
    <div onScrollCapture={event=>{if((event.target as HTMLElement).classList.contains('wb-record-list'))remember({...live.current,scroll:(event.target as HTMLElement).scrollTop});}}><ItemList label="协作记录列表" className="wb-record-list">{visible.map(({record,parts,preview})=>{
      const found=terms.length?parts.find(text=>terms.some(term=>text.toLocaleLowerCase().includes(term))):undefined;
      return <button data-list-item data-record-id={record.id} key={record.id} className="wb-list-row" aria-current={activeId===record.id?true:undefined} onClick={()=>{remember({...live.current,scroll:list()?.scrollTop||0});onSelect(record.id);}}><TraceIcon name={kind==='thinking'?'discussion':'work'}/><span><strong>{record.title}</strong><span className="wb-record-preview">{snippet(found||preview,view.query)}</span><small>{renderStatus(record)}</small></span></button>;
    })}</ItemList></div>
    {matches.length>SIZE&&<div className="wb-history-paging"><button className="wb-button" disabled={!page} onClick={()=>update({...view,page:page-1,scroll:0})}>上一页记录</button><span>{page+1} / {pages}</span><button className="wb-button" disabled={page>=pages-1} onClick={()=>update({...view,page:page+1,scroll:0})}>下一页记录</button></div>}
    {!matches.length&&view.query&&<HaloEmptyState compact kind="records-filter" icon="search" title="没有匹配的协作记录" description="当前打开的内容和未保存草稿仍保留。这里只查已保存的记录。"><button className="wb-button" onClick={()=>update({...view,query:'',page:0,scroll:0})}>清空记录筛选</button></HaloEmptyState>}
  </div>;
}

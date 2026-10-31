import React,{useLayoutEffect,useMemo,useRef} from 'react';
import type {ContentHost,ContentRef,WorkbenchClient} from './client';
import {FormFeedback} from './feedback';
import {HaloSearchInput,HaloSelect} from './halo-controls';
import {HaloBadge,HaloEmptyState,HaloNotice} from './halo-surfaces';
import {ItemList} from './list-navigation';
import {TraceIcon,type IconName} from '../ui/icon';
import './workspace-search.css';

type SearchGroup='all'|'material'|'expression'|'capability'|'thinking'|'task';
export interface SearchOptions {group:SearchGroup;history:boolean}
export type SearchTarget={type:'content';ref:ContentRef}|{type:'thinking';id:string;messageId?:string}|{type:'task';id:string};
export interface SearchHit {key:string;group:Exclude<SearchGroup,'all'>;title:string;label:string;icon:IconName;parts:string[];version?:number;currentVersion?:number;status:string;target:SearchTarget}
const groups:{value:SearchGroup;label:string}[]=[{value:'all',label:'全部工作区'},{value:'material',label:'材料'},{value:'expression',label:'我的表达与 AI 原稿'},{value:'capability',label:'能力'},{value:'thinking',label:'共同思考'},{value:'task',label:'外部任务'}];
const materialLabels:Record<string,string>={text:'文字材料',dialogue:'对话片段',code:'代码',image:'图片',video:'视频片段',audio:'音频',pdf:'PDF 局部',web:'网页摘录',ink:'手绘'};
const expressionLabels:Record<string,string>={note:'我的表达',annotation:'我的摘记',question:'未决问题',understanding:'当前理解',ink:'手绘'};
const statusLabels:Record<string,string>={pending:'待采用的 AI 原稿',accepted:'已采用',saved:'暂存',rejected:'已拒绝',disabled:'已停用',draft:'草稿',published:'个人库已发布',trial:'试用准备'};
const materialIcon=(kind:string):IconName=>kind==='video'?'video':kind==='audio'?'audio':kind==='image'?'image':kind==='code'?'code':kind==='web'?'external':kind==='dialogue'?'discussion':kind==='ink'?'pencil':'document';

// Only canonical saved content is indexed. Layout changes do not rebuild this
// projection, and no source file, model, or execution service is queried here.
function indexWorkspace(host:ContentHost):SearchHit[]{
  const rows:SearchHit[]=[];
  for(const group of ['material','expression','capability'] as const){
    const collection=group==='material'?host.materials:group==='expression'?host.expressions:host.capabilities;
    for(const entry of Object.values(collection).reverse()){
      for(const version of Object.keys(entry.versions).map(Number).sort((a,b)=>b-a)){
        const value=entry.versions[version],label=group==='capability'?(value.usage==='instruction'?'AI 指令':value.usage==='template'?'提示模板':'方法'):group==='expression'?(entry.author==='agent'?'AI 原稿':expressionLabels[entry.kind]||'我的表达'):materialLabels[entry.kind]||'材料';
        const title=group==='capability'?value.title||'未命名能力':entry.title||label;
        rows.push({key:`${group}:${entry.id}:${version}`,group,title,label,icon:group==='capability'?'library':materialIcon(entry.kind),parts:[value.text,value.purpose,value.scope,value.steps,value.prompt,value.evidence,value.examples,value.origin?.fileName,value.origin?.url].filter((x):x is string=>typeof x==='string'&&x.length>0),version,currentVersion:entry.version,status:statusLabels[entry.status]||'',target:{type:'content',ref:{kind:group,id:entry.id,version}}});
      }
    }
  }
  for(const session of Object.values(host.sessions).reverse()){
    rows.push({key:`thinking:${session.id}`,group:'thinking',title:session.title||'共同思考',label:'共同思考',icon:'discussion',parts:[...session.messages].reverse().map(message=>message.text),status:'已保存的用户讨论',target:{type:'thinking',id:session.id}});
  }
  for(const task of Object.values(host.tasks).reverse()){
    rows.push({key:`task:${task.id}`,group:'task',title:task.title||'外部任务',label:'外部任务',icon:'work',parts:[task.goal,task.destination,...(task.plan||[]).map(step=>step.text)],status:task.status==='cancelled'?'已取消的任务准备':'已保存的任务准备',target:{type:'task',id:task.id}});
  }
  return rows;
}

function preview(parts:string[],terms:string[]):string{
  const body=parts.find(part=>terms.some(term=>part.toLocaleLowerCase().includes(term)))||parts[0]||'没有已保存的正文';
  const at=terms.length?Math.max(0,body.toLocaleLowerCase().indexOf(terms.find(term=>body.toLocaleLowerCase().includes(term))||'')):0;
  // Work in Unicode characters: neither emoji nor supplementary CJK characters
  // are sliced into lone surrogate halves at the excerpt boundary.
  const before=Array.from(body.slice(0,at)).length,chars=Array.from(body),start=Math.max(0,before-24),end=Math.min(chars.length,start+150);
  return(start?'…':'')+chars.slice(start,end).join('')+(end<chars.length?'…':'');
}

export function WorkspaceSearch({client,host,query,onQuery,options,onOptions,onOpen,onPlace,onReturnCanvas,activation=false,returnKey,scrollState,loading=false,readError=null}:{client:WorkbenchClient;host:ContentHost;query:string;onQuery:(value:string)=>void;options:SearchOptions;onOptions:(value:SearchOptions)=>void;onOpen:(hit:SearchHit)=>void;onPlace:(hit:SearchHit,owner:string,isCurrent:()=>boolean)=>Promise<unknown>;onReturnCanvas:()=>void;activation?:boolean;returnKey:string|null;scrollState:React.MutableRefObject<number>;loading?:boolean;readError?:string|null}){
  const index=useMemo(()=>indexWorkspace(host),[host]),container=useRef<HTMLDivElement>(null),interacted=useRef(false),live=useRef({query,options}),[placeBusy,setPlaceBusy]=React.useState<string|null>(null),[error,setError]=React.useState('');
  live.current={query,options};
  const state=React.useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot),feedbackOwner='search:placement';
  const terms=useMemo(()=>query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean),[query]);
  const matches=useMemo(()=>index.filter(hit=>(options.group==='all'||hit.group===options.group)&&(options.history||hit.version===undefined||hit.version===hit.currentVersion)&&terms.every(term=>[hit.title,hit.label,...hit.parts].some(part=>part.toLocaleLowerCase().includes(term)))),[index,options.group,options.history,terms]);
  const visible=matches.slice(0,100);
  // Native hidden/embedded windows may deliver the last scroll event after a
  // click. Capture the actual position at selection, before unmounting the list.
  const rememberScroll=()=>{const list=container.current?.querySelector<HTMLElement>('.wb-find-results');if(list)scrollState.current=list.scrollTop;};
  useLayoutEffect(()=>{
    // showModal handles initial autofocus. A delayed restoration must never
    // steal focus after the user has already typed, filtered, or navigated.
    if(!returnKey)return;
    const list=container.current?.querySelector<HTMLElement>('.wb-find-results');if(!list)return;
    const frame=requestAnimationFrame(()=>{
      if(interacted.current)return;
      list.scrollTop=scrollState.current;
      const selected=returnKey&&list.querySelector<HTMLElement>(`[data-search-key="${CSS.escape(returnKey)}"]`);
      if(selected)selected.focus({preventScroll:true});else container.current?.querySelector<HTMLInputElement>('input')?.focus();
    });
    return()=>cancelAnimationFrame(frame);
  },[]);
  const reset=()=>{onQuery('');onOptions({group:'all',history:false});scrollState.current=0;};
  return <div className="wb-find wb-workspace-search" ref={container} onPointerDownCapture={()=>{interacted.current=true;}} onKeyDownCapture={()=>{interacted.current=true;}} onInputCapture={()=>{interacted.current=true;}}>
    <HaloSearchInput autoFocus={!returnKey} label="搜索当前内容" value={query} onKeyDown={event=>{if(event.key==='ArrowDown'&&!event.nativeEvent.isComposing&&event.nativeEvent.keyCode!==229){const first=container.current?.querySelector<HTMLElement>('.wb-find-results [data-list-item]');if(first){event.preventDefault();first.focus();}}}} onValueChange={value=>{onQuery(value);scrollState.current=0;}} placeholder="搜索材料、表达、能力、讨论和任务"/>
    <div className="wb-search-options"><label>查找范围<HaloSelect aria-label="查找范围" value={options.group} onValueChange={value=>onOptions({...options,group:value as SearchGroup})}>{groups.map(group=><option key={group.value} value={group.value}>{group.label}</option>)}</HaloSelect></label><label className="wb-check"><input type="checkbox" checked={options.history} onChange={event=>onOptions({...options,history:event.target.checked})}/>包括历史正文版本</label></div>
    {readError&&<HaloNotice tone="warning" title="显示上次成功读取的内容" description={readError+' 检索结果不代表已经同步最新版本；关闭面板后可重试读取。'}/>}
    {loading&&<p role="status">正在重新读取；目前检索的是上次成功读取的内容。</p>}
    {activation&&<p className="wb-muted">当前为已保存内容的文字检索，不是 AI 关联建议；不会自动认定关系。</p>}
    <p className="wb-halo-hint">查找当前空间已保存的正文、来源名称与地址、能力方法、用户讨论和任务准备。不读取原件全文、未提交草稿或独立运行账本中的 AI 结果。</p>
    <p className="wb-halo-hint" role="status">找到 {matches.length} 条{matches.length>100?'，先显示前 100 条，请缩小检索范围':''}。打开结果不修改内容或启动 Agent。</p>
    <FormFeedback client={client} owner={feedbackOwner} busy={Boolean(placeBusy)} pendingLabel="正在放到画布…" message={error} error={Boolean(error)}/>
    <div className="wb-search-scroll" onScrollCapture={event=>{if((event.target as HTMLElement).classList.contains('wb-find-results'))scrollState.current=(event.target as HTMLElement).scrollTop;}}><ItemList label="搜索结果" className="wb-find-results">{visible.map(hit=>{
      const target:SearchTarget=hit.target.type==='thinking'?{...hit.target,messageId:host.sessions[hit.target.id].messages.find(message=>terms.length&&terms.some(term=>message.text.toLocaleLowerCase().includes(term)))?.id}:hit.target;
      return <div key={hit.key} className="wb-find-row" data-search-kind={hit.group}>
        <button data-list-item data-search-key={hit.key} onClick={()=>{rememberScroll();onOpen({...hit,target});}}><TraceIcon name={hit.icon}/><span><strong>{hit.title}</strong><span className="wb-search-meta"><span>{hit.label}</span>{hit.version!==undefined&&<HaloBadge icon={hit.version===hit.currentVersion?'document':'history'}>v{hit.version}{hit.version===hit.currentVersion?' 当前':' 历史只读'}</HaloBadge>}{hit.status&&<span>{hit.version!==undefined&&hit.version!==hit.currentVersion?'对象当前：':''}{hit.status}</span>}</span><small>{preview(hit.parts,terms)}</small></span></button>
        {hit.target.type==='content'&&<button className="wb-button" disabled={Boolean(placeBusy)||state.saving||Boolean(state.pending)} aria-label={(hit.version!==hit.currentVersion?'固定此版放到画布：':'放到画布：')+hit.title} onClick={()=>{rememberScroll();setPlaceBusy(hit.key);setError('');const origin=container.current,request=live.current;const isCurrent=()=>Boolean(origin?.isConnected)&&live.current.query===request.query&&live.current.options.group===request.options.group&&live.current.options.history===request.options.history;void onPlace(hit,feedbackOwner,isCurrent).catch(cause=>{if(origin?.isConnected)setError(client.getSnapshot().pending?'':cause instanceof Error?cause.message:'未能放到画布；检索与内容仍保留。');}).finally(()=>{if(origin?.isConnected)setPlaceBusy(null);});}}>{placeBusy===hit.key?'正在保存…':hit.version!==hit.currentVersion?'固定此版放到画布':'放到画布'}</button>}
      </div>;
    })}{!matches.length&&<HaloEmptyState compact kind="search" icon="search" title="没有匹配内容" description="试试更短的关键词或其他范围；搜索不会改写原有内容。"><button className="wb-button" onClick={reset}>{query?'清空检索':'重置检索条件'}</button><button className="wb-button" onClick={onReturnCanvas}>返回画布</button></HaloEmptyState>}</ItemList></div>
  </div>;
}

import React,{createContext,useContext,useLayoutEffect,useRef,useState,type MutableRefObject} from 'react';
import {HaloDisclosure} from './halo-disclosure';
import {HaloNotice} from './halo-surfaces';
import {TraceIcon} from '../ui/icon';

type Value=boolean|number;
type Reading={schemaVersion:1;owner:string;expanded:boolean;open:Record<string,boolean>;values:Record<string,Value>;scrollTop:number;anchor:null|{key:string;offset:number}};
type Problem={message:string;raw:string|null;unreadable:boolean};
type Snapshot={value:Reading;problem:Problem|null;legacy:boolean};
export type ActivationReadingController={checkpoint:(options?:{settle?:boolean})=>void};
type Context={value:Reading;setOpen:(key:string,value:React.SetStateAction<boolean>,fallback:boolean)=>void;setValue:(key:string,value:React.SetStateAction<Value>,fallback:Value)=>void;defer:(key:string,pending:boolean)=>void;defaultValue:(key:string)=>Value|undefined;observeDefault:(key:string,value:Value)=>void};
const ReadingContext=createContext<Context|null>(null);
const plain=(v:any)=>v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:any,allowed:string[])=>plain(v)&&Object.keys(v).every(k=>allowed.includes(k));
const safeKey=(v:any)=>typeof v==='string'&&v.length>0&&v.length<=2048&&!['__proto__','constructor','prototype'].includes(v);
const position=(v:any)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e8;
const visible=(element:HTMLElement)=>Boolean(element.getClientRects().length)&&!element.closest('[inert],details:not([open])');
const map=(v:any,check:(x:any)=>boolean)=>plain(v)&&Object.keys(v).length<=512&&Object.entries(v).every(([k,x])=>safeKey(k)&&check(x));
const primitive=(v:any):v is Value=>typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e8;
const empty=(owner:string):Reading=>({schemaVersion:1,owner,expanded:false,open:{},values:{},scrollTop:0,anchor:null});
const sameMap=(a:Record<string,Value>,b:Record<string,Value>)=>Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([key,value])=>Object.is(value,b[key]));
const same=(a:Reading,b:Reading)=>a.owner===b.owner&&a.expanded===b.expanded&&sameMap(a.open,b.open)&&sameMap(a.values,b.values)&&a.scrollTop===b.scrollTop&&a.anchor?.key===b.anchor?.key&&a.anchor?.offset===b.anchor?.offset;
const valid=(v:any,owner:string):v is Reading=>keys(v,['schemaVersion','owner','expanded','open','values','scrollTop','anchor'])&&v.schemaVersion===1&&v.owner===owner&&typeof v.expanded==='boolean'&&map(v.open,x=>typeof x==='boolean')&&map(v.values,primitive)&&position(v.scrollTop)&&(v.anchor===null||keys(v.anchor,['key','offset'])&&safeKey(v.anchor.key)&&typeof v.anchor.offset==='number'&&Number.isFinite(v.anchor.offset)&&Math.abs(v.anchor.offset)<=1e8);
function load(key:string,owner:string):Snapshot{
  let raw:string|null;
  try{raw=localStorage.getItem(key);}catch{return{value:empty(owner),problem:{message:'阅读恢复信息当前不可读取，未取得原文，也未自动覆盖。存储恢复后可收起再打开；内容和业务草稿仍可继续。',raw:null,unreadable:true},legacy:false};}
  if(raw===null)return{value:empty(owner),problem:null,legacy:false};
  try{
    if(raw.length>1024*1024)throw Error('Reading metadata too large');const value=JSON.parse(raw);
    if(valid(value,owner))return{value,problem:null,legacy:false};
    if(keys(value,['scrollTop'])&&Object.hasOwn(value,'scrollTop')&&position(value.scrollTop))return{value:{...empty(owner),scrollTop:value.scrollTop},problem:null,legacy:true};
  }catch{}
  return{value:empty(owner),problem:{message:'这份阅读恢复记录的格式、版本或来路无法确认，原始字节仍保留。未用默认展开状态覆盖它；已保存内容与独立草稿不受影响。',raw,unreadable:false},legacy:false};
}
const exportRecord=(value:unknown)=>{const url=URL.createObjectURL(new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='Trace-activation-reading-recovery.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

export function useActivationView<T extends Value>(key:string,initial:T,observed=true):[T,React.Dispatch<React.SetStateAction<T>>]{
  const context=useContext(ReadingContext),[fallback,setFallback]=useState(initial);
  const value=context&&Object.hasOwn(context.value.values,key)?context.value.values[key]as T:context?.defaultValue(key)as T??fallback,owner=context?.value.owner;
  useLayoutEffect(()=>{if(observed)context?.observeDefault(key,value);},[key,value,observed,owner]);
  const set:React.Dispatch<React.SetStateAction<T>>=next=>context?context.setValue(key,next as React.SetStateAction<Value>,value):setFallback(next);
  return[value,set];
}
export function useActivationOpen(key:string,initial=false):[boolean,React.Dispatch<React.SetStateAction<boolean>>]{
  const context=useContext(ReadingContext),[fallback,setFallback]=useState(initial),value=context&&Object.hasOwn(context.value.open,key)?context.value.open[key]:fallback;
  return[value,next=>context?context.setOpen(key,next,value):setFallback(next)];
}
export function useActivationReadingHold(key:string,pending:boolean){
  const context=useContext(ReadingContext),owner=context?.value.owner;
  useLayoutEffect(()=>{context?.defer(key,pending);return()=>context?.defer(key,false);},[key,pending,owner]);
}
export function ActivationDisclosure({readingId,title,children,className='',defaultOpen=false}:{readingId:string;title:React.ReactNode;children:React.ReactNode;className?:string;defaultOpen?:boolean}){
  const context=useContext(ReadingContext),[fallback,setFallback]=useState(defaultOpen),open=context&&Object.hasOwn(context.value.open,readingId)?context.value.open[readingId]:fallback;
  if(!context)return <HaloDisclosure title={title} className={className} defaultOpen={defaultOpen}>{children}</HaloDisclosure>;
  return <div data-activation-reading-key={'section:'+readingId} data-activation-reading-section={readingId}><HaloDisclosure title={title} className={className} open={open} onOpenChange={next=>context?context.setOpen(readingId,next,open):setFallback(next)}>{children}</HaloDisclosure></div>;
}

// View metadata only. The keyed frame restores its exact owner's structure
// before measuring scroll; no Product body, candidate or run is stored here.
export function ActivationReadingFrame({storageKey,owner,rootRef,controller,ready,resumeFocus,onClose,children}:{storageKey:string;owner:string;rootRef:MutableRefObject<HTMLElement|null>;controller:MutableRefObject<ActivationReadingController|null>;ready:boolean;resumeFocus?:string;onClose:()=>void;children:React.ReactNode}){
  const [initial]=useState(()=>load(storageKey,owner)),[value,setValue]=useState(initial.value),[problem,setProblem]=useState(initial.problem),[legacy,setLegacy]=useState(initial.legacy),[saveError,setSaveError]=useState(''),[phase,setPhase]=useState<'pending'|'done'|'cancelled'|'unavailable'>(initial.problem?'unavailable':'pending'),[layoutEpoch,setLayoutEpoch]=useState(0);
  const body=useRef<HTMLDivElement>(null),live=useRef(value),problemRef=useRef(problem),alive=useRef(true),restoring=useRef(!initial.problem),interacted=useRef(false),frame=useRef<number|null>(null),queuedSave=useRef<number|null>(null),cancelledPhase=useRef<number|null>(null),focusDone=useRef(false);
  problemRef.current=problem;
  // Advance the view ref synchronously with explicit actions. A later RAF
  // checkpoint must not replay a pre-render snapshot over a pending choice.
  const commit=(next:Reading)=>{if(same(live.current,next))return;live.current=next;setValue(next);};
  const deferred=useRef(new Set<string>()),observedDefaults=useRef(new Map<string,Value>());
  const capture=():Reading=>{
    const node=body.current;if(!node)return live.current;
    const top=node.getBoundingClientRect().top+node.clientTop;
    const anchors=[...node.querySelectorAll<HTMLElement>('[data-activation-reading-key]')].map(element=>({element,rect:element.getBoundingClientRect()})).filter(({element,rect})=>visible(element)&&rect.height>0&&rect.bottom>top);
    const anchor=anchors.filter(a=>a.rect.top<=top+8).sort((a,b)=>b.rect.top-a.rect.top)[0]||anchors.sort((a,b)=>Math.abs(a.rect.top-top)-Math.abs(b.rect.top-top))[0];
    const values={...live.current.values},open={...live.current.open};
    for(const [key,value]of observedDefaults.current)if(!Object.hasOwn(values,key))values[key]=value;
    for(const wrapper of node.querySelectorAll<HTMLElement>('[data-activation-reading-section]')){const key=wrapper.dataset.activationReadingSection!,details=wrapper.firstElementChild;if(details?.tagName==='DETAILS'&&!Object.hasOwn(open,key))open[key]=(details as HTMLDetailsElement).open;}
    for(const element of node.querySelectorAll<HTMLElement>('[data-activation-scroll-key]'))if(visible(element)){const key=element.dataset.activationScrollKey!;values['scroll:'+key+':y']=element.scrollTop;values['scroll:'+key+':x']=element.scrollLeft;}
    return{...live.current,open,values,scrollTop:node.scrollTop,anchor:anchor?{key:anchor.element.dataset.activationReadingKey!,offset:anchor.rect.top-top}:null};
  };
  const persist=(next:Reading,explicit=false)=>{
    if(problemRef.current&&!explicit)return;
    try{if(!valid(next,owner))throw Error('Invalid reading metadata');localStorage.setItem(storageKey,JSON.stringify(next));if(alive.current){setSaveError('');setLegacy(false);if(explicit){setProblem(null);setPhase('done');}}}catch{if(alive.current)setSaveError('阅读位置未能保存到本地；旧记录没有被清空，可先导出当前阅读信息。');}
  };
  const checkpoint=(options?:{settle?:boolean})=>{if(restoring.current||!body.current)return;if(options?.settle)for(const animation of body.current.getAnimations({subtree:true}))if(animation.id.startsWith('trace-surface-disclosure-'))try{animation.finish();}catch{}const next=capture();if(sameMap(next.open,live.current.open))next.open=live.current.open;if(sameMap(next.values,live.current.values))next.values=live.current.values;commit(next);persist(next);};
  const restoreInner=()=>{for(const scroller of body.current?.querySelectorAll<HTMLElement>('[data-activation-scroll-key]')||[])if(visible(scroller)){const key=scroller.dataset.activationScrollKey!,y=live.current.values['scroll:'+key+':y'],x=live.current.values['scroll:'+key+':x'];if(typeof y==='number')scroller.scrollTop=y;if(typeof x==='number')scroller.scrollLeft=x;}};
  const cancelRestoration=()=>{
    interacted.current=true;
    if(restoring.current){restoring.current=false;if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;
      // React's capture listener can flush before onChange sees a controlled
      // textarea's new value. Cancel immediately, render feedback next task.
      if(cancelledPhase.current===null)cancelledPhase.current=window.setTimeout(()=>{cancelledPhase.current=null;if(alive.current)setPhase('cancelled');},0);
    }
  };
  const changeMap=(name:'open'|'values',key:string,next:React.SetStateAction<any>,fallback:Value)=>{
    cancelRestoration();
    const previous=live.current,current=Object.hasOwn(previous[name],key)?previous[name][key]:fallback,updated=typeof next==='function'?next(current):next;if(!safeKey(key)||!primitive(updated)||name==='open'&&typeof updated!=='boolean')return;commit({...previous,[name]:{...previous[name],[key]:updated}});
  };
  useLayoutEffect(()=>{
    alive.current=true;const token={checkpoint};controller.current=token;const flush=()=>checkpoint({settle:true});window.addEventListener('pagehide',flush);window.addEventListener('beforeunload',flush);
    return()=>{alive.current=false;window.removeEventListener('pagehide',flush);window.removeEventListener('beforeunload',flush);if(frame.current!==null)cancelAnimationFrame(frame.current);if(queuedSave.current!==null)cancelAnimationFrame(queuedSave.current);if(cancelledPhase.current!==null){clearTimeout(cancelledPhase.current);cancelledPhase.current=null;}if(!restoring.current)persist(capture());if(controller.current===token)controller.current=null;};
  },[]);
  useLayoutEffect(()=>{
    if(!restoring.current||!ready||deferred.current.size||!body.current)return;
    const restore=()=>{
      const node=body.current;if(!node||interacted.current||!alive.current)return;
      const anchor=live.current.anchor,element=anchor?[...node.querySelectorAll<HTMLElement>('[data-activation-reading-key]')].find(e=>e.dataset.activationReadingKey===anchor.key&&e.getClientRects().length):null;
      restoreInner();
      node.scrollTop=element&&anchor?node.scrollTop+element.getBoundingClientRect().top-(node.getBoundingClientRect().top+node.clientTop)-anchor.offset:live.current.scrollTop;
    };
    restore();
    frame.current=requestAnimationFrame(()=>{
      frame.current=null;if(!alive.current||interacted.current)return;restore();restoring.current=false;setPhase('done');
      if(!focusDone.current){focusDone.current=true;const node=body.current!,target=resumeFocus?[...node.querySelectorAll<HTMLElement>('[data-activation-focus-key]')].find(e=>e.dataset.activationFocusKey===resumeFocus):null;if(target){const rect=target.getBoundingClientRect(),view=node.getBoundingClientRect();if(rect.top<view.top||rect.bottom>view.bottom)node.scrollTop+=rect.top-view.top-24;}(target||rootRef.current)?.focus({preventScroll:true});}
    });
    return()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);};
  },[ready,layoutEpoch]);
  useLayoutEffect(()=>{
    const node=body.current;if(!node)return;
    const save=()=>{if(!interacted.current||restoring.current||queuedSave.current!==null||node.querySelector('[data-animating]'))return;queuedSave.current=requestAnimationFrame(()=>{queuedSave.current=null;if(alive.current&&!node.querySelector('[data-animating]'))checkpoint();});};
    const observer=new MutationObserver(save);observer.observe(node,{subtree:true,childList:true,attributes:true,attributeFilter:['open','data-animating']});const resize=new ResizeObserver(save);resize.observe(node);return()=>{observer.disconnect();resize.disconnect();};
  },[]);
  useLayoutEffect(()=>{if(interacted.current&&!restoring.current)restoreInner();},[value.open]);
  useLayoutEffect(()=>{if(interacted.current&&!restoring.current)checkpoint();},[value.expanded,value.open,value.values,Boolean(problem),Boolean(saveError),legacy]);
  const dismiss=()=>{checkpoint({settle:true});onClose();};
  return <ReadingContext.Provider value={{value,setOpen:(key,next,fallback)=>changeMap('open',key,next,fallback),setValue:(key,next,fallback)=>changeMap('values',key,next,fallback),defaultValue:key=>observedDefaults.current.get(key),observeDefault:(key,next)=>{if(safeKey(key)&&primitive(next)&&!observedDefaults.current.has(key))observedDefaults.current.set(key,next);},defer:(key,pending)=>{if(pending===deferred.current.has(key))return;if(pending)deferred.current.add(key);else deferred.current.delete(key);if(alive.current)setLayoutEpoch(v=>v+1);}}}><section ref={rootRef} tabIndex={-1} role="region" aria-label="激活旧线索工作面" className={'wb-activation-panel '+(value.expanded?'is-expanded':'')} data-reading-owner={owner} data-reading-restored={phase} onPointerDownCapture={cancelRestoration} onWheelCapture={cancelRestoration} onTouchStartCapture={cancelRestoration} onInputCapture={cancelRestoration} onKeyDownCapture={cancelRestoration} onKeyDown={event=>{if(event.key==='Escape'&&!event.nativeEvent.isComposing&&event.nativeEvent.keyCode!==229&&event.target instanceof HTMLElement&&!event.target.closest('[role=listbox],[role=menu],dialog')){event.preventDefault();dismiss();}}}>
    <header className="wb-activation-heading"><div><h2>激活旧线索</h2><p>有依据地比较，不把联想当事实</p></div><div className="wb-actions"><button className="wb-button" onClick={()=>commit({...live.current,expanded:!live.current.expanded})}>{value.expanded?'收起工作面':'扩大工作面'}</button><button className="wb-icon-button" aria-label="收起激活工作面" onClick={dismiss}><TraceIcon name="close"/></button></div></header>
    <div ref={body} className="wb-activation-body" onScrollCapture={()=>{if(interacted.current&&!restoring.current&&queuedSave.current===null)queuedSave.current=requestAnimationFrame(()=>{queuedSave.current=null;if(alive.current)checkpoint();});}}>
      {problem&&<HaloNotice tone="warning" title="阅读恢复信息需要核对" description={problem.message} actions={<><button className="wb-button" onClick={()=>exportRecord(problem.raw??{owner,currentView:capture(),problem:problem.message})}>{problem.raw===null?'导出当前阅读信息':'原样导出阅读恢复记录'}</button>{!problem.unreadable&&<button className="wb-button" onClick={()=>{if(window.confirm('先导出需要保留的原记录。明确只重置当前探索的阅读恢复信息？不会改动内容、草稿或其它探索。'))persist(capture(),true);}}>明确重置这份阅读恢复</button>}</>}/>}
      {saveError&&<HaloNotice tone="warning" title="阅读位置尚未保存" description={saveError} actions={<button className="wb-button" onClick={()=>exportRecord(capture())}>导出当前阅读信息</button>}/>}
      {legacy&&<p className="wb-halo-hint">旧阅读记录只含滚动位置；过去的展开状态未记录。本次显示默认结构，后续明确操作才保存新的完整阅读状态。</p>}
      {children}
    </div>
  </section></ReadingContext.Provider>;
}

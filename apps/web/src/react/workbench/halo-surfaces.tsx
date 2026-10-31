import React,{useEffect,useRef} from 'react';
import {ToggleGroup} from 'radix-ui';
import {TraceIcon} from '../ui/icon';
import type {ContentEntry} from './client';
import './halo-surfaces.css';
import {useSurfaceMotion} from './motion';

export type HaloTone='neutral'|'success'|'warning'|'error';
export function HaloBadge({children,tone='neutral',className=''}:{children:React.ReactNode;tone?:HaloTone;className?:string}){
  return <span className={'wb-halo-badge '+className} data-tone={tone}>{children}</span>;
}

// A non-empty single selection. Radix supplies roving keys; selecting the
// current item must not clear the active workspace or reset its draft.
export function HaloSegmented({value,onValueChange,items,label}:{value:string;onValueChange:(value:string)=>void;items:{value:string;label:string;count?:number}[];label:string}){
  return <ToggleGroup.Root type="single" className="wb-halo-segmented" value={value} onValueChange={next=>{if(next)onValueChange(next);}} aria-label={label}>
    {items.map(item=><ToggleGroup.Item key={item.value} value={item.value} aria-label={item.label}>
      <span>{item.label}</span>{item.count!==undefined&&<span className="wb-halo-segment-count" aria-hidden="true">{item.count}</span>}
    </ToggleGroup.Item>)}
  </ToggleGroup.Root>;
}

export function HaloSurface({children,className=''}:{children:React.ReactNode;className?:string}){
  return <div className={'wb-halo-surface '+className}>{children}</div>;
}

// MorphSurface's trigger/editor relationship, adapted to a persistent local
// annotation. Collapsing never unmounts the form or deletes its versioned draft.
export function HaloAnnotationSurface({children,preview}:{children:React.ReactNode;preview:string}){
  const [open,setOpen]=React.useState(Boolean(preview)),id=React.useId(),trigger=React.useRef<HTMLButtonElement>(null),panel=React.useRef<HTMLDivElement>(null),composing=React.useRef(false);
  const close=()=>{setOpen(false);trigger.current?.focus();};
  return <section className="wb-halo-annotation" data-open={open} onCompositionStartCapture={()=>{composing.current=true;}} onCompositionEndCapture={()=>{composing.current=false;}}>
    <button type="button" ref={trigger} className="wb-halo-annotation-trigger" aria-expanded={open} aria-controls={id} onClick={()=>{if(open)close();else{setOpen(true);requestAnimationFrame(()=>panel.current?.querySelector('textarea')?.focus());}}}>
      <TraceIcon name="pencil" size={18}/><span>{open?'收起摘记':preview?'编辑我的摘记':'写一条摘记'}</span><TraceIcon name={open?'down':'plus'} size={16}/>
    </button>
    {!open&&preview&&<p className="wb-halo-annotation-preview">{preview}</p>}
    <div ref={panel} id={id} hidden={!open} onKeyDown={event=>{if(event.key==='Escape'&&!composing.current&&!event.nativeEvent.isComposing&&event.nativeEvent.keyCode!==229){event.preventDefault();event.stopPropagation();close();}}}>{children}</div>
  </section>;
}

// Local persistent feedback, not a timer-driven toast. Errors remain actionable
// at the form and the title is announced once without stealing keyboard focus.
export function HaloNotice({title,description,tone='success',onDismiss}:{title:string;description?:string;tone?:HaloTone;onDismiss?:()=>void}){
  const ref=useRef<HTMLElement>(null),{reveal,dismiss}=useSurfaceMotion(ref,onDismiss||(()=>{}),'notice');
  useEffect(()=>{reveal();},[title,description,tone]);
  return <section ref={ref} className="wb-halo-notice" data-tone={tone} role={tone==='error'?'alert':'status'}>
    <span className="wb-halo-notice-icon"><TraceIcon name={tone==='error'?'error':tone==='warning'?'pending':'check'} size={18}/></span>
    <div><strong>{title}</strong>{description&&<p>{description}</p>}</div>
    {onDismiss&&<button type="button" className="wb-icon-button" aria-label="收起保存提示" onClick={dismiss}><TraceIcon name="close" size={16}/></button>}
  </section>;
}

export function HaloProgress({value=null,max=1,label,valueText}:{value?:number|null;max?:number;label:string;valueText?:string}){
  const bound=Math.max(1,max),current=value===null?null:Math.min(bound,Math.max(0,value));
  return <div className="wb-halo-progress">
    <div><span>{label}</span>{valueText&&<span>{valueText}</span>}</div>
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={bound} aria-valuenow={current??undefined} aria-valuetext={valueText||(current===null?'处理中，完成时间未知':undefined)} className="wb-halo-progress-track" data-indeterminate={current===null}>
      <span style={{transform:`scaleX(${current===null?.32:current/bound})`}}/>
    </div>
  </div>;
}

const stateLabels:Record<string,string>={draft:'草稿',published:'个人库已发布',trial:'试用准备',disabled:'已停用'};
export function CapabilityStatus({status}:{status:string}){
  return <HaloBadge tone={status==='published'?'success':status==='disabled'?'warning':'neutral'}>{stateLabels[status]||status}</HaloBadge>;
}

// MinimalCard's content hierarchy without a fake image or a nested action.
// This remains one native list button bound to the canonical capability entry.
export function CapabilitySummary({entry,active,onSelect}:{entry:ContentEntry;active:boolean;onSelect:()=>void}){
  const value=entry.versions[entry.version];
  return <button type="button" data-list-item className="wb-capability-summary" aria-current={active?'true':undefined} onClick={onSelect}>
    <span className="wb-capability-summary-heading"><TraceIcon name="library" size={18}/><strong>{entry.title||'未命名能力'}</strong></span>
    <span className="wb-capability-summary-description">{value?.purpose||'尚未填写用途'}</span>
    <span className="wb-capability-summary-meta"><CapabilityStatus status={entry.status}/><span className="wb-capability-version">v{entry.version}</span></span>
  </button>;
}

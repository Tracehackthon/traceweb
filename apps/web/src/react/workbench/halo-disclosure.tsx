import {motionDuration} from '../ui/motion-duration';
import React,{useEffect,useLayoutEffect,useRef,useId,forwardRef} from 'react';
import {TraceIcon} from '../ui/icon';
import {motionAllowed} from './motion';

// Native details remains the semantic/focus owner. Only deliberate pointer
// disclosure animates; keyboard, reduced motion and live data updates are instant.
export function HaloDisclosure({title,children,className='',defaultOpen=false,open,onOpenChange}:{title:React.ReactNode;children:React.ReactNode;className?:string;defaultOpen?:boolean;open?:boolean;onOpenChange?:(open:boolean)=>void}){
  const id='trace-disclosure-'+useId(),root=useRef<HTMLDetailsElement>(null),body=useRef<HTMLDivElement>(null),animations=useRef<Animation[]>([]),target=useRef(false);
  useEffect(()=>()=>{for(const a of animations.current)a.cancel();},[]);
  useLayoutEffect(()=>{if(open===undefined||(animations.current.length&&target.current===open))return;for(const a of animations.current)a.cancel();animations.current=[];const node=root.current,content=body.current;if(!node||!content)return;node.open=open;target.current=open;node.dataset.expanded=String(open);delete node.dataset.animating;node.querySelector('summary')?.setAttribute('aria-expanded',String(open));content.inert=!open;},[open]);
  return <details ref={root} open={open??defaultOpen} className={'wb-halo-disclosure '+className}><summary aria-expanded={open??defaultOpen} aria-controls={id} onClick={event=>{
    const node=root.current,content=body.current;if(!node||!content)return;
    event.preventDefault();const opening=animations.current.length?!target.current:!node.open;target.current=opening;onOpenChange?.(opening);node.dataset.expanded=String(opening);node.querySelector('summary')?.setAttribute('aria-expanded',String(opening));
    const height=node.getBoundingClientRect().height,opacity=node.open?getComputedStyle(content).opacity:'0';
    for(const a of animations.current)a.cancel();animations.current=[];content.inert=false;
    if(!event.detail||!motionAllowed()){node.open=opening;content.inert=!opening;delete node.dataset.animating;return;}
    node.open=true;content.inert=!opening;node.dataset.animating='true';
    const summary=node.querySelector('summary')!,end=opening?node.scrollHeight:summary.getBoundingClientRect().height;
    const style=getComputedStyle(node),options={duration:motionDuration(style,opening?'--trace-motion-enter':'--trace-motion-exit',opening?200:160),easing:style.getPropertyValue('--trace-motion-ease').trim()||'cubic-bezier(0.23,1,0.32,1)',fill:'both' as const};
    const size=node.animate([{height:height+'px'},{height:end+'px'}],options),fade=content.animate([{opacity},{opacity:opening?'1':'0'}],options);
    size.id='trace-surface-disclosure-size';fade.id='trace-surface-disclosure-fade';animations.current=[size,fade];
    void size.finished.then(()=>{if(animations.current[0]!==size)return;node.open=opening;delete node.dataset.animating;content.inert=!opening;for(const a of animations.current)a.cancel();animations.current=[];}).catch(()=>{});
  }}><span className="wb-disclosure-label">{title}</span><span className="wb-control-icon"><TraceIcon name="down" size={16}/></span></summary><div ref={body} id={id} inert={!(open??defaultOpen)} className="wb-halo-disclosure-content">{children}</div></details>;
}

// Controlled editors stay mounted: collapsing cannot discard a draft or reset
// textarea selection. Native hidden/inert is restored when the exit finishes.
export const HaloCollapse=forwardRef<HTMLDivElement,React.HTMLAttributes<HTMLDivElement>&{open:boolean;focusOnOpen?:boolean;instant?:boolean}>(function HaloCollapse({open,focusOnOpen=false,instant=false,children,className='',...props},forwarded){
  const panel=useRef<HTMLDivElement|null>(null),previous=useRef<boolean|null>(null),animations=useRef<Animation[]>([]);
  useLayoutEffect(()=>{
    const node=panel.current;if(!node)return;
    const first=previous.current===null;previous.current=open;
    const start=node.hidden?0:node.getBoundingClientRect().height,opacity=node.hidden?'0':getComputedStyle(node).opacity;
    const restoreFocus=!open&&node.contains(document.activeElement);for(const a of animations.current)a.cancel();animations.current=[];node.inert=!open;
    if(restoreFocus){const trigger=node.id?document.querySelector<HTMLElement>('[aria-controls="'+CSS.escape(node.id)+'"]'):node.previousElementSibling;if(trigger instanceof HTMLButtonElement)trigger.focus({preventScroll:true});}
    if(first||instant||!motionAllowed()){node.hidden=!open;delete node.dataset.animating;if(open&&focusOnOpen)node.querySelector<HTMLElement>('textarea,input')?.focus();return;}
    node.hidden=false;node.dataset.animating='true';if(open&&focusOnOpen)node.querySelector<HTMLElement>('textarea,input')?.focus();
    const style=getComputedStyle(node),options={duration:motionDuration(style,open?'--trace-motion-enter':'--trace-motion-exit',open?200:160),easing:style.getPropertyValue('--trace-motion-ease').trim()||'cubic-bezier(.23,1,.32,1)',fill:'both' as const};
    const size=node.animate([{height:start+'px'},{height:(open?node.scrollHeight:0)+'px'}],options),fade=node.animate([{opacity},{opacity:open?'1':'0'}],options);
    size.id='trace-surface-collapse-size';fade.id='trace-surface-collapse-fade';animations.current=[size,fade];
    void size.finished.then(()=>{if(animations.current[0]!==size)return;node.hidden=!open;delete node.dataset.animating;for(const a of animations.current)a.cancel();animations.current=[];}).catch(()=>{});
  },[open]);
  useEffect(()=>()=>{for(const a of animations.current)a.cancel();},[]);
  return <div {...props} ref={node=>{panel.current=node;if(typeof forwarded==='function')forwarded(node);else if(forwarded)forwarded.current=node;}} className={'wb-halo-collapse '+className} aria-hidden={!open}>{children}</div>;
});

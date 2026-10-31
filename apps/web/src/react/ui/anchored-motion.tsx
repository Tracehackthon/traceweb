import {motionDuration} from './motion-duration';
import React,{forwardRef,useCallback,useLayoutEffect,useRef,useState} from 'react';

// Radix keeps placement, focus and Presence. The constant-opacity CSS exit is
// only its lifetime signal; this WAAPI effect owns visible motion and retargets
// from the current compositor value when a close is immediately reversed.
export function useAnchoredMotion(open:boolean){
  const [node,setNode]=useState<HTMLElement|null>(null),current=useRef<Animation|null>(null),seen=useRef<HTMLElement|null>(null);
  const ref=useCallback((element:HTMLElement|null)=>setNode(element),[]);
  useLayoutEffect(()=>{
    if(!node||document.documentElement.dataset.workbenchMotion!=='true')return;
    const root=document.documentElement,allowed=root.dataset.traceInput!=='keyboard'&&root.dataset.reduceMotion!=='true'&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&node.dataset.state!=='instant-open';
    const first=seen.current!==node;seen.current=node;
    const style=getComputedStyle(node),from=current.current?{opacity:style.opacity,transform:style.transform}:open?{opacity:'0',transform:'scale(.97)'}:{opacity:style.opacity,transform:style.transform};
    current.current?.cancel();current.current=null;node.inert=!open;
    if(!allowed||!open&&node.dataset.motionExit==='immediate'){delete node.dataset.motionPhase;return;}
    if(first&&!open)return;
    node.dataset.motionPhase=open?'enter':'exit';
    const animation=node.animate([from,open?{opacity:'1',transform:'none'}:{opacity:'0',transform:'scale(.97)'}],{duration:motionDuration(style,open?'--trace-motion-exit':'--trace-motion-fast',open?160:120),easing:style.getPropertyValue('--trace-motion-ease').trim()||'cubic-bezier(.23,1,.32,1)',fill:'both'});
    animation.id='trace-surface-popover-'+(open?'enter':'exit');current.current=animation;
    void animation.finished.then(()=>{if(current.current!==animation)return;delete node.dataset.motionPhase;if(open)animation.cancel();current.current=null;}).catch(()=>{});
  },[node,open]);
  useLayoutEffect(()=>()=>{current.current?.cancel();},[node]);
  return ref;
}

// asChild adds no wrapper or alternate focus owner to the actual Radix content.
export const AnchoredMotionSurface=forwardRef<HTMLDivElement,React.HTMLAttributes<HTMLDivElement>&{motionOpen:boolean}>(function AnchoredMotionSurface({motionOpen,...props},forwarded){
  const motionRef=useAnchoredMotion(motionOpen);
  const ref=useCallback((node:HTMLDivElement|null)=>{motionRef(node);if(typeof forwarded==='function')forwarded(node);else if(forwarded)forwarded.current=node;},[motionRef,forwarded]);
  return <div {...props} ref={ref}/>;
});

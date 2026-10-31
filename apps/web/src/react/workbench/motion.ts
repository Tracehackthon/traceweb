import {useEffect,useRef,type RefObject} from 'react';
import './workbench-motion.css';

export function motionAllowed(){
  const root=document.documentElement;
  return root.dataset.traceInput!=='keyboard'&&root.dataset.reduceMotion!=='true'&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Modality is observed, not guessed from :focus-visible on text inputs.
export function useWorkbenchMotion(){
  useEffect(()=>{
    const root=document.documentElement,old=root.dataset.traceInput;
    root.dataset.traceInput='pointer';
    const pointer=()=>{if(root.dataset.traceInput!=='pointer')root.dataset.traceInput='pointer';};
    const keyboard=()=>{
      root.dataset.traceInput='keyboard';
      for(const animation of document.getAnimations())if(animation.id.startsWith('trace-surface-'))animation.finish();
    };
    const reduce=()=>{if(!motionAllowed())for(const animation of document.getAnimations())if(animation.id.startsWith('trace-surface-'))animation.finish();};
    const query=matchMedia('(prefers-reduced-motion: reduce)'),observer=new MutationObserver(reduce);
    observer.observe(root,{attributes:true,attributeFilter:['data-reduce-motion']});query.addEventListener('change',reduce);
    document.addEventListener('pointerdown',pointer,true);document.addEventListener('pointermove',pointer,{passive:true});document.addEventListener('keydown',keyboard,true);
    return()=>{observer.disconnect();query.removeEventListener('change',reduce);document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('pointermove',pointer);document.removeEventListener('keydown',keyboard,true);if(old===undefined)delete root.dataset.traceInput;else root.dataset.traceInput=old;};
  },[]);
}

// Keep existing native/Radix focus ownership. Only defer an explicit pointer
// dismissal, never a save command, keyboard interaction, or reduced-motion user.
export function useSurfaceMotion<T extends HTMLElement>(ref:RefObject<T|null>,onDismiss:()=>void,kind:'dialog'|'notice'='dialog'){
  const current=useRef<Animation|null>(null),closing=useRef(false),callback=useRef(onDismiss);callback.current=onDismiss;
  useEffect(()=>()=>{current.current?.cancel();},[]);
  const play=(exit:boolean)=>{
    const element=ref.current;if(!element||!motionAllowed()){if(exit)callback.current();return;}
    element.dataset.motionState=exit?'closing':'open';
    const style=getComputedStyle(element),from=exit?{opacity:style.opacity,transform:style.transform}:{opacity:'0',transform:kind==='dialog'?'translateY(8px) scale(.97)':'none'};
    current.current?.cancel();
    const to=exit?{opacity:'0',transform:kind==='dialog'?'translateY(8px) scale(.97)':'none'}:{opacity:'1',transform:'none'};
    const animation=element.animate([from,to],{duration:parseFloat(style.getPropertyValue(exit?'--trace-motion-exit':'--trace-motion-enter'))||(exit?160:200),easing:style.getPropertyValue('--trace-motion-ease').trim()||'cubic-bezier(0.23, 1, 0.32, 1)',fill:'both'});
    animation.id='trace-surface-'+(exit?'exit':'enter');current.current=animation;
    void animation.finished.then(()=>{if(current.current!==animation)return;if(exit)callback.current();else animation.cancel();current.current=null;}).catch(()=>{});
  };
  return {reveal:()=>{closing.current=false;play(false);},dismiss:()=>{if(closing.current)return;closing.current=true;play(true);}};
}

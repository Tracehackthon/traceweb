import React,{useId,useRef,useState} from 'react';
import {TraceIcon} from '../ui/icon';
import './expressive-controls.css';

// Adapted from the user-provided Gooey Input. Filter only decorative surfaces:
// input text and focus outlines must remain crisp and outside the SVG filter.
export function GooeySearch({onSearch}:{onSearch:(query:string)=>void}){
  const id='trace-gooey-'+useId().replace(/[^a-zA-Z0-9_-]/g,''),input=useRef<HTMLInputElement>(null),trigger=useRef<HTMLButtonElement>(null),composing=useRef(false);
  const [open,setOpen]=useState(false),[query,setQuery]=useState('');
  const clear=()=>{setQuery('');input.current?.focus();};
  const close=()=>{setOpen(false);trigger.current?.focus();};
  return <div className="wb-gooey-search" data-open={open} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget)&&!query)setOpen(false);}}>
    <svg className="wb-material-defs" aria-hidden="true" focusable="false"><defs><filter id={id} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur"/><feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" result="goo"/><feComposite in="SourceGraphic" in2="goo" operator="atop"/></filter></defs></svg>
    <div className="wb-gooey-surfaces" style={{filter:`url(#${id})`}} aria-hidden="true"><i/><i/></div>
    <button ref={trigger} className="wb-gooey-trigger" type="button" aria-label="搜索" aria-expanded={open} aria-controls={id+'-field'} onClick={()=>{setOpen(true);requestAnimationFrame(()=>input.current?.focus());}}><TraceIcon name="search"/>{!open&&<span>搜索</span>}</button>
    <form onSubmit={event=>{event.preventDefault();if(composing.current||!open||!query.trim())return;onSearch(query);}}>
      <input ref={input} id={id+'-field'} type="search" aria-label="快速搜索当前资料" placeholder="输入后回车搜索" value={query} disabled={!open} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(composing.current||event.nativeEvent.isComposing||event.nativeEvent.keyCode===229){if(event.key==='Enter')event.preventDefault();return;}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}}/>
      {open&&query&&<button type="button" className="wb-gooey-clear" aria-label="清除快速搜索" onClick={clear}><TraceIcon name="close" size={16}/></button>}
    </form>
  </div>;
}

// Native button semantics, unique SVG IDs, and a readable CSS blur fallback.
export function LiquidButton({children,className='',type='button',...props}:React.ButtonHTMLAttributes<HTMLButtonElement>){
  const id='trace-glass-'+useId().replace(/[^a-zA-Z0-9_-]/g,'');
  return <button {...props} type={type} className={className+' wb-liquid-button'}>
    <span className="wb-liquid-surface" aria-hidden="true" style={{backdropFilter:`url(#${id}) blur(4px)`}}/>
    <span className="wb-liquid-label">{children}</span>
    <svg className="wb-material-defs" aria-hidden="true" focusable="false"><defs><filter id={id} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.05 0.05" numOctaves="1" seed="1" result="noise"/><feGaussianBlur in="noise" stdDeviation="2" result="blurred"/><feDisplacementMap in="SourceGraphic" in2="blurred" scale="70" xChannelSelector="R" yChannelSelector="B" result="displaced"/><feGaussianBlur in="displaced" stdDeviation="4"/></filter></defs></svg>
  </button>;
}

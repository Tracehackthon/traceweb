import React,{useEffect,useRef} from 'react';
import {TraceIcon} from '../ui/icon';
import {motionAllowed} from './motion';

// Native details remains the semantic/focus owner. Only deliberate pointer
// disclosure animates; keyboard, reduced motion and live data updates are instant.
export function HaloDisclosure({title,children}:{title:React.ReactNode;children:React.ReactNode}){
  const root=useRef<HTMLDetailsElement>(null),body=useRef<HTMLDivElement>(null),animations=useRef<Animation[]>([]),target=useRef(false);
  useEffect(()=>()=>{for(const a of animations.current)a.cancel();},[]);
  return <details ref={root} className="wb-halo-disclosure"><summary onClick={event=>{
    const node=root.current,content=body.current;if(!node||!content)return;
    event.preventDefault();const opening=animations.current.length?!target.current:!node.open;target.current=opening;
    const height=node.getBoundingClientRect().height,opacity=node.open?getComputedStyle(content).opacity:'0';
    for(const a of animations.current)a.cancel();animations.current=[];content.inert=false;
    if(!event.detail||!motionAllowed()){node.open=opening;delete node.dataset.animating;return;}
    node.open=true;content.inert=!opening;node.dataset.animating='true';
    const summary=node.querySelector('summary')!,end=opening?node.scrollHeight:summary.getBoundingClientRect().height;
    const style=getComputedStyle(node),options={duration:parseFloat(style.getPropertyValue('--trace-motion-enter'))||200,easing:style.getPropertyValue('--trace-motion-ease').trim()||'cubic-bezier(0.23,1,0.32,1)',fill:'both' as const};
    const size=node.animate([{height:height+'px'},{height:end+'px'}],options),fade=content.animate([{opacity},{opacity:opening?'1':'0'}],options);
    size.id='trace-surface-disclosure-size';fade.id='trace-surface-disclosure-fade';animations.current=[size,fade];
    void size.finished.then(()=>{if(animations.current[0]!==size)return;node.open=opening;delete node.dataset.animating;content.inert=false;for(const a of animations.current)a.cancel();animations.current=[];}).catch(()=>{});
  }}><span>{title}</span><TraceIcon name="down" size={16}/></summary><div ref={body} className="wb-halo-disclosure-content">{children}</div></details>;
}

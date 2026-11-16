import React,{useLayoutEffect,useRef} from 'react';

// Scroll early enough to expose a neighbour, without moving focus or animating.
export function revealNeighbour(container:HTMLElement,item:HTMLElement){
  const box=container.getBoundingClientRect(),row=item.getBoundingClientRect(),peek=16;
  if(row.bottom>box.bottom-peek)container.scrollTop+=row.bottom-box.bottom+peek;
  else if(row.top<box.top+peek)container.scrollTop-=box.top-row.top+peek;
}
export function ItemList({children,label,className='',selector='button[data-list-item]',onKeyDown}:{children:React.ReactNode;label:string;className?:string;selector?:string;onKeyDown?:(event:React.KeyboardEvent<HTMLDivElement>)=>void}){
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const element=ref.current;if(!element)return;
    const size=()=>{element.style.removeProperty('--wb-list-height');const rows=[...element.querySelectorAll<HTMLElement>(selector)];const box=element.getBoundingClientRect();const last=rows.find(row=>row.getBoundingClientRect().top>box.top+32&&row.getBoundingClientRect().top+16<box.bottom&&row.getBoundingClientRect().bottom>box.bottom);if(last)element.style.setProperty('--wb-list-height',last.getBoundingClientRect().top-box.top+16+'px');};
    size();const observer=new ResizeObserver(size);observer.observe(element.parentElement||element);return()=>observer.disconnect();
  },[children,selector]);
  return <div ref={ref} aria-label={label} className={'wb-item-list '+className} onKeyDown={event=>{
    onKeyDown?.(event);if(event.defaultPrevented||event.nativeEvent.isComposing||event.nativeEvent.keyCode===229||event.altKey||event.metaKey||event.ctrlKey)return;
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    const rows=[...event.currentTarget.querySelectorAll<HTMLElement>(selector)].filter(e=>!e.matches(':disabled'));
    const at=rows.findIndex(e=>e===event.target||e.contains(event.target as Node));if(at<0)return;
    event.preventDefault();const index=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,at+(event.key==='ArrowDown'?1:-1)));
    rows[index]?.focus({preventScroll:true});if(rows[index])revealNeighbour(event.currentTarget,rows[index]);
  }}>{children}</div>;
}

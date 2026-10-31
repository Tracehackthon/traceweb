import React,{useEffect,useState} from 'react';
import {WorkbenchModal} from './modal';
import {TraceIcon} from '../ui/icon';

// The same collection has one owner and one rendered list. Small windows use a
// deliberate picker instead of reserving a fixed third of the editing viewport.
export function CollectionPanel({title,caption=title,current,count,createLabel,onCreate,children}:{title:string;caption?:string;current:string;count:number;createLabel:string;onCreate:()=>void;children:React.ReactNode}){
  const [narrow,setNarrow]=useState(()=>matchMedia('(max-width:767px)').matches),[open,setOpen]=useState(false);
  useEffect(()=>{const media=matchMedia('(max-width:767px)'),change=()=>{setNarrow(media.matches);setOpen(false);};media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  if(!narrow)return <section className="wb-list-pane">{children}</section>;
  return <div className="wb-collection-compact">
    <button className="wb-button wb-collection-switch" aria-label={'切换'+title+'：'+current} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><span><small>{caption} · {count}</small><strong>{current}</strong></span><TraceIcon name="down"/></button>
    <button className="wb-icon-button" aria-label={createLabel} onClick={onCreate}><TraceIcon name="plus"/></button>
    {open&&<WorkbenchModal title={'选择'+title} onClose={()=>setOpen(false)}><div className="wb-collection-modal" onClick={event=>{if((event.target as Element).closest('[data-list-item],[data-collection-close]'))setOpen(false);}}><section className="wb-list-pane">{children}</section><div className="wb-collection-create"><button className="wb-button" onClick={()=>{onCreate();setOpen(false);}}><TraceIcon name="plus"/>{createLabel}</button></div></div></WorkbenchModal>}
  </div>;
}

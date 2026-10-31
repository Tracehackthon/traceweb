import React,{useEffect,useRef} from 'react';
import {TraceIcon} from '../ui/icon';
import {useSurfaceMotion} from './motion';
export function WorkbenchModal({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){
  const ref=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLElement|null>(null),composing=useRef(false);
  const {reveal,dismiss}=useSurfaceMotion(ref,onClose);
  useEffect(()=>{trigger.current=document.activeElement as HTMLElement;ref.current?.showModal();reveal();return()=>{ref.current?.close();trigger.current?.isConnected&&trigger.current.focus();};},[]);
  return <dialog ref={ref} className="wb-dialog" aria-label={title} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onSubmitCapture={event=>{if(composing.current){event.preventDefault();event.stopPropagation();}}} onKeyDownCapture={event=>{if(event.key==='Escape'&&(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229)){event.preventDefault();event.stopPropagation();}}} onCancel={event=>{event.preventDefault();if(!composing.current)dismiss();}} onClick={event=>{if(event.target===event.currentTarget)dismiss();}}><header><h2>{title}</h2><button className="wb-icon-button" aria-label="关闭对话框" onClick={dismiss}><TraceIcon name="close"/></button></header>{children}</dialog>;
}

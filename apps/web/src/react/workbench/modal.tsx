import React,{useEffect,useRef} from 'react';
import {TraceIcon} from '../ui/icon';
import {useSurfaceMotion} from './motion';
export function WorkbenchModal({title,context,className='',onClose,onDismissStart,children}:{title:string;context?:string;className?:string;onClose:()=>void;onDismissStart?:()=>void;children:React.ReactNode}){
  const ref=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLElement|null>(null),composing=useRef(false);
  const {reveal,dismiss}=useSurfaceMotion(ref,onClose);
  const beginDismiss=()=>{onDismissStart?.();dismiss();};
  useEffect(()=>{trigger.current=document.activeElement as HTMLElement;ref.current?.showModal();reveal();return()=>{ref.current?.close();trigger.current?.isConnected&&trigger.current.focus();};},[]);
  // A retiring tooltip can still prevent the browser's native cancel event.
  // The top-layer modal owns Escape; composing text must never dismiss it.
  return <dialog ref={ref} className={'wb-dialog '+className} aria-label={title} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onSubmitCapture={event=>{if(composing.current){event.preventDefault();event.stopPropagation();}}} onKeyDownCapture={event=>{if(event.key!=='Escape')return;if(composing.current||event.nativeEvent.isComposing||event.nativeEvent.keyCode===229){event.preventDefault();event.stopPropagation();return;}const target=event.target as HTMLElement;if(target.closest('dialog')!==event.currentTarget||target.closest('[role=listbox],[role=menu]'))return;event.preventDefault();event.stopPropagation();beginDismiss();}} onCancel={event=>{event.preventDefault();event.stopPropagation();if(event.target===event.currentTarget&&!composing.current)beginDismiss();}} onClick={event=>{if(event.target===event.currentTarget)beginDismiss();}}><header>{context?<div className="wb-modal-heading"><h2>{title}</h2><p className="wb-modal-context" title={context}>{context}</p></div>:<h2>{title}</h2>}<button type="button" className="wb-icon-button" aria-label="关闭对话框" onClick={beginDismiss}><TraceIcon name="close"/></button></header>{children}</dialog>;
}

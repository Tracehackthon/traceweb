import React,{useEffect,useRef} from 'react';
export function WorkbenchModal({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){
  const ref=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLElement|null>(null);
  useEffect(()=>{trigger.current=document.activeElement as HTMLElement;ref.current?.showModal();return()=>{ref.current?.close();trigger.current?.isConnected&&trigger.current.focus();};},[]);
  return <dialog ref={ref} className="wb-dialog" aria-label={title} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}><header><h2>{title}</h2><button className="wb-icon-button" aria-label="关闭对话框" onClick={onClose}>×</button></header>{children}</dialog>;
}

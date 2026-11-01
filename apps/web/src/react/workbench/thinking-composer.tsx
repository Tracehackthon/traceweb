import {useDiscussionHistory} from './discussion-browser';
import {HaloTextarea} from './halo-controls';
import React,{useId,useLayoutEffect,useRef,useState} from 'react';
import {revealNeighbour} from './list-navigation';

type Message={id:string;text:string;author:string};
export function ThinkingComposer({messages,value,onChange,onSave,tools,disabled=false,saveDisabled=false}:{messages:Message[];value:string;onChange:(text:string)=>void;onSave:(text:string)=>Promise<unknown>;tools?:React.ReactNode;disabled?:boolean;saveDisabled?:boolean}){
  const id=useId(),form=useRef<HTMLFormElement>(null),input=useRef<HTMLTextAreaElement>(null),list=useRef<HTMLDivElement>(null),composing=useRef(false),before=useRef({value:'',start:0,end:0});
  const [index,setIndex]=useState<number|null>(null),[saving,setSaving]=useState(false);
  const discussionHistory=useDiscussionHistory();
  const history=messages.filter(m=>m.author==='user').slice(-50).reverse();
  useLayoutEffect(()=>{const stream=form.current?.previousElementSibling;if(stream instanceof HTMLElement&&stream.classList.contains('wb-messages'))stream.scrollTop=stream.scrollHeight;},[messages.length]);
  useLayoutEffect(()=>{if(index!==null&&list.current){const row=list.current.querySelector<HTMLElement>('[aria-selected=true]');if(row)revealNeighbour(list.current,row);}},[index]);
  const close=(restore:boolean)=>{setIndex(null);if(restore){onChange(before.current.value);requestAnimationFrame(()=>input.current?.setSelectionRange(before.current.start,before.current.end));}};
  const choose=(at:number)=>{const message=history[at];if(!message)return;onChange(message.text);setIndex(null);requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(message.text.length,message.text.length);});};
  // The draft owner reconciles identity/scope and clears the controlled value.
  // Presentation must not clear again or erase its confirmed save notice.
  return <form ref={form} className="wb-thinking-composer" onSubmit={event=>{event.preventDefault();if(composing.current||saving||disabled||saveDisabled||!value.trim())return;setSaving(true);const submitted=value;void onSave(submitted).catch(()=>{}).finally(()=>setSaving(false));}}>
    {tools&&<div className="wb-composer-tools">{tools}</div>}
    <HaloTextarea surfaceClassName="wb-composer-control" ref={input} aria-label="继续共同思考" aria-haspopup={discussionHistory?"dialog":"listbox"} aria-expanded={discussionHistory?discussionHistory.expanded:index!==null} aria-controls={!discussionHistory&&index!==null?id:undefined} aria-activedescendant={index!==null?id+'-'+index:undefined} value={value} readOnly={disabled} onChange={event=>{close(false);onChange(event.target.value);}} placeholder="写下问题或想法" onCompositionStart={()=>{composing.current=true;close(false);}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={event=>{
      if(composing.current||event.nativeEvent.isComposing||event.nativeEvent.keyCode===229||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
      if(discussionHistory&&event.key==='ArrowUp'&&value===''&&history.length){event.preventDefault();discussionHistory.open();return;}
      if(index===null){if(event.key==='ArrowUp'&&value===''&&history.length){event.preventDefault();before.current={value,start:event.currentTarget.selectionStart,end:event.currentTarget.selectionEnd};setIndex(0);}return;}
      if(['ArrowUp','ArrowDown','Home','End','Enter','Escape'].includes(event.key)){event.preventDefault();event.stopPropagation();if(event.key==='Escape')close(true);else if(event.key==='Enter')choose(index);else setIndex(event.key==='Home'?0:event.key==='End'?history.length-1:Math.max(0,Math.min(history.length-1,index+(event.key==='ArrowDown'?1:-1))));}
      else if(event.key==='Tab')close(false);
    }} onBlur={event=>{if(!event.currentTarget.form?.contains(event.relatedTarget))close(false);}}/>
    {index!==null&&<div ref={list} id={id} role="listbox" aria-label="历史输入" className="wb-input-history">{history.map((message,at)=><div key={message.id} id={id+'-'+at} role="option" aria-selected={at===index} onPointerDown={event=>event.preventDefault()} onClick={()=>choose(at)}>{message.text}</div>)}</div>}
    <div><button className="wb-button wb-primary" type="submit" disabled={disabled||saveDisabled||saving||!value.trim()}>{saving?'正在保存…':'留下这段思考'}</button></div>
  </form>;
}

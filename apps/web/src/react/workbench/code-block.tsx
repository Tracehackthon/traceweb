import React,{useId,useRef,useState} from 'react';
import './execution-view.css';

export function CodeBlock({code,language='text',title='代码'}:{code:string;language?:string;title?:string}) {
  const id=useId(),pre=useRef<HTMLPreElement>(null),[tab,setTab]=useState(0),[notice,setNotice]=useState('');
  // Only explicit fenced blocks are projected; the complete original is always available.
  const tabs=[{label:'完整原文',code,language}];
  const fence=/^```([\w+-]*)[^\r\n]*\r?\n([\s\S]*?)^```\s*$/gm;let match:RegExpExecArray|null;
  while((match=fence.exec(code))&&tabs.length<17)tabs.push({label:`代码段 ${tabs.length}`,code:match[2],language:match[1]||'text'});
  const active=Math.min(tab,tabs.length-1),selected=tabs[active],latest=useRef(selected.code);latest.current=selected.code;
  const select=(index:number)=>{setTab(index);setNotice('');};
  return <section className="wb-code-block" aria-label={title}><header><span>{title}</span><span className="wb-code-language">{selected.language}</span><button type="button" className="wb-button" aria-label="复制当前代码" onClick={()=>{const text=selected.code;void (async()=>{try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(text);if(latest.current===text)setNotice('已复制当前代码');}catch{if(latest.current===text)setNotice('复制未完成，请选中代码手动复制。');}})();}}>复制</button></header>
    {tabs.length>1&&<div className="wb-code-tabs" role="tablist" aria-label="代码内容">{tabs.map((item,index)=><button type="button" key={index} role="tab" id={id+'-tab-'+index} aria-controls={id+'-panel'} aria-selected={active===index} tabIndex={active===index?0:-1} onClick={()=>select(index)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(active+(e.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length;select(next);requestAnimationFrame(()=>document.getElementById(id+'-tab-'+next)?.focus());}}}>{item.label}</button>)}</div>}
    <pre ref={pre} className="wb-code-body" tabIndex={0} role={tabs.length>1?'tabpanel':undefined} id={id+'-panel'} aria-labelledby={tabs.length>1?id+'-tab-'+active:undefined}><code>{selected.code}</code></pre>
    {notice&&<p role="status">{notice}{notice.startsWith('复制未完成')&&<button type="button" className="wb-button" onClick={()=>{if(pre.current){const range=document.createRange();range.selectNodeContents(pre.current);const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);pre.current.focus();}}}>选中代码</button>}</p>}
  </section>;
}

export function MaterialText({text,kind,fileName}:{text:string;kind:string;fileName?:string}) {
  const extension=fileName?.split('.').pop()?.toLowerCase(),language=({js:'javascript',mjs:'javascript',ts:'typescript',tsx:'tsx',py:'python',json:'json',sh:'bash',css:'css',html:'html'} as Record<string,string>)[extension||'']||'text';
  return kind==='code'||/^```/m.test(text)?<CodeBlock code={text} language={language} title="材料代码"/>:<p className="wb-preserve">{text||'还没有文字摘录。'}</p>;
}

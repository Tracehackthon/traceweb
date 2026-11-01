import React, {useRef, useLayoutEffect} from 'react'
import {ArrowUp, Check, CircleAlert, LoaderCircle, RotateCcw} from 'lucide-react'

export type CaptureReceipt = {kind:'idle'|'saving'|'saved'|'error'; text:string}
export function CompanionComposer({draft,onChange,onSave,busy,pendingText,receipt,storageError='',conflict=false,onReconcile,rejected=false,onRelease,archives=[]}:{
  draft:string; onChange:(text:string)=>void; onSave:()=>void; busy:boolean;
  pendingText?:string; receipt:CaptureReceipt; storageError?:string;conflict?:boolean;onReconcile?:()=>void;rejected?:boolean;onRelease?:()=>void;archives?:{text:string;commandId:string}[];
}) {
  const input=useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(()=>{const e=input.current;if(e){e.style.height='auto';e.style.height=Math.min(160,Math.max(88,e.scrollHeight))+'px'}},[draft])
  const pending=pendingText!==undefined
  return <form className="trace-compose" aria-label="随手记录" aria-busy={busy} onSubmit={e=>{e.preventDefault();if(!busy&&!storageError&&(pending||draft.trim()))onSave()}}>
    <label className="trace-label" htmlFor="trace-companion-draft">此刻，想留下什么？</label>
    <div className="trace-compose-surface">
      <textarea ref={input} id="trace-companion-draft" aria-label="此刻的想法" value={draft} rows={3} placeholder="一句灵感，或一段还没想清楚的话…" onChange={e=>onChange(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form?.requestSubmit()}}}/>
      <div className="trace-compose-toolbar"><small>{storageError?'尚未写入设备，请先复制':pending?'新输入仍是草稿':draft?'草稿留在这台设备':'不必整理，先留下来'}</small><button className="trace-submit" type="submit" disabled={busy||Boolean(storageError)||(!pending&&!draft.trim())} aria-label={pending?'重试原请求':'保存记录'}>{busy?<LoaderCircle className="trace-spinner"/>:pending?<RotateCcw/>:<ArrowUp/>}<span>{busy?'保存中':pending?'重试原请求':'保存记录'}</span></button></div>
    </div>
    <div className="trace-compose-meta"><span>Enter 换行</span><kbd>Ctrl ↵ 保存</kbd></div>
    {pending&&<details className="trace-pending-original"><summary>待确认的原请求</summary><p>{pendingText}</p><small>重试只提交这段原文，不包含后来的修改。</small></details>}
    {rejected&&<button type="button" className="trace-button" disabled={busy} onClick={onRelease}>保留原文，解除这次请求</button>}
    {archives.length>0&&<details className="trace-pending-original"><summary>未提交原文（{archives.length}）</summary>{archives.map(item=><p key={item.commandId}>{item.text}</p>)}</details>}
    {conflict&&<button type="button" className="trace-button" disabled={busy} onClick={onReconcile}>核对最新版本后，保存原请求</button>}
    {(storageError||receipt.kind!=='idle')&&<div className={`trace-receipt trace-receipt-${storageError?'error':receipt.kind}`} role={storageError||receipt.kind==='error'?'alert':'status'}>{storageError||receipt.kind==='error'?<CircleAlert/>:receipt.kind==='saved'?<Check/>:<LoaderCircle className="trace-spinner"/>}<span>{storageError||receipt.text}</span></div>}
  </form>
}

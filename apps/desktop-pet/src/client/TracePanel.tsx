import React,{useEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react'
import {Tabs} from 'radix-ui'
import {ArrowUpRight,ChevronLeft,Maximize2,Minimize2,Search} from 'lucide-react'
import {type Observation} from './mock-data'
import {type PetProjection,type TraceCodexApprovalDecision} from './codex-events'
import {CompanionComposer,type CaptureReceipt} from './CompanionComposer'
type Props={open:boolean;requestedView:'request'|'recent'|'write';observations:Observation[];focusedObservationId?:string;onSelect:(id:string)=>void;draft:string;onDraftChange:(value:string)=>void;onSave:()=>void;busy:boolean;pendingText?:string;receipt:CaptureReceipt;storageError:string;conflict:boolean;onReconcile:()=>void;rejected:boolean;onRelease:()=>void;archives:{text:string;commandId:string}[];onAccept:(text:string,source?:string)=>Promise<void>;onContinue:()=>void;onClose:()=>void;onToggleSize:()=>void;discussionNotice:string;compact:boolean;capabilities:any;onCapabilityRequest:(request:Record<string,unknown>)=>Promise<any>;codexProjection:PetProjection;onCodexDecision:(decision:TraceCodexApprovalDecision)=>Promise<void>;onCodexInput:(answers:Record<string,{answers:string[]}>)=>Promise<void>;codexInteractionBusy:boolean;codexInteractionNotice:string;onHeaderPointerDown:(e:ReactPointerEvent<HTMLElement>)=>void;onHeaderPointerMove:(e:ReactPointerEvent<HTMLElement>)=>void;onHeaderPointerUp:(e:ReactPointerEvent<HTMLElement>)=>void}
export function TracePanel({open,requestedView,observations,focusedObservationId,onSelect,draft,onDraftChange,onSave,busy,pendingText,receipt,storageError,conflict,onReconcile,rejected,onRelease,archives,onAccept,onContinue,onClose,onToggleSize,discussionNotice,compact,capabilities,onCapabilityRequest,codexProjection,onCodexDecision,onCodexInput,codexInteractionBusy,codexInteractionNotice,onHeaderPointerDown,onHeaderPointerMove,onHeaderPointerUp}:Props){
  const pendingCodexInteraction=codexProjection.pendingInteraction
  const [tab,setTab]=useState(pendingCodexInteraction?'request':focusedObservationId?'recent':'write'),[query,setQuery]=useState('')
  const [sourceMode,setSourceMode]=useState('zhihu'),[profileId,setProfileId]=useState(''),[capabilityBusy,setCapabilityBusy]=useState(''),[capabilityNotice,setCapabilityNotice]=useState(''),[capabilityError,setCapabilityError]=useState(false),[sourceResults,setSourceResults]=useState<any[]>([]),[agentRun,setAgentRun]=useState<any>(null)
  const [codexAnswers,setCodexAnswers]=useState<Record<string,string>>({}),focusCard=useRef<HTMLElement>(null)
  const wasOpen=useRef(false)
  useEffect(()=>{if(open&&!wasOpen.current)setTab(requestedView);wasOpen.current=open},[open,requestedView])
  const agent=capabilities?.agent,profiles=agent?.profiles||[],focused=observations.find(o=>o.id===focusedObservationId),visible=observations.filter(o=>o.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  useEffect(()=>{setCodexAnswers({})},[pendingCodexInteraction?.interactionId])
  useEffect(()=>{if(!pendingCodexInteraction&&tab==='request')setTab('write')},[pendingCodexInteraction,tab])
  useEffect(()=>{if(tab==='recent')focusCard.current?.scrollIntoView({block:'nearest'})},[tab,focusedObservationId])
  const submitCodexInput=()=>{const answers:Record<string,{answers:string[]}>= {};for(const [id,value]of Object.entries(codexAnswers))if(value.trim())answers[id]={answers:[value.trim()]};if(Object.keys(answers).length)void onCodexInput(answers)}
  const run=async(kind:'search'|'agent')=>{const text=draft.trim()||focused?.text;if(!text){setCapabilityError(true);setCapabilityNotice('先写一句，或在最近记录中选一条。');return}setCapabilityBusy(kind);setCapabilityError(false);setCapabilityNotice(kind==='search'?'正在查找来源…':'正在请求 Agent…');try{const result=await onCapabilityRequest(kind==='search'?{operation:'search',source:sourceMode,query:text,count:3}:{operation:'agent.run',text,source:sourceMode,...(profileId?{profileId}:{})});if(kind==='search'){setSourceResults(result.items||[]);setCapabilityNotice(result.items?.length?'已返回摘要，保存前可先查看原文。':'本次没有返回来源。')}else{setAgentRun(result);setCapabilityError(result.status!=='succeeded');setCapabilityNotice(result.status==='succeeded'?'结果已返回，尚未保存或采用。':result.error?.message||'本次运行未完成。')}}catch(e){setCapabilityError(true);setCapabilityNotice(e instanceof Error?e.message:'本次请求没有完成。')}finally{setCapabilityBusy('')}}
  return <aside className={'trace-panel '+(compact?'trace-panel-compact':'')} role="dialog" aria-modal="false" aria-label="Trace 悬浮窗">
    <header className="trace-surface-header trace-panel-drag-handle" onPointerDown={onHeaderPointerDown} onPointerMove={onHeaderPointerMove} onPointerUp={onHeaderPointerUp} onPointerCancel={onHeaderPointerUp}><div className="trace-brand"><span className="trace-brand-mark" aria-hidden="true">t.</span><div><strong>桌面收集</strong><small>随手记录，慢慢想清楚</small></div></div><div className="trace-window-actions"><button type="button" onClick={onToggleSize} aria-label={compact?'展开悬浮窗':'缩小悬浮窗'}>{compact?<Maximize2/>:<Minimize2/>}</button><button type="button" onClick={onClose} aria-label="返回快速记录"><ChevronLeft/></button></div></header>
    <Tabs.Root className="trace-panel-tabs" value={tab} onValueChange={setTab}><Tabs.List className="trace-segments" aria-label="悬浮窗内容"><Tabs.Trigger value="write">记录</Tabs.Trigger><Tabs.Trigger value="recent">最近 <span>{observations.length}</span></Tabs.Trigger><Tabs.Trigger value="tools">来源与 Agent</Tabs.Trigger>{pendingCodexInteraction&&<Tabs.Trigger value="request">待处理 <span>1</span></Tabs.Trigger>}</Tabs.List><div className="trace-panel-body">
      <Tabs.Content value="write"><CompanionComposer draft={draft} onChange={onDraftChange} onSave={onSave} busy={busy} pendingText={pendingText} receipt={receipt} storageError={storageError} conflict={conflict} onReconcile={onReconcile} rejected={rejected} onRelease={onRelease} archives={archives}/><p className="trace-gentle-note">原话留在本机收集区。需要展开时，再回到完整工作面继续。</p></Tabs.Content>
      <Tabs.Content value="recent"><label className="trace-search-field"><Search aria-hidden="true"/><input aria-label="查找最近记录" placeholder="找一句曾经留下的话" value={query} onChange={e=>setQuery(e.target.value)}/></label><p className="trace-list-caption">最近 {observations.length} 条本机记录 · 匹配 {visible.length} 条</p><div className="trace-observation-list">{visible.length?visible.map(o=><article ref={o.id===focusedObservationId?focusCard:undefined} className={'trace-observation-card '+(o.id===focusedObservationId?'trace-selected':'')} key={o.id}><button type="button" className="trace-record-select" aria-pressed={o.id===focusedObservationId} onClick={()=>onSelect(o.id)}><small>{o.status} · {o.source||'桌面收集'}</small><p>{o.text}</p></button>{o.id===focusedObservationId&&<button className="trace-record-continue" type="button" onClick={onContinue}>继续这条讨论 <ArrowUpRight/></button>}</article>):<p className="trace-empty">{query?'没有找到这句话。试试更短的词。':'这里还空着，先去留一句话吧。'}</p>}</div>{discussionNotice&&<p role="status" className="trace-receipt">{discussionNotice}</p>}</Tabs.Content>
      <Tabs.Content value="tools"><section className="trace-tools-intro"><span className={'trace-connection '+(capabilities?.connected?'trace-connected':'')}>{capabilities?.loading?'正在检查连接':capabilities?.connected?'本机服务已连接':'服务暂未连接'}</span><h3>让思考多一个参照</h3><p>使用当前草稿，或选中的最近记录。搜索会访问外部来源；执行仅在你明确点击后开始。</p></section><label className="trace-field">搜索范围<select aria-label="搜索范围" value={sourceMode} onChange={e=>setSourceMode(e.target.value)} disabled={Boolean(capabilityBusy)}><option value="zhihu">知乎</option><option value="global">全网</option></select></label>{profiles.length>0&&<label className="trace-field">Agent 执行器<select aria-label="Agent 执行器" value={profileId||agent?.defaultProfileId||profiles[0]?.profileId} onChange={e=>setProfileId(e.target.value)} disabled={Boolean(capabilityBusy)}>{profiles.map((p:any)=><option key={p.profileId} value={p.profileId}>{p.label||p.profileId}</option>)}</select></label>}<div className="trace-tool-actions"><button className="trace-button" type="button" disabled={!capabilities?.search?.enabled||Boolean(capabilityBusy)} onClick={()=>void run('search')}>{capabilityBusy==='search'?'查找中…':'查找来源'}</button><button className="trace-button trace-button-primary" type="button" disabled={!agent?.enabled||Boolean(capabilityBusy)} onClick={()=>void run('agent')}>{capabilityBusy==='agent'?'请求中…':'交给 Agent'}</button></div>{!capabilities?.search?.enabled&&<p className="trace-gentle-note">搜索尚未可用，不影响本机记录。</p>}{!agent?.enabled&&<p className="trace-gentle-note">Agent 尚未可用；不会把记录保存冒充 AI 执行。</p>}{(receipt.kind!=='idle'||pendingText!==undefined)&&<div className="trace-tool-save-receipt"><p className={'trace-receipt '+(receipt.kind==='error'?'trace-receipt-error':'')} role={receipt.kind==='error'?'alert':'status'}>{receipt.text||'有一段原请求等待确认。'}</p>{pendingText!==undefined&&<button className="trace-button" disabled={busy} onClick={conflict?onReconcile:onSave}>{conflict?'核对最新版本后，保存原请求':'重试原请求'}</button>}</div>}{capabilityNotice&&<p className={'trace-receipt '+(capabilityError?'trace-receipt-error':'')} role={capabilityError?'alert':'status'}>{capabilityNotice}</p>}{sourceResults.map(item=><article className="trace-source-card" key={item.id}><small>公开来源 · 尚未保存</small><h3>{item.title||'未命名来源'}</h3><p>{item.excerpt}</p><footer>{item.url&&<a href={item.url} target="_blank" rel="noreferrer">查看原文 <ArrowUpRight/></a>}<button type="button" disabled={busy||pendingText!==undefined} onClick={()=>void onAccept(item.excerpt,item.source)}>保存摘要</button></footer></article>)}{agentRun?.result&&<article className="trace-source-card"><small>Agent 返回 · 尚未采用</small><p>{agentRun.result.answer}</p><button disabled={busy||pendingText!==undefined} onClick={()=>void onAccept(agentRun.result.answer,'Agent 返回')}>保存这份回答</button></article>}</Tabs.Content>
      <Tabs.Content value="request">
      {pendingCodexInteraction && (
        <section className="trace-section trace-approval-section" aria-labelledby="trace-approval-title" data-trace-interactive-region="approval">
          <div className="trace-approval-kicker">需要你的决定 · {pendingCodexInteraction.kind === 'input' ? '输入请求' : '操作请求'}</div>
          <h3 id="trace-approval-title">{pendingCodexInteraction.title}</h3>
          <p className="trace-approval-summary">{pendingCodexInteraction.summary}</p>
          <div className="trace-approval-impact">
            <span>将要发生什么</span>
            <strong>{pendingCodexInteraction.impact}</strong>
          </div>
          {pendingCodexInteraction.kind === 'input' ? (
            <>
              <p className="trace-approval-note">这次请求需要回答 Codex 的问题。Trace 只展示安全的问题摘要，不会猜测选项或代填答案。</p>
              {pendingCodexInteraction.questions?.length ? (
                <div className="trace-input-questions" aria-label="Codex 输入问题">
                  {pendingCodexInteraction.questions.map((question) => (
                    <label className="trace-input-question" key={question.id}>
                      <span>{question.header || '需要回答的问题'}</span>
                      <small>{question.question || '请填写你的回答'}</small>
                      <input
                        type={question.isSecret ? 'password' : 'text'}
                        value={codexAnswers[question.id] || ''}
                        onChange={(event) => setCodexAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                        placeholder={question.isSecret ? '不会在 Trace 界面回显' : '填写回答'}
                        autoComplete={question.isSecret ? 'off' : 'on'}
                      />
                    </label>
                  ))}
                </div>
              ) : (
                <p className="trace-approval-disabled">当前请求没有可安全展示的问题，Trace 不会猜测输入格式。</p>
              )}
            </>
          ) : (
            <p className="trace-approval-note">默认不会放行。允许只作用于这一次请求；拒绝当前操作不会代替 Agent 停止，若要中断本轮请明确选择“停止本轮”。</p>
          )}
          {codexInteractionNotice && <p className="trace-approval-notice" role="status">{codexInteractionNotice}</p>}
          {pendingCodexInteraction.kind === 'input' ? (
            <div className="trace-approval-actions">
              <button
                className="trace-button trace-button-primary"
                type="button"
                disabled={codexInteractionBusy || !onCodexInput || !pendingCodexInteraction.recoverable || !Object.values(codexAnswers).some((answer) => answer.trim())}
                onClick={submitCodexInput}
              >
                {codexInteractionBusy ? '正在提交…' : '提交回答'}
              </button>
              <button
                className="trace-button trace-button-secondary trace-approval-reject"
                type="button"
                disabled={codexInteractionBusy || !onCodexDecision || !pendingCodexInteraction.recoverable}
                onClick={() => void onCodexDecision?.('cancel')}
              >
                停止本轮
              </button>
            </div>
          ) : (
            <div className="trace-approval-actions">
              <button
                className="trace-button trace-button-secondary trace-approval-reject"
                type="button"
                disabled={codexInteractionBusy || !onCodexDecision || !pendingCodexInteraction.recoverable}
                onClick={() => void onCodexDecision?.('decline')}
              >
                {codexInteractionBusy ? '正在提交…' : '拒绝此操作'}
              </button>
              <button
                className="trace-button trace-button-quiet trace-approval-cancel"
                type="button"
                disabled={codexInteractionBusy || !onCodexDecision || !pendingCodexInteraction.recoverable}
                onClick={() => void onCodexDecision?.('cancel')}
              >
                停止本轮
              </button>
              <button
                className="trace-button trace-button-primary"
                type="button"
                disabled={codexInteractionBusy || !onCodexDecision || !pendingCodexInteraction.recoverable}
                onClick={() => void onCodexDecision?.('accept')}
              >
                允许这一次
              </button>
            </div>
          )}
          {!pendingCodexInteraction.recoverable && (
            <p className="trace-approval-disabled" role="status">
              {pendingCodexInteraction.state === 'expired'
                ? '这条请求已经过期，Trace 不会继续提交。请重新触发当前 Codex 操作。'
                : pendingCodexInteraction.state === 'conflict'
                  ? '这条请求的运行版本已经变化，请刷新当前 Codex 状态后再决定。'
                  : '这条请求当前不可恢复，Trace 不会猜测或重复提交。'}
            </p>
          )}
          {!pendingCodexInteraction.runId && <small className="trace-approval-disabled">这条请求缺少可恢复的运行身份，Trace 不会猜测目标。</small>}
        </section>
      )}

      </Tabs.Content>
    </div></Tabs.Root>
    <footer className="trace-surface-footer"><span>拖动标题可移动</span><span>Esc 收起 · 草稿保留</span></footer>
  </aside>
}

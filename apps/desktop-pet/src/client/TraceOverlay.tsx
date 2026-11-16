import React, {useEffect,useRef,useState,type CSSProperties,type PointerEvent as ReactPointerEvent} from 'react'
import {Tabs} from 'radix-ui'
import {ArrowUpRight,Check,Clock3,Maximize2,Minus,X} from 'lucide-react'
import sitImage from './assets/pet/sit_A.png'
import {createInitialTraceCodexState,normalizeTraceCodexEvent,projectTraceCodexState,reduceTraceCodexEvent,type TraceCodexApprovalDecision,type TraceCodexInteraction} from './codex-events'
import {type Observation} from './mock-data'
import {CompanionComposer,type CaptureReceipt} from './CompanionComposer'
import {TracePanel} from './TracePanel'

type Point={x:number;y:number}
type PendingCapture={commandId:string;matterId:string;expectedRevision:number;text:string;source:string;previous?:{commandId:string;expectedRevision:number}[];rejected?:boolean}
type NativeBridge={requestCapability?:(request:Record<string,unknown>)=>Promise<any>;openDiscussion?:(url:string)=>void;getPlacement?:()=>Promise<Point|null>;savePlacement?:(position:Point&{placement:string;isFreelyPositioned:boolean})=>Promise<void>;onCodexEvent?:(listener:(event:unknown)=>void)=>(()=>void)|undefined;onCandidate?:(listener:(event:unknown)=>void)=>(()=>void)|undefined}
const bridge=()=> (window as Window&{traceNative?:NativeBridge}).traceNative
const draftKey='trace-companion:v2:draft',pendingKey='trace-companion:v2:pending',archiveKey='trace-companion:v2:rejected'
const pet={width:92,height:116},inset=16
const viewport=()=>({width:window.innerWidth,height:window.innerHeight})
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(value,Math.max(min,max)))
const safePet=(p:Point,v=viewport())=>({x:clamp(p.x,8,v.width-pet.width-8),y:clamp(p.y,8,v.height-pet.height-8)})
function initialDraft(){try{const text=localStorage.getItem(draftKey);return{text:text||'',error:''}}catch{return{text:'',error:'本地草稿无法读取。为避免丢稿，暂不提交，请检查设备存储。'}}}
function initialPending():{value:PendingCapture|null;error:string}{try{const raw=localStorage.getItem(pendingKey);if(!raw)return{value:null,error:''};const p=JSON.parse(raw);if(typeof p.commandId!=='string'||typeof p.matterId!=='string'||typeof p.text!=='string'||typeof p.source!=='string'||!Number.isSafeInteger(p.expectedRevision))throw Error();return{value:p,error:''}}catch{return{value:null,error:'未确认请求无法读取，原记录未覆盖。请保留设备数据后再处理。'}}}
function placeSurface(p:Point,v:{width:number;height:number},expanded:boolean){const width=Math.min(expanded?460:352,v.width-32),height=Math.min(expanded?620:440,v.height-32);const left=p.x-width-12,right=p.x+pet.width+12;const x=left>=inset?left:right+width<=v.width-inset?right:clamp(p.x+pet.width/2-width/2,inset,v.width-width-inset);return{left:x,top:clamp(p.y+pet.height-height,inset,v.height-height-inset),width,maxHeight:height} as CSSProperties}
export function TraceOverlay(){
  const [v,setV]=useState(viewport),[position,setPosition]=useState<Point>(()=>safePet({x:window.innerWidth-114,y:window.innerHeight-124}))
  const [surface,setSurface]=useState<'closed'|'quick'|'panel'>('closed'),[shelf,setShelf]=useState('write'),[expanded,setExpanded]=useState(false)
  const [detached,setDetached]=useState<Point|null>(null),petButton=useRef<HTMLButtonElement>(null),surfaceRef=useRef<HTMLDivElement>(null),panelRef=useRef<HTMLDivElement>(null)
  const [draftState]=useState(initialDraft),[pendingState]=useState(initialPending),[draft,setDraft]=useState(draftState.text),draftRef=useRef(draft)
  const [pending,setPending]=useState<PendingCapture|null>(pendingState.value),pendingRef=useRef(pending),[busy,setBusy]=useState(false),inFlight=useRef(false)
  const [conflict,setConflict]=useState(false),[rejected,setRejected]=useState(pendingState.value?.rejected===true),[archives,setArchives]=useState<{text:string;commandId:string}[]>(()=>{try{const raw=JSON.parse(localStorage.getItem(archiveKey)||'[]');return Array.isArray(raw)?raw.filter(x=>typeof x?.text==='string'&&typeof x?.commandId==='string'):[]}catch{return[]}})
  const [storageError,setStorageError]=useState(draftState.error||pendingState.error),[receipt,setReceipt]=useState<CaptureReceipt>({kind:pendingState.value?'error':'idle',text:pendingState.value?'上次保存尚未确认。草稿和原请求都在，可手动重试。':''})
  const [observations,setObservations]=useState<Observation[]>([]),[readError,setReadError]=useState(''),[reading,setReading]=useState(true),[focusedObservationId,setFocusedObservationId]=useState<string>()
  const [capabilities,setCapabilities]=useState<any>({connected:false,loading:true}),[discussionNotice,setDiscussionNotice]=useState('')
  const [codexState,setCodexState]=useState(createInitialTraceCodexState),codexProjection=projectTraceCodexState(codexState)
  const [codexInteractionBusy,setCodexInteractionBusy]=useState(false),[codexInteractionNotice,setCodexInteractionNotice]=useState('')
  const codexDecisionInFlightRef=useRef(false),codexInteractionKeysRef=useRef(new Map<string,{key:string;fingerprint:string}>())
  const drag=useRef<{id:number;start:Point;origin:Point;target:'pet'|'panel';moved:boolean}|null>(null),suppressClick=useRef(false)
  const requestCapability=async(request:Record<string,unknown>)=>{if(!bridge()?.requestCapability)throw Error('本机服务尚未连接，草稿仍保留。');return bridge()!.requestCapability!(request)}
  const updateDraft=(text:string)=>{try{localStorage.setItem(draftKey,text);setStorageError(pendingState.error)}catch{setStorageError('草稿未能写入设备，请先复制输入内容；这次不会提交。')}draftRef.current=text;setDraft(text);if(!pendingRef.current)setReceipt({kind:'idle',text:''})}
  const refresh=async()=>{setReading(true);try{const value=await requestCapability({operation:'workspace.summary'});if(!Array.isArray(value.observations))throw Error('记录未能完整读取');setObservations(value.observations);setReadError('')}catch(e){setReadError(e instanceof Error?e.message:'记录暂时无法读取，已显示内容保留。')}finally{setReading(false)}}
  useEffect(()=>{void refresh();let active=true;void requestCapability({operation:'capabilities'}).then(value=>{if(active)setCapabilities({...value,loading:false})},()=>{if(active)setCapabilities({connected:false,loading:false})});const interval=window.setInterval(()=>void refresh(),10000);return()=>{active=false;window.clearInterval(interval)}},[])
  useEffect(()=>{const resize=()=>{setV(viewport());setPosition(p=>safePet(p));setDetached(null)};window.addEventListener('resize',resize);void bridge()?.getPlacement?.().then(p=>{if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y))setPosition(safePet(p))}).catch(()=>{});return()=>window.removeEventListener('resize',resize)},[])
  useEffect(()=>bridge()?.onCodexEvent?.(raw=>{const event=normalizeTraceCodexEvent(raw);if(event)setCodexState(s=>reduceTraceCodexEvent(s,event))}),[])
  useEffect(()=>bridge()?.onCandidate?.(()=>void refresh()),[])
  const close=()=>{setSurface('closed');setDetached(null);petButton.current?.focus({preventScroll:true})}
  useEffect(()=>{if(surface==='closed')return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!e.isComposing&&!e.defaultPrevented){e.preventDefault();close()}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[surface])
  useEffect(()=>{if(surface!=='closed')requestAnimationFrame(()=>{(surface==='panel'?panelRef.current:surfaceRef.current)?.querySelector<HTMLElement>('[data-companion-focus],textarea')?.focus({preventScroll:true})})},[surface])
  const saveCapture=async(text=draftRef.current,source='桌宠随手记录')=>{
    if(inFlight.current||storageError)return
    if(!text.trim()&&!pendingRef.current)return
    if(!pendingRef.current&&text.trim().length>1_000_000){setReceipt({kind:'error',text:'这一段超过100万字符，尚未提交。请先复制保留原文，再分段记录。'});return}
    inFlight.current=true;setBusy(true);setReceipt({kind:'saving',text:'正在保存到本机收集区…'})
    try{
      let command=pendingRef.current
      if(!command){const summary=await requestCapability({operation:'workspace.summary'});if(!Number.isSafeInteger(summary.revision))throw Error('无法确认当前保存版本，请重试。');const id=crypto.randomUUID();command={commandId:'pet-capture-'+id,matterId:'pet-'+id,expectedRevision:summary.revision,text:text.trim(),source};localStorage.setItem(pendingKey,JSON.stringify(command));pendingRef.current=command;setPending(command)}
      const result=await requestCapability({operation:'product.command',protocolVersion:1,commandId:command.commandId,expectedRevision:command.expectedRevision,operations:[{type:'capture.create',matterId:command.matterId,text:command.text}]})
      if(result.ok===false){setConflict(result.status===409);if([400,413,415,422].includes(result.status)){const denied={...command,rejected:true};localStorage.setItem(pendingKey,JSON.stringify(denied));pendingRef.current=denied;setPending(denied);setRejected(true)}throw Error(result.status===409?'已保存版本发生变化。原请求与当前草稿都保留，请核对版本后再试。':result.error?.message||'这次保存没有完成。')}
      const matter=result.host?.chain?.matters?.find((m:any)=>m.id===command!.matterId)
      if(!matter||matter.originalText!==command.text)throw Error('保存回执尚未确认，原请求仍保留。')
      localStorage.removeItem(pendingKey);pendingRef.current=null;setPending(null);setConflict(false);setRejected(false)
      if(draftRef.current.trim()===command.text){updateDraft('');setReceipt({kind:'saved',text:'已保存到本机收集区。'})}else setReceipt({kind:'saved',text:'原请求已保存；后来的输入仍是草稿。'})
      setFocusedObservationId(matter.id);void refresh()
    }catch(e){setReceipt({kind:'error',text:e instanceof Error?e.message:'保存尚未确认，草稿与原请求保留。'})}finally{inFlight.current=false;setBusy(false)}
  }
  const releaseRejected=()=>{const command=pendingRef.current;if(!command?.rejected||inFlight.current)return;try{const raw=JSON.parse(localStorage.getItem(archiveKey)||'[]');if(!Array.isArray(raw))throw Error();const retained=raw.some((item:any)=>item.commandId===command.commandId)?raw:[...raw,command];localStorage.setItem(archiveKey,JSON.stringify(retained));localStorage.removeItem(pendingKey);pendingRef.current=null;setPending(null);setArchives(retained);setRejected(false);setReceipt({kind:'idle',text:''})}catch{setReceipt({kind:'error',text:'原请求暂时无法归档，仍保留在原位，没有解除。'})}}
  const reconcileCapture=async()=>{if(inFlight.current||!pendingRef.current)return;inFlight.current=true;setBusy(true);let ready=false;try{const summary=await requestCapability({operation:'workspace.summary'});if(!Number.isSafeInteger(summary.revision))throw Error('当前版本未能读取。');const original=pendingRef.current,updated={...original,commandId:'pet-capture-'+crypto.randomUUID(),expectedRevision:summary.revision,previous:[...(original.previous||[]),{commandId:original.commandId,expectedRevision:original.expectedRevision}].slice(-10)};localStorage.setItem(pendingKey,JSON.stringify(updated));pendingRef.current=updated;setPending(updated);setConflict(false);setReceipt({kind:'idle',text:''});ready=true;}catch(e){setReceipt({kind:'error',text:e instanceof Error?e.message:'版本核对未完成。'})}finally{inFlight.current=false;setBusy(false)}if(ready)void saveCapture()}
  const continueDiscussion=(id?:string)=>{const item=observations.find(o=>o.id===(id||focusedObservationId))||observations[0];if(!item){setDiscussionNotice('先选择一条已保存记录。');return}const url=new URL('http://127.0.0.1:4173/');url.searchParams.set('from','trace-native');url.searchParams.set('observationId',item.id);url.searchParams.set('text',item.text);url.searchParams.set('status',item.status);url.searchParams.set('source',item.source||'桌面收集');if(bridge()?.openDiscussion){bridge()!.openDiscussion!(url.toString());setDiscussionNotice('已请求打开这条记录的讨论。')}else setDiscussionNotice('当前宿主未连接原生讨论窗口。')}
  const interactionFingerprint = (answers: Record<string, { answers: string[] }>) => JSON.stringify(
    Object.keys(answers).sort().map((questionId) => [questionId, answers[questionId]?.answers ?? []]),
  )

  const idempotencyKeyFor = (scope: string, fingerprint = '') => {
    const current = codexInteractionKeysRef.current.get(scope)
    if (current?.fingerprint === fingerprint) return current.key
    const key = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `trace-${Date.now()}-${Math.random().toString(36).slice(2)}`
    codexInteractionKeysRef.current.set(scope, { key, fingerprint })
    while (codexInteractionKeysRef.current.size > 32) {
      codexInteractionKeysRef.current.delete(codexInteractionKeysRef.current.keys().next().value as string)
    }
    return key
  }

  const decideCodexInteraction = async (decision: TraceCodexApprovalDecision) => {
    if (codexDecisionInFlightRef.current) return
    const interaction: TraceCodexInteraction | null = codexProjection.pendingInteraction
    if (!interaction) return
    if (interaction.kind !== 'approval') {
      if (decision !== 'cancel') {
        setCodexInteractionNotice('这类请求需要填写问题答案，Trace 不会把批准决定误当成输入。')
        return
      }
      if (!interaction.runId) {
        setCodexInteractionNotice('这条输入请求缺少可恢复的运行身份，Trace 没有猜测目标。')
        return
      }
      codexDecisionInFlightRef.current = true
      setCodexInteractionBusy(true)
      setCodexInteractionNotice('正在停止本轮运行…')
      try {
        await requestCapability({ operation: 'agent.run.cancel', runId: interaction.runId })
        setCodexInteractionNotice('已停止本轮运行。')
        const resolved = normalizeTraceCodexEvent({
          eventId: `${interaction.runId}:${interaction.interactionId}:cancel`,
          type: 'runtime.interaction.resolved',
          runId: interaction.runId,
          threadId: interaction.threadId || undefined,
          turnId: interaction.turnId || undefined,
          itemId: interaction.itemId || undefined,
          data: { state: 'cancelled', status: 'cancelled', interaction: { interactionId: interaction.interactionId } },
        })
        if (resolved) setCodexState((current) => reduceTraceCodexEvent(current, resolved))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setCodexInteractionNotice(/409|conflict|revision|stale|expired|already.?handled|已处理|版本/i.test(message)
          ? '这条输入请求已经结束或版本发生变化，请刷新当前状态。'
          : message)
      } finally {
        codexDecisionInFlightRef.current = false
        setCodexInteractionBusy(false)
      }
      return
    }
    if (!interaction.runId || interaction.expectedRevision === null) {
      setCodexInteractionNotice('这条审批缺少可恢复的运行版本，Trace 已保持拒绝。请重新打开当前 Codex 任务。')
      return
    }
    if (!interaction.recoverable) {
      setCodexInteractionNotice('这条审批已经过期或不可恢复，Trace 没有继续提交。')
      return
    }
    if (interaction.expiresAt !== null && interaction.expiresAt <= Date.now()) {
      setCodexInteractionNotice('这条审批已经过期，Trace 没有继续提交。请重新触发当前 Codex 操作。')
      return
    }
    codexDecisionInFlightRef.current = true
    setCodexInteractionBusy(true)
    setCodexInteractionNotice(
      decision === 'accept'
        ? '正在提交允许决定…'
        : decision === 'cancel'
          ? '正在提交停止本轮…'
          : '正在提交拒绝决定…',
    )
    const idempotencyScope = `${interaction.interactionId}:approval:${interaction.expectedRevision}:${decision}`
    const idempotencyKey = idempotencyKeyFor(idempotencyScope)
    try {
      await requestCapability({
        operation: 'agent.run.approval',
        runId: interaction.runId,
        interactionId: interaction.interactionId,
        expectedRevision: interaction.expectedRevision,
        idempotencyKey,
        decision,
      })
      setCodexInteractionNotice(
        decision === 'accept'
          ? '已允许这一次，正在继续。'
          : decision === 'cancel'
            ? '已停止本轮运行。'
            : '已拒绝这次操作，Agent 可以继续处理其它步骤。',
      )
      codexInteractionKeysRef.current.delete(idempotencyScope)
      // The runtime emits runtime.approval.resolved as the authoritative
      // event.  Optimistically clear only after the endpoint accepted the
      // idempotent decision; a later event can still move the session to a
      // terminal/review state without re-opening the prompt.
      const resolved = normalizeTraceCodexEvent({
        eventId: `${interaction.runId}:${interaction.interactionId}:${decision}`,
        type: 'runtime.approval.resolved',
        runId: interaction.runId,
        threadId: interaction.threadId || undefined,
        turnId: interaction.turnId || undefined,
        itemId: interaction.itemId || undefined,
        data: {
          interaction: { interactionId: interaction.interactionId },
          status: decision === 'accept' || decision === 'accept_for_session'
            ? 'accepted'
            : decision === 'cancel'
              ? 'cancelled'
              : 'declined',
        },
      })
      if (resolved) setCodexState((current) => reduceTraceCodexEvent(current, resolved))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setCodexInteractionNotice(/409|conflict|revision|stale|expired|already.?handled|已处理|版本/i.test(message)
        ? '这条审批已经被处理、过期或版本发生变化，请刷新当前状态。'
        : message)
    } finally {
      codexDecisionInFlightRef.current = false
      setCodexInteractionBusy(false)
    }
  }

  const submitCodexInput = async (answers: Record<string, { answers: string[] }>) => {
    if (codexDecisionInFlightRef.current) return
    const interaction: TraceCodexInteraction | null = codexProjection.pendingInteraction
    if (!interaction || interaction.kind !== 'input') return
    if (!interaction.runId || interaction.expectedRevision === null) {
      setCodexInteractionNotice('这条输入请求缺少可恢复的运行版本，Trace 没有猜测目标。')
      return
    }
    if (!interaction.recoverable || (interaction.expiresAt !== null && interaction.expiresAt <= Date.now())) {
      setCodexInteractionNotice('这条输入请求已经过期或不可恢复，请重新触发当前 Codex 操作。')
      return
    }
    codexDecisionInFlightRef.current = true
    setCodexInteractionBusy(true)
    setCodexInteractionNotice('正在提交回答…')
    const idempotencyScope = `${interaction.interactionId}:input:${interaction.expectedRevision}`
    const idempotencyKey = idempotencyKeyFor(idempotencyScope, interactionFingerprint(answers))
    try {
      await requestCapability({
        operation: 'agent.run.input',
        runId: interaction.runId,
        interactionId: interaction.interactionId,
        expectedRevision: interaction.expectedRevision,
        idempotencyKey,
        answers,
      })
      setCodexInteractionNotice('已提交回答，正在继续。')
      codexInteractionKeysRef.current.delete(idempotencyScope)
      const resolved = normalizeTraceCodexEvent({
        eventId: `${interaction.runId}:${interaction.interactionId}:input`,
        type: 'runtime.interaction.resolved',
        runId: interaction.runId,
        threadId: interaction.threadId || undefined,
        turnId: interaction.turnId || undefined,
        itemId: interaction.itemId || undefined,
        data: { state: 'resolved', status: 'resolved', interaction: { interactionId: interaction.interactionId } },
      })
      if (resolved) setCodexState((current) => reduceTraceCodexEvent(current, resolved))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setCodexInteractionNotice(/409|conflict|revision|stale|expired|already.?handled|已处理|版本/i.test(message)
        ? '这条输入请求已经被处理、过期或版本发生变化，请刷新当前状态。'
        : message)
    } finally {
      codexDecisionInFlightRef.current = false
      setCodexInteractionBusy(false)
    }
  }


  const openPanel=(id?:string)=>{setFocusedObservationId(id);setSurface('panel');setDetached(null)}
  const pointerDown=(e:ReactPointerEvent<HTMLElement>,target:'pet'|'panel')=>{if(e.button!==0||(target==='panel'&&(e.target as HTMLElement).closest('button,a,input')))return;suppressClick.current=false;drag.current={id:e.pointerId,start:{x:e.clientX,y:e.clientY},origin:target==='pet'?position:{x:Number(surfaceStyle.left),y:Number(surfaceStyle.top)},target,moved:false};e.currentTarget.setPointerCapture(e.pointerId)}
  const pointerMove=(e:ReactPointerEvent<HTMLElement>)=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;const dx=e.clientX-d.start.x,dy=e.clientY-d.start.y;if(Math.hypot(dx,dy)>5)d.moved=true;if(!d.moved)return;const p={x:d.origin.x+dx,y:d.origin.y+dy};if(d.target==='pet')setPosition(safePet(p));else setDetached({x:clamp(p.x,inset,v.width-Number(surfaceStyle.width)-inset),y:clamp(p.y,inset,v.height-Number(surfaceStyle.maxHeight)-inset)})}
  const pointerUp=(e:ReactPointerEvent<HTMLElement>)=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;const cancelled=e.type==='pointercancel';if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);drag.current=null;suppressClick.current=d.moved;if(d.moved&&d.target==='pet'&&!cancelled)void bridge()?.savePlacement?.({...safePet({x:d.origin.x+e.clientX-d.start.x,y:d.origin.y+e.clientY-d.start.y}),placement:'free',isFreelyPositioned:true}).catch(()=>setDiscussionNotice('位置未能保存，下次将使用原位置。'))}
  const surfaceStyle={...placeSurface(position,v,surface==='panel'&&expanded),...(detached?{left:detached.x,top:detached.y}:{})}
  return <div data-trace-geometry="true" className="trace-overlay" style={{left:position.x,top:position.y}}>
    {surface==='closed'&&codexProjection.status!=='idle'&&<button type="button" className={'trace-status-bubble '+(codexProjection.pendingInteraction?'trace-status-attention':'')} style={{...placeSurface(position,v,false),width:Math.min(280,v.width-32),top:clamp(position.y-84,inset,v.height-120)}} data-trace-interactive-region="status" onClick={()=>openPanel()}><span>{codexProjection.label}</span><strong>{codexProjection.pendingInteraction?'有一条请求，需要你决定':codexProjection.title}</strong><ArrowUpRight aria-hidden="true"/></button>}
    {surface==='quick'&&<div ref={surfaceRef} className="trace-companion-surface trace-quick-surface" style={surfaceStyle} data-trace-interactive-region="quick" role="dialog" aria-label="Trace 随手记录" aria-modal="false">
      <header className="trace-surface-header"><div className="trace-brand"><span className="trace-brand-mark" aria-hidden="true">t.</span><div><strong>Trace</strong><small>在这里，留住一闪而过</small></div></div><div className="trace-window-actions"><button type="button" onClick={()=>openPanel()} aria-label="打开 Trace 悬浮窗" title="打开悬浮窗"><Maximize2/></button><button type="button" onClick={close} aria-label="收起 Trace" title="收起，保留草稿"><X/></button></div></header>
      <Tabs.Root value={shelf} onValueChange={setShelf}><Tabs.List className="trace-segments" aria-label="桌面内容"><Tabs.Trigger value="write">写一句</Tabs.Trigger><Tabs.Trigger value="recent">最近记录 <span>{observations.length}</span></Tabs.Trigger></Tabs.List><Tabs.Content value="write"><CompanionComposer draft={draft} onChange={updateDraft} onSave={()=>void saveCapture()} busy={busy} pendingText={pending?.text} receipt={receipt} storageError={storageError} conflict={conflict} onReconcile={()=>void reconcileCapture()} rejected={rejected} onRelease={releaseRejected} archives={archives}/></Tabs.Content><Tabs.Content value="recent"><div className="trace-shelf-list" aria-label="最近记录">{reading&&observations.length===0?<p className="trace-empty">正在读取本机记录…</p>:observations.length?observations.slice(0,5).map(item=><button className="trace-shelf-item" key={item.id} onClick={()=>openPanel(item.id)}><Clock3/><span><strong>{item.text}</strong><small>{item.status} · {item.source||'桌面收集'}</small></span><ArrowUpRight/></button>):<p className="trace-empty">还没有记录。<br/>不必想完整，从一句话开始。</p>}</div></Tabs.Content></Tabs.Root>
      {readError&&<div className="trace-read-error" role="status">记录暂时未更新，已有内容仍保留。<button onClick={()=>void refresh()}>重新读取</button></div>}
      <footer className="trace-surface-footer"><span><Check/>仅保存在本机</span><button type="button" onClick={()=>openPanel()}>打开悬浮窗 <ArrowUpRight/></button></footer>
    </div>}
    <div ref={panelRef} hidden={surface!=='panel'} className="trace-detail-panel" style={surfaceStyle} data-trace-interactive-region="panel"><TracePanel open={surface==='panel'} requestedView={codexProjection.pendingInteraction?'request':focusedObservationId?'recent':'write'} observations={observations} focusedObservationId={focusedObservationId} onSelect={setFocusedObservationId} draft={draft} onDraftChange={updateDraft} onSave={()=>void saveCapture()} busy={busy} pendingText={pending?.text} receipt={receipt} storageError={storageError} conflict={conflict} onReconcile={()=>void reconcileCapture()} rejected={rejected} onRelease={releaseRejected} archives={archives} onContinue={()=>continueDiscussion()} onClose={()=>{setSurface('quick');setDetached(null)}} onToggleSize={()=>{setExpanded(e=>!e);setDetached(null)}} compact={!expanded} onHeaderPointerDown={e=>pointerDown(e,'panel')} onHeaderPointerMove={pointerMove} onHeaderPointerUp={pointerUp} capabilities={capabilities} onCapabilityRequest={requestCapability} onAccept={(text,source)=>saveCapture(text,source)} discussionNotice={discussionNotice} codexProjection={codexProjection} onCodexDecision={decideCodexInteraction} onCodexInput={submitCodexInput} codexInteractionBusy={codexInteractionBusy} codexInteractionNotice={codexInteractionNotice}/></div>
    <button ref={petButton} className={'trace-pet-button '+(surface!=='closed'?'trace-pet-active':'')} type="button" data-trace-interactive-region="pet" aria-label={surface==='closed'?'打开 Trace':'收起 Trace'} aria-expanded={surface!=='closed'} title="单击记一笔 · 拖动移动" onPointerDown={e=>pointerDown(e,'pet')} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onClick={()=>{if(suppressClick.current){suppressClick.current=false;return}if(surface==='closed'){setSurface(codexProjection.pendingInteraction?'panel':'quick')}else close()}}><span className="trace-pet-aura" aria-hidden="true"/><img src={sitImage} alt="" draggable={false}/><span className="trace-pet-caption">{surface==='closed'?'记一笔':'收起'}</span></button>
  </div>
}

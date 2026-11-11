import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {stableWorkbenchJson} from '@trace/product-workspace';
import {makeId,type WorkbenchClient,type Task,type ContentRef,type ExternalTaskRequest,type ExternalTaskReturn} from './client';
import {HaloNotice,HaloBadge} from './halo-surfaces';
import {HaloField,HaloInput,HaloTextarea} from './halo-controls';
import {HaloDisclosure} from './halo-disclosure';
import {CodeBlock} from './code-block';

type ActionKind='approve'|'reject'|'revoke'|'review';
type SavedAction={kind:ActionKind;body:Record<string,any>};
const namespace=location.pathname.startsWith('/app/demo')?'demo':'personal';
const digest=async(body:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableWorkbenchJson(body)))),x=>x.toString(16).padStart(2,'0')).join('');
function savedAction(raw:string,taskId:string):SavedAction{
  if(raw.length>256*1024)throw Error('原交接请求超出恢复上限；未覆盖。');
  const value=JSON.parse(raw);
  if(!value||!['approve','reject','revoke','review'].includes(value.kind)||!value.body||value.body.protocolVersion!==2||value.body.taskId!==taskId||typeof value.body.commandId!=='string'||!Number.isSafeInteger(value.body.expectedRevision)||Object.keys(value).some(k=>!['kind','body'].includes(k)))throw Error('交接恢复记录不能识别；请先导出核对，未覆盖或自动发送。');
  return value;
}

export function ExternalTaskHandoff({task,client,onOpen}:{task:Task;client:WorkbenchClient;onOpen?:(ref:ContentRef)=>void}){
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot),connected=state.features.includes('task-handoff-v2');
  const key='trace-workbench:'+namespace+':external-action:'+task.id;
  const [initial]=useState(()=>{let raw:string|null=null;try{raw=localStorage.getItem(key);return {raw,action:raw?savedAction(raw,task.id):null,error:''};}catch(e){return {raw,action:null,error:String(e.message||e)};}});
  const [pending,setPending]=useState<SavedAction|null>(initial.action),[problem,setProblem]=useState(initial.error),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[configuration,setConfiguration]=useState<any>(null),[preview,setPreview]=useState<any>(null),[projectDir,setProjectDir]=useState(''),[confirmed,setConfirmed]=useState(false),[receiptState,setReceiptState]=useState('');
  const lock=useRef(false),owner=useRef(false);useEffect(()=>{owner.current=true;return()=>{owner.current=false;};},[task.id]);
  // Poll only the already selected content owner. No inferred task/project,
  // no execution polling disguised as model progress, and no canvas navigation.
  useEffect(()=>{if(!connected)return;const read=()=>{if(!document.hidden)void client.refreshContent().catch(e=>{if(owner.current)setProblem('接续状态暂未确认：'+e.message);});};const timer=window.setInterval(read,5000);document.addEventListener('visibilitychange',read);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',read);};},[connected,client]);
  const refresh=async()=>{await client.refreshContent();};
  const clearExact=(action:SavedAction)=>{
    const raw=localStorage.getItem(key);
    if(raw!==JSON.stringify(action))throw Error('恢复记录已在另一处变化；没有清除后来请求。');
    localStorage.removeItem(key);setPending(null);setReceiptState('');
  };
  const execute=async(action:SavedAction)=>{
    if(lock.current||!connected)return;lock.current=true;setBusy(true);setProblem('');setNotice('');
    try{
      const value=await client.taskHandoff(action.kind,action.body);
      if(!value.receipt||value.receipt.commandId!==action.body.commandId||value.receipt.requestHash!==await digest(action.body))throw Error('回执与原请求身份不一致；没有假定动作完成。');
      if(!owner.current)return;
      clearExact(action);setPreview(null);setConfirmed(false);setNotice(action.kind==='approve'?'已授权待领取；尚不证明内容已送达或执行。':action.kind==='revoke'?'后续领取许可已撤销；已交付副本不能收回，也不代表外部执行已停止。':action.kind==='reject'?'申请已拒绝；任务、原件和其它申请仍保留。':'复核已保存；没有自动写回当前理解或发布能力。');
      await refresh();
    }catch(e){if(owner.current)setProblem(e.message||'动作未确认；原请求已保留，请先核对原回执，不另起同一动作。');}
    finally{lock.current=false;if(owner.current)setBusy(false);}
  };
  const stage=(kind:ActionKind,fields:Record<string,unknown>)=>{
    if(lock.current||pending||initial.error)return;
    const action={kind,body:{protocolVersion:2,commandId:makeId('handoff'),expectedRevision:client.getSnapshot().revision,taskId:task.id,...fields}};
    try{localStorage.setItem(key,JSON.stringify(action));setPending(action);void execute(action);}catch(e){setProblem('原请求未能落盘，尚未发送：'+e.message);}
  };
  const inspect=async()=>{
    if(!pending||busy)return;setBusy(true);setProblem('');
    try{const value=await client.taskHandoffReceipt(pending.body.commandId);if(!owner.current)return;
      if(value.known){if(value.receipt.commandId!==pending.body.commandId||value.receipt.kind!==pending.kind||value.receipt.requestHash!==await digest(pending.body))throw Error('原回执与保存请求不同，未清除或重发。');clearExact(pending);setNotice('原请求已经提交；已按准确指纹核对，不重复操作。');await refresh();}
      else setReceiptState('absent');
    }catch(e){if(owner.current)setProblem('原命令仍未确认：'+e.message);}finally{if(owner.current)setBusy(false);}
  };
  const openPreview=async(request:ExternalTaskRequest)=>{
    if(busy||pending)return;setBusy(true);setProblem('');setConfirmed(false);setProjectDir('');
    try{const value=await client.taskHandoff('preview',{protocolVersion:2,commandId:makeId('handoff-preview'),expectedRevision:client.getSnapshot().revision,taskId:task.id,requestId:request.id});if(owner.current)setPreview(value);}
    catch(e){if(owner.current)setProblem(e.message);}finally{if(owner.current)setBusy(false);}
  };
  const claim=task.dispatch?.source==='codex'?task.dispatch:null;
  const requests=task.handoff?.requests||[],returned=task.handoff?.returns||[];
  const exportRecovery=()=>{const raw=localStorage.getItem(key);if(raw===null)return;const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='Trace-external-action-recovery.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <section className="wb-execution" aria-label="外部现场接续与返回">
    <header><h3>外部现场接续</h3><HaloBadge>{claim?claim.revokedAt?'后续许可已撤销':returned.length?'结果已接回，待复核':claim.receivedAt?'已领取 · 执行状态未知':'已授权 · 待领取':'尚未交接'}</HaloBadge></header>
    <p>本机执行和外部接续使用同一任务身份。只交付你核对的输入；领取、执行、结果报告和采用分别记录。</p>
    <HaloField label="当前任务ID"><HaloInput readOnly aria-label="外部接续任务ID" value={task.id}/></HaloField>
    <div className="wb-actions"><button className="wb-button" disabled={busy} onClick={()=>void refresh().catch(e=>setProblem(e.message))}>核对接续申请与返回</button>{connected&&<button className="wb-button" disabled={busy} onClick={()=>{setBusy(true);void client.taskHandoff('configuration').then(value=>{if(owner.current)setConfiguration(value);}).catch(e=>{if(owner.current)setProblem(e.message);}).finally(()=>{if(owner.current)setBusy(false);});}}>查看独立连接配置</button>}</div>
    {!connected&&<HaloNotice title="此入口未连接外部任务桥接" description="仍能正常手动思考、组织材料和准备任务；导入的交接记录只作历史，不会恢复授权或伪造送达。"/>}
    {configuration&&<HaloDisclosure title="仅为明确连接的MCP进程配置，不是内容分享" open><p>配置桥接是单独授权。不要把密钥内容复制到材料、提示词或分享包；这里只给受控文件入口。不会自动安装、改全局配置或启动模型。</p><CodeBlock title="该内容owner的连接参数" code={JSON.stringify({...(configuration.mcpEntry?{command:'node',args:[configuration.mcpEntry]}:{}),env:{TRACE_TASK_PRODUCT_URL:configuration.baseUrl,TRACE_TASK_MCP_KEY_FILE:configuration.keyFile}},null,2)}/><p>宿主须报告唯一明确的本机允许根；缺失或歧义时不会交付。允许根不是自动证明的“当前项目”，每项任务仍需人工配对。</p><button className="wb-button" onClick={()=>setConfiguration(null)}>收起连接说明</button></HaloDisclosure>}
    {pending&&<HaloNotice tone="warning" title="原交接动作待核对" description="未知不等于失败。先查原命令，再决定重发同一请求或在证实未提交后重新准备。" actions={<><CodeBlock title="保存的原请求（请核对后再操作）" code={JSON.stringify(pending,null,2)}/><div className="wb-actions"><button className="wb-button" disabled={busy||!connected} onClick={()=>void inspect()}>核对原命令回执</button><button className="wb-button" disabled={busy||!connected} onClick={()=>void execute(pending)}>重发原请求（不改ID）</button><button className="wb-button" onClick={exportRecovery}>导出恢复记录</button>{receiptState==='absent'&&<button className="wb-button" disabled={busy} onClick={()=>{try{clearExact(pending);setPreview(null);setConfirmed(false);setNotice('原回执确认不存在；仅清除本地待发动作，请重新预览核对。');}catch(e){setProblem(e.message);}}}>确认未提交，重新准备</button>}</div></>}/>}
    {initial.error&&!pending&&<button className="wb-button" onClick={exportRecovery}>导出无法识别的原记录</button>}
    {requests.length===0&&!claim&&<p className="wb-muted">还没有接续申请。把任务ID带到已明确配置的外部现场，用 Trace 的任务领取工具发起不含正文的申请。</p>}
    {requests.map(request=><section key={request.id} aria-label={'接续申请 '+request.id}><h4>{request.clientName||'外部宿主'} · {({pending:'待你核对',approved:'已授权',rejected:'已拒绝'})[request.status]}</h4><dl className="wb-source-metadata"><dt>宿主会话</dt><dd className="wb-preserve">{request.sessionId}</dd><dt>报告的允许根</dt><dd className="wb-preserve">{request.projectDir}</dd><dt>申请身份</dt><dd className="wb-preserve">{request.id}</dd></dl>{request.status==='pending'&&connected&&!task.dispatch&&<div className="wb-actions"><button className="wb-button" disabled={busy||Boolean(pending)} onClick={()=>void openPreview(request)}>预览输入并核对项目</button><button className="wb-button" disabled={busy||Boolean(pending)} onClick={()=>stage('reject',{requestId:request.id})}>拒绝这项申请</button></div>}</section>)}
    {preview&&<section aria-label="外部交付确认"><h4>只授权这次核对的输入</h4><p>会话：{preview.request.sessionId}</p><CodeBlock title="准确冻结输入（尚未交付）" code={JSON.stringify(preview.input,null,2)}/><HaloField label="你授权的本机项目目录"><HaloInput aria-label="外部授权项目目录" value={projectDir} onChange={e=>{setProjectDir(e.target.value);setConfirmed(false);}}/></HaloField><p className="wb-halo-hint">输入你核对的本机目录；Node会核对真实目录与申请，不能仅凭同名目录授权。Trace不为外部宿主增加文件权限。</p><label className="wb-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已核对具体会话、项目和上述输入，仅授权本次范围</label><div className="wb-actions"><button className="wb-button wb-primary" disabled={busy||Boolean(pending)||!confirmed||!projectDir.trim()} onClick={()=>stage('approve',{requestId:preview.request.id,projectDir,expectedInputHash:preview.inputHash})}>确认授权，等待外部领取</button><button className="wb-button" disabled={busy} onClick={()=>{setPreview(null);setConfirmed(false);}}>取消本次确认（不发送）</button></div></section>}
    {claim&&<><p className="wb-preserve">原会话 {claim.sessionId} · 项目 {claim.projectDir}</p><p>{claim.receivedAt?'有原领取回执；未接收可信运行证明，执行状态仍未知。':'保存授权不代表已经送达。'}</p>{!claim.revokedAt&&connected&&<button className="wb-button" disabled={busy||Boolean(pending)} onClick={()=>stage('revoke',{dispatchId:claim.id})}>撤销后续领取许可（不停止外部执行）</button>}</>}
    {returned.map(result=><ExternalReturn key={result.id} result={result} client={client} busy={busy||Boolean(pending)} connected={connected} onOpen={onOpen} onReview={(decision,note)=>stage('review',{returnId:result.id,decision,note})}/>)}
    {(busy||notice||problem)&&<HaloNotice pending={busy} tone={problem?'error':'neutral'} title={busy?'正在核对真实回执…':problem||notice}/>}
  </section>;
}
function ExternalReturn({result,client,busy,connected,onOpen,onReview}:{result:ExternalTaskReturn;client:WorkbenchClient;busy:boolean;connected:boolean;onOpen?:(ref:ContentRef)=>void;onReview:(decision:string,note:string)=>void}){
  const [note,setNote]=useState(result.review?.note||'');
  const {host}=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot),original=host?.expressions[result.source.id];
  return <section aria-label={'外部返回 '+result.id}><h4>外部返回 · {result.review?({kept:'仅保留',needs_work:'需继续核对',rejected:'不采用'})[result.review.decision]:'待复核'}</h4><p>这是原会话报告，不等于 Trace 独立验证或你的当前判断。原稿和准确输入身份独立保留。</p>{Object.entries({报告的事实与证据:result.payload.fact,摘要:result.payload.summary,解释:result.payload.interpretation,未确定处:result.payload.unconfirmed,候选理解:result.payload.proposedUnderstanding}).filter(([,value])=>value).map(([label,value])=><section key={label}><h5>{label}</h5><p className="wb-preserve">{value}</p></section>)}{result.payload.artifacts?.length>0&&<CodeBlock title="产物描述（未自动读取或打开）" code={JSON.stringify(result.payload.artifacts,null,2)}/>}<HaloDisclosure title="不可变返回原稿与身份"><p className="wb-preserve">返回 {result.id} · 输入 {result.contextHash} · 原稿 {result.resultHash}</p><CodeBlock title="原始结构化返回" code={JSON.stringify(result.payload,null,2)}/>{original&&onOpen&&<button className="wb-button" onClick={()=>onOpen(result.source)}>打开准确原稿继续思考</button>}</HaloDisclosure>{!result.review?<><HaloField label="外部结果复核备注"><HaloTextarea aria-label={'外部结果复核备注 '+result.id} value={note} readOnly={busy} onChange={e=>setNote(e.target.value)}/></HaloField><div className="wb-actions">{([['kept','仅保留，不采用观点'],['needs_work','需要继续核对'],['rejected','不采用这份返回']]as const).map(([decision,label])=><button key={decision} className="wb-button" disabled={busy||!connected} onClick={()=>onReview(decision,note)}>{label}</button>)}</div></>:<p className="wb-preserve">复核备注：{result.review.note||'未补充备注'}。复核不自动修改理解或能力。</p>}</section>;
}

import { workspaceRequest, browserStorage } from '../workspace-storage';
import { responseFromNativeProductCommand } from '../native-product-response.mjs';
import {stableWorkbenchJson,validateProductCommand} from '@trace/product-workspace';
import {pendingKey,isPendingStorageKey,pendingRecordKey,readPendingRecords,samePendingWrite,validatePendingWrite,type PendingWrite,type PendingRecord,type PendingRecoveryIssue} from './pending-recovery';
export type {PendingWrite,PendingRecoveryIssue} from './pending-recovery';

export interface ContentRef { kind: 'material' | 'expression' | 'capability'; id: string; version: number; anchor?: { type: string; [key: string]: unknown } }
export interface StepItem { id:string; text:string; checked:boolean }
export interface ContentValue { usage?:'method'|'template'|'instruction'; prompt?:string; stepItems?:StepItem[]; text?: string; resourceId?: string | null; refs?: ContentRef[]; origin?: { kind: string; url?: string; fileName?: string; message?:{sessionId:string;messageId:string}; locator?: { type: string; [key: string]: unknown }; packet?:{resourceId:string;source:ContentRef;sourceAuthor?:'user'|'agent';withheld?:'thinking-message'} }; ink?: { points: { x: number; y: number }[]; width: number; color: string }; title?: string; purpose?: string; scope?: string; steps?: string; evidence?: string; examples?: string }
export interface ContentEntry { changes?:{version:number;reason:string;state?:string;feedback?:{id:string;version:number;sourceVersion:number};transfer?:{direction:'incoming'|'outgoing';packetResourceId:string;packetId:string;createdAt:string;sender:string;recipient:string;source:ContentRef;omittedFields?:string[]}}[]; id: string; title: string; kind: string; version: number; versions: Record<string, ContentValue>; status: string; author?: string; publishedVersions?: number[] }
export interface Relation { author?:'user'|'agent';modifiedBy?:'user';sources?:ContentRef[];history?:Omit<Relation,'id'|'history'>[]; id: string; from: ContentRef; to: ContentRef; reason: string; evidence: string; difference: string; uncertainty: string; kind: string; status: string; version: number }
export interface MessageScope {refs:ContentRef[];excluded:ContentRef[];historyIds:string[]}
export interface ActivationExplanation {commonality:string;difference:string;uncertainty:string;relationKind:'supplement'|'support'|'limit'|'challenge'|'alternative'|'branch'|'unknown';question:string}
export interface ActivationCandidate extends ActivationExplanation {id:string;from:ContentRef;to:ContentRef;kind:'direct'|'potential';evidence:{ref:ContentRef;start:number;end:number;quote:string}[]}
export interface ActivationPlacement {canvasId:string;groupId:string;fromNodeId:string;toNodeId:string;status:'prepared'|'confirmed'|'abandoned';revision:number|null;at:string}
export interface ActivationDecision {candidateId:string;version:number;decision:'accepted'|'saved'|'rejected'|'coframe';interpretation:ActivationExplanation;note:string;output?:{kind:'relation'|'question'|'branch';id:string;relationId?:string};at:string}
export interface Activation {id:string;createdAt:string;question:string;seeds:ContentRef[];pool:ContentRef[];excluded:ContentRef[];instructions:ContentRef[];limit:number;canvasId:string|null;version:number;status:'prepared'|'returned'|'closed'|'cancelled';result:null|{source:{kind:'manual'}|{kind:'native-result';runId:string;inputHash:string;resultHash:string};summary:string;candidates:ActivationCandidate[];coverage:null|{read:ContentRef[];partial:ContentRef[];unread:ContentRef[]};at:string};decisions:Record<string,ActivationDecision[]>;placements:Record<string,ActivationPlacement>;ended:null|{reason:string;at:string}}
export interface Thinking { id: string; title: string; refs: ContentRef[]; excluded: ContentRef[]; instructions?:ContentRef[]; messages: { id: string; text: string; author: string; instructions?:ContentRef[]; template?:ContentRef; scope?:MessageScope }[]; status: string }
export interface NativeTaskDispatch {id:string;commandId:string;inputCommandId?:string;source:'native';requestId:string;runId:string;previousRunId?:string|null;inputVersion:1;inputHash:string;preparedInputHash:string;projectDir:string;projectIdentity:string;mode:'read-only'|'workspace-write';at:string;cancelledAt?:string}
export interface ExternalTaskDispatch {id:string;commandId:string;inputCommandId:string;source:'codex';requestId:string;deliveryId:string;ownerId:string;sessionId:string;inputVersion:1;inputHash:string;preparedInputHash:string;projectDir:string;projectIdentity:string;rootUri:string;mode:'external-host';at:string;receivedAt?:string;receiveCommandId?:string;revokedAt?:string;cancelledAt?:string;runId?:never;previousRunId?:never}
export type TaskDispatch=NativeTaskDispatch|ExternalTaskDispatch;
export interface ExternalTaskRequest {id:string;commandId:string;ownerId:string;sessionId:string;projectDir:string;projectIdentity:string;rootUri:string;clientName:string;at:string;status:'pending'|'approved'|'rejected'}
export interface ExternalTaskReturn {id:string;commandId:string;deliveryId:string;contextHash:string;resultHash:string;source:ContentRef;payload:{fact:string;summary?:string;interpretation?:string;unconfirmed?:string;proposedUnderstanding?:string;artifacts?:{title:string;kind:string;path?:string;url?:string;digest?:string}[]};at:string;review?:{commandId:string;decision:'kept'|'needs_work'|'rejected';note:string;at:string}}
export interface Task { handoff?:{preparation?:unknown;requests:ExternalTaskRequest[];returns:ExternalTaskReturn[]};preparedInputVersion?:1;dispatch?:TaskDispatch;dispatchHistory?:TaskDispatch[];execution?:{source:'trace-agent-runtime';runId:string;requestId:string;contextHash:string}; instructions?:ContentRef[]; plan?:StepItem[]; template?:ContentRef; id: string; title: string; goal: string; destination: string; refs: ContentRef[]; excluded: ContentRef[]; status: string; results: unknown[] }
export interface Resource { id: string; sha256: string; mime: string; bytes: number }
export type FeedbackContext={kind:'manual';note:string}|{kind:'thinking';id:string;messageId:string}|{kind:'task';id:string}|{kind:'native-result';runId:string;taskId:string;inputHash:string;resultHash:string;verifiedAt?:string;refs?:ContentRef[];sessionId?:string;messageId?:string};
export interface CapabilityFeedbackInput {title:string;facts:string;interpretation:string;scope:string;assessment:'support'|'limit'|'counterexample'|'undecided';target:ContentRef|null;context:FeedbackContext;refs:ContentRef[];observedAt:string}
export interface CapabilityFeedback extends Omit<ContentEntry,'versions'> {versions:Record<string,CapabilityFeedbackInput&{resolution:{action:'open'|'kept'|'revised'|'disabled'|'withdrawn';reason:string;ref:ContentRef|null;at:string}}>}
export interface ContentHost { schemaVersion: 2; activations?:Record<string,Activation>; feedbacks?:Record<string,CapabilityFeedback>; resources: Record<string, Resource>; materials: Record<string, ContentEntry>; expressions: Record<string, ContentEntry>; relations: Record<string, Relation>; capabilities: Record<string, ContentEntry>; sessions: Record<string, Thinking>; tasks: Record<string, Task>; migration: { matterRefs: Record<string, { original: ContentRef; understanding: ContentRef; legacyId: string }>; sourceRefs: Record<string, ContentRef> }; preferences?: { displayName: string; reduceMotion: boolean }; legacy: unknown }
export interface CanvasNode { id: string; ref: ContentRef | null; position: { x: number; y: number }; width: number; height: number; groupId: string | null; label: string }
export interface CanvasEdge { id: string; from: string; to: string; relationId: string | null }
export interface CanvasScene { nodes: CanvasNode[]; connections: CanvasEdge[] }
export interface CanvasDocument extends CanvasScene { schemaVersion: 1; id: string; title: string; revision: number; undo: CanvasScene[]; redo: CanvasScene[] }
export interface WorkbenchState { features:string[]; ready: boolean; loading: boolean; readError: string | null; host: ContentHost | null; legacy: unknown; revision: number; canvas: CanvasDocument | null; canvases: { id: string; title: string; revision: number }[]; saving: boolean; error: string | null; pending: PendingWrite | null; pendingWrites: PendingWrite[]; pendingRecovery: PendingRecoveryIssue[] }
export interface PreparedContentCommand {protocolVersion:1;commandId:string;expectedRevision:number;operations:unknown[]}
type NativeBridge = { requestCapability?: (request: Record<string, unknown>) => Promise<any> };
const native = () => (window as Window & { traceNative?: NativeBridge }).traceNative;
export const makeId = (prefix: string) => prefix + '-' + crypto.randomUUID();

async function jsonRequest(path: string, body?: unknown) {
  const response = native()?.requestCapability
    ? responseFromNativeProductCommand(await native()!.requestCapability!({ operation: 'workbench.request', pathname: path, method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body }) }))
    : await workspaceRequest(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error?.message || '这次操作没有完成。'), { code: value.error?.code, status: response.status });
  return value;
}
export async function saveResource(file: Blob): Promise<Resource> {
  if(file.size>256*1024*1024)throw new Error('当前单个原件上限为256 MiB；没有读取或提交这个文件。');
  if (native()?.requestCapability) {
    const result = await native()!.requestCapability!({ operation: 'product.resource.save', bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type || 'application/octet-stream' });
    if (result.ok === false) throw new Error(result.error?.message || '原件没有保存成功。');
    return result.resource;
  }
  if (browserStorage) return (await import('../../product/workbench-browser.mjs')).saveBrowserResource(file);
  const response = await fetch('/api/product/resources', { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file });
  const value = await response.json(); if (!response.ok) throw new Error(value.error?.message || '原件没有保存成功。'); return value.resource;
}
async function resourceBlob(id: string): Promise<Blob> {
  if (native()?.requestCapability) { const value = await native()!.requestCapability!({ operation: 'product.resource.read', resourceId: id }); if (value.ok === false) throw new Error(value.error?.message || '原件不可用。'); return new Blob([new Uint8Array(value.bytes)], { type: value.mime }); }
  if (browserStorage) return (await import('../../product/workbench-browser.mjs')).readBrowserResource(id).then(row => row.blob);
  const response = await fetch('/api/product/resources/' + id + '/content'); if (!response.ok) throw new Error('原件不可用；已保存摘录仍保留。'); return response.blob();
}

export class WorkbenchClient {
  private state: WorkbenchState = { features:[], ready: false, loading: false, readError: null, host: null, legacy: null, revision: 0, canvas: null, canvases: [], saving: false, error: null, pending: null, pendingWrites: [], pendingRecovery: [] };
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private urls = new Map<string, Promise<string>>();
  private id = 'canvas-main';
  private loadSequence=0;
  // Only revision floors, not retained scenes or another layout database.
  // A successful write to a non-current board still constrains later reads.
  private canvasRevisions=new Map<string,number>();
  private rememberCanvasRevision(document:CanvasDocument){this.canvasRevisions.set(document.id,Math.max(this.canvasRevisions.get(document.id)||0,document.revision));}
  constructor(){
    this.refreshRecovery();
    if(this.state.pending)this.state={...this.state,error:'上次操作尚未确认，可用原命令核对。'};
  }
  private recoveryChanged=(event:StorageEvent)=>{if(isPendingStorageKey(event.key))this.refreshRecovery();};
  private refreshRecovery(){
    let result:ReturnType<typeof readPendingRecords>;
    try{result=readPendingRecords(localStorage);}catch{result={records:[],issues:[{key:pendingKey,raw:null,reason:'本地恢复记录暂不可读取；未重置记录或发送新请求。'}]};}
    const requests=result.records.map(record=>record.request).filter((request,index,items)=>items.findIndex(other=>samePendingWrite(request,other))===index);
    const pending=requests.find(request=>samePendingWrite(request,this.state.pending))||requests[0]||null;
    this.set({pending,pendingWrites:requests,pendingRecovery:result.issues,...(result.issues.length?{error:result.issues[0].reason}:this.state.pendingRecovery.length?{error:null}:{})});
    return result;
  }
  rereadRecovery(){this.refreshRecovery();}
  selectPending(expected:PendingWrite){const found=this.refreshRecovery().records.find(record=>samePendingWrite(record.request,expected));if(found)this.set({pending:found.request});}
  private assertCanWrite(){
    const recovery=this.refreshRecovery();
    if(recovery.issues.length)throw Error('本地恢复记录需要先导出或明确恢复；没有覆盖它或发送新请求。');
    if(recovery.records.length)throw Error('上一操作尚未确认，请先核对原请求；普通读取不会丢弃它。');
  }
  private clearExactRecords(records:PendingRecord[]){
    for(const record of records){
      if(localStorage.getItem(record.key)!==record.raw)throw Error('恢复记录已在另一处变化；保留后来记录，未代为清除。');
      localStorage.removeItem(record.key);
    }
  }
  subscribe = (fn: () => void) => { if(!this.listeners.size)window.addEventListener('storage',this.recoveryChanged);this.listeners.add(fn);return()=>{this.listeners.delete(fn);if(!this.listeners.size)window.removeEventListener('storage',this.recoveryChanged);}; };
  getSnapshot = () => this.state;
  private set(patch: Partial<WorkbenchState>) { this.state = { ...this.state, ...patch }; for (const fn of this.listeners) fn(); }
  async load(canvasId = this.id) {
    const sequence=++this.loadSequence;
    this.set({ loading: true, readError: null });
    try {
      const result = await jsonRequest('/api/product/workspace');
      if (result.host?.schemaVersion !== 2 && !(this.state.host && result.revision<this.state.revision)) { if(sequence!==this.loadSequence)return false;this.id=canvasId;this.set({ ready: true, loading: false, readError: null, host: null, legacy: result.host, revision: result.revision }); return true; }
      let [layout, list] = await Promise.all([jsonRequest('/api/product/canvases/' + canvasId), jsonRequest('/api/product/canvases')]);
      if(sequence!==this.loadSequence)return false;
      const floor=this.canvasRevisions.get(canvasId)||0;
      if(layout.document.revision<floor&&!(this.state.canvas?.id===canvasId&&this.state.canvas.revision>=floor)){
        layout=await jsonRequest('/api/product/canvases/'+canvasId);
        if(sequence!==this.loadSequence)return false;
        if(layout.document.revision<(this.canvasRevisions.get(canvasId)||0))throw Error('这份画布读取早于刚确认的布局；原工作面仍保留，请重新读取。');
      }
      // Content and layout have separate monotonic revisions. A read started
      // before a successful write may finish later; keep the newer accepted
      // snapshot without invalidating the requested canvas switch or loading.
      const newerContent=result.revision>=this.state.revision,currentCanvas=this.state.canvas;
      const canvas=currentCanvas?.id===canvasId&&currentCanvas.revision>layout.document.revision?currentCanvas:layout.document;
      const canvases=list.items.map(item=>item.id===canvas.id&&item.revision<canvas.revision?{id:canvas.id,title:canvas.title,revision:canvas.revision}:item);
      if(canvas.revision>0&&!canvases.some(item=>item.id===canvas.id))canvases.push({id:canvas.id,title:canvas.title,revision:canvas.revision});
      this.rememberCanvasRevision(canvas);this.id=canvasId;this.set({ready:true,loading:false,readError:null,...(newerContent?{host:result.host,legacy:null,revision:result.revision}:{}),features:Array.isArray(result.storage?.features)?result.storage.features:[],canvas,canvases});return true;
    } catch (error) {
      // A failed refresh is not a first load. Keep the mounted editors and
      // last verified document; do not acknowledge or clear a pending write.
      if(sequence===this.loadSequence)this.set({ loading: false, readError: error instanceof Error ? error.message : '读取失败；没有创建空画布。' });return false;
    }
  }
  // Native permission/result receipts may change content without a canvas
  // command. Refresh monotonically without creating a new navigation intent.
  taskHandoffReceipt(commandId:string){return jsonRequest('/api/product/task-handoffs/receipts/'+encodeURIComponent(commandId));}
  taskHandoff(kind:'configuration'|'preview'|'approve'|'reject'|'revoke'|'review',body?:Record<string,unknown>){if(kind!=='configuration')this.assertCanWrite();return jsonRequest('/api/product/task-handoffs/'+kind,body);}
  async refreshContent() {
    const result=await jsonRequest('/api/product/workspace');
    if(result.host?.schemaVersion!==2)throw new Error('当前内容协议暂不可读取；未替换工作面。');
    if(result.revision<this.state.revision)return false;
    this.set({host:result.host,legacy:null,revision:result.revision,features:Array.isArray(result.storage?.features)?result.storage.features:this.state.features});return true;
  }
  private enqueue<T>(action: () => Promise<T>):Promise<T> {
    const result = this.queue.then(action); this.queue = result.catch(() => {}); return result;
  }
  private async send(path: string, body: unknown,owner?:string) {
    this.assertCanWrite();
    const pending:PendingWrite={path,body:structuredClone(body),...(owner?{owner}:{})};
    validatePendingWrite(pending);
    const key=pendingRecordKey(pending),raw=JSON.stringify(pending);
    // Persist before transport. Unique request keys retain both windows' writes;
    // a failed or late request never overwrites a different recovery record.
    try{if(localStorage.getItem(key)!==null)throw Error('这份原请求身份已有恢复记录；未覆盖或重复发送。');localStorage.setItem(key,raw);if(localStorage.getItem(key)!==raw)throw Error('原请求未能完整保留；没有发送。');}
    catch(error){this.refreshRecovery();this.set({error:error instanceof Error?error.message:'原请求未能保留；没有发送。'});throw error;}
    this.refreshRecovery();this.set({saving:true,error:null});
    try{
      const result=await jsonRequest(pending.path,pending.body);
      try{this.clearExactRecords([{key,raw,request:pending}]);}catch(error){this.set({error:error instanceof Error?error.message:'内容已收到回执，但本地原请求尚未清除。'});}
      this.refreshRecovery();return result;
    }catch(error){this.refreshRecovery();this.set({error:error instanceof Error?error.message:'保存未确认；原请求仍保留。'});throw error;}
    finally{this.set({saving:false});}
  }
  command(operations: unknown[],owner?:string,onPrepared?:(command:PreparedContentCommand)=>void) {
    const frozen=structuredClone(operations);
    return this.enqueue(async()=>{this.assertCanWrite();const command:PreparedContentCommand={protocolVersion:1,commandId:makeId('content'),expectedRevision:this.state.revision,operations:frozen};onPrepared?.(structuredClone(command));const result=await this.send('/api/product/commands',command,owner);if(result.revision>=this.state.revision)this.set({host:result.host,revision:result.revision});return result;});
  }
  async inspectCommand(command:PreparedContentCommand):Promise<{status:'committed'|'absent'|'mismatch'|'unknown';error?:string}> {
    try{
      validateProductCommand(command);
      if(!/^[a-zA-Z0-9_-]{1,200}$/.test(command.commandId))throw Error('原命令身份无法通过当前只读入口核对。');
      const bytes=new TextEncoder().encode(stableWorkbenchJson(command)),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
      const result=await jsonRequest('/api/product/commands/'+encodeURIComponent(command.commandId)),r=result.receipt;
      if(r?.protocolVersion!==1||r.commandId!==command.commandId||r.status!=='committed'||r.requestHash!==hash)return{status:'mismatch',error:'原请求与真实回执不一致'};
      // Never merge the old receipt snapshot into the current workspace, or
      // retry another pending command as a side effect of this read.
      return{status:'committed'};
    }catch(error){if(error.code==='UNKNOWN_COMMAND'&&error.status===404)return{status:'absent'};return{status:'unknown',error:error.message||'原命令回执暂不可核对；没有推定保存或取消。'};}
  }
  layout(scene?: CanvasScene, action: 'replace' | 'undo' | 'redo' | 'rename' = 'replace', title?: string, baseRevision=this.state.canvas?.revision,canvasId=this.id,owner?:string,activation?:{id:string;candidateId:string}) { return this.enqueue(async () => { if(activation&&this.state.host?.activations?.[activation.id]?.status!=='returned')throw new Error('原探索已结束，未发送新的同框布局。'); if (baseRevision===undefined) throw new Error('画布尚未读取。'); const result = await this.send('/api/product/canvases/' + canvasId + '/commands', { protocolVersion: 1, commandId: makeId('layout'), expectedRevision: baseRevision, action, ...(scene ? { scene } : {}), ...(title === undefined ? {} : { title }),...(activation?{activation:structuredClone(activation)}:{}) },owner); this.rememberCanvasRevision(result.document);const head={id:result.document.id,title:result.document.title,revision:result.document.revision},known=this.state.canvases.find(item=>item.id===head.id);if(!known||known.revision<=head.revision)this.set({canvases:known?this.state.canvases.map(item=>item.id===head.id?head:item):[...this.state.canvases,head]});if(this.id===canvasId&&(!this.state.canvas||result.document.revision>=this.state.canvas.revision))this.set({ canvas: result.document }); return result; }); }
  async prepare() { await this.command([{ type: 'workspace.upgrade' }]); await this.load(); if (this.state.canvas?.revision === 0) await this.layout(undefined, 'rename', '新的想法'); await this.load(); }
  retry(expected:PendingWrite){
    const frozen=structuredClone(expected);
    return this.enqueue(async()=>{
      try{
        validatePendingWrite(frozen);
        const recovery=this.refreshRecovery(),matches=recovery.records.filter(record=>samePendingWrite(record.request,frozen));
        if(recovery.issues.length)throw Error('先恢复无法识别的本地记录；未发送任何重试。');
        if(!matches.length)throw Error('当前待核对请求与页面原请求不一致；保留两份，没有代为执行。');
        // Bind path, owner and the complete frozen body here, inside the queue,
        // not just in the button or before a previous write finishes.
        this.set({saving:true,error:null,pending:frozen});
        await jsonRequest(frozen.path,frozen.body);
        this.clearExactRecords(matches);this.refreshRecovery();await this.load();return true;
      }catch(error){this.refreshRecovery();this.set({error:error instanceof Error?error.message:'重试尚未确认；原请求仍保留。'});return false;}
      finally{this.set({saving:false});}
    });
  }
  async reloadAfterConflict(){const loaded=await this.load();this.refreshRecovery();return loaded;}
  forgetPending(expected:PendingWrite){
    const frozen=structuredClone(expected);
    return this.enqueue(async()=>{try{validatePendingWrite(frozen);const records=this.refreshRecovery().records.filter(record=>samePendingWrite(record.request,frozen));if(!records.length)throw Error('原请求已在另一处变化；没有删除后来记录。');this.clearExactRecords(records);this.refreshRecovery();this.set({error:null});return true;}catch(error){this.refreshRecovery();this.set({error:error instanceof Error?error.message:'本地原请求未清除。'});return false;}});
  }
  resetRecoveryRecord(issue:PendingRecoveryIssue){
    return this.enqueue(async()=>{try{const current=this.refreshRecovery().issues.find(value=>value.key===issue.key&&value.raw===issue.raw);if(!current||issue.raw===null||!isPendingStorageKey(issue.key)||localStorage.getItem(issue.key)!==issue.raw)throw Error('原始恢复记录已变化或无法读取；没有删除它。');localStorage.removeItem(issue.key);this.refreshRecovery();this.set({error:null});return true;}catch(error){this.refreshRecovery();this.set({error:error instanceof Error?error.message:'原始恢复记录仍保留。'});return false;}});
  }
  async createCanvas() { this.assertCanWrite();const canvasId=makeId('canvas'),document=(await this.readCanvas(canvasId)).document;if(document.id!==canvasId||document.revision!==0)throw new Error('这个新画布身份已经存在；没有改名或覆盖它。');await this.layout(undefined,'rename','新的想法',0,canvasId);return canvasId; }
  readResource(id: string) { return resourceBlob(id); }
  readCanvas(id: string): Promise<{ document: CanvasDocument }> { return jsonRequest('/api/product/canvases/' + encodeURIComponent(id)); }
  resourceUrl(id: string) { let value = this.urls.get(id); if (!value) { value = resourceBlob(id).then(blob => URL.createObjectURL(blob)); this.urls.set(id, value); value.catch(() => this.urls.delete(id)); } return value; }
  destroy() { window.removeEventListener('storage',this.recoveryChanged); for (const url of this.urls.values()) void url.then(URL.revokeObjectURL).catch(() => {}); this.urls.clear(); }
}

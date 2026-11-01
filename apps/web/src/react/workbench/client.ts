import { workspaceRequest, browserStorage } from '../workspace-storage';
import { responseFromNativeProductCommand } from '../native-product-response.mjs';

export interface ContentRef { kind: 'material' | 'expression' | 'capability'; id: string; version: number; anchor?: { type: string; [key: string]: unknown } }
export interface StepItem { id:string; text:string; checked:boolean }
export interface ContentValue { usage?:'method'|'template'|'instruction'; prompt?:string; stepItems?:StepItem[]; text?: string; resourceId?: string | null; refs?: ContentRef[]; origin?: { kind: string; url?: string; fileName?: string; locator?: { type: string; [key: string]: unknown }; packet?:{resourceId:string;source:ContentRef;sourceAuthor?:'user'|'agent'} }; ink?: { points: { x: number; y: number }[]; width: number; color: string }; title?: string; purpose?: string; scope?: string; steps?: string; evidence?: string; examples?: string }
export interface ContentEntry { changes?:{version:number;reason:string;state?:string;feedback?:{id:string;version:number;sourceVersion:number};transfer?:{direction:'incoming'|'outgoing';packetResourceId:string;packetId:string;createdAt:string;sender:string;recipient:string;source:ContentRef;omittedFields?:string[]}}[]; id: string; title: string; kind: string; version: number; versions: Record<string, ContentValue>; status: string; author?: string; publishedVersions?: number[] }
export interface Relation { id: string; from: ContentRef; to: ContentRef; reason: string; evidence: string; difference: string; uncertainty: string; kind: string; status: string; version: number }
export interface Thinking { id: string; title: string; refs: ContentRef[]; excluded: ContentRef[]; instructions?:ContentRef[]; messages: { id: string; text: string; author: string; instructions?:ContentRef[]; template?:ContentRef }[]; status: string }
export interface Task { execution?:{source:'trace-agent-runtime';runId:string;requestId:string;contextHash:string}; instructions?:ContentRef[]; plan?:StepItem[]; template?:ContentRef; id: string; title: string; goal: string; destination: string; refs: ContentRef[]; excluded: ContentRef[]; status: string; results: unknown[] }
export interface Resource { id: string; sha256: string; mime: string; bytes: number }
export type FeedbackContext={kind:'manual';note:string}|{kind:'thinking';id:string;messageId:string}|{kind:'task';id:string}|{kind:'native-result';runId:string;taskId:string;inputHash:string;resultHash:string;verifiedAt?:string;refs?:ContentRef[];sessionId?:string;messageId?:string};
export interface CapabilityFeedbackInput {title:string;facts:string;interpretation:string;scope:string;assessment:'support'|'limit'|'counterexample'|'undecided';target:ContentRef|null;context:FeedbackContext;refs:ContentRef[];observedAt:string}
export interface CapabilityFeedback extends Omit<ContentEntry,'versions'> {versions:Record<string,CapabilityFeedbackInput&{resolution:{action:'open'|'kept'|'revised'|'disabled'|'withdrawn';reason:string;ref:ContentRef|null;at:string}}>}
export interface ContentHost { schemaVersion: 2; feedbacks?:Record<string,CapabilityFeedback>; resources: Record<string, Resource>; materials: Record<string, ContentEntry>; expressions: Record<string, ContentEntry>; relations: Record<string, Relation>; capabilities: Record<string, ContentEntry>; sessions: Record<string, Thinking>; tasks: Record<string, Task>; migration: { matterRefs: Record<string, { original: ContentRef; understanding: ContentRef; legacyId: string }>; sourceRefs: Record<string, ContentRef> }; preferences?: { displayName: string; reduceMotion: boolean }; legacy: unknown }
export interface CanvasNode { id: string; ref: ContentRef | null; position: { x: number; y: number }; width: number; height: number; groupId: string | null; label: string }
export interface CanvasEdge { id: string; from: string; to: string; relationId: string | null }
export interface CanvasScene { nodes: CanvasNode[]; connections: CanvasEdge[] }
export interface CanvasDocument extends CanvasScene { schemaVersion: 1; id: string; title: string; revision: number; undo: CanvasScene[]; redo: CanvasScene[] }
export interface WorkbenchState { features:string[]; ready: boolean; loading: boolean; readError: string | null; host: ContentHost | null; legacy: unknown; revision: number; canvas: CanvasDocument | null; canvases: { id: string; title: string; revision: number }[]; saving: boolean; error: string | null; pending: { path: string; body: unknown; owner?:string } | null }
type NativeBridge = { requestCapability?: (request: Record<string, unknown>) => Promise<any> };
const native = () => (window as Window & { traceNative?: NativeBridge }).traceNative;
const pendingKey='trace-workbench-pending:'+(location.pathname.startsWith('/app/demo')?'demo':'personal');
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
  private state: WorkbenchState = { features:[], ready: false, loading: false, readError: null, host: null, legacy: null, revision: 0, canvas: null, canvases: [], saving: false, error: null, pending: null };
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private urls = new Map<string, Promise<string>>();
  private id = 'canvas-main';
  private loadSequence=0;
  constructor(){try{const saved=localStorage.getItem(pendingKey);if(saved){const p=JSON.parse(saved);if(p&&typeof p.path==='string'&&(p.path==='/api/product/commands'||/^\/api\/product\/canvases\/[a-zA-Z0-9_-]+\/commands$/.test(p.path))&&p.body&&typeof p.body==='object')this.state={...this.state,pending:p,error:'上次操作尚未确认，可用原命令核对。'};}}catch{this.state={...this.state,error:'本地恢复记录读取失败；未重置已保存内容。'};}}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.state;
  private set(patch: Partial<WorkbenchState>) { this.state = { ...this.state, ...patch }; for (const fn of this.listeners) fn(); }
  async load(canvasId = this.id) {
    const sequence=++this.loadSequence;
    this.set({ loading: true, readError: null });
    try {
      const result = await jsonRequest('/api/product/workspace');
      if (result.host?.schemaVersion !== 2) { if(sequence!==this.loadSequence)return false;this.id=canvasId;this.set({ ready: true, loading: false, readError: null, host: null, legacy: result.host, revision: result.revision }); return true; }
      const [layout, list] = await Promise.all([jsonRequest('/api/product/canvases/' + canvasId), jsonRequest('/api/product/canvases')]);
      if(sequence!==this.loadSequence)return false;this.id=canvasId;this.set({ ready: true, loading: false, readError: null, host: result.host, legacy: null, features:Array.isArray(result.storage?.features)?result.storage.features:[], revision: result.revision, canvas: layout.document, canvases: list.items });return true;
    } catch (error) {
      // A failed refresh is not a first load. Keep the mounted editors and
      // last verified document; do not acknowledge or clear a pending write.
      if(sequence===this.loadSequence)this.set({ loading: false, readError: error instanceof Error ? error.message : '读取失败；没有创建空画布。' });return false;
    }
  }
  private enqueue<T>(action: () => Promise<T>):Promise<T> {
    const result = this.queue.then(action); this.queue = result.catch(() => {}); return result;
  }
  private async send(path: string, body: unknown,owner?:string) {
    if (this.state.pending) throw new Error('上一操作尚未确认，请先重试原命令或保留草稿后重新读取。');
    this.set({ saving: true, error: null });
    try { const result = await jsonRequest(path, body); return result; }
    catch (error) { const pending = { path, body: structuredClone(body),...(owner?{owner}:{}) }; try{localStorage.setItem(pendingKey, JSON.stringify(pending));}catch{/* In-memory recovery remains available; no false acknowledgement. */} this.set({ error: error instanceof Error ? error.message : '保存未确认。', pending }); throw error; }
    finally { this.set({ saving: false }); }
  }
  command(operations: unknown[],owner?:string) { return this.enqueue(async () => { const result = await this.send('/api/product/commands', { protocolVersion: 1, commandId: makeId('content'), expectedRevision: this.state.revision, operations },owner); this.set({ host: result.host, revision: result.revision }); return result; }); }
  layout(scene?: CanvasScene, action: 'replace' | 'undo' | 'redo' | 'rename' = 'replace', title?: string, baseRevision=this.state.canvas?.revision,canvasId=this.id,owner?:string) { return this.enqueue(async () => { if (baseRevision===undefined) throw new Error('画布尚未读取。'); const result = await this.send('/api/product/canvases/' + canvasId + '/commands', { protocolVersion: 1, commandId: makeId('layout'), expectedRevision: baseRevision, action, ...(scene ? { scene } : {}), ...(title === undefined ? {} : { title }) },owner); if(this.id===canvasId)this.set({ canvas: result.document }); return result; }); }
  async prepare() { await this.command([{ type: 'workspace.upgrade' }]); await this.load(); if (this.state.canvas?.revision === 0) await this.layout(undefined, 'rename', '新的想法'); await this.load(); }
  async retry() { const pending = this.state.pending; if (!pending) return; this.set({ saving: true }); try { await jsonRequest(pending.path, pending.body); localStorage.removeItem(pendingKey); this.set({ pending: null, error: null }); await this.load(); } catch (error) { this.set({ error: error instanceof Error ? error.message : '重试尚未确认。' }); } finally { this.set({ saving: false }); } }
  async reloadAfterConflict() { if(await this.load()){this.set({ pending: null, error: null });localStorage.removeItem(pendingKey);} }
  async createCanvas() { if(!await this.load(makeId('canvas')))throw new Error('新画布没有准备好；原画布未被覆盖。');await this.layout(undefined, 'rename', '新的想法');await this.load();return this.id; }
  readResource(id: string) { return resourceBlob(id); }
  readCanvas(id: string): Promise<{ document: CanvasDocument }> { return jsonRequest('/api/product/canvases/' + encodeURIComponent(id)); }
  resourceUrl(id: string) { let value = this.urls.get(id); if (!value) { value = resourceBlob(id).then(blob => URL.createObjectURL(blob)); this.urls.set(id, value); value.catch(() => this.urls.delete(id)); } return value; }
  destroy() { for (const url of this.urls.values()) void url.then(URL.revokeObjectURL).catch(() => {}); this.urls.clear(); }
}

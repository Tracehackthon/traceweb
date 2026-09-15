import * as B from '../product/bridge.mjs';
import { workspaceRequest, storageLabel } from './workspace-storage';
import { homeEntries, mattersView, recordsOf, titleOf } from '../product/library.mjs';
import type { DialogState, RouteMemory, RouteNavigationOptions, SelectionAnchor, ViewName, WebStatus, WorkspaceSnapshot } from './types';

const clone = <T>(value: T): T => structuredClone(value);
const uid = (kind: string) => `${kind}-${crypto.randomUUID()}`;
const allowed: ViewName[] = ['home', 'matters', 'chain', 'compare', 'worksite', 'works', 'search', 'all', 'discussion'];

type HarnessHandoff = {
  observationId: string | null;
  text: string;
  status: string | null;
  source: string | null;
};

/**
 * The Harness is only allowed to hand over an explicit observation.  It does
 * not get to infer a conclusion or overwrite an existing Trace matter.
 */
function readHarnessHandoff(): HarnessHandoff | null {
  const params = new URLSearchParams(location.search);
  if (params.get('from') !== 'deepseek-harness') return null;
  const text = (params.get('text') || '').trim();
  if (!text) return null;
  return {
    observationId: params.get('observationId'),
    text,
    status: params.get('status'),
    source: params.get('source'),
  };
}

function urlFor(route: RouteMemory): URL {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('view', route.view);
  for (const [key, param] of [['matterId', 'matter'], ['workId', 'work'], ['sessionId', 'session'], ['screen', 'screen'], ['q', 'q'], ['kind', 'kind'], ['recordId', 'record']] as const) {
    const value = route[key];
    if (value) url.searchParams.set(param, String(value));
  }
  return url;
}

function fromUrl(): RouteMemory {
  const params = new URLSearchParams(location.search);
  // A DeepSeek Harness handoff is ingested into the canonical Trace model
  // during startup below.  Other legacy query links retain their old route.
  const isHarnessHandoff = Boolean(readHarnessHandoff());
  let view = (params.get('view') || (!isHarnessHandoff && ['from', 'observationId', 'text', 'status', 'source'].some((key) => params.has(key)) ? 'discussion' : 'home')) as ViewName;
  if (!allowed.includes(view)) view = 'home';
  if (view === 'matters' && params.has('matter')) view = 'chain';
  if (view === 'matters' && params.has('q')) view = 'search';
  let memory: RouteMemory | null = null;
  try {
    memory = history.state?.traceRoute || JSON.parse(sessionStorage.getItem(`trace:${location.search}`) || 'null');
  } catch {
    memory = null;
  }
  const route: RouteMemory = { view };
  for (const [key, param] of [['matterId', 'matter'], ['workId', 'work'], ['sessionId', 'session'], ['screen', 'screen'], ['q', 'q'], ['kind', 'kind'], ['recordId', 'record']] as const) {
    if (params.has(param)) route[key] = params.get(param) || undefined;
  }
  return memory && urlFor(memory).search === location.search ? memory : route;
}

function routeKey(route: RouteMemory): string {
  return JSON.stringify({ view: route.view, matterId: route.matterId, workId: route.workId, sessionId: route.sessionId, screen: route.screen, q: route.q, kind: route.kind, recordId: route.recordId });
}

function sameValue(left: unknown, right: unknown): boolean {
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return left === right; }
}

export interface RuntimeSnapshot extends WorkspaceSnapshot {
  route: RouteMemory;
}

/**
 * Typed service boundary for the React shell.  Reducers and SQLite stay in
 * their existing modules; React only sees snapshots and explicit commands.
 */
export class WebRuntime {
  private listeners = new Set<() => void>();
  private host: any = null;
  private revision = 0;
  private recoveryGeneration = 0;
  private storage: any = null;
  private route: RouteMemory = fromUrl();
  private ready = false;
  private busy = false;
  private pendingPayload: any = null;
  private pendingGeneration = 0;
  private dirty = 0;
  private saved = 0;
  private timer: number | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private continuation: (() => void) | null = null;
  private startPromise: Promise<void> | null = null;
  private routeRoot: HTMLElement | null = null;
  // Matters keeps a short-lived presentation state for the approved
  // overview → growth → reentry interaction. The canonical matter remains in
  // the bridge; leaving this route discards only the presentation state.
  private mattersPresentation: { mode: 'overview' | 'reentry' | 'deep' | 'search'; selectedId: string | null; deepTab: string; contextMode: string; query: string } | null = null;
  private status: WebStatus = { state: 'loading', text: '正在接回你留在本机的内容…' };
  private error: string | null = null;
  private dialog: DialogState | null = null;
  private snapshot: RuntimeSnapshot = this.makeSnapshot();

  private makeSnapshot(): RuntimeSnapshot {
    return { host: this.host, revision: this.revision, storage: this.storage, ready: this.ready, busy: this.busy, pending: Boolean(this.pendingPayload || this.continuation || this.dirty > this.saved), status: this.status, error: this.error, dialog: this.dialog, route: this.route };
  }

  private emit(): void {
    this.snapshot = this.makeSnapshot();
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RuntimeSnapshot => this.snapshot;
  getRoute = (): RouteMemory => this.route;
  getRouteKey = (): string => `${routeKey(this.route)}:${this.recoveryGeneration}`;
  getRouteRoot = (): HTMLElement | null => this.routeRoot;
  setRouteRoot = (root: HTMLElement | null): void => { this.routeRoot = root; };
  getHost = (): any => this.host;
  isReducedMotion = (): boolean => Boolean(this.host?.preferences?.reduceMotion) || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.loadWorkspace();
    return this.startPromise;
  }

  private setStatus(state: WebStatus['state'], text: string): void {
    this.status = { state, text };
    this.emit();
  }

  private async loadWorkspace(): Promise<void> {
    this.setStatus('loading', '正在接回你留在本机的内容…');
    try {
      const response = await workspaceRequest('/api/web/workspace', { cache: 'no-store' });
      if (!response.ok) throw new Error(`读取本机内容失败（${response.status}），没有重置数据。`);
      const data = await response.json();
      if (!Number.isInteger(data.revision)) throw new Error('存储响应不正确');
      this.host = data.host || B.createBridge();
      this.revision = data.revision;
      this.storage = data.storage;
      const recovered = B.recoverPendingComparisons(this.host);
      if (!sameValue(recovered, this.host)) {
        this.host = recovered;
        await this.save(this.host);
      }
      this.route = fromUrl();
      await this.resumeHarnessHandoff();
      this.ready = true;
      this.error = null;
      this.setPreferences();
      this.setStatus('saved', `已连接${storageLabel}存储`);
      this.emit();
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
      this.setStatus('error', '本机内容未能读取，没有用空内容覆盖它。');
      throw cause;
    }
  }

  /**
   * Turn a Harness observation into a normal Trace matter exactly once, then
   * remove the transient query parameters so refresh cannot create a copy.
   */
  private async resumeHarnessHandoff(): Promise<void> {
    const handoff = readHarnessHandoff();
    if (!handoff || !this.host) return;

    const existing = this.host.chain.matters.find((item: any) => {
      const marker = item.externalHandoff;
      if (marker?.origin !== 'deepseek-harness') return false;
      return handoff.observationId
        ? marker.observationId === handoff.observationId
        : marker.text === handoff.text && marker.source === handoff.source;
    });

    let matterId: string;
    if (existing) {
      matterId = existing.id;
    } else {
      matterId = uid('matter');
      const sourceTitle = handoff.source || 'DeepSeek Harness';
      const next = B.captureInput(this.host, {
        matterId,
        text: handoff.text,
        source: {
          id: uid('source'),
          title: sourceTitle,
          excerpt: handoff.text,
          context: '从 DeepSeek Harness 接续的原始现场。',
        },
      });
      if (next.error) throw new Error(next.error.message || '未能接住来自 Harness 的观察。');
      const captured = next.chain.matters.find((item: any) => item.id === matterId);
      // This is provenance only. It never changes the user’s original text or
      // assigns a judgement based on the mock Harness status.
      captured.externalHandoff = {
        origin: 'deepseek-harness',
        observationId: handoff.observationId,
        text: handoff.text,
        source: handoff.source,
        status: handoff.status,
        receivedAt: new Date().toISOString(),
      };
      this.host = next;
      await this.save(next);
    }

    this.route = { view: 'chain', matterId, screen: 'resume' };
    history.replaceState({ traceRoute: this.route }, '', urlFor(this.route));
    try { sessionStorage.setItem(`trace:${location.search}`, JSON.stringify(this.route)); } catch { /* storage can be disabled */ }
  }

  private async save(value: any, commandId = uid('command')): Promise<any> {
    const payload = { expectedRevision: this.revision, host: clone(value), commandId };
    this.pendingPayload = payload;
    this.pendingGeneration = this.dirty;
    this.setStatus('saving', `正在保存在${storageLabel}…`);
    let response: Response;
    let data: any;
    try {
      response = await workspaceRequest('/api/web/workspace', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      data = await response.json();
    } catch {
      this.setStatus('error', '保存未确认。内容仍在页面中，请重试或导出。');
      throw new Error('保存连接中断');
    }
    if (!response.ok) {
      const message = response.status === 409 ? '另一处已有更新，未覆盖它。请先导出，再载入新版本。' : `保存失败：${data?.error?.message || response.status}`;
      this.setStatus('error', message);
      throw new Error(message);
    }
    this.revision = Math.max(this.revision, data.revision);
    this.storage = data.storage;
    this.pendingPayload = null;
    this.setStatus('saved', `已保存在${storageLabel}`);
    this.emit();
    return data;
  }

  private async flush(): Promise<void> {
    if (this.timer) window.clearTimeout(this.timer);
    await this.tail;
    if (this.pendingPayload) throw new Error('请先处理未确认的保存');
    if (this.dirty <= this.saved) return;
    const generation = this.dirty;
    const snapshot = clone(this.host);
    const job = this.tail.then(() => this.save(snapshot)).then(() => { this.saved = Math.max(this.saved, generation); this.emit(); });
    this.tail = job.catch(() => undefined);
    await job;
  }

  draft(next: any): void {
    this.host = next;
    this.dirty += 1;
    if (!this.pendingPayload) this.setStatus('saving', '草稿待保存…');
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { void this.flush().catch(() => undefined); }, 350);
    this.emit();
  }

  async commit(transform: (host: any) => any, after: (next: any) => void = () => undefined): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.emit();
    try {
      await this.flush();
      const next = transform(this.host);
      if (next?.error) {
        this.message(next.error.message);
        return;
      }
      const finish = () => {
        this.host = next;
        this.saved = ++this.dirty;
        this.setPreferences();
        after(next);
        this.emit();
      };
      this.continuation = finish;
      await this.save(next);
      this.continuation = null;
      finish();
    } catch (cause) {
      if (!this.pendingPayload) this.message(cause instanceof Error ? cause.message : String(cause));
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  async retryPending(): Promise<void> {
    if (!this.pendingPayload || this.busy) return;
    this.busy = true;
    const payload = this.pendingPayload;
    const generation = this.pendingGeneration;
    this.emit();
    try {
      await this.save(payload.host, payload.commandId);
      this.saved = Math.max(this.saved, generation);
      const finish = this.continuation;
      this.continuation = null;
      finish?.();
      if (this.dirty > this.saved) await this.flush();
    } catch {
      // Keep the pending payload and recovery controls visible.
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  async loadSaved(): Promise<void> {
    try {
      const response = await workspaceRequest('/api/web/workspace', { cache: 'no-store' });
      if (!response.ok) throw new Error(`读取本机内容失败（${response.status}）`);
      const data = await response.json();
      this.host = B.recoverPendingComparisons(data.host || B.createBridge());
      this.revision = data.revision;
      this.storage = data.storage;
      this.pendingPayload = null;
      this.continuation = null;
      this.dirty = this.saved = 0;
      this.ready = true;
      this.error = null;
      // Explicitly replacing a workspace must remount scene adapters, which
      // intentionally keep local input state during ordinary autosaves.
      this.recoveryGeneration += 1;
      this.setPreferences();
      this.closeDialog();
      this.setStatus('saved', '已载入本机保存的版本');
      this.emit();
    } catch (cause) {
      this.message(cause instanceof Error ? cause.message : String(cause));
    }
  }

  private setPreferences(): void {
    document.documentElement.dataset.reduceMotion = String(this.isReducedMotion());
  }

  retain(): void {
    if (!this.routeRoot) return;
    this.route.scroll = [...this.routeRoot.querySelectorAll('*')]
      .filter((element) => element.scrollTop > 0 && typeof element.className === 'string')
      .map((element) => ({ className: element.className as string, top: element.scrollTop }));
    history.replaceState({ traceRoute: this.route }, '', location.href);
    try { sessionStorage.setItem(`trace:${location.search}`, JSON.stringify(this.route)); } catch { /* storage can be disabled */ }
  }

  restore(root: HTMLElement, route: RouteMemory = this.route): void {
    for (const entry of route.scroll || []) {
      const element = [...root.querySelectorAll<HTMLElement>('*')].find((candidate) => candidate.className === entry.className);
      if (element) element.scrollTop = entry.top;
    }
    const anchor = route.anchor;
    if (!anchor || route.view !== 'chain') return;
    const element = root.querySelector<HTMLElement>(`[data-selection="${CSS.escape(anchor.field)}"]`);
    if (!element) return;
    const value = element instanceof HTMLTextAreaElement ? element.value : element.textContent || '';
    if (value.slice(anchor.start, anchor.end) !== anchor.text) return;
    if (element instanceof HTMLTextAreaElement) {
      element.focus({ preventScroll: true });
      element.setSelectionRange(anchor.start, anchor.end);
      return;
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let start: [Node, number] | null = null;
    let end: [Node, number] | null = null;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!start && offset + (node.textContent?.length || 0) >= anchor.start) start = [node, anchor.start - offset];
      if (offset + (node.textContent?.length || 0) >= anchor.end) { end = [node, anchor.end - offset]; break; }
      offset += node.textContent?.length || 0;
    }
    if (start && end) {
      const selection = getSelection();
      const range = document.createRange();
      range.setStart(...start); range.setEnd(...end);
      selection?.removeAllRanges(); selection?.addRange(range);
    }
  }

  navigate(next: RouteMemory, { replace = false, origin }: RouteNavigationOptions = {}): void {
    if (this.pendingPayload && this.continuation) {
      this.message('本次保存尚未确认，请先重试或导出内容。');
      return;
    }
    this.retain();
    const route: RouteMemory = { ...next };
    if (route.view === 'home') delete route.returnTarget;
    else if (!Object.hasOwn(route, 'returnTarget')) {
      route.returnTarget = clone(origin || (route.view === this.route.view && ((route.view === 'chain' && route.matterId === this.route.matterId) || (route.view === 'worksite' && route.workId === this.route.workId)) ? this.route.returnTarget : this.route) || { view: 'home' });
    }
    this.route = route;
    if (route.view !== 'matters') this.mattersPresentation = null;
    history[replace ? 'replaceState' : 'pushState']({ traceRoute: route }, '', urlFor(route));
    try { sessionStorage.setItem(`trace:${location.search}`, JSON.stringify(route)); } catch { /* storage can be disabled */ }
    this.emit();
  }

  handlePopState(): void {
    this.route = fromUrl();
    this.emit();
  }

  back(): void { this.navigate(this.route.returnTarget || { view: 'home' }); }

  showDialog(dialog: DialogState): void { this.dialog = dialog; this.emit(); }
  closeDialog(): void { if (this.dialog) { this.dialog = null; this.emit(); } }
  message(message: string): void { this.showDialog({ type: 'message', title: '这一步还没有完成', message }); }

  confirmLoadSaved(): void {
    this.showDialog({
      type: 'message',
      title: '载入已保存版本',
      message: '不会合并或覆盖磁盘上的新版本。请先导出未保存内容，再载入。',
      confirm: { label: '载入已保存版本', action: () => { void this.loadSaved(); } },
    });
  }

  profile(): void { this.showDialog({ type: 'profile', title: '个人与设置' }); }

  sources(): void {
    const matter = this.matter();
    if (!matter) return;
    this.showDialog({ type: 'sources', title: '这件事的对照与来处', message: matter.id });
  }

  workContext(): void {
    const value = this.selectWorksite();
    if (!value) return;
    const text = [`任务：${value.work.title}`, `项目：${value.work.project}`, `工具 / Agent：${value.work.agent}`, '', ...value.context.flatMap((item: any) => [`【${item.role} · 理解 v${item.sourceVersion}】`, item.instruction, item.text, item.note || '', '']), ...value.contextFindings.map((item: any) => item.text)].join('\n');
    this.showDialog({ type: 'work-context', title: '本次带入的内容', message: text });
  }

  recordForRoute(): any | null {
    if (!this.route.recordId || !this.host) return null;
    return recordsOf(this.host).find((record) => record.id === this.route.recordId) || null;
  }

  openRecordIfNeeded(): void {
    const record = this.recordForRoute();
    if (record) this.showDialog({ type: 'record', title: record.kind === 'result' ? '保存下来的这次结果' : record.kind === 'source' ? '原材料与来处' : '这次修订的记录', record });
  }

  matter(): any | null { return this.host?.chain?.matters?.find((matter: any) => matter.id === this.route.matterId) || null; }

  selectWorksite(): any | null { return this.route.workId ? B.selectWorksite(this.host, this.route.workId) : null; }

  projection(): any {
    let value: any;
    if (this.route.view === 'chain') {
      value = B.selectChain(this.host, this.route.matterId);
      if (value && this.route.anchor?.field === 'originalText') value.focus = this.route.anchor;
    }
    if (this.route.view === 'compare') value = B.selectComparison(this.host, this.route.sessionId);
    if (this.route.view === 'worksite') value = this.selectWorksite();
    if (value) value.notice = (value.notice || '').replaceAll('本次会话', '本机').replaceAll('本地原型', '本地记录');
    return value;
  }

  prepareRoute(route = this.route): void {
    if (!this.host) return;
    if (route.view === 'chain' && route.matterId) this.host = B.dispatchChain(this.host, { matterId: route.matterId, action: { type: 'OPEN', id: route.matterId, screen: route.screen || 'resume' } });
    if (route.view === 'worksite' && route.workId && this.host.worksite.works[route.workId]) {
      route.matterId ||= this.host.worksite.sessions[route.workId].intake[0]?.matterId;
      this.host = B.dispatchWorksite(this.host, { workId: route.workId, action: { type: 'NAVIGATE', screen: route.screen || 'overview' } });
    }
  }

  onHomeDraft = (text: string): void => {
    if (!this.host) return;
    const next = clone(this.host);
    next.chain.capture.text = text;
    this.draft(next);
  };

  onCapture = (text: string): void => {
    void this.commit((state) => B.captureInput(state, { matterId: uid('matter'), text }), (next) => this.navigate(next.route));
  };

  onChainAction = (action: any): void => {
    if (this.busy || !this.host || !this.route.matterId) return;
    if (action.type === 'FOCUS') {
      const anchor = B.selectComparisonAnchor(this.host, this.route.matterId, action);
      if (anchor) this.route.anchor = anchor;
      if (action.field === 'originalText') { this.emit(); return; }
    }
    if (['CLEAR_FOCUS', 'FRESH_CONTEXT', 'RESUME_CONTEXT'].includes(action.type)) delete this.route.anchor;
    if (action.type === 'OPEN_COMPARISON' || (action.type === 'NAVIGATE' && action.screen === 'comparison')) { this.openCompare(action.focus); return; }
    if (action.type === 'NAVIGATE' && ['work', 'results', 'revised'].includes(action.screen)) {
      const works = Object.values(this.host.worksite.works).filter((work: any) => this.host.worksite.sessions[work.id].intake.some((item: any) => item.matterId === this.route.matterId));
      if (works.length) this.navigate({ view: 'worksite', workId: (works.at(-1) as any).id, matterId: this.route.matterId, screen: action.screen === 'work' ? 'overview' : 'results' });
      else this.message('还没有本次工作。先从「带去用」确认工作和带入的内容。');
      return;
    }
    if (action.type === 'CONFIRM_HANDOFF') {
      const handoff = B.selectChain(this.host, this.route.matterId).handoff;
      void this.commit((state) => (B.createWorkFromHandoff as any)(state, { matterId: this.route.matterId, workId: uid('work'), destination: handoff.destination, role: handoff.role, note: handoff.note }), (next) => this.navigate(next.route));
      return;
    }
    if (action.type === 'OPEN' && action.id !== this.route.matterId) { this.navigate({ view: 'chain', matterId: action.id, screen: action.screen || 'resume' }); return; }
    const change = (state: any) => B.dispatchChain(state, { matterId: this.route.matterId, action });
    if (/_DRAFT$/.test(action.type) || ['FOCUS', 'CLEAR_FOCUS'].includes(action.type)) {
      const next = change(this.host); if (next.error) { this.message(next.error.message); return; }
      this.draft(next); return;
    }
    if (['NAVIGATE', 'BACK', 'CLEAR_NOTICE'].includes(action.type)) {
      this.host = change(this.host);
      this.navigate({ ...this.route, screen: this.host.chain.screen, anchor: action.type === 'NAVIGATE' ? undefined : this.route.anchor }, { replace: action.type === 'CLEAR_NOTICE' });
      return;
    }
    void this.commit(change, (next) => next.chain.screen !== this.route.screen ? this.navigate({ ...this.route, screen: next.chain.screen }) : undefined);
  };

  private openCompare(focus?: SelectionAnchor): void {
    const matter = this.matter();
    if (!matter) return;
    const fresh = this.host.chain.sessions[matter.id].contextMode === 'fresh';
    const selected = focus || this.route.anchor;
    const basis = fresh && !selected ? { field: 'discussion' } : selected || { field: this.route.screen === 'understanding' ? 'understanding' : this.route.screen === 'discussion' ? 'discussion' : 'originalText' };
    const anchor = B.selectComparisonAnchor(this.host, matter.id, basis);
    if (!anchor) { this.message('没有可比较的文字。先选一句原话、补充或已保存的理解。'); return; }
    void this.commit((state) => B.openComparison(state, { sessionId: uid('compare'), matterId: matter.id, anchor, returnTarget: { ...clone(this.route), anchor } }), (next) => this.navigate(next.route));
  }

  onComparisonAction = (action: any): void => {
    if (this.busy || !this.host || !this.route.sessionId) return;
    const sessionId = this.route.sessionId;
    const change = (state: any) => B.dispatchComparison(state, { sessionId, action });
    if (/_DRAFT$|_PATCH$/.test(action.type)) {
      const next = change(this.host); if (next.error) { this.message(next.error.message); return; }
      this.draft(next); return;
    }
    if (['LINK', 'CONFIRM_REVISION', 'UNDO_REVISION'].includes(action.type)) {
      this.busy = true; this.emit();
      void (async () => {
        try {
          await this.flush();
          const prepared = change(this.host);
          if (prepared.error) { this.message(prepared.error.message); return; }
          const requestId = prepared.comparisons[sessionId].model.request?.id;
          if (!requestId) { this.host = prepared; this.emit(); return; }
          const applied = B.applyPendingComparison(prepared, { sessionId, requestId });
          if (!applied.outcome.ok) { this.host = B.deliverComparisonResult(prepared, { sessionId, requestId, outcome: applied.outcome }); this.emit(); return; }
          const finish = () => { this.host = B.deliverComparisonResult(applied.host, { sessionId, requestId, outcome: applied.outcome }); this.dirty += 1; this.emit(); void this.flush().catch(() => undefined); };
          this.continuation = finish;
          await this.save(applied.host, requestId);
          this.continuation = null;
          finish();
        } catch (cause) {
          if (!this.pendingPayload) this.message(cause instanceof Error ? cause.message : String(cause));
        } finally {
          this.busy = false; this.emit();
        }
      })();
      return;
    }
    void this.commit(change);
  };

  onReturnComparison = (): void => {
    if (!this.route.sessionId) return;
    const next = B.returnFromComparison(this.host, this.route.sessionId);
    if (next.error && next.error.code !== 'stale_anchor') { this.message(next.error.message); return; }
    this.host = next;
    this.navigate(next.route);
  };

  continueComparison = (): void => {
    if (!this.route.sessionId) return;
    const next = B.returnFromComparison(this.host, this.route.sessionId);
    if (next.error && next.error.code !== 'stale_anchor') { this.message(next.error.message); return; }
    this.host = next;
    this.navigate({ ...next.route, screen: 'discussion' });
  };

  onWorkAction = (action: any): void => {
    if (this.busy || !this.host || !this.route.workId) return;
    if (action.type === 'SELECT_WORK') { this.navigate({ view: 'worksite', workId: action.id, screen: 'overview' }); return; }
    const change = (state: any) => B.dispatchWorksite(state, { workId: this.route.workId, action });
    if (/_DRAFT$/.test(action.type)) {
      const next = change(this.host); if (next.error) { this.message(next.error.message); return; }
      this.draft(next); return;
    }
    if (action.type === 'NAVIGATE') {
      this.host = change(this.host);
      this.navigate({ ...this.route, screen: this.host.worksite.sessions[this.route.workId].screen });
      return;
    }
    void this.commit(change, () => {
      if (action.type === 'TRY_AGAIN') this.navigate({ view: 'chain', matterId: this.route.matterId, screen: 'handoff' });
      else {
        const nextScreen = B.selectWorksite(this.host, this.route.workId).screen;
        if (nextScreen !== this.route.screen) this.navigate({ ...this.route, screen: nextScreen });
      }
    });
  };

  onMattersAction = (action: any): void => {
    if (!this.host) return;
    if (action.type === 'OPEN') {
      const selected = this.host.chain.matters.find((matter: any) => matter.id === action.id);
      if (!selected) return;
      this.mattersPresentation = { mode: 'reentry', selectedId: selected.id, deepTab: 'care', contextMode: 'resume', query: '' };
      this.emit();
      return;
    }
    if (action.type === 'SEARCH') {
      this.mattersPresentation = null;
      this.navigate({ view: 'search', q: action.query });
      return;
    }
    if (action.type === 'BACK' || action.type === 'OVERVIEW') {
      if (this.mattersPresentation && this.mattersPresentation.mode !== 'overview') {
        if (this.mattersPresentation.mode === 'deep') this.mattersPresentation = { ...this.mattersPresentation, mode: 'reentry' };
        else this.mattersPresentation = null;
        this.emit();
      } else this.back();
      return;
    }
    const selectedId = this.mattersPresentation?.selectedId;
    if (!selectedId) return;
    if (action.type === 'CONTINUE') {
      const screen = action.tab === 'understanding' ? 'understanding' : action.tab === 'comparison' ? 'resume' : 'resume';
      this.navigate({ view: 'chain', matterId: selectedId, screen });
      return;
    }
    if (action.type === 'FRESH') {
      this.navigate({ view: 'chain', matterId: selectedId, screen: 'reentry' });
      return;
    }
    if (action.type === 'TAB') {
      this.mattersPresentation = { ...this.mattersPresentation!, mode: 'deep', deepTab: action.tab };
      this.emit();
    }
  };

  updatePreferences(displayName: string, reduceMotion: boolean): void {
    void this.commit(
      (state) => ({ ...state, preferences: { displayName: displayName.trim(), reduceMotion } }),
      () => {
        this.closeDialog();
        this.setStatus('saved', '设置已保存');
      },
    );
  }

  getTitleOfMatter(matter: any): string { return titleOf(matter); }
  getHomeEntries(): any { return this.host ? homeEntries(this.host) : {}; }
  getMattersView(): any {
    if (!this.host) return null;
    const view = mattersView(this.host);
    if (!this.mattersPresentation) return view;
    const selected = view.matters.find((matter: any) => matter.id === this.mattersPresentation!.selectedId) || null;
    return { ...view, ...this.mattersPresentation, selected };
  }
}

export const runtime = new WebRuntime();

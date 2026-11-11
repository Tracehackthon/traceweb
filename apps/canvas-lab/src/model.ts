export type Engine = 'drawnix' | 'reactflow';
export type Kind = 'text' | 'image' | 'video' | 'audio' | 'web' | 'pdf';
export type Material = {
  id: string; kind: Kind; title: string; original: string; note: string;
  origin: 'fixture' | 'agent-proposal' | 'user-edited-proposal';
  source: { url: string; available: boolean; page?: number; region?: number[]; start?: number; end?: number; fromIds?: string[] };
  asset?: string;
};
export type Suggestion = { id: string; text: string; fromIds: string[]; status: 'pending' | 'accepted' | 'deferred' | 'rejected'; adoptedId?: string };
export type Session = {
  schema: 1; engine: Engine; materials: Record<string, Material>; layout: any;
  suggestions: Suggestion[]; request: { ids: string[]; materials: Material[] } | null;
};
export type EngineApi = {
  diagnostics?: () => unknown;
  snapshot: () => any; select: (ids: string[]) => void; tool: (value: 'select' | 'ink' | 'pan') => void;
  undo: () => void; redo: () => void; group: () => void; ungroup: () => void;
  connect: (from: string, to: string, id: string) => void; unlink: () => void;
  add: (id: string) => void; fit: () => void;
};
export type EngineProps = {
  store: LabStore; initial: any; ready: (api: EngineApi) => void;
  change: (layout: any) => void; selection: (ids: string[]) => void;
};
const originals: Omit<Material, 'id' | 'note' | 'origin'>[] = [
  { kind: 'text', title: '一个还没想清楚的问题', original: '把材料放在一起，不等于已经弄懂它们的关系。这里保留我的原话，允许暂时没有结论。', source: { url: '/fixtures/source.html#thought', available: true } },
  { kind: 'image', title: '截图 · 一次阅读的局部', original: '自己制作的网页截图；不是用户私人材料。', asset: '/fixtures/screenshot.png', source: { url: '/fixtures/source.html#screenshot', available: true, region: [0, 0, 680, 460] } },
  { kind: 'video', title: '视频 · 1 到 3 秒', original: '自产色块移动片段；只验证媒体操作与来源定位。', asset: '/fixtures/clip.webm', source: { url: '/fixtures/clip.webm', available: true, start: 1, end: 3 } },
  { kind: 'audio', title: '录音 · 0.5 到 2 秒', original: '自产测试音，不含人声或私人录音。', asset: '/fixtures/tone.wav', source: { url: '/fixtures/tone.wav', available: true, start: 0.5, end: 2 } },
  { kind: 'web', title: '网页摘录 · 保留来路', original: '新的理解可以修正旧的联系；一条建议不是既有事实。', source: { url: '/fixtures/source.html#excerpt', available: true } },
  { kind: 'pdf', title: 'PDF · 第 1 页的局部', original: '第 1 页，PDF 点坐标区域 [36, 81, 432, 120]；保留 PDF 原件与预制局部。', asset: '/fixtures/pdf-region.png', source: { url: '/fixtures/paper.pdf#page=1', available: true, page: 1, region: [36, 81, 432, 120] } },
  { kind: 'web', title: '来源暂时不可用', original: '已经取得的片段仍保留，但不假装能访问原文。', source: { url: '/fixtures/unavailable.html', available: false } },
];
export const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
export function seed(engine: Engine, count = 7): Session {
  const materials: Record<string, Material> = {};
  for (let i = 0; i < count; i++) {
    const id = `m${String(i + 1).padStart(3, '0')}`;
    materials[id] = { ...clone(originals[i % originals.length]), id, title: originals[i % originals.length].title + (i >= 7 ? ` · ${i + 1}` : ''), note: '', origin: 'fixture' };
  }
  return { schema: 1, engine, materials, layout: null, suggestions: [], request: null };
}
const KIND: Kind[] = ['text', 'image', 'video', 'audio', 'web', 'pdf'];
const finitePoint = (p: any) => Array.isArray(p) && p.length === 2 && p.every((n: any) => typeof n === 'number' && Number.isFinite(n));
export function validate(value: any, engine: Engine): Session {
  if (value?.schema !== 1 || value.engine !== engine || !value.materials || typeof value.materials !== 'object' || Array.isArray(value.materials) || !Array.isArray(value.suggestions)) throw new Error('不是当前候选的有效样例文件');
  const ids = Object.keys(value.materials);
  if (!ids.length || ids.length > 1000) throw new Error('材料数量必须为 1–1000');
  for (const [id, m] of Object.entries<any>(value.materials)) {
    if (!/^[-\w]+$/.test(id) || id !== m.id || !KIND.includes(m.kind) || typeof m.original !== 'string' || typeof m.note !== 'string' || typeof m.title !== 'string' || !['fixture', 'agent-proposal', 'user-edited-proposal'].includes(m.origin) || typeof m.source?.available !== 'boolean' || typeof m.source?.url !== 'string') throw new Error('材料身份、原稿或来源字段损坏');
    if (![m.source.url, m.asset].filter(Boolean).every((url: string) => url.startsWith('/fixtures/') || url.startsWith('#proposal-'))) throw new Error('样例只接受本地测试来源');
    if (m.source.start !== undefined && (!Number.isFinite(m.source.start) || !Number.isFinite(m.source.end) || m.source.start < 0 || m.source.start >= m.source.end)) throw new Error('媒体片段范围损坏');
    if (m.source.page !== undefined && (!Number.isInteger(m.source.page) || m.source.page < 1)) throw new Error('PDF 页码损坏');
    if (m.source.region && (!Array.isArray(m.source.region) || m.source.region.length !== 4 || !m.source.region.every(Number.isFinite))) throw new Error('来源区域损坏');
  }
  for (const s of value.suggestions) {
    if (typeof s.id !== 'string' || typeof s.text !== 'string' || !Array.isArray(s.fromIds) || !s.fromIds.every((id: string) => ids.includes(id)) || !['pending', 'accepted', 'deferred', 'rejected'].includes(s.status) || (s.adoptedId && !ids.includes(s.adoptedId))) throw new Error('建议引用或采用状态损坏');
  }
  if (value.request && (!Array.isArray(value.request.ids) || !value.request.ids.every((id: string) => ids.includes(id)) || !Array.isArray(value.request.materials))) throw new Error('讨论输入损坏');
  const layout = value.layout;
  if (!layout) throw new Error('缺少画布状态');
  const nodes: any[] = engine === 'reactflow' ? layout.nodes : layout.children;
  if (!Array.isArray(nodes) || nodes.length > 10000) throw new Error('画布对象损坏');
  const nodeIds = new Set<string>();
  const materialIds = new Set<string>();
  for (const n of nodes) {
    if (typeof n.id !== 'string' || nodeIds.has(n.id)) throw new Error('画布对象身份重复或缺失');
    nodeIds.add(n.id);
    const mid = engine === 'reactflow' ? n.data?.materialId : n.materialId;
    if (mid) {
      if (!ids.includes(mid) || materialIds.has(mid)) throw new Error('画布材料引用无效');
      materialIds.add(mid);
    }
    if (engine === 'reactflow') {
      if (!['material', 'ink', 'group'].includes(n.type) || !Number.isFinite(n.position?.x) || !Number.isFinite(n.position?.y)) throw new Error('节点位置或类型损坏');
      if (n.type === 'material' && !mid) throw new Error('材料节点缺少内容身份');
      if (n.type === 'ink' && (!Array.isArray(n.data?.points) || n.data.points.length < 2 || !n.data.points.every(finitePoint) || !Number.isFinite(n.data.width) || !Number.isFinite(n.data.height))) throw new Error('手绘数据损坏');
    } else {
      if (!['trace-material', 'group', 'freehand', 'arrow-line'].includes(n.type)) throw new Error('不是本样例支持的画布对象');
      if (n.type === 'trace-material' && !mid) throw new Error('材料形状缺少内容身份');
      if (n.type !== 'group' && (!Array.isArray(n.points) || n.points.length < 2 || !n.points.every(finitePoint))) throw new Error('画布坐标损坏');
      if (n.type === 'arrow-line' && (!n.source || !n.target || !Array.isArray(n.texts) || !['curve', 'straight', 'elbow'].includes(n.shape))) throw new Error('连线结构损坏');
    }
  }
  // Removing/undoing a placement does not delete its canonical material. An
  // unplaced material remains recoverable from the scoped material list.
  if (engine === 'reactflow') {
    if (!Array.isArray(layout.edges) || !layout.edges.every((e: any) => typeof e.id === 'string' && nodeIds.has(e.source) && nodeIds.has(e.target))) throw new Error('连线引用损坏');
    for (const n of nodes) {
      const seen = new Set([n.id]); let current = n;
      while (current.parentId) { const parent = nodes.find(p => p.id === current.parentId); if (!parent || parent.type !== 'group' || seen.has(parent.id)) throw new Error('分组引用损坏或形成循环'); seen.add(parent.id); current = parent; }
    }
    if (![layout.viewport?.x, layout.viewport?.y, layout.viewport?.zoom].every(Number.isFinite) || layout.viewport.zoom <= 0) throw new Error('视口损坏');
  } else {
    if (!finitePoint(layout.viewport?.origination) || !Number.isFinite(layout.viewport?.zoom) || layout.viewport.zoom <= 0) throw new Error('视口损坏');
    for (const n of nodes) {
      for (const key of ['source', 'target']) if (n[key]?.boundId && !nodeIds.has(n[key].boundId)) throw new Error('连线端点损坏');
      const seen = new Set([n.id]); let current = n;
      while (current.groupId) { const parent = nodes.find(p => p.id === current.groupId); if (!parent || parent.type !== 'group' || seen.has(parent.id)) throw new Error('分组引用损坏或形成循环'); seen.add(parent.id); current = parent; }
    }
  }
  return clone(value);
}
export class LabStore {
  state: Session; listeners = new Set<() => void>();
  openSource: (material: Material) => void = () => {};
  constructor(state: Session) { this.state = state; }
  get = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  update(fn: (state: Session) => Session) { this.state = fn(this.state); this.listeners.forEach(fn => fn()); }
  note(id: string, note: string) { this.update(s => ({ ...s, materials: { ...s.materials, [id]: { ...s.materials[id], note } } })); }
}
const DB = 'trace-canvas-lab-v1';
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('sessions');
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
export async function load(engine: Engine) {
  const db = await database();
  return new Promise<Session | null>((resolve, reject) => {
    const tx = db.transaction('sessions'); const r = tx.objectStore('sessions').get(engine);
    r.onsuccess = () => { try { resolve(r.result ? validate(r.result, engine) : null); } catch (e) { reject(e); } };
    r.onerror = () => reject(r.error); tx.oncomplete = () => db.close();
  });
}
export async function save(state: Session) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put(clone(state), state.engine);
    tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

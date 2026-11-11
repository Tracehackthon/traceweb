import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { LabStore, clone, load, save, seed, validate, type Engine, type EngineApi, type Material, type Session, type Suggestion } from './model';
import { Media } from './MaterialCard';
import './style.css';
const Drawnix = lazy(() => import('./DrawnixCanvas'));
const Flow = lazy(() => import('./ReactFlowCanvas'));
const engine: Engine = new URLSearchParams(location.search).get('engine') === 'reactflow' ? 'reactflow' : 'drawnix';

function SourceDialog({ material: m, close }: { material: Material; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement; ref.current?.showModal(); return () => previous?.focus(); }, []);
  return <dialog ref={ref} onCancel={close} className="source-dialog" aria-labelledby="source-title">
    <header><div><small>原件与定位 · 不用描述替代素材</small><h2 id="source-title">{m.title}</h2></div><button onClick={close} aria-label="关闭出处">×</button></header>
    <div className="source-body">
      {!m.source.available && <p className="warning">来源不可用。下面仅为已保留片段，不代表原文仍可访问。</p>}
      <Media material={m} />
      <p>{m.original}</p>
      <dl><dt>来源</dt><dd>{m.source.url}</dd>{m.source.start !== undefined && <><dt>片段范围</dt><dd data-source-range>{m.source.start}–{m.source.end} 秒</dd></>}{m.source.page && <><dt>PDF 定位</dt><dd data-source-range>第 {m.source.page} 页 · 区域 [{m.source.region?.join(', ')}]</dd></>}{m.source.fromIds && <><dt>讨论来路</dt><dd>{m.source.fromIds.join('、')}</dd></>}</dl>
      {m.source.available && !m.source.url.startsWith('#') && <a className="button" href={m.source.url} target="_blank" rel="noopener noreferrer">打开原件{m.source.page ? ` · 第 ${m.source.page} 页` : ''}</a>}
    </div>
  </dialog>;
}
function Proposal({ proposal: p, decide }: { proposal: Suggestion; decide: (p: Suggestion, status: Suggestion['status'], text?: string) => void }) {
  const [draft, setDraft] = useState(p.text);
  return <section className="proposal" data-proposal={p.id}><small>固定模拟返回 · 来自 {p.fromIds.join('、')}</small><textarea aria-label={`改写 ${p.id}`} value={draft} disabled={p.status === 'accepted' || p.status === 'rejected'} onChange={e => setDraft(e.target.value)} />
    <div className="proposal-actions">{['pending', 'deferred'].includes(p.status) ? <><button onClick={() => decide(p, 'accepted', p.text)}>采纳原建议</button><button onClick={() => decide(p, 'accepted', draft)}>改写并接回</button><button onClick={() => decide(p, 'deferred')}>暂存</button><button onClick={() => decide(p, 'rejected')}>拒绝</button></> : <span>{p.status === 'accepted' ? `已接回 ${p.adoptedId}` : '已拒绝 · 原材料保留'}</span>}</div>
    {p.status === 'deferred' && <p className="caption">已暂存，尚未写入画布。</p>}
  </section>;
}
function App({ store, bootError }: { store: LabStore; bootError: string }) {
  const s = useSyncExternalStore(store.subscribe, store.get);
  const [epoch, setEpoch] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [source, setSource] = useState<Material | null>(null);
  const [message, setMessage] = useState(bootError);
  const [blocked, setBlocked] = useState(Boolean(bootError));
  const [saved, setSaved] = useState('等待画布初始化');
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState('select');
  const api = useRef<EngineApi | null>(null);
  const revision = useRef(0);
  const importInput = useRef<HTMLInputElement>(null);
  const initial = useMemo(() => s.layout, [epoch]);
  store.openSource = setSource;
  useEffect(() => {
    if (blocked || !s.layout) return;
    setSaved('保存中…');
    const ticket = ++revision.current;
    const timer = setTimeout(() => { void save(s).then(() => { if (ticket === revision.current) setSaved('已保存到独立测试存储'); }, e => { setSaved('保存失败 · 修改仍在当前页面'); setMessage(String(e)); }); }, 180);
    return () => clearTimeout(timer);
  }, [s, blocked]);
  const replace = (next: Session) => {
    setReady(false); api.current = null; setSelected([]); setSource(null); setTool('select');
    store.update(() => next); setEpoch(e => e + 1);
  };
  const choose = (id: string) => { const ids = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]; api.current?.select(ids); setSelected(ids); };
  const discuss = () => {
    if (!selected.length) return;
    const ids = [...selected]; const time = Date.now();
    store.update(state => ({ ...state, request: { ids, materials: ids.map(id => clone(state.materials[id])) }, suggestions: [...state.suggestions,
      { id: `p-${time}-1`, text: '这些材料值得放在一起看，但还不足以说明它们存在因果关系。', fromIds: ids, status: 'pending' },
      { id: `p-${time}-2`, text: '可以先保留问题：哪些差异会改变目前的解释？', fromIds: ids, status: 'pending' },
    ] }));
    setMessage('模拟讨论完成：未调用真实模型，仅使用右侧列明的选中材料。');
  };
  const decide = (p: Suggestion, status: Suggestion['status'], text?: string) => {
    if (p.status === 'accepted' || p.status === 'rejected') return;
    const id = status === 'accepted' ? `returned-${p.id}` : undefined;
    store.update(state => ({ ...state,
      materials: id ? { ...state.materials, [id]: { id, kind: 'text', title: '接回的一点思考', original: text || p.text, note: '', origin: text === p.text ? 'agent-proposal' : 'user-edited-proposal', source: { url: `#proposal-${p.id}`, available: true, fromIds: p.fromIds } } } : state.materials,
      suggestions: state.suggestions.map(item => item.id === p.id ? { ...item, status, adoptedId: id } : item),
    }));
    if (id) api.current?.add(id);
  };
  const exportState = () => {
    const doc = { ...store.get(), layout: api.current?.snapshot() };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `trace-canvas-lab-${engine}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('样例文件超过 8 MiB');
      const next = validate(JSON.parse(await file.text()), engine);
      replace(next); setMessage('导入成功：材料、原稿及画布状态已恢复。');
    } catch (e) { setMessage(`未导入，现有状态未改动：${e instanceof Error ? e.message : e}`); }
    if (importInput.current) importInput.current.value = '';
  };
  useEffect(() => {
    (window as any).__canvasLab = { getState: () => clone(store.get()), snapshot: () => api.current?.snapshot(), diagnostics: () => api.current?.diagnostics?.(), selected: () => [...selected], storageName: 'trace-canvas-lab-v1', engine, ready };
    return () => { delete (window as any).__canvasLab; };
  }, [store, selected, ready]);
  const Candidate = engine === 'drawnix' ? Drawnix : Flow;
  const placedIds = new Set<string>((engine === 'drawnix' ? s.layout?.children : s.layout?.nodes)?.map((n: any) => n.materialId || n.data?.materialId).filter(Boolean) || []);
  return <div className="lab-shell" data-tool={tool}>
    <header className="lab-header"><div className="brand"><span className="brand-mark">T</span><div><strong>Trace <span>/ 画布验证室</span></strong><small>技术验证，非正式产品 · 本地自产材料 · 不连接真实 Agent</small></div></div>
      <nav aria-label="候选底座"><a href="?engine=drawnix" aria-current={engine === 'drawnix' ? 'page' : undefined}>01 Drawnix / Plait</a><a href="?engine=reactflow" aria-current={engine === 'reactflow' ? 'page' : undefined}>02 React Flow</a></nav>
    </header>
    <div className="lab-workspace"><main className="canvas-column">
      <div className="scene-heading"><div><p className="eyebrow">同一组材料 · 同一组操作</p><h1>先放在一起，再慢慢想。</h1></div><label>场景<select aria-label="材料数量" defaultValue="7" onChange={e => { setBlocked(false); replace(seed(engine, Number(e.target.value))); setMessage('仅重置本候选的测试场景，正式产品未改动。'); }}><option value="7">7 张材料卡</option><option value="50">50 张 · 测量</option><option value="200">200 张 · 测量</option></select></label></div>
      <div className="lab-toolbar plait-board-attached" aria-label="画布操作">
        <div>{(['select', 'pan', 'ink'] as const).map((v, i) => <button key={v} data-tool={v} aria-pressed={tool === v} onClick={() => { setTool(v); api.current?.tool(v); }}>{['选择', '平移', '手绘'][i]}</button>)}</div>
        <div><button data-action="undo" onClick={() => api.current?.undo()}>撤销</button><button data-action="redo" onClick={() => api.current?.redo()}>重做</button><button data-action="fit" onClick={() => api.current?.fit()}>查看全部</button></div>
        <div><button data-action="group" disabled={selected.length < 2} onClick={() => api.current?.group()}>分组</button><button data-action="ungroup" onClick={() => api.current?.ungroup()}>取消分组</button><button data-action="connect" disabled={selected.length !== 2} onClick={() => api.current?.connect(selected[0], selected[1], `relation-${Date.now()}`)}>连接所选</button><button data-action="unlink" onClick={() => api.current?.unlink()}>解除连线</button></div>
      </div>
      <div className="canvas-container"><Suspense fallback={<div className="loading">正在加载 {engine}，未启动另一套引擎…</div>}><Candidate key={epoch} store={store} initial={initial}
        ready={value => { api.current = value; setReady(true); }}
        change={layout => store.update(state => ({ ...state, layout }))} selection={setSelected} /></Suspense></div>
      <footer className="canvas-footer plait-board-attached"><span data-save-state>{saved}</span><span>{Object.keys(s.materials).length} 份材料 · {selected.length} 份选中</span><div><button onClick={exportState} disabled={!ready} data-action="export">导出样例</button><button onClick={() => importInput.current?.click()}>导入样例</button><input ref={importInput} type="file" accept="application/json,.json" aria-label="导入样例文件" hidden onChange={e => void importFile(e.target.files?.[0])} /></div></footer>
    </main>
    <aside className="thinking-panel plait-board-attached"><div className="panel-heading"><span className="status-dot" /><h2>围绕选中内容</h2><span className="badge">固定模拟</span></div><p className="panel-intro">只带入你选中的材料。建议先留在这里，接不接回由你决定。</p>
      <details className="material-list" open><summary>本次参考范围 <span>{selected.length} 份</span></summary><div>{Object.values(s.materials).map(m => <div className="material-entry" key={m.id}><label><input type="checkbox" checked={selected.includes(m.id)} onChange={() => choose(m.id)} disabled={!ready || !placedIds.has(m.id)} /><span>{m.title}</span><small>{m.id}</small></label>{!placedIds.has(m.id) && <button data-restore={m.id} onClick={() => api.current?.add(m.id)}>未放在画布 · 放回</button>}</div>)}</div></details>
      <button className="primary" data-action="discuss" disabled={!selected.length || !ready} onClick={discuss}>用这 {selected.length} 份材料模拟讨论 ↗</button>
      <p className="message" role="status" data-message>{message || '没有建议也可以继续表达，不必产生结论。'}</p>
      {blocked && <button className="danger" onClick={() => { setBlocked(false); replace(seed(engine)); setMessage('已明确重置损坏的测试存储。'); }}>明确重置损坏的测试场景</button>}
      {s.suggestions.map(p => <Proposal key={p.id} proposal={p} decide={decide} />)}
      {s.request && <details className="request-details"><summary>核对本次实际输入</summary><pre data-request>{JSON.stringify(s.request, null, 2)}</pre></details>}
      <div className="panel-footnote"><strong>这不是正式选型结论</strong><p>先核验材料、手绘、关联、回流与恢复；默认界面不代表 Trace 最终设计。</p></div>
    </aside></div>
    {source && <SourceDialog key={source.id} material={source} close={() => setSource(null)} />}
  </div>;
}
let state: Session; let bootError = '';
try { state = await load(engine) || seed(engine); } catch (e) { state = seed(engine); bootError = `测试存储读取失败，已暂停自动保存，不覆盖原数据：${e instanceof Error ? e.message : e}`; }
createRoot(document.getElementById('root')!).render(<App store={new LabStore(state)} bootError={bootError} />);

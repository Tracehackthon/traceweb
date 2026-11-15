import { useSyncExternalStore } from 'react';
import type { Material, LabStore } from './model';
const labels = { text: '文字', image: '截图', video: '视频', audio: '音频', web: '网页', pdf: 'PDF 局部' };
export function Media({ material: m }: { material: Material }) {
  if (m.kind === 'video' || m.kind === 'audio') {
    const Tag = m.kind;
    return <Tag controls preload="metadata" src={m.asset} aria-label={m.title}
      onLoadedMetadata={e => { e.currentTarget.currentTime = m.source.start || 0; }}
      onTimeUpdate={e => { const el = e.currentTarget; if (m.source.end && el.currentTime >= m.source.end) { el.pause(); el.currentTime = m.source.end; } }} />;
  }
  if (m.asset) return <img src={m.asset} alt={m.original} draggable={false} loading="lazy" />;
  return <p className="original">{m.original}</p>;
}
export function MaterialCard({ id, store }: { id: string; store: LabStore }) {
  const state = useSyncExternalStore(store.subscribe, store.get);
  const m = state.materials[id];
  if (!m) return null;
  return <article className="material-card" data-material={id}>
    <header className="card-grip" data-grip={id}><span>{labels[m.kind]}</span><small>{id}</small><h3>{m.title}</h3></header>
    <div className="card-controls nodrag nopan nowheel" onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
      <Media material={m} />
      {m.kind !== 'text' && m.kind !== 'web' && <p className="caption">{m.original}</p>}
      {m.origin !== 'fixture' && <span className="provenance">{m.origin === 'agent-proposal' ? '用户采纳的模拟建议' : '用户改写 · 保留模拟建议来路'}</span>}
      <label>我的批注<textarea aria-label={`${id} 批注`} value={m.note} onChange={e => store.note(id, e.target.value)} placeholder="可以先记一点，不必形成结论" /></label>
      <button className="source-button" data-source={id} onClick={() => store.openSource(m)}>{m.source.available ? '↗ 返回原出处' : '来源不可用 · 查看已留片段'}</button>
    </div>
  </article>;
}

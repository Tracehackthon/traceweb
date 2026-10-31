/* Timeline/expanded comparison structure adapted from EasyUI RecoveryLedger,
 * MIT, copyright (c) 2026 Suraj Maurya, commit 7c106d4a195f9ce566ffbbc672fc48bed68d30bd.
 * No upstream restore handler, fabricated timestamps, Motion or theme retained.
 * Full upstream notice: public/licenses/easyui-MIT.txt. */
import React, { useId, useState } from 'react';
import { TraceIcon } from './icon';

export interface EvolutionEntry { id: string; action: string; description: string; state: string; before: string | null; after: string; beforeVersion?: number; afterVersion?: number; resultId?: string | null }
const labels: Record<string, string> = { original: '原稿', current: '当前', historical: '历史 · 不作为当前判断', undone: '已撤销 · 不作为当前判断' };
export function EvolutionPanel({ entries, selectedId }: { entries: EvolutionEntry[]; selectedId?: string }) {
  const [expanded, setExpanded] = useState<string | null>(selectedId || null);
  const prefix = useId();
  if (!entries.length) return <section className="tu-empty"><TraceIcon name="history" size={20} /><h3>没有这项内容的演变记录</h3><p>没有补造历史。原件、结果和孤立材料仍可在“内容”中查看。</p></section>;
  return <section className="tu-evolution" aria-label="内容演变">
    <p className="tu-muted">这里只回看，不修改当前理解。仅显示实际保留的原稿、修订和当前内容；未留快照的直接编辑无法还原。</p>
    <ol className="tu-timeline">{entries.map((entry, index) => {
      const isExpanded = expanded === entry.id;
      const panelId = `${prefix}-${index}`;
      return <li className="tu-timeline-entry" key={entry.id} data-state={entry.state}>
        <span className="tu-timeline-dot" aria-hidden="true" />
        <button className="tu-history-trigger" type="button" aria-expanded={isExpanded} aria-controls={panelId} onClick={() => setExpanded(isExpanded ? null : entry.id)}>
          <span className="tu-history-heading"><strong>{entry.action}{entry.afterVersion != null ? ` · v${entry.afterVersion}` : ''}</strong><span className="tu-badge" data-tone={entry.state === 'current' ? 'positive' : 'neutral'}>{labels[entry.state] || '记录'}</span></span>
          <span className="tu-history-description">{entry.description || '内容为空'}</span><TraceIcon name={isExpanded ? 'down' : 'right'} size={16} />
        </button>
        <div className="tu-history-detail" id={panelId} hidden={!isExpanded}>
          {entry.before !== null ? <div className="tu-revision-compare" aria-label="本次修订前后对照"><section><h4>修改前{entry.beforeVersion != null ? ` · v${entry.beforeVersion}` : ''}</h4><p>{entry.before || '当时为空'}</p></section><section><h4>修改后{entry.afterVersion != null ? ` · v${entry.afterVersion}` : ''}</h4><p>{entry.after || '当时为空'}</p></section></div> : <p className="tu-preserve">{entry.after || '内容为空'}</p>}
          <small>回看不会产生修订，也不会重新启用历史内容。</small>
        </div>
      </li>;
    })}</ol>
  </section>;
}

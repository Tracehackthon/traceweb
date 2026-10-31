import React from 'react';
import { TraceIcon } from './icon';
import { sourceLink } from './library-projection.mjs';
export interface ReferenceItem { id: string; title: string; text: string; href?: string | null; status?: string }
/** Display the caller's actual scope. This is not a picker and never adds
 * related material or the entire host on behalf of a collaboration caller. */
export function ReferenceList({ items, label }: { items: ReferenceItem[]; label: string }) {
  return <section className="trace-ui" aria-label={label}><h3>{label}</h3><ul className="trace-ui tu-reference-list">{items.length ? items.map(item => <li className="tu-reference-item" key={item.id}><strong>{item.title}</strong><p>{item.text || '未记录摘录'}</p>{item.status && <small>{item.status}</small>}{sourceLink(item.href) && <div><a className="tu-source-link" href={sourceLink(item.href)!} target="_blank" rel="noopener noreferrer">查看原出处<TraceIcon name="external" size={16} /></a></div>}</li>) : <li className="tu-reference-item">当前范围没有材料；没有自动补入其他历史。</li>}</ul></section>;
}

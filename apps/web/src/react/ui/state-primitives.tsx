/* Presentation composition adapted from shadcn/ui (MIT), copyright (c) 2023 shadcn.
 * Fixed source: 24a16429815cc4d691f38b49d0f4ffc11a9daef4,
 * apps/v4/registry/bases/radix/ui/{empty,alert,skeleton}.tsx.
 * Replaced Tailwind/cva/cn with Trace CSS; no business or network ownership.
 * See public/licenses/shadcn-MIT.txt and vendor/ui-boundary-source-record.json. */
import React, { useId } from 'react';
import { ProcessState, type ProcessPhase } from './controls';
import { TraceIcon, type IconName } from './icon';
import './state-primitives.css';

export function TraceEmptyState({ title, description, icon = 'document', children, actions }: {
  title: string; description: string; icon?: IconName; children?: React.ReactNode; actions?: React.ReactNode;
}) {
  const id = useId();
  return <section className="tu-state-empty" data-slot="empty" aria-labelledby={id}>
    <div data-slot="empty-header"><TraceIcon name={icon} size={20} />
      <h2 id={id} data-slot="empty-title">{title}</h2>
      <p data-slot="empty-description">{description}</p>
    </div>
    {children}
    {actions && <div className="tu-state-actions" data-slot="empty-content">{actions}</div>}
  </section>;
}

export function TraceStatusNotice({ phase, title, description, actions }: {
  phase: ProcessPhase; title: string; description: string; actions?: React.ReactNode;
}) {
  const id = useId();
  return <section className="tu-status-notice" data-slot="alert" data-phase={phase} aria-labelledby={id}>
    <ProcessState phase={phase}><strong id={id} data-slot="alert-title">{title}</strong>
      <span className="tu-notice-description" data-slot="alert-description">{description}</span>
    </ProcessState>
    {actions && <div className="tu-state-actions" data-slot="alert-action">{actions}</div>}
  </section>;
}

/** Decorative placeholder only: the owner supplies aria-busy and a live message. */
export function TraceSkeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div data-slot="skeleton" className={`tu-skeleton ${className}`} style={style} aria-hidden="true" />;
}

/** Controlled expansion lets the owner preserve it across navigation/unmounts. */
export function TraceExpandableText({ text, expanded, onExpandedChange, label = '正文', lines = 3 }: {
  text: string; expanded: boolean; onExpandedChange: (expanded: boolean) => void; label?: string; lines?: number;
}) {
  const id = useId();
  return <section className="tu-expandable" aria-label={label}>
    <div id={id} className="tu-expandable-body" data-expanded={expanded} style={{ '--trace-clamp-lines': Math.max(1, lines) } as React.CSSProperties}>{text}</div>
    <button type="button" className="tu-button tu-ghost" aria-expanded={expanded} aria-controls={id} onClick={() => onExpandedChange(!expanded)}>{expanded ? '收起' : '展开全文'} · {label}</button>
  </section>;
}

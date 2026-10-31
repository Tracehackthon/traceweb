/* Origin-aware menu/tooltip presentation adapted from EasyUI (MIT),
 * copyright (c) 2026 Suraj Maurya. Source: 7c106d4a195f9ce566ffbbc672fc48bed68d30bd
 * OriginDropdown.tsx / DirectionalTooltip.tsx. Behavior is Radix, not EasyUI's
 * manual outside-click/positioning code. See public/licenses/easyui-MIT.txt. */
import React, { useEffect, useRef, useState } from 'react';
import { MENU_TIMING, inMenuSafeZone } from './menu-intent.mjs';
import { DropdownMenu, Tooltip } from 'radix-ui';
import { TraceIcon, type IconName } from './icon';

export const TraceTooltipProvider = Tooltip.Provider;
export function TraceTooltip({ children, content, side = 'top' }: { children: React.ReactElement; content: React.ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return <Tooltip.Root><Tooltip.Trigger asChild>{children}</Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="trace-ui tu-tooltip" side={side} sideOffset={8} collisionPadding={12}>{content}<Tooltip.Arrow className="tu-tooltip-arrow" /></Tooltip.Content></Tooltip.Portal></Tooltip.Root>;
}

export interface MenuAction { id: string; label: string; icon?: IconName; disabled?: boolean; destructive?: boolean; children?: MenuAction[] }
export function TraceMenu({ label, actions, onAction, open, onOpenChange, pendingId, error, side = 'bottom' }: {
  label: string; actions: MenuAction[]; onAction: (id: string) => void;
  open?: boolean; onOpenChange?: (open: boolean) => void; pendingId?: string;
  error?: string; side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  return <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
    <DropdownMenu.Trigger asChild><button type="button" className="trace-ui tu-button tu-icon-button" aria-label={label}><TraceIcon name="more" /></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="trace-ui tu-menu" side={side} align="end" sideOffset={6} collisionPadding={12} aria-label={label}>
      <MenuRows actions={actions} onAction={onAction} pendingId={pendingId} title={label} />
      {pendingId && <p className="tu-menu-message" role="status">正在处理；关闭菜单不会撤销已发出的操作。</p>}
      {error && <p className="tu-menu-message" role="alert">{error}</p>}
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

// Radix retains focus, keyboard navigation, dismissal and collision handling.
function MenuRows({ actions, onAction, pendingId, title }: { actions: MenuAction[]; onAction: (id: string) => void; pendingId?: string; title: string }) {
  const [active, setActive] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const panels = useRef(new Map<string, HTMLElement>());
  const points = useRef<{ x: number; y: number }[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => clearTimeout(timer.current);
  useEffect(() => () => clearTimeout(timer.current), []);
  const safe = () => {
    const row = active && rows.current.get(active);
    const panel = active && panels.current.get(active);
    return Boolean(row && panel && inMenuSafeZone(points.current.at(-1), points.current.at(-2), row.parentElement!.getBoundingClientRect(), panel.getBoundingClientRect(), panel.dataset.side));
  };
  const enter = (action: MenuAction, drag = false) => {
    cancel();
    if (action.disabled || pendingId) return;
    const started = Date.now();
    const apply = () => {
      if (safe() && Date.now() - started < MENU_TIMING.safe) {
        timer.current = setTimeout(apply, MENU_TIMING.recheck);
      } else setActive(action.children?.length ? action.id : null);
    };
    timer.current = setTimeout(apply, drag ? MENU_TIMING.drag : MENU_TIMING.open);
  };
  const track = (event: React.PointerEvent) => {
    points.current = [...points.current.slice(-1), { x: event.clientX, y: event.clientY }];
  };
  return <><DropdownMenu.Label className="tu-menu-title">{title}</DropdownMenu.Label>{actions.map(action => {
    const contents = <>{action.icon && <TraceIcon name={action.icon} size={18} />}<span>{action.label}</span>{pendingId === action.id && <TraceIcon name="spinner" size={16} className="tu-working" />}</>;
    const events = {
      onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => { track(event); if (safe()) event.preventDefault(); },
      onPointerLeave: () => cancel(),
      onDragEnter: () => enter(action, true),
    };
    return action.children?.length ? <DropdownMenu.Sub key={action.id} open={active === action.id} onOpenChange={value => { if (!value && !safe()) setActive(null); }}>
      <DropdownMenu.SubTrigger {...events} ref={node => { if (node) rows.current.set(action.id, node); else rows.current.delete(action.id); }} className="tu-menu-item" disabled={action.disabled || Boolean(pendingId)}
        onPointerEnter={event => { if (event.pointerType !== 'touch') enter(action); }}
        onPointerDown={event => { if (event.pointerType === 'touch') { cancel(); setActive(action.id); } }}
        onClick={() => { cancel(); setActive(action.id); }}
        onKeyDown={event => { if (['ArrowRight', 'Enter', ' '].includes(event.key)) { cancel(); setActive(action.id); } }}>
        {contents}<span className="tu-menu-chevron" aria-hidden="true">›</span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal><DropdownMenu.SubContent ref={node => { if (node) panels.current.set(action.id, node); else panels.current.delete(action.id); }} className="trace-ui tu-menu tu-submenu" sideOffset={-8} collisionPadding={12} onPointerEnter={cancel}>
        <MenuRows actions={action.children} title={action.label} onAction={onAction} pendingId={pendingId} />
      </DropdownMenu.SubContent></DropdownMenu.Portal>
    </DropdownMenu.Sub> : <DropdownMenu.Item {...events} key={action.id} className="tu-menu-item" data-destructive={action.destructive || undefined} disabled={action.disabled || Boolean(pendingId)} onPointerEnter={() => enter(action)} onSelect={() => onAction(action.id)}>{contents}</DropdownMenu.Item>;
  })}</>;
}

export type ProcessPhase = 'idle' | 'pending' | 'success' | 'error' | 'unknown' | 'cancelled';
export function ProcessState({ phase, children }: { phase: ProcessPhase; children: React.ReactNode }) {
  const name: IconName = phase === 'pending' ? 'spinner' : phase === 'success' ? 'success' : phase === 'error' ? 'error' : phase === 'unknown' ? 'pending' : 'idle';
  return <div className="trace-ui tu-process-state" data-phase={phase} role={phase === 'error' ? 'alert' : 'status'} aria-live="polite"><TraceIcon name={name} size={16} className={phase === 'pending' ? 'tu-working' : ''} /><span>{children}</span></div>;
}

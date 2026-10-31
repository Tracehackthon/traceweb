/* Search/result presentation adapted from EasyUI CommandMenu, MIT,
 * copyright (c) 2026 Suraj Maurya, commit 7c106d4a195f9ce566ffbbc672fc48bed68d30bd.
 * Replaced the catalog/GitHub actions, global listeners, manual dialog,
 * Motion and Tailwind theme with real Product projections and scoped UI.
 * See public/licenses/easyui-MIT.txt. */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Tabs } from 'radix-ui';
import { queryRecords, routeForRecord, returnFocusSelectors, titleOf } from '../product/library.mjs';
import { runtime } from './runtime';
import type { RouteMemory, WorkspaceSnapshot } from './types';
import { TraceIcon, type IconName } from './ui/icon';
import { TraceMenu, TraceTooltip } from './ui/controls';
import { EvolutionPanel } from './ui/evolution-panel';
import { evolutionEntries, recordKindLabels, recordSource, sourceLink } from './ui/library-projection.mjs';

const kindIcons: Record<string, IconName> = { expression: 'document', understanding: 'document', discussion: 'discussion', source: 'link', result: 'work', revision: 'history', work: 'work', branch: 'discussion' };
const filters = [['', '全部'], ['expression', '原表达'], ['understanding', '理解'], ['source', '材料'], ['result', '结果'], ['revision', '修订'], ['work', '工作']];

function returnToOrigin(route: RouteMemory) {
  runtime.back();
  const focus = (attempt = 0) => {
    const selector = returnFocusSelectors(route).find(value => document.querySelector(value));
    const target = selector ? document.querySelector<HTMLElement>(selector) : null;
    if (target) { if (!target.matches('button,a,input,textarea,select,[tabindex]')) target.tabIndex = -1; target.focus({ preventScroll: true }); }
    else if (attempt < 6) requestAnimationFrame(() => focus(attempt + 1));
  };
  requestAnimationFrame(() => focus());
}

export function LibraryWorkspace({ snapshot, status }: { snapshot: WorkspaceSnapshot & { route: RouteMemory }; status?: React.ReactNode }) {
  const route = snapshot.route;
  const root = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLUListElement>(null);
  const composing = useRef(false);
  const [query, setQuery] = useState(route.q || '');
  const [narrowDetail, setNarrowDetail] = useState(Boolean(route.selectedId));
  const works = route.view === 'works';
  const kind = works ? 'work' : route.kind || '';
  const includeHistory = route.includeHistory !== 'false';
  const rows = useMemo(() => snapshot.host?.chain ? queryRecords(snapshot.host, { q: route.q || '', kind, matterId: route.matterId || '' }).filter(item => includeHistory || item.kind !== 'revision') : [], [snapshot.host, route.q, route.matterId, kind, includeHistory]);
  const selectedId = route.selectedId || route.recordId || rows[0]?.id;
  const selected = rows.find(item => item.id === selectedId);
  const entries = useMemo(() => evolutionEntries(snapshot.host, selected), [snapshot.host, selected?.id]);
  const source = recordSource(snapshot.host, selected);
  const href = sourceLink(source?.url);
  const matter = snapshot.host?.chain?.matters?.find((item: any) => item.id === route.matterId);
  const tab = route.detailTab === 'evolution' ? 'evolution' : 'content';

  const change = (patch: Partial<RouteMemory>) => { runtime.retain(); runtime.navigate({ ...runtime.getRoute(), ...patch, returnTarget: route.returnTarget }, { replace: true }); };
  const select = (id: string, detailTab = 'content') => { change({ selectedId: id, detailTab }); setNarrowDetail(true); };
  const openOriginal = (record = selected) => { const next = routeForRecord(record); if (next) { runtime.retain(); runtime.navigate(next, { origin: { ...runtime.getRoute(), selectedId: record.id } }); } };

  useEffect(() => { if (!composing.current) setQuery(route.q || ''); }, [route.q]);
  useLayoutEffect(() => {
    if (!root.current) return;
    runtime.setRouteRoot(root.current);
    runtime.restore(root.current, route);
    if (route.view === 'search' && !route.selectedId) input.current?.focus({ preventScroll: true });
    return () => runtime.setRouteRoot(null);
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key !== 'Escape' || snapshot.dialog || document.querySelector('[role="menu"], [role="tooltip"]')) return;
      event.preventDefault();
      if (narrowDetail && matchMedia('(max-width: 767px)').matches) { setNarrowDetail(false); input.current?.focus(); }
      else returnToOrigin(route);
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [route, snapshot.dialog, narrowDetail]);

  const moveInResults = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(results.current?.querySelectorAll<HTMLButtonElement>('[data-result-select]') || [])];
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  };
  const commitQuery = (value: string) => change({ q: value, selectedId: undefined, recordId: undefined, detailTab: 'content' });

  return <section className="trace-ui tu-library" ref={root} data-route-host data-narrow-detail={narrowDetail || undefined} aria-label={works ? '工作现场列表' : '找回与演变'}>
    <header className="tu-workspace-header">
      <button className="tu-wordmark" type="button" onClick={() => runtime.navigate({ view: 'home' })} aria-label="Trace，返回首页">Trace</button>
      <span className="tu-breadcrumb">我的空间 <span aria-hidden="true">/</span> {works ? '工作现场' : '找回与演变'}</span>
      <div className="tu-header-actions">
        <TraceTooltip content="个人与设置"><button type="button" className="tu-button tu-icon-button" aria-label="个人与设置" onClick={() => runtime.profile()}><TraceIcon name="settings" /></button></TraceTooltip>
        <TraceMenu label="更多查找操作" actions={[{ id: 'all', label: '全部痕迹', icon: 'library' }, { id: 'works', label: '工作现场', icon: 'work' }, { id: 'matters', label: '在意的事', icon: 'document' }]} onAction={id => runtime.navigate({ view: id as RouteMemory['view'] }, { origin: route.returnTarget || { view: 'home' } })} />
      </div>
    </header>
    <div className="tu-library-body">
      <aside className="tu-find-panel" aria-label="搜索与结果">
        <div className="tu-find-heading"><h1>{works ? '工作现场' : '找回与演变'}</h1><p className="tu-muted">{works ? '准备、执行与返回，按实际记录区分。' : '原话、材料与结果，都保留各自的来处。'}</p></div>
        <form role="search" className="tu-search-field" onSubmit={event => { event.preventDefault(); if (!composing.current) commitQuery(query); }}>
          <TraceIcon name="search" /><input ref={input} aria-label="搜索全部痕迹" type="search" autoComplete="off" value={query} placeholder="搜索原话、理解、材料或结果" onCompositionStart={() => { composing.current = true; }} onCompositionEnd={event => { composing.current = false; commitQuery(event.currentTarget.value); }} onChange={event => { setQuery(event.currentTarget.value); if (!composing.current && !(event.nativeEvent as InputEvent).isComposing) commitQuery(event.currentTarget.value); }} onKeyDown={event => { if (event.key === 'ArrowDown' && !event.nativeEvent.isComposing) { event.preventDefault(); results.current?.querySelector<HTMLButtonElement>('[data-result-select]')?.focus(); } }} />
        </form>
        {route.matterId && <div className="tu-scope"><span>范围：{matter ? titleOf(matter) : '原对象当前不可用'}</span><button type="button" className="tu-text-button" onClick={() => change({ matterId: undefined, selectedId: undefined })}>查看全部</button></div>}
        {!works && <><nav className="tu-filters" aria-label="内容类型">{filters.map(([value, label]) => <button type="button" key={value} aria-pressed={kind === value} onClick={() => change({ kind: value, selectedId: undefined, recordId: undefined })}>{label}</button>)}</nav><label className="tu-checkbox"><input type="checkbox" checked={includeHistory} onChange={event => change({ includeHistory: String(event.currentTarget.checked), selectedId: undefined, recordId: undefined })} /> 包含历史修订</label></>}
        <p className="tu-result-count" role="status">{rows.length} 条{route.q ? '匹配' : ''}内容</p>
        <ul ref={results} className="tu-search-results" aria-label="查找结果" onKeyDown={event => { if ((event.target as HTMLElement).hasAttribute('data-result-select')) moveInResults(event); }}>
          {rows.map(record => <li className="tu-result" key={record.id} data-selected={selected?.id === record.id || undefined}>
            <button type="button" className="tu-result-select" data-result-select={record.id} aria-current={selected?.id === record.id ? 'true' : undefined} onClick={() => select(record.id)}>
              <TraceIcon name={kindIcons[record.kind] || 'document'} size={20} /><span className="tu-result-copy"><strong>{record.title}</strong><span className="tu-result-excerpt">{record.text || '内容为空'}</span><small>{recordKindLabels[record.kind]}{record.meta ? ` · ${record.meta}` : ''}</small></span>
            </button>
            <TraceMenu label={`操作：${recordKindLabels[record.kind]} · ${record.title}`} actions={[{ id: 'content', label: '查看完整内容', icon: 'document' }, { id: 'history', label: '查看演变', icon: 'history', disabled: !record.matterId }, { id: 'origin', label: '回到原处继续', icon: 'forward', disabled: !record.route }]} onAction={id => id === 'origin' ? openOriginal(record) : select(record.id, id === 'history' ? 'evolution' : 'content')} />
          </li>)}
        </ul>
        {!rows.length && <section className="tu-empty"><TraceIcon name="search" size={20} /><h2>{route.q ? '没有找到匹配内容' : '这个范围还没有内容'}</h2><p>可以换个关键词或范围；没有用示例替换你的内容。</p>{(route.q || route.kind || route.matterId) && <button type="button" className="tu-button" onClick={() => { setQuery(''); change({ q: '', kind: '', matterId: undefined, selectedId: undefined, recordId: undefined }); }}>清除筛选</button>}</section>}
        <footer className="tu-find-footer"><button type="button" className="tu-button" onClick={() => returnToOrigin(route)}><TraceIcon name="back" size={16} />返回原处</button></footer>
      </aside>
      <main className="tu-record-detail" aria-label="所选内容详情">
        <button className="tu-button tu-mobile-back" type="button" onClick={() => { setNarrowDetail(false); input.current?.focus(); }}><TraceIcon name="back" size={16} />返回查找结果</button>
        {selected ? <>
          <header className="tu-detail-heading"><span className="tu-badge">{recordKindLabels[selected.kind]}</span><h2>{selected.title}</h2>{selected.meta && <p className="tu-muted">{selected.meta}</p>}</header>
          <Tabs.Root value={tab} onValueChange={detailTab => change({ detailTab })}>
            <Tabs.List className="tu-tabs" aria-label="内容详情视图"><Tabs.Trigger className="tu-tab" value="content">内容</Tabs.Trigger><Tabs.Trigger className="tu-tab" value="evolution">演变</Tabs.Trigger></Tabs.List>
            <Tabs.Content className="tu-tab-content" value="content">
              {selected.kind === 'revision' && <p className="tu-notice">这是历史修订记录，不代表当前判断；查看不会更改内容。</p>}
              {selected.before != null && <section className="tu-read-section"><h3>修改前</h3><p>{selected.before || '当时为空'}</p></section>}
              <section className="tu-read-section"><h3>{selected.kind === 'revision' ? '修改后' : '完整内容'}</h3><p>{selected.text || '内容为空'}</p></section>
              {selected.interpretation && <section className="tu-read-section"><h3>我的解释</h3><p>{selected.interpretation}</p></section>}
              {selected.unconfirmed && <section className="tu-read-section"><h3>仍不确定</h3><p>{selected.unconfirmed}</p></section>}
              {source && <section className="tu-read-section"><h3>来源与原件</h3><p>{source.author ? `作者：${source.author}` : '未记录作者'}{source.origin ? ` · ${source.origin === 'provider-snapshot' ? '已取得的来源快照' : '带入材料'}` : ''}</p>{href ? <a className="tu-source-link" href={href} target="_blank" rel="noopener noreferrer">查看原出处<TraceIcon name="external" size={16} /></a> : <p className="tu-notice">未记录可打开的原出处，当前保留内容不等于完整原件。</p>}</section>}
            </Tabs.Content>
            <Tabs.Content className="tu-tab-content" value="evolution"><EvolutionPanel key={selected.id} entries={entries} selectedId={selected.kind === 'revision' ? selected.id : undefined} /></Tabs.Content>
          </Tabs.Root>
          <footer className="tu-detail-footer">{selected.route ? <button type="button" className="tu-button tu-primary" onClick={() => openOriginal()}>回到原处继续<TraceIcon name="forward" size={16} /></button> : <p className="tu-muted">这份材料尚未关联到具体事项；没有伪造返回位置。</p>}</footer>
        </> : <section className="tu-empty"><TraceIcon name="document" size={20} /><h2>{selectedId ? '所选内容不在当前结果中' : '从左侧选择内容'}</h2><p>查看、比较与返回都不会自动改写你的理解。</p>{selectedId && rows.length > 0 && <button className="tu-button" type="button" onClick={() => select(rows[0].id)}>查看第一条结果</button>}</section>}
      </main>
    </div><footer className="tu-status-tray" aria-label="工作区保存状态">{status}</footer>
  </section>;
}

import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import * as B from './product/bridge.mjs';
import { ASSETS } from './product/assets.mjs';
import { h, homeEntries, mountLibrary, recordsOf, titleOf } from './product/library.mjs';
import { preloadImages, registerFont, clearResourceCache, getResourceStats } from './product/resource-cache.mjs';
import { runtime } from './react/runtime';
import { browserStorage, exportWorkspace } from './react/workspace-storage';
import type { DialogState, RouteMemory, RouteNavigationOptions, ViewName, WorkspaceSnapshot } from './react/types';

type StyleName = 'web' | 'home' | 'matters' | 'chain' | 'compare' | 'worksite';
type MountedScreen = { routeKey: string; root: HTMLDivElement; screen: any };

const styleUrls = import.meta.glob([
  './product/web.css',
  './home.css',
  './matters/matters.css',
  './product/chain.css',
  './product/comparison.css',
  './product/worksite.css',
], { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const styleFiles: Record<StyleName, string> = {
  web: './product/web.css', home: './home.css', matters: './matters/matters.css',
  chain: './product/chain.css', compare: './product/comparison.css', worksite: './product/worksite.css',
};
const styleCache = new Map<StyleName, { link: HTMLLinkElement; ready: Promise<void> }>();
const motionServicesPromise = Promise.all([
  import('./vendor/anime.esm.js'),
  import('./home/scene-glass.js'),
  import('./motion/scene-motion.mjs'),
]);

// Kept intentionally read-only: the evidence harness can inspect warm-cache
// reuse without coupling the production UI to a test-only store.
(window as any).__traceResourceStats = getResourceStats;

function style(name: StyleName): Promise<void> {
  const current = styleCache.get(name);
  if (current) return current.ready.then(() => { current.link.media = 'all'; });
  const url = styleUrls[styleFiles[name]];
  if (!url) return Promise.reject(new Error(`样式未找到：${name}`));
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.media = 'not all'; link.href = url;
  link.dataset.reactStyle = name;
  const ready = new Promise<void>((resolve, reject) => {
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`样式未加载：${name}`));
  });
  styleCache.set(name, { link, ready });
  document.head.append(link);
  return ready.then(() => { link.media = 'all'; });
}

function routeStyle(view: ViewName): StyleName | null {
  if (view === 'home') return 'home';
  if (view === 'matters') return 'matters';
  if (view === 'chain') return 'chain';
  if (view === 'compare') return 'compare';
  if (view === 'worksite') return 'worksite';
  return null;
}

function routeAssets(view: ViewName): Record<string, string> {
  if (view === 'home') return ASSETS.home;
  if (view === 'matters') return ASSETS.matters;
  if (view === 'chain') return ASSETS.chain;
  if (view === 'compare') return ASSETS.compare;
  if (view === 'worksite') return ASSETS.worksite;
  return {};
}

function routeResourceUrls(view: ViewName): string[] {
  const assets = routeAssets(view);
  return Object.values(assets).filter((value) => /\.(?:png|svg|jpe?g|webp)(?:[?#]|$)/i.test(value));
}

function routeResourceFonts(view: ViewName): Array<{ family: string; url?: string; weight: string }> {
  const assets = routeAssets(view);
  const shared = [
    { family: 'Trace Product Serif', url: assets.fullSerifFont || assets.serifFont, weight: '250 900' },
    { family: 'Trace Product Sans', url: assets.fullSansFont || assets.sansFont, weight: '100 900' },
  ];
  if (view === 'home') return [
    { family: 'Trace Home Serif', url: assets.fullSerifFont || assets.serifFont, weight: '250 900' },
    { family: 'Trace Home Sans', url: assets.fullSansFont || assets.sansFont, weight: '100 900' },
  ];
  if (view === 'matters') return [
    { family: 'Trace Matters Serif', url: assets.fullSerifFont || assets.serifFont, weight: '250 900' },
    { family: 'Trace Matters Sans', url: assets.fullSansFont || assets.sansFont, weight: '100 900' },
  ];
  if (view === 'chain') return [
    { family: 'Trace Chain Serif', url: assets.serifFont, weight: '250 900' },
    { family: 'Trace Chain Sans', url: assets.sansFont, weight: '100 900' },
  ];
  if (view === 'compare') return [
    { family: 'Trace Compare Serif', url: assets.serifFont, weight: '250 900' },
    { family: 'Trace Compare Sans', url: assets.sansFont, weight: '100 900' },
  ];
  if (view === 'worksite') return [
    { family: 'Trace Worksite Serif', url: assets.serifFont, weight: '250 900' },
    { family: 'Trace Worksite Sans', url: assets.sansFont, weight: '100 900' },
  ];
  return shared;
}

async function loadRouteResources(view: ViewName): Promise<any> {
  const modulePromise = view === 'home' ? import('./home.js')
    : view === 'matters' ? import('./matters/matters-screen.mjs')
      : view === 'chain' ? import('./product/chain-screen.mjs')
        : view === 'compare' ? import('./product/comparison-screen.mjs')
          : view === 'worksite' ? import('./product/worksite-screen.mjs')
            : ['all', 'search', 'works'].includes(view) ? Promise.resolve({ mountLibrary }) : Promise.resolve(null);
  const styleName = routeStyle(view);
  const criticalPromises: Promise<unknown>[] = [style('web'), modulePromise];
  if (styleName) criticalPromises.push(style(styleName));

  // Images and full Chinese font faces improve visual fidelity but are not a
  // functional prerequisite.  On a cold CDN edge these files can take longer
  // than the old seven-second gate, which previously replaced the entire app
  // with an error screen even though its JS and CSS were already ready.  Warm
  // them in parallel and let font-display/CSS fallbacks keep the route usable.
  const warmupPromises: Promise<unknown>[] = [];
  if (view !== 'discussion') warmupPromises.push(preloadImages(routeResourceUrls(view), { timeoutMs: 30000 }).catch(() => undefined));
  for (const font of routeResourceFonts(view)) {
    if (font.url) warmupPromises.push(registerFont(font).catch(() => undefined));
  }
  void Promise.all(warmupPromises);
  const results = await Promise.all(criticalPromises);
  return results[1];
}

function motionServices() {
  return motionServicesPromise.then(([anime, glass, sceneMotion]) => ({
    animate: (target: any, params: any) => anime.animate(target, runtime.isReducedMotion() ? { ...params, duration: 0, delay: 0 } : params),
    svg: anime.svg,
    mountSceneGlass: glass.mountSceneGlass,
    createSceneMotion: sceneMotion.createSceneMotion,
    registerFont,
  }));
}

function missingScreen(root: HTMLDivElement): any {
  root.innerHTML = '<section class="web-loading"><h1>没有找到这段来处。</h1><p>这个地址对应的内容不在当前空间里，没有用示例替换它。</p><button type="button">到全部痕迹里找找</button></section>';
  root.querySelector('button')?.addEventListener('click', () => runtime.navigate({ view: 'all' }));
  return { destroy: () => root.replaceChildren(), update: () => undefined };
}

async function mountRoute(root: HTMLDivElement, route: RouteMemory, module: any): Promise<any> {
  const host = runtime.getHost();
  if (!host) return missingScreen(root);
  if ((['chain', 'compare'].includes(route.view) && !host.chain.matters.some((matter: any) => matter.id === route.matterId)) || (route.view === 'compare' && !host.comparisons[route.sessionId || '']) || (route.view === 'worksite' && !host.worksite.works[route.workId || ''])) return missingScreen(root);
  const assets = routeAssets(route.view);
  if (route.view === 'home') {
    const services = await motionServices();
    const entries = runtime.getHomeEntries();
    const navigateHomeMatter = (key: string, screen: string = 'resume') => {
      const entry = runtime.getHomeEntries()[key];
      if (entry?.matterId) runtime.navigate({ view: 'chain', matterId: entry.matterId, screen });
    };
    const navigateHomeWork = (key: string) => {
      const entry = runtime.getHomeEntries()[key];
      if (!entry?.matterId) return;
      const work = Object.values(host.worksite.works || {}).find((candidate: any) =>
        host.worksite.sessions?.[candidate.id]?.intake?.some((item: any) => item.matterId === entry.matterId),
      ) as any;
      if (work) runtime.navigate({ view: 'worksite', workId: work.id, matterId: entry.matterId, screen: 'overview' });
      else runtime.navigate({ view: 'chain', matterId: entry.matterId, screen: 'handoff' });
    };
    return module.mountHome({
      root, product: true, entries, snapshot: { captureDraft: host.chain.capture.text || '' }, assets,
      services,
      // The first bubble click is deliberately local (see home.js).  These
      // callbacks are only for explicit actions in the expanded card.
      onOpen: (key: string) => navigateHomeMatter(key),
      onContinue: (key: string, screen: string) => navigateHomeMatter(key, screen),
      onSource: (key: string) => navigateHomeMatter(key, 'resume'),
      onWork: navigateHomeWork,
      onAll: () => runtime.navigate({ view: 'all' }), onSearch: () => runtime.navigate({ view: 'search' }),
      onMatters: () => runtime.navigate({ view: 'matters' }), onWorks: () => runtime.navigate({ view: 'works' }),
      onProfile: () => runtime.profile(), onDraft: runtime.onHomeDraft, onCapture: runtime.onCapture,
    });
  }
  if (['all', 'search', 'works'].includes(route.view)) {
    document.title = `Trace · ${route.view === 'works' ? '工作现场' : route.view === 'search' ? '搜索' : '全部痕迹'}`;
    return module.mountLibrary({ root, host, route, onNavigate: (next: RouteMemory, options?: RouteNavigationOptions) => runtime.navigate(next, options), onBack: () => runtime.back(), onProfile: () => runtime.profile() });
  }
  if (route.view === 'discussion') {
    const url = new URL(location.href); url.pathname = '/legacy.html';
    window.location.assign(url.href);
    return missingScreen(root);
  }
  const services = await motionServices();
  if (route.view === 'matters') {
    return module.mountMattersScreen({ root, view: runtime.getMattersView(), assets, services, onHome: () => runtime.navigate({ view: 'home' }), onAll: () => runtime.navigate({ view: 'all' }), onAction: runtime.onMattersAction });
  }
  if (route.view === 'chain') {
    return module.mountChainScreen({ root, view: runtime.projection(), assets, services, onAction: runtime.onChainAction, onHome: () => runtime.navigate({ view: 'home' }), onMatters: () => runtime.navigate({ view: 'matters' }), onBack: () => route.screen === 'resume' ? runtime.back() : runtime.navigate({ ...runtime.getRoute(), screen: 'resume' }), onWorkspaces: () => runtime.navigate({ view: 'works' }) });
  }
  if (route.view === 'compare') {
    return module.mountComparisonScreen({ root, view: runtime.projection(), assets, services, onAction: runtime.onComparisonAction, onReturn: runtime.onReturnComparison, onContinue: () => runtime.continueComparison(), onAll: () => runtime.navigate({ view: 'all', matterId: route.matterId }), onProfile: () => runtime.profile() });
  }
  if (route.view === 'worksite') {
    return module.mountWorksiteScreen({ root, view: runtime.projection(), assets, services, onAction: runtime.onWorkAction, onHome: () => runtime.navigate({ view: 'home' }), onBack: () => runtime.back(), onOpenMatter: (value: any) => { const id = typeof value === 'string' ? value : value?.id || value?.matterId; if (id) runtime.navigate({ view: 'chain', matterId: id, screen: 'understanding' }); else runtime.message('还没有为这条发现关联事项。'); }, onReturnToAgent: () => runtime.workContext(), onOpenArtifact: (item: any) => runtime.message(item?.excerpt || '还没有实际产物或来源链接，不会跳到演示文件。'), onProfile: () => runtime.profile(), onWorkspaces: () => runtime.navigate({ view: 'works' }), onCreateWork: () => runtime.navigate({ view: 'chain', matterId: route.matterId, screen: 'handoff' }) });
  }
  return missingScreen(root);
}

function RecoveryButton({ children, primary = false, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  const classes = [primary ? 'web-primary' : '', 'web-shell-button', className || ''].filter(Boolean).join(' ');
  return <button {...props} type={props.type || 'button'} className={classes}>{children}</button>;
}

function StatusBar({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const exportRecovery = () => {
    const value = { revision: snapshot.revision, host: snapshot.host, unsaved: snapshot.pending };
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `Trace-recovery-${Date.now()}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <aside className="web-status" data-state={snapshot.status.state} role="status" aria-live="polite"><i /><span>{snapshot.status.text}</span>{snapshot.status.state === 'error' && <><RecoveryButton data-retry onClick={() => void runtime.retryPending()}>重试保存</RecoveryButton><RecoveryButton data-export onClick={exportRecovery}>导出未保存内容</RecoveryButton><RecoveryButton data-load onClick={() => runtime.confirmLoadSaved()}>载入已保存版本</RecoveryButton></>}</aside>;
}

function returnLabel(route: RouteMemory): string {
  if (route.returnTarget?.view === 'search') return '返回搜索结果';
  if (route.returnTarget?.view === 'all') return '返回全部痕迹';
  if (route.returnTarget?.view === 'worksite') return '返回这次工作';
  if (route.returnTarget?.view === 'chain') return '返回原来的事情';
  return '返回来处';
}

function Chrome({ snapshot }: { snapshot: ReturnType<typeof runtime.getSnapshot> }) {
  const route = snapshot.route;
  const matter = snapshot.host?.chain?.matters?.find((item: any) => item.id === route.matterId);
  return <>
    <nav className="web-continuity" aria-label="接续导航">
      {route.returnTarget && route.view !== 'home' && <RecoveryButton onClick={() => route.view === 'compare' ? runtime.onReturnComparison() : runtime.back()}>← {returnLabel(route)}</RecoveryButton>}
      {matter && ['chain', 'compare', 'worksite'].includes(route.view) && <>
        <RecoveryButton onClick={() => runtime.navigate({ view: 'chain', matterId: matter.id, screen: 'understanding' })}>{matter.understanding ? `我的理解 v${matter.understandingVersion}` : '原话已保留 · 还没有写理解'}</RecoveryButton>
        {matter.links?.length ? <RecoveryButton onClick={() => runtime.sources()}>{matter.links.length} 份对照已关联</RecoveryButton> : null}
      </>}
    </nav>
    {route.view === 'chain' && <nav className="web-context-menu" aria-label="事项工具"><RecoveryButton onClick={() => runtime.navigate({ view: 'search' })}>搜索</RecoveryButton><RecoveryButton onClick={() => runtime.navigate({ view: 'all', matterId: route.matterId })}>全部痕迹</RecoveryButton><RecoveryButton onClick={() => runtime.profile()}>个人与设置</RecoveryButton></nav>}
  </>;
}

function RouteOutlet({ snapshot }: { snapshot: ReturnType<typeof runtime.getSnapshot> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<MountedScreen | null>(null);
  const tokenRef = useRef(0);
  const [pendingKey, setPendingKey] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const route = snapshot.route;
  const key = runtime.getRouteKey();

  useLayoutEffect(() => {
    runtime.setRouteRoot(activeRef.current?.root || null);
    return () => runtime.setRouteRoot(null);
  }, []);

  useEffect(() => {
    if (!snapshot.ready || !hostRef.current) return;
    const token = ++tokenRef.current;
    const abort = new AbortController();
    setPendingKey(key); setLoadError(null);
    const old = activeRef.current;
    if (!old && !hostRef.current.querySelector('.react-route-loading')) {
      const loading = document.createElement('section'); loading.className = 'react-route-loading'; loading.innerHTML = '<span class="react-loading-mark">Trace</span><p>正在接回这段来处…</p>'; hostRef.current.append(loading);
    }
    void (async () => {
      const module = await loadRouteResources(route.view);
      if (abort.signal.aborted || token !== tokenRef.current) return;
      runtime.prepareRoute(route);
      const nextRoot = document.createElement('div');
      nextRoot.className = 'react-route-root'; nextRoot.dataset.route = route.view; nextRoot.dataset.transition = 'incoming';
      const screen = await mountRoute(nextRoot, route, module);
      if (abort.signal.aborted || token !== tokenRef.current) { screen?.destroy?.(); return; }
      hostRef.current?.querySelector('.react-route-loading')?.remove();
      hostRef.current?.append(nextRoot);
      activeRef.current = { routeKey: key, root: nextRoot, screen };
      runtime.setRouteRoot(nextRoot);
      setPendingKey('');
      requestAnimationFrame(() => { nextRoot.dataset.transition = 'settled'; runtime.restore(nextRoot, route); runtime.openRecordIfNeeded(); });
      if (old) {
        old.root.dataset.transition = 'outgoing';
        // The incoming root is already mounted before this branch runs.  Do
        // not keep a second form-bearing surface around: assistive tech and
        // browser automation would otherwise see duplicate controls during
        // the transition.  The resource gate above still keeps the old
        // surface visible for the entire slow module/image wait, while this
        // synchronous swap avoids an observable empty frame.
        const delay = 0;
        const removeOld = () => { old.screen?.destroy?.(); old.root.remove(); };
        if (delay === 0) removeOld(); else window.setTimeout(removeOld, delay);
      }
    })().catch((cause) => {
      if (abort.signal.aborted || token !== tokenRef.current) return;
      console.error(cause);
      setPendingKey(''); setLoadError(cause instanceof Error ? cause.message : String(cause));
      if (!activeRef.current) hostRef.current?.querySelector('.react-route-loading')?.remove();
    });
    return () => { abort.abort(); };
  }, [key, snapshot.ready, retryNonce]);

  useEffect(() => {
    const active = activeRef.current;
    if (!active || active.routeKey !== key || !snapshot.ready) return;
    try {
      if (snapshot.route.view === 'home') return;
      if (active.screen?.update) active.screen.update(['all', 'search', 'works'].includes(snapshot.route.view) ? snapshot.host : snapshot.route.view === 'matters' ? runtime.getMattersView() : runtime.projection());
    } catch (cause) {
      console.error(cause);
    }
  }, [snapshot, key]);

  const retry = () => {
    clearResourceCache({ images: routeResourceUrls(route.view), fonts: routeResourceFonts(route.view).map((font) => font.family) });
    // A rejected native dynamic import can stay in the browser module map.
    // Reloading only after an explicit retry gives it a fresh fetch while the
    // persisted SQLite state and URL remain authoritative.
    window.location.reload();
  };
  return <><div className="react-route-host" data-route-host ref={hostRef} aria-busy={Boolean(pendingKey)} />{loadError && <section className="react-route-error" role="alert"><h1>页面资源未能加载</h1><p>{loadError}</p><RecoveryButton primary onClick={retry}>重新加载</RecoveryButton></section>}</>;
}

function DialogContent({ dialog, snapshot }: { dialog: DialogState; snapshot: ReturnType<typeof runtime.getSnapshot> }) {
  const [name, setName] = useState(snapshot.host?.preferences?.displayName || '');
  const [reduceMotion, setReduceMotion] = useState(Boolean(snapshot.host?.preferences?.reduceMotion));
  useEffect(() => { setName(snapshot.host?.preferences?.displayName || ''); setReduceMotion(Boolean(snapshot.host?.preferences?.reduceMotion)); }, [dialog.type, snapshot.host]);
  if (dialog.type === 'message') return <><p>{dialog.message}</p><footer><RecoveryButton onClick={() => runtime.closeDialog()}>{dialog.confirm ? '取消' : '回到原处'}</RecoveryButton>{dialog.confirm && <RecoveryButton primary onClick={() => { const action = dialog.confirm?.action; runtime.closeDialog(); action?.(); }}>{dialog.confirm.label}</RecoveryButton>}</footer></>;
  if (dialog.type === 'profile') return <><p>{browserStorage ? '内容仅保存在当前浏览器，不上传、不跨设备同步。清除网站数据会丢失内容，请定期导出；正式站与各预览地址的数据相互独立。' : '这是你在本机的 Trace 空间。没有开通账号、云同步或对外授权。'}</p><form onSubmit={(event) => { event.preventDefault(); runtime.updatePreferences(name, reduceMotion); }}><label>怎么称呼你<input name="name" type="text" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="你的称呼（可不填）" /></label><label><input name="motion" type="checkbox" checked={reduceMotion} onChange={(event) => setReduceMotion(event.target.checked)} /> 减少界面动效</label><h3>你的内容保存在这里</h3><p>{snapshot.storage?.location}</p><p>{snapshot.host?.chain?.matters?.length || 0} 件事 · {snapshot.host?.chain?.sources?.length || 0} 份材料 · {Object.keys(snapshot.host?.worksite?.works || {}).length} 个工作记录</p><footer><RecoveryButton onClick={() => void exportWorkspace().catch((error) => runtime.message(error.message))}>导出全部内容</RecoveryButton><RecoveryButton primary type="submit">保存设置</RecoveryButton></footer></form></>;
  if (dialog.type === 'sources') {
    const matter = snapshot.host?.chain?.matters?.find((item: any) => item.id === dialog.message);
    const linked = snapshot.host?.chain?.sources?.filter((source: any) => source.ownerMatterId === matter?.id) || [];
    return <><p>{titleOf(matter)}</p>{linked.length ? linked.map((source: any) => { const link = matter.links?.find((item: any) => item.sourceId === source.id); return <section className="web-linked-item" key={source.id}><strong>{source.title}</strong><p>{source.excerpt}</p><small>{link ? `已接为${({ limit: '限制', limitation: '限制', support: '支持', challenge: '挑战', supplement: '补充' } as Record<string, string>)[link.relationship.type] || '有关'} · 关联本身不改变理解` : '尚未关联 · 原材料仍保留'}</small></section>; }) : <p>还没有材料，可以先选一句原话找个对照。</p>}<footer><RecoveryButton onClick={() => { runtime.closeDialog(); runtime.navigate({ view: 'all', matterId: matter?.id }); }}>查看这件事的全部痕迹</RecoveryButton></footer></>;
  }
  if (dialog.type === 'work-context') return <><p>这是你确认的本地上下文，尚未发送给外部 Agent。可复制到实际工作中，之后手工带回结果。</p><pre>{dialog.message}</pre><footer><RecoveryButton primary onClick={async (event) => { try { await navigator.clipboard.writeText(dialog.message || ''); (event.currentTarget as HTMLButtonElement).textContent = '已复制 · 尚未发送'; } catch { (event.currentTarget as HTMLButtonElement).textContent = '请手动选择文字复制'; } }}>复制本次上下文</RecoveryButton></footer></>;
  const record = dialog.record || {};
  return <>{record.meta && <p>{record.meta}</p>}{record.before && <><h3>修改前</h3><p>{record.before}</p></>}<h3>{record.title}</h3><p>{record.text}</p>{record.interpretation && <><h3>我的解释</h3><p>{record.interpretation}</p></>}{record.unconfirmed && <><h3>还不确定</h3><p>{record.unconfirmed}</p></>}</>;
}

function DialogHost({ snapshot }: { snapshot: ReturnType<typeof runtime.getSnapshot> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const dialog = snapshot.dialog;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (dialog && !element.open) element.showModal();
    if (!dialog && element.open) element.close();
  }, [dialog]);
  if (!dialog) return <dialog ref={ref} className="web-dialog" />;
  return <dialog ref={ref} className="web-dialog" aria-labelledby="react-dialog-title" onCancel={(event) => { event.preventDefault(); runtime.closeDialog(); }} onClick={(event) => { if (event.target === event.currentTarget) runtime.closeDialog(); }}><header><h2 id="react-dialog-title">{dialog.title}</h2><button type="button" aria-label="关闭" onClick={() => runtime.closeDialog()}>×</button></header><DialogContent dialog={dialog} snapshot={snapshot} /></dialog>;
}

function App() {
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  useEffect(() => {
    void runtime.start().catch(() => undefined);
    const popstate = () => runtime.handlePopState();
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && snapshot.route.view !== 'home') { event.preventDefault(); runtime.navigate({ view: 'search' }); }
      if (event.key === 'Escape' && !snapshot.dialog && ['search', 'all', 'works'].includes(snapshot.route.view)) { event.preventDefault(); runtime.back(); }
    };
    const beforeunload = (event: BeforeUnloadEvent) => { if (snapshot.pending) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('popstate', popstate); window.addEventListener('keydown', keydown); window.addEventListener('beforeunload', beforeunload);
    return () => { window.removeEventListener('popstate', popstate); window.removeEventListener('keydown', keydown); window.removeEventListener('beforeunload', beforeunload); };
  }, [snapshot.dialog, snapshot.pending, snapshot.route.view]);
  useEffect(() => {
    const route = snapshot.route.view;
    document.body.className = route === 'home' ? 'home-page' : route === 'matters' ? 'matters-page' : '';
    document.body.dataset.reactShell = 'true';
    document.documentElement.dataset.reduceMotion = String(runtime.isReducedMotion());
    document.title = route === 'home' ? 'Trace · 把此刻的一点，带到以后' : route === 'matters' ? 'Trace · 在意的事' : document.title;
  }, [snapshot.route.view, snapshot.host?.preferences?.reduceMotion]);
  return <div className="trace-react-shell" data-route={snapshot.route.view} data-ready={snapshot.ready ? 'true' : 'false'} data-busy={snapshot.busy ? 'true' : 'false'}><StatusBar snapshot={snapshot} /><Chrome snapshot={snapshot} /><RouteOutlet snapshot={snapshot} /><DialogHost snapshot={snapshot} /></div>;
}

const mountPoint = document.querySelector('#app');
if (!mountPoint) throw new Error('Trace 应用缺少 #app 挂载点');
createRoot(mountPoint).render(<App />);


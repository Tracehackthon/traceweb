import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import './product/web.css';
import * as B from './product/bridge.mjs';
import { ASSETS } from './product/assets.mjs';
import { h, homeEntries, mountLibrary, recordsOf, titleOf } from './product/library.mjs';
import { preloadImages, registerFont, clearResourceCache, getResourceStats } from './product/resource-cache.mjs';
import { completeDemoMode, runtime } from './react/runtime';
import { COMPLETE_DEMO } from './product/demo-workspace.mjs';
import { browserStorage, exportWorkspace } from './react/workspace-storage';
import { agentCapabilities, checkZhihuAuthorization, disconnectZhihuAuthorization, hasNativeCapabilityBridge, readZhihuUserContent, runNativeAgent, searchPublic, startZhihuAuthorization, zhihuAuthorizationStatus, type SearchItem, type SearchSource, type ZhihuAuthorizationStatus } from './react/capability-client';
import type { DialogState, RouteMemory, RouteNavigationOptions, ViewName, WorkspaceSnapshot } from './react/types';

type StyleName = 'home' | 'matters' | 'chain' | 'compare' | 'worksite';
type MountedScreen = { routeKey: string; root: HTMLDivElement; screen: any };

const styleUrls = import.meta.glob([
  './home.css',
  './matters/matters.css',
  './product/chain.css',
  './product/comparison.css',
  './product/worksite.css',
], { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const styleFiles: Record<StyleName, string> = {
  home: './home.css', matters: './matters/matters.css',
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
    { family: 'Trace Home Serif', url: assets.serifFont, weight: '250 900' },
    { family: 'Trace Home Sans', url: assets.sansFont, weight: '100 900' },
  ];
  if (view === 'matters') return [
    { family: 'Trace Matters Serif', url: assets.serifFont, weight: '250 900' },
    { family: 'Trace Matters Sans', url: assets.sansFont, weight: '100 900' },
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
  const criticalPromises: Promise<unknown>[] = [modulePromise];
  if (styleName) criticalPromises.push(style(styleName));

  const results = await Promise.all(criticalPromises);

  // Images and Chinese font faces improve visual fidelity but are not a
  // functional prerequisite.  On a cold CDN edge these files can take longer
  // than the old seven-second gate, which previously replaced the entire app
  // with an error screen even though its JS and CSS were already ready.  Start
  // warmups only after route code/styles have won network priority, and let
  // font-display/CSS fallbacks keep the route usable.
  const warmupPromises: Promise<unknown>[] = [];
  if (view !== 'discussion') warmupPromises.push(preloadImages(routeResourceUrls(view), { timeoutMs: 30000 }).catch(() => undefined));
  for (const font of routeResourceFonts(view)) {
    if (font.url) warmupPromises.push(registerFont(font).catch(() => undefined));
  }
  void Promise.all(warmupPromises);
  return results[0];
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
      root, product: true, entries, snapshot: {
        captureDraft: host.chain.capture.text || '',
        completeDemoMode,
        demoSourceCount: host.chain.sources.filter((item: any) => item.origin === 'provider-snapshot' && item.provider === 'zhihu').length,
      }, assets,
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
    return module.mountChainScreen({ root, view: runtime.projection(), assets, services, demo: completeDemoMode, onAction: runtime.onChainAction, onHome: () => runtime.navigate({ view: 'home' }), onMatters: () => runtime.navigate({ view: 'matters' }), onBack: () => route.screen === 'resume' ? runtime.back() : runtime.navigate({ ...runtime.getRoute(), screen: 'resume' }), onWorkspaces: () => runtime.navigate({ view: 'works' }) });
  }
  if (route.view === 'compare') {
    return module.mountComparisonScreen({ root, view: runtime.projection(), assets, services, onAction: runtime.onComparisonAction, onReturn: runtime.onReturnComparison, onContinue: () => runtime.continueComparison(), onAll: () => runtime.navigate({ view: 'all', matterId: route.matterId }), onProfile: () => runtime.profile() });
  }
  if (route.view === 'worksite') {
    return module.mountWorksiteScreen({ root, view: runtime.projection(), assets, services, onAction: runtime.onWorkAction, onHome: () => runtime.navigate({ view: 'home' }), onBack: () => runtime.back(), onOpenMatter: (value: any) => { const id = typeof value === 'string' ? value : value?.id || value?.matterId; if (id) runtime.navigate({ view: 'chain', matterId: id, screen: 'understanding' }); else runtime.message('还没有为这条发现关联事项。'); }, onReturnToAgent: runtime.returnToNativeWork, onOpenArtifact: (item: any) => runtime.message(item?.excerpt || '还没有实际产物或来源链接，不会跳到演示文件。'), onProfile: () => runtime.profile(), onWorkspaces: () => runtime.navigate({ view: 'works' }), onCreateWork: () => runtime.navigate({ view: 'chain', matterId: route.matterId, screen: 'handoff' }) });
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

function AmbientFrame() {
  return <div className="trace-ambient" aria-hidden="true">
    <span className="trace-ambient-light" />
    <img className="trace-ambient-piece trace-ambient-orbit" src="/decor/trace-orbit.svg" alt="" draggable="false" />
    <img className="trace-ambient-piece trace-ambient-sprig" src="/decor/trace-sprig.svg" alt="" draggable="false" />
    <img className="trace-ambient-piece trace-ambient-pebbles" src="/decor/trace-pebbles.svg" alt="" draggable="false" />
  </div>;
}

const demoActions = [
  { label: '留下一点', source: '知乎原现场', route: { view: 'chain', matterId: COMPLETE_DEMO.matterId, screen: 'resume' } },
  { label: '从这里接着', route: { view: 'chain', matterId: COMPLETE_DEMO.matterId, screen: 'discussion' } },
  { label: '找个对照', source: '知乎对照', route: { view: 'compare', matterId: COMPLETE_DEMO.matterId, sessionId: COMPLETE_DEMO.comparisonId } },
  { label: '我的理解', route: { view: 'chain', matterId: COMPLETE_DEMO.matterId, screen: 'understanding' } },
  { label: '带去用', route: { view: 'worksite', matterId: COMPLETE_DEMO.matterId, workId: COMPLETE_DEMO.workId, screen: 'overview' } },
  { label: '结果回来', route: { view: 'worksite', matterId: COMPLETE_DEMO.matterId, workId: COMPLETE_DEMO.workId, screen: 'results' } },
] as const;

function DemoGuide({ snapshot }: { snapshot: ReturnType<typeof runtime.getSnapshot> }) {
  const [open, setOpen] = useState(false);
  if (!completeDemoMode || !snapshot.ready) return null;
  const isCurrent = (item: typeof demoActions[number]) => item.route.view === snapshot.route.view
    && (!('screen' in item.route) || item.route.screen === snapshot.route.screen);
  return <aside className="demo-guide" data-open={open ? 'true' : 'false'} aria-label="完整演示动作清单">
    <button className="demo-guide-toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}><span>完整演示</span><b>6 / 6</b></button>
    {open && <div className="demo-guide-body"><div className="demo-guide-source"><i>知</i><span><strong>知乎参与了这条思考链</strong><small>公开来源分别进入原现场与对照</small></span></div><nav>{demoActions.map((item, index) => <button type="button" key={item.label} aria-current={isCurrent(item) ? 'step' : undefined} onClick={() => { setOpen(false); runtime.navigate(item.route as RouteMemory); }}><span>{index + 1}</span><b>{item.label}</b>{'source' in item && item.source ? <small>{item.source}</small> : null}</button>)}</nav><footer><button type="button" onClick={() => runtime.resetCompleteDemo()}>恢复演示初始状态</button><a href="/app">进入我的空间</a><a href="/">返回产品介绍</a></footer></div>}
  </aside>;
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
  return <><div className="react-route-host" data-route-host ref={hostRef} aria-busy={!snapshot.ready || Boolean(pendingKey)}>{!snapshot.ready && <section className="react-route-loading"><span className="react-loading-mark">Trace</span><p>正在接回你的内容…</p></section>}</div>{loadError && <section className="react-route-error" role="alert"><h1>页面资源未能加载</h1><p>{loadError}</p><RecoveryButton primary onClick={retry}>重新加载</RecoveryButton></section>}</>;
}

function DialogContent({ dialog, snapshot }: { dialog: DialogState; snapshot: ReturnType<typeof runtime.getSnapshot> }) {
  const [name, setName] = useState(snapshot.host?.preferences?.displayName || '');
  const [reduceMotion, setReduceMotion] = useState(Boolean(snapshot.host?.preferences?.reduceMotion));
  useEffect(() => { setName(snapshot.host?.preferences?.displayName || ''); setReduceMotion(Boolean(snapshot.host?.preferences?.reduceMotion)); }, [dialog.type, snapshot.host]);
  if (dialog.type === 'message') return <><p>{dialog.message}</p><footer><RecoveryButton onClick={() => runtime.closeDialog()}>{dialog.confirm ? '取消' : '回到原处'}</RecoveryButton>{dialog.confirm && <RecoveryButton primary onClick={() => { const action = dialog.confirm?.action; runtime.closeDialog(); action?.(); }}>{dialog.confirm.label}</RecoveryButton>}</footer></>;
  if (dialog.type === 'profile') return <><p>{completeDemoMode ? '演示空间只使用合成数据，与账号和个人内容完全分开，可以随时恢复。' : browserStorage ? '内容只留在这个应用里，不上传、不跨设备同步。清除应用数据会丢失内容，请定期导出。' : '内容保存在这台设备的 Trace 空间里，没有开通云同步。'}</p><form onSubmit={(event) => { event.preventDefault(); runtime.updatePreferences(name, reduceMotion); }}><label>怎么称呼你<input name="name" type="text" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="你的称呼（可不填）" /></label><label><input name="motion" type="checkbox" checked={reduceMotion} onChange={(event) => setReduceMotion(event.target.checked)} /> 减少界面动效</label><h3>{completeDemoMode ? '演示内容' : '此设备上的内容'}</h3><p>{completeDemoMode ? '与个人空间分开，可随时恢复' : browserStorage ? '保存在当前应用中' : '保存在本机 Trace 中'}</p><p>{snapshot.host?.chain?.matters?.length || 0} 件事 · {snapshot.host?.chain?.sources?.length || 0} 份材料 · {Object.keys(snapshot.host?.worksite?.works || {}).length} 个工作记录</p>{!completeDemoMode && <ZhihuAuthorization/>}<footer>{completeDemoMode ? <><RecoveryButton onClick={() => runtime.resetCompleteDemo()}>恢复完整演示</RecoveryButton><a href="/app">进入我的空间</a></> : <RecoveryButton onClick={() => void exportWorkspace().catch((error) => runtime.message(error.message))}>导出全部内容</RecoveryButton>}<RecoveryButton primary type="submit">保存设置</RecoveryButton></footer></form></>;
  if (dialog.type === 'capability' && dialog.capability) return <CapabilityDialog capability={dialog.capability} />;
  if (dialog.type === 'sources') {
    const matter = snapshot.host?.chain?.matters?.find((item: any) => item.id === dialog.message);
    const linked = snapshot.host?.chain?.sources?.filter((source: any) => source.ownerMatterId === matter?.id) || [];
    return <><p>{titleOf(matter)}</p>{linked.length ? linked.map((source: any) => { const link = matter.links?.find((item: any) => item.sourceId === source.id); return <section className="web-linked-item" key={source.id}><strong>{source.title}</strong><p>{source.excerpt}</p><small>{link ? `已接为${({ limit: '限制', limitation: '限制', support: '支持', challenge: '挑战', supplement: '补充' } as Record<string, string>)[link.relationship.type] || '有关'} · 关联本身不改变理解` : '尚未关联 · 原材料仍保留'}</small></section>; }) : <p>还没有材料，可以先选一句原话找个对照。</p>}<footer><RecoveryButton onClick={() => { runtime.closeDialog(); runtime.navigate({ view: 'all', matterId: matter?.id }); }}>查看这件事的全部痕迹</RecoveryButton></footer></>;
  }
  if (dialog.type === 'work-context') return <><p>这是你确认的本地上下文，尚未发送给外部 Agent。可复制到实际工作中，之后手工带回结果。</p><pre>{dialog.message}</pre><footer><RecoveryButton primary onClick={async (event) => { try { await navigator.clipboard.writeText(dialog.message || ''); (event.currentTarget as HTMLButtonElement).textContent = '已复制 · 尚未发送'; } catch { (event.currentTarget as HTMLButtonElement).textContent = '请手动选择文字复制'; } }}>复制本次上下文</RecoveryButton></footer></>;
  const record = dialog.record || {};
  return <>{record.meta && <p>{record.meta}</p>}{record.before && <><h3>修改前</h3><p>{record.before}</p></>}<h3>{record.title}</h3><p>{record.text}</p>{record.interpretation && <><h3>我的解释</h3><p>{record.interpretation}</p></>}{record.unconfirmed && <><h3>还不确定</h3><p>{record.unconfirmed}</p></>}</>;
}

function CapabilityDialog({ capability }: { capability: NonNullable<DialogState['capability']> }) {
  const requestedSource: SearchSource | 'none' = capability.source === 'web' ? 'global' : capability.source;
  const [source, setSource] = useState<SearchSource>(requestedSource === 'none' ? 'zhihu' : requestedSource);
  const [items, setItems] = useState<SearchItem[]>([]);
  const [searchState, setSearchState] = useState(requestedSource === 'none' ? '未选择联网搜索。' : '准备搜索…');
  const [searchBusy, setSearchBusy] = useState(false);
  const [kept, setKept] = useState<string[]>([]);
  const [agentInfo, setAgentInfo] = useState<any>(null);
  const [agentState, setAgentState] = useState(capability.agent === 'none' ? '这次没有选择 Agent。' : '正在检查这台设备上的 Agent…');
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentResult, setAgentResult] = useState<any>(null);
  const [profileId, setProfileId] = useState('');
  const native = hasNativeCapabilityBridge();

  const doSearch = async (nextSource = source) => {
    setSearchBusy(true); setItems([]); setSearchState(`正在从${nextSource === 'zhihu' ? '知乎' : '全网'}查找 3 条公开来源…`);
    try {
      const result = await searchPublic(nextSource, capability.query, 3);
      setItems(result.items || []); setSearchState(result.items?.length ? `收到 ${result.items.length} 条接口摘要；尚未保存。` : '这次没有返回来源，可以换一个更具体的问题。');
    } catch (cause) { setSearchState(cause instanceof Error ? cause.message : '搜索没有完成。'); }
    finally { setSearchBusy(false); }
  };

  useEffect(() => { if (requestedSource !== 'none') void doSearch(requestedSource); }, []);
  useEffect(() => {
    if (capability.agent === 'none') return;
    void agentCapabilities().then((value) => {
      const agent = value?.agent || value;
      setAgentInfo(agent);
      const profiles = agent?.profiles || [];
      const selected = capability.agent === 'codex-native'
        ? profiles.find((profile: any) => profile.kind === 'codex')?.profileId
        : capability.agent === 'custom'
          ? profiles.find((profile: any) => profile.kind === 'agent')?.profileId
          : profiles.find((profile: any) => /harness/i.test(`${profile.profileId} ${profile.label}`))?.profileId;
      const selectedProfile = selected || agent?.defaultProfileId || profiles[0]?.profileId || '';
      setProfileId(selectedProfile);
      setAgentState(agent?.enabled ? `这台设备上有 ${profiles.length} 个 Agent 可用；已优先匹配你刚才的选择。` : native ? '桌宠已连接，但这台设备上还没有可用的 Agent。' : '这次交接已经保存；启动桌宠后才能调用 Codex 或自定义 Agent。');
    }).catch((cause) => setAgentState(cause instanceof Error ? cause.message : '暂时无法连接这台设备上的 Agent。'));
  }, [capability.agent]);

  const keep = async (item: SearchItem) => {
    try { await runtime.keepPublicSource(capability.matterId, item, capability.query); setKept((current) => [...new Set([...current, item.id])]); }
    catch (cause) { setSearchState(cause instanceof Error ? cause.message : '来源没有保存。'); }
  };
  const runAgent = async () => {
    setAgentBusy(true); setAgentResult(null); setAgentState('正在创建一次有边界的 Agent 运行…');
    try {
      const result = await runNativeAgent({ text: capability.query, source: requestedSource, ...(profileId ? { profileId } : {}) });
      setAgentResult(result); setAgentState(result.status === 'succeeded' ? 'Agent 已返回候选；没有自动写入我的理解。' : result.error?.message || `本次运行：${result.status}`);
    } catch (cause) { setAgentState(cause instanceof Error ? cause.message : 'Agent 运行没有完成。'); }
    finally { setAgentBusy(false); }
  };

  const profiles = agentInfo?.profiles || [];
  const metric = (item: SearchItem) => [item.vote_up_count == null ? '' : `${item.vote_up_count} 赞同`, item.comment_count == null ? '' : `${item.comment_count} 评论`, item.content_type || ''].filter(Boolean).join(' · ');
  const agentIntent = ({ 'codex-native': 'Codex 原生', 'codex-harness': 'Codex Harness', custom: '自定义 Agent' } as Record<string, string>)[capability.agent] || '未选择';
  return <section className="web-capability-flow">
    <p>原话已经先保存。下面的外部内容仍是候选，只有你明确保留后才会进入这件事。</p>
    <div className="web-capability-grid">
      {requestedSource !== 'none' && <section><header><i>知</i><div><h3>公开来源</h3><small>知乎经验与全网资料</small></div></header><div className="web-capability-controls"><select aria-label="搜索范围" value={source} disabled={searchBusy} onChange={(event) => setSource(event.target.value as SearchSource)}><option value="zhihu">知乎搜索</option><option value="global">全网搜索</option></select><RecoveryButton disabled={searchBusy} onClick={() => void doSearch()}>{searchBusy ? '正在查找…' : '重新查找'}</RecoveryButton></div><p role="status">{searchState}</p>{items.map((item) => <article className="web-capability-source" key={item.id}><small>{item.source === 'zhihu' ? '知乎公开内容' : '全网公开内容'}{item.author ? ` · ${item.author}` : ''}</small><strong>{item.title || '未命名来源'}</strong>{metric(item) && <span>{metric(item)}</span>}<p>{item.excerpt}</p><footer>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">查看原文</a> : <small>接口未返回原文链接</small>}<RecoveryButton primary disabled={!item.url || kept.includes(item.id)} onClick={() => void keep(item)}>{!item.url ? '暂不能保留' : kept.includes(item.id) ? '已保留到这件事' : '保留到这件事'}</RecoveryButton></footer></article>)}</section>}
      {capability.agent !== 'none' && <section><header><i>C</i><div><h3>原生 Agent</h3><small>Codex 与自定义执行器</small></div></header><dl className="web-agent-boundary"><div><dt>这次选择</dt><dd>{agentIntent}</dd></div><div><dt>在哪里处理</dt><dd>{native ? '这台设备' : '等待桌宠连接'}</dd></div><div><dt>怎样回来</dt><dd>先给你复核</dd></div></dl><p role="status">{agentState}</p>{profiles.length > 0 && <label>使用哪个 Agent<select value={profileId} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((profile: any) => <option value={profile.profileId} key={profile.profileId}>{profile.label || '可用 Agent'}</option>)}</select></label>}<RecoveryButton primary disabled={!native || !agentInfo?.enabled || agentBusy} onClick={() => void runAgent()}>{agentBusy ? 'Agent 正在处理…' : '开始一次 Agent 讨论'}</RecoveryButton>{!native && <small>启动桌宠后，这次内容会从本机交给 Agent；网页不会接触你的登录信息。</small>}{agentResult?.result && <article className="web-capability-agent-result"><small>{agentResult.profile?.label || 'Agent'} · {agentResult.result.kind === 'revision_candidate' ? '修改候选' : '讨论回答'}</small><strong>Agent 的回答</strong><p>{agentResult.result.answer}</p>{agentResult.result.uncertainties?.length > 0 && <><b>仍不确定</b><ul>{agentResult.result.uncertainties.map((text: string) => <li key={text}>{text}</li>)}</ul></>}</article>}</section>}
    </div>
    <footer><RecoveryButton onClick={() => runtime.closeDialog()}>完成，回到这件事</RecoveryButton></footer>
  </section>;
}

function ZhihuAuthorization() {
  const [status, setStatus] = useState<ZhihuAuthorizationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resource, setResource] = useState('');
  const [items, setItems] = useState<Array<{ id?: string | null; title?: string; summary?: string; url?: string | null }>>([]);
  const load = async () => {
    try {
      setStatus(await zhihuAuthorizationStatus()); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '知乎授权状态暂时不可用。'); }
  };
  useEffect(() => { void load(); }, []);
  const start = async () => {
    setBusy(true); setError('');
    try {
      const value = await startZhihuAuthorization();
      if (!value.login_url) throw new Error('未能发起知乎授权。');
      if (hasNativeCapabilityBridge()) {
        window.open(value.login_url, '_blank', 'noopener,noreferrer');
        setStatus(await zhihuAuthorizationStatus());
        setBusy(false);
      } else window.location.assign(value.login_url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '未能发起知乎授权。'); setBusy(false); }
  };
  const check = async () => {
    setBusy(true); setError('');
    try { setStatus(await checkZhihuAuthorization()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '未能确认知乎授权结果。'); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true); setError('');
    try {
      await disconnectZhihuAuthorization();
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '未能断开知乎授权。'); }
    finally { setBusy(false); }
  };
  const read = async (kind: 'contents' | 'favorites' | 'followees') => {
    setBusy(true); setError('');
    try {
      const value = await readZhihuUserContent(kind, 3);
      setResource(kind); setItems(value.items || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '没有读到知乎资料。'); }
    finally { setBusy(false); }
  };
  const authorized = status?.oauth?.status === 'authorized';
  const stateLabel = authorized ? '已连接' : status === null && !error ? '正在检查' : status?.oauth?.configured ? '未连接' : '服务未配置';
  const userContentUnavailable = status?.user_content_configured === false;
  return <section className="web-zhihu-auth" data-state={authorized ? 'authorized' : status?.oauth?.configured ? 'ready' : 'unconfigured'}><div className="web-auth-title"><h3>我的知乎内容</h3><span>{stateLabel}</span></div><p>{authorized ? '当前浏览器可以按你的明确操作读取知乎资料；不会自动导入。' : status?.oauth?.configured ? '连接后可由你明确读取创作、关注和收藏。公开搜索不需要这项授权。' : status === null && !error ? '正在核对当前环境的知乎授权能力…' : '当前部署尚未启用个人知乎资料授权。公开搜索与这项设置彼此独立。'}</p>{status?.oauth?.expires_at && <small>本次授权最晚有效至 {new Date(status.oauth.expires_at).toLocaleString('zh-CN')}</small>}{error && <p className="web-auth-error" role="alert">{error}</p>}<div>{authorized ? <><RecoveryButton disabled={busy || userContentUnavailable} onClick={() => void read('contents')}>读取近期创作</RecoveryButton><RecoveryButton disabled={busy || userContentUnavailable} onClick={() => void read('favorites')}>读取近期收藏</RecoveryButton><RecoveryButton disabled={busy || userContentUnavailable} onClick={() => void read('followees')}>读取关注</RecoveryButton><RecoveryButton disabled={busy} onClick={() => void disconnect()}>断开连接</RecoveryButton></> : <><RecoveryButton primary disabled={busy || status?.oauth?.configured !== true} onClick={() => void start()}>{busy ? '正在处理…' : status?.oauth?.status === 'pending_user_authorization' ? '重新打开知乎授权' : '连接我的知乎'}</RecoveryButton>{hasNativeCapabilityBridge() && status?.oauth?.status === 'pending_user_authorization' && <RecoveryButton disabled={busy} onClick={() => void check()}>我已授权，检查结果</RecoveryButton>}</>}<RecoveryButton disabled={busy} onClick={() => void load()}>刷新状态</RecoveryButton></div>{resource && <div className="web-zhihu-results" aria-live="polite"><strong>{({ contents: '近期创作', favorites: '近期收藏', followees: '关注' } as Record<string, string>)[resource]} · {items.length} 条</strong>{items.length ? items.map((item, index) => <article key={item.id || `${resource}-${index}`}><b>{item.title || '未命名内容'}</b>{item.summary && <p>{item.summary}</p>}{item.url && <a href={item.url} target="_blank" rel="noreferrer">打开知乎原处</a>}</article>) : <p>当前接口返回空列表。</p>}<small>只展示本次明确读取的 3 条，没有自动保存到 Trace。</small></div>}<small>{status?.notice || '这项连接只用于个人知乎资料；Trace 内容仍保存在当前浏览器。'}</small></section>;
}

function DialogHost({ snapshot }: { snapshot: ReturnType<typeof runtime.getSnapshot> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const dialog = snapshot.dialog;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (dialog && !element.open) { previousFocus.current = document.activeElement as HTMLElement; element.showModal(); }
    if (!dialog && element.open) { element.close(); const target = previousFocus.current; previousFocus.current = null; window.requestAnimationFrame(() => target?.isConnected && target.focus()); }
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
  useEffect(() => {
    if (!snapshot.ready) return;
    const url = new URL(location.href);
    if (!url.searchParams.has('zhihu')) return;
    const result = url.searchParams.get('zhihu');
    const reason = url.searchParams.get('reason');
    url.searchParams.delete('zhihu'); url.searchParams.delete('reason');
    history.replaceState(history.state, '', url);
    if (result === 'error') runtime.message(`知乎授权没有完成（${reason || '回调校验失败'}）。请重新发起，不会重放旧授权码。`);
    else runtime.profile();
  }, [snapshot.ready]);
  return <div className="trace-react-shell" data-route={snapshot.route.view} data-ready={snapshot.ready ? 'true' : 'false'} data-busy={snapshot.busy ? 'true' : 'false'}><AmbientFrame /><DemoGuide snapshot={snapshot} /><StatusBar snapshot={snapshot} /><Chrome snapshot={snapshot} /><RouteOutlet snapshot={snapshot} /><DialogHost snapshot={snapshot} /></div>;
}

const mountPoint = document.querySelector('#app');
if (!mountPoint) throw new Error('Trace 应用缺少 #app 挂载点');
createRoot(mountPoint).render(<App />);


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
import { agentCapabilities, adoptNativeAgent, cancelNativeAgent, checkCodexConnection, checkZhihuAuthorization, confirmDesktopProject, connectTraceCodexPlugin, desktopSetupStatus, disconnectZhihuAuthorization, hasNativeCapabilityBridge, readDesktopRuntimePanel, readNativeAgentEvents, readNativeAgentRun, readZhihuUserContent, runDesktopRuntimeAction, searchPublic, selectCodexProfile, selectDesktopProject, startNativeAgent, startZhihuAuthorization, zhihuAuthorizationStatus, type SearchItem, type SearchSource, type ZhihuAuthorizationStatus, type ZhihuUserContentKind } from './react/capability-client';
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
  const nativeConnected = hasNativeCapabilityBridge();
  const statusText = (() => {
    if (!nativeConnected) return snapshot.status.text;
    if (snapshot.status.state === 'loading') return '桌宠已连接 · 正在读取内容…';
    if (snapshot.status.state === 'saving') return '桌宠已连接 · 正在保存…';
    if (snapshot.status.state === 'saved') return '桌宠已连接 · 内容已保存';
    return `桌宠已连接 · ${snapshot.status.text}`;
  })();
  const exportRecovery = () => {
    const value = { revision: snapshot.revision, host: snapshot.host, unsaved: snapshot.pending };
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `Trace-recovery-${Date.now()}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <aside className="web-status" data-state={snapshot.status.state} data-native={nativeConnected ? 'connected' : undefined} role="status" aria-live="polite" title={nativeConnected ? '桌宠与主窗口正在使用同一份当前会话数据' : undefined}><i /><span>{statusText}</span>{nativeConnected && snapshot.status.state !== 'error' && <button type="button" onClick={() => runtime.profile()}>本机能力</button>}{snapshot.status.state === 'error' && <><RecoveryButton data-retry onClick={() => void runtime.retryPending()}>重试保存</RecoveryButton><RecoveryButton data-export onClick={exportRecovery}>导出未保存内容</RecoveryButton><RecoveryButton data-load onClick={() => runtime.confirmLoadSaved()}>载入已保存版本</RecoveryButton></>}</aside>;
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
    {open && <div className="demo-guide-body"><div className="demo-guide-source"><i>知</i><span><strong>知乎参与了这条思考链</strong><small>2 份知乎公开内容，分别作为原现场和对照</small></span></div><nav>{demoActions.map((item, index) => <button type="button" key={item.label} aria-current={isCurrent(item) ? 'step' : undefined} onClick={() => { setOpen(false); runtime.navigate(item.route as RouteMemory); }}><span>{index + 1}</span><b>{item.label}</b>{'source' in item && item.source ? <small>{item.source}</small> : null}</button>)}</nav><footer><button type="button" onClick={() => runtime.resetCompleteDemo()}>恢复演示初始状态</button><a href="/app">进入我的空间</a><a href="/">返回产品介绍</a></footer></div>}
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
  if (dialog.type === 'profile') return <><p>{completeDemoMode ? '演示内容与个人空间完全分开，可以随时恢复。' : browserStorage ? '内容只保存在当前浏览器，不上传，也不会跨设备同步。清除浏览器数据前请先导出。' : '内容保存在这台设备的 Trace 中，目前没有云同步。'}</p><form onSubmit={(event) => { event.preventDefault(); runtime.updatePreferences(name, reduceMotion); }}><label>怎么称呼你<input name="name" type="text" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="你的称呼（可不填）" /></label><label><input name="motion" type="checkbox" checked={reduceMotion} onChange={(event) => setReduceMotion(event.target.checked)} /> 减少界面动效</label><h3>{completeDemoMode ? '演示内容' : browserStorage ? '当前浏览器中的内容' : '这台设备上的内容'}</h3><p>{completeDemoMode ? '与个人空间分开，可随时恢复' : browserStorage ? '只保存在当前浏览器' : '保存在本机 Trace 中'}</p><p>{snapshot.host?.chain?.matters?.length || 0} 件事 · {snapshot.host?.chain?.sources?.length || 0} 份材料 · {Object.keys(snapshot.host?.worksite?.works || {}).length} 个工作记录</p>{!completeDemoMode && hasNativeCapabilityBridge() && <><CodexConnectionPanel/><RuntimeOperationsPanel/></>}{!completeDemoMode && <ZhihuAuthorization/>}<footer>{completeDemoMode ? <><RecoveryButton onClick={() => runtime.resetCompleteDemo()}>恢复完整演示</RecoveryButton><a href="/app">进入我的空间</a></> : <RecoveryButton onClick={() => void exportWorkspace().catch((error) => runtime.message(error.message))}>导出全部内容</RecoveryButton>}<RecoveryButton primary type="submit">保存设置</RecoveryButton></footer></form></>;
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
  const [searchState, setSearchState] = useState(requestedSource === 'none' ? '这次没有选择联网搜索。' : '准备查找公开内容…');
  const [searchBusy, setSearchBusy] = useState(false);
  const [kept, setKept] = useState<string[]>([]);
  const [agentInfo, setAgentInfo] = useState<any>(null);
  const [agentState, setAgentState] = useState(capability.agent === 'none' ? '这次没有选择 Agent。' : '正在检查这台设备上的 Agent…');
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentResult, setAgentResult] = useState<any>(null);
  const [agentRunId, setAgentRunId] = useState('');
  const [profileId, setProfileId] = useState('');
  const native = hasNativeCapabilityBridge();

  const doSearch = async (nextSource = source) => {
    setSearchBusy(true); setItems([]); setSearchState(`正在从${nextSource === 'zhihu' ? '知乎' : '全网'}查找公开内容…`);
    try {
      const result = await searchPublic(nextSource, capability.query, 3);
      setItems(result.items || []); setSearchState(result.items?.length ? `找到 ${result.items.length} 条公开内容；保留前不会加入这件事。` : '没有找到合适的内容，可以换一个更具体的问题。');
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
      const candidates = capability.agent === 'codex-native'
        ? profiles.filter((profile: any) => profile.kind === 'codex')
        : capability.agent === 'custom'
          ? profiles.filter((profile: any) => profile.kind === 'agent')
          : profiles.filter((profile: any) => /harness/i.test(`${profile.profileId} ${profile.label}`));
      const defaultProfile = profiles.find((profile: any) => profile.profileId === agent?.defaultProfileId && candidates.includes(profile));
      // A list position is not a configuration.  If this surface has several
      // matching executors, leave the select unresolved until the user picks
      // one (the desktop bridge applies the same rule before execution).
      const selectedProfile = capability.agent === 'codex-native'
        ? agent?.codexProfile?.profile?.profileId || defaultProfile?.profileId || (candidates.length === 1 ? candidates[0]?.profileId : '')
        : defaultProfile?.profileId || (candidates.length === 1 ? candidates[0]?.profileId : '');
      setProfileId(selectedProfile);
      setAgentState(agent?.enabled
        ? selectedProfile ? `找到 ${profiles.length} 个可用 Agent，已按刚才的选择为你匹配。` : `找到多个可用 ${capability.agent === 'codex-native' ? 'Codex' : 'Agent'}，请先明确选择一个执行器。`
        : native ? '桌宠已连接，但还没有找到可用的 Agent。' : '这次交接已经保存。启动桌宠后，才能交给 Codex 或自定义 Agent。');
    }).catch((cause) => setAgentState(cause instanceof Error ? cause.message : '暂时无法连接这台设备上的 Agent。'));
  }, [capability.agent]);

  const keep = async (item: SearchItem) => {
    try { await runtime.keepPublicSource(capability.matterId, item, capability.query); setKept((current) => [...new Set([...current, item.id])]); }
    catch (cause) { setSearchState(cause instanceof Error ? cause.message : '来源没有保存。'); }
  };
  const runAgent = async () => {
    setAgentBusy(true); setAgentResult(null); setAgentState('正在交给 Agent 处理…');
    try {
      const created = await startNativeAgent({ text: capability.query, source: requestedSource, ...(profileId ? { profileId } : {}) });
      const runId = String(created?.runId || '');
      if (!runId) throw new Error('Agent 没有返回本次运行身份。');
      setAgentRunId(runId); setAgentState('Agent 已接收，正在实时更新状态…');
      let current = created;
      const terminal = new Set(['succeeded', 'failed', 'cancelled', 'stale', 'timed_out', 'interrupted']);
      let cursor = 0;
      while (!terminal.has(current?.status)) {
        try {
          const page = await readNativeAgentEvents(runId, cursor);
          const events = Array.isArray(page?.events) ? page.events : [];
          const last = events.at(-1);
          if (last?.id && /^\d+$/.test(String(last.id))) cursor = Number(last.id);
          if (last?.data?.status && !terminal.has(last.data.status)) setAgentState(last.data.status === 'running' ? 'Agent 正在处理…' : 'Agent 已进入队列…');
        } catch {
          // A disconnected event stream must not lose the run. Fall back to a
          // bounded status read; the local Agent keeps the authoritative run.
          await new Promise((resolve) => window.setTimeout(resolve, 500));
        }
        current = await readNativeAgentRun(runId);
        if (current?.status && !terminal.has(current.status)) setAgentState(current.status === 'running' ? 'Agent 正在处理…' : 'Agent 已进入队列…');
      }
      setAgentResult(current); setAgentState(current.status === 'succeeded' ? 'Agent 已返回回答，确认前不会写入“我的理解”。' : current.error?.message || 'Agent 没有完成这次处理，可以稍后重试。');
    } catch (cause) { setAgentState(cause instanceof Error ? cause.message : 'Agent 运行没有完成。'); }
    finally { setAgentBusy(false); }
  };

  const cancelAgent = async () => {
    if (!agentRunId) return;
    setAgentState('正在请求停止这次运行…');
    try { const value = await cancelNativeAgent(agentRunId); setAgentResult(value); setAgentState('这次运行已停止，原话与已有内容没有改变。'); }
    catch (cause) { setAgentState(cause instanceof Error ? cause.message : '停止请求没有完成。'); }
    finally { setAgentBusy(false); }
  };

  const changeAdoption = async (action: 'accept' | 'dismiss' | 'undo') => {
    if (!agentRunId) return;
    try {
      const value = await adoptNativeAgent(agentRunId, action, runtime.getSnapshot().revision);
      setAgentResult(value?.run || value); setAgentState(action === 'accept' ? '候选已应用到草稿，仍需你确认。' : action === 'undo' ? '这次采纳已撤销。' : '候选已忽略，原理解没有变化。');
    } catch (cause) { setAgentState(cause instanceof Error ? cause.message : '结果处理没有完成。'); }
  };

  const profiles = agentInfo?.profiles || [];
  const profileOptions = capability.agent === 'codex-native'
    ? profiles.filter((profile: any) => profile.kind === 'codex')
    : capability.agent === 'custom'
      ? profiles.filter((profile: any) => profile.kind === 'agent')
      : profiles.filter((profile: any) => /harness/i.test(`${profile.profileId} ${profile.label}`));
  const metric = (item: SearchItem) => [item.vote_up_count == null ? '' : `${item.vote_up_count} 赞同`, item.comment_count == null ? '' : `${item.comment_count} 评论`, item.content_type || ''].filter(Boolean).join(' · ');
  const agentIntent = ({ 'codex-native': 'Codex 原生', 'codex-harness': 'Codex Harness', custom: '自定义 Agent' } as Record<string, string>)[capability.agent] || '未选择';
  return <section className="web-capability-flow">
    <p>原话已经保存。搜索结果和 Agent 回答会先留在这里，只有你确认后才会进入这件事。</p>
    <div className="web-capability-grid">
      {requestedSource !== 'none' && <section><header><i>知</i><div><h3>公开来源</h3><small>知乎经验与全网资料</small></div></header><div className="web-capability-controls"><select aria-label="搜索范围" value={source} disabled={searchBusy} onChange={(event) => setSource(event.target.value as SearchSource)}><option value="zhihu">知乎搜索</option><option value="global">全网搜索</option></select><RecoveryButton disabled={searchBusy} onClick={() => void doSearch()}>{searchBusy ? '正在查找…' : '重新查找'}</RecoveryButton></div><p role="status">{searchState}</p>{items.map((item) => <article className="web-capability-source" key={item.id}><small>{item.source === 'zhihu' ? '知乎公开内容' : '全网公开内容'}{item.author ? ` · ${item.author}` : ''}</small><strong>{item.title || '未命名来源'}</strong>{metric(item) && <span>{metric(item)}</span>}<p>{item.excerpt}</p><footer>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">查看原文</a> : <small>接口未返回原文链接</small>}<RecoveryButton primary disabled={!item.url || kept.includes(item.id)} onClick={() => void keep(item)}>{!item.url ? '暂不能保留' : kept.includes(item.id) ? '已保留到这件事' : '保留到这件事'}</RecoveryButton></footer></article>)}</section>}
      {capability.agent !== 'none' && <section><header><i>C</i><div><h3>在本机继续</h3><small>Codex、Harness 或自定义 Agent</small></div></header><dl className="web-agent-boundary"><div><dt>这次选择</dt><dd>{agentIntent}</dd></div><div><dt>在哪里处理</dt><dd>{native ? '这台设备' : '等待桌宠连接'}</dd></div><div><dt>结果回来后</dt><dd>先由你确认</dd></div></dl><p role="status">{agentState}</p>{profileOptions.length > 0 && <label>使用哪个 Agent<select value={profileId} onChange={(event) => setProfileId(event.target.value)}>{!profileId && <option value="">请选择执行器</option>}{profileOptions.map((profile: any) => <option value={profile.profileId} key={profile.profileId}>{profile.label || '可用 Agent'}</option>)}</select></label>}<RecoveryButton primary disabled={!native || !agentInfo?.enabled || !profileId || agentBusy} onClick={() => void runAgent()}>{agentBusy ? 'Agent 正在处理…' : '交给 Agent 继续'}</RecoveryButton>{agentBusy && <RecoveryButton disabled={!agentRunId} onClick={() => void cancelAgent()}>停止这次运行</RecoveryButton>}{!native && <small>启动桌宠后，这次内容会从本机交给 Agent；网页不会接触你的登录信息。</small>}{agentResult?.result && <article className="web-capability-agent-result"><small>{agentResult.profile?.label || 'Agent'} · {agentResult.result.kind === 'revision_candidate' ? '修改建议' : '讨论回答'}</small><strong>Agent 的回答</strong><p>{agentResult.result.answer}</p>{agentResult.result.uncertainties?.length > 0 && <><b>仍不确定</b><ul>{agentResult.result.uncertainties.map((text: string) => <li key={text}>{text}</li>)}</ul></>}{agentResult.result.adoption === 'not_applied' && <footer><RecoveryButton primary onClick={() => void changeAdoption('accept')}>接受候选</RecoveryButton><RecoveryButton onClick={() => void changeAdoption('dismiss')}>忽略候选</RecoveryButton></footer>}{agentResult.result.adoption === 'applied' && <RecoveryButton onClick={() => void changeAdoption('undo')}>撤销这次采纳</RecoveryButton>}</article>}</section>}
    </div>
    <footer><RecoveryButton onClick={() => runtime.closeDialog()}>完成，回到这件事</RecoveryButton></footer>
  </section>;
}

type RuntimePanelState = {
  connected?: boolean;
  sessionKind?: string;
  sessionId?: string;
  projectBinding?: {
    status?: string;
    sourceLabel?: string;
    identityHint?: string | null;
  };
  sessions?: Array<{ sessionId?: string; status?: string; project?: string; updatedAt?: string }>;
  turnCount?: number;
  findings?: Array<{ kind?: string; status?: string; turn?: string; summary?: string }>;
  jobs?: Array<{ status?: string; execution_mode?: string; error_code?: string }>;
  proposals?: Array<{ id?: string; status?: string; target?: string; scope?: string; rationale?: string; revision?: number }>;
  activations?: Array<{ id?: string; status?: string; count?: number; createdAt?: string }>;
  worker?: { status?: string; mode?: string; queueDepth?: number; failedCount?: number };
  recovery?: Array<{ state?: string; id?: string; expectedBranch?: string }>;
  policies?: Array<{ status?: string; scope?: string; id?: string; revision?: number }>;
  orchestrations?: Array<{ status?: string; id?: string; revision?: number; hasCandidate?: boolean; hasManifest?: boolean; producerStatus?: string }>;
  trials?: Array<{ status?: string; id?: string; orchestrationId?: string; revision?: number; outcome?: string }>;
};

function RuntimeOperationsPanel() {
  const [panel, setPanel] = useState<RuntimePanelState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('正在读取工作现场…');
  const [previewedRecovery, setPreviewedRecovery] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<{ preflightId?: string; canApply?: boolean } | null>(null);
  const [policyPreview, setPolicyPreview] = useState<{ previewId?: string; scope?: string } | null>(null);
  const [trialScenario, setTrialScenario] = useState('验证这条能力在当前项目中的边界');
  const [publicationReceipt, setPublicationReceipt] = useState('');
  const [rollbackReceipt, setRollbackReceipt] = useState('');
  const load = async () => {
    setBusy(true);
    try {
      const value = await readDesktopRuntimePanel();
      setPanel(value || null);
      setMessage(value?.connected ? '工作现场已连接。原始正文与本机路径不会显示在这里。' : '桌面 Runtime 尚未连接。');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '工作现场暂时不可用。'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  const action = async (name: string, payload: Record<string, unknown> = {}, confirmText = '') => {
    if (busy) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setMessage('正在更新工作现场…');
    try { const result = await runDesktopRuntimeAction(name, { ...payload, ...(confirmText ? { confirmation: 'user-confirmed' } : {}) }); setMessage('已收到 Runtime 回执，正在刷新现场…'); await load(); return result; }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : '这一步没有完成，原有记录没有被覆盖。'); }
    finally { setBusy(false); }
  };
  const firstSession = panel?.sessions?.[0];
  const candidate = panel?.orchestrations?.[0];
  const trial = candidate ? panel?.trials?.find((item) => item.orchestrationId === candidate.id && ['queued', 'running'].includes(item.status || '')) : panel?.trials?.[0];
  const adoptedGuard = panel?.proposals?.find((item) => item.status === 'adopted' && item.target === 'runtime-guard');
  const activePolicy = panel?.policies?.find((item) => item.status === 'active');
  return <section className="web-runtime-operations" aria-label="本机能力与工作现场">
    <header><div><span className="web-panel-eyebrow">TRACE RUNTIME · LOCAL WORKSITE</span><h3>本机能力与工作现场</h3></div><RecoveryButton disabled={busy} onClick={() => void load()}>刷新</RecoveryButton></header>
    <p className="web-runtime-operations-intro">这里是桌面端的真实接口入口：跟随 Codex 会话、查看异步工作状态、处理路由提案和恢复预览。危险操作都需要再次确认；界面只显示经过整理的状态。</p>
    <p className="web-runtime-operations-status" role="status">{message}</p>
    <section className="web-runtime-operations-section"><header><h4>工作现场</h4><span>{firstSession?.status || '尚未附着'}</span></header><p>{firstSession?.project || '尚未选择项目'}{firstSession?.updatedAt ? ` · 最近活动 ${firstSession.updatedAt}` : ''}</p><small>{panel?.sessionKind === 'synthetic-bridge' ? '当前是桌面桥接 synthetic session，不是 Codex Desktop 原生 thread；原生 thread 只以 Agent 回执提供。' : '当前会话身份等待 Runtime 回执。'}{panel?.projectBinding?.sourceLabel ? ` · 项目来源：${panel.projectBinding.sourceLabel}` : ''}</small><div className="web-runtime-actions"><RecoveryButton disabled={busy} onClick={() => void action('session.attach')}>开始跟随</RecoveryButton><RecoveryButton disabled={busy || firstSession?.status !== 'attached'} onClick={() => void action('session.pause')}>暂停接收</RecoveryButton><RecoveryButton disabled={busy || !firstSession || firstSession.status === 'ended'} onClick={() => void action('session.detach', {}, '确认结束当前桌面会话的跟随？')}>结束跟随</RecoveryButton></div><small>{panel?.turnCount || 0} 个会话片段 · {panel?.findings?.length || 0} 条工作发现</small></section>
    <section className="web-runtime-operations-section"><header><h4>异步理解</h4><span>{panel?.worker?.status || '未配置'}</span></header><p>队列 {panel?.worker?.queueDepth ?? 0} · 失败 {panel?.worker?.failedCount ?? 0} · {panel?.jobs?.length || 0} 条最近任务</p><RecoveryButton disabled={busy} onClick={() => void action('sensemaking.drain', { limit: 16 })}>处理已入队任务</RecoveryButton></section>
    <section className="web-runtime-operations-section"><header><h4>路由提案</h4><span>试用 ≠ 采用</span></header>{panel?.proposals?.length ? panel.proposals.slice(0, 4).map((proposal) => <article className="web-runtime-row" key={proposal.id}><div><strong>{proposal.target || '待判断'} · {proposal.scope || '未知范围'}</strong><small>{proposal.rationale || '等待更多证据'}</small></div><span>{proposal.status}</span><div className="web-runtime-actions"><RecoveryButton disabled={busy} onClick={() => void action('routing.decide', { proposalId: proposal.id, decision: 'trial', expectedRevision: proposal.revision || 0 })}>试用</RecoveryButton><RecoveryButton disabled={busy} onClick={() => void action('routing.decide', { proposalId: proposal.id, decision: 'adopt', expectedRevision: proposal.revision || 0 }, '确认采用这条路由提案？它会进入 Trace 的后续能力来源。')}>采用</RecoveryButton><RecoveryButton disabled={busy} onClick={() => void action('routing.decide', { proposalId: proposal.id, decision: 'reject', expectedRevision: proposal.revision || 0 })}>忽略</RecoveryButton></div></article>) : <p className="web-runtime-empty">还没有路由提案。</p>}</section>
    <section className="web-runtime-operations-section"><header><h4>仓库保护与恢复</h4><span>先预览，再决定</span></header><p>apply 只能使用刚返回的只读预检回执；没有已采用的 runtime-guard 提案时不会开放。</p><div className="web-runtime-actions"><RecoveryButton disabled={busy} onClick={async () => { const result = await action('repository.preflight', { ...(adoptedGuard?.id ? { proposalId: adoptedGuard.id } : {}), taskIntent: '为当前工作现场准备受控分支' }, '先做一次只读仓库预检？不会切换、重置、删除或推送。'); if (result?.preflightId) setPreflight(result); }}>只读预检{adoptedGuard ? '（绑定已采用提案）' : ''}</RecoveryButton><RecoveryButton primary disabled={busy || !preflight?.canApply} onClick={() => void action('repository.apply', { preflightId: preflight?.preflightId }, '确认按刚才的预检回执执行受控分支保护？这一步可能切换到新分支，不会 push、merge、delete 或 reset。')}>确认 apply</RecoveryButton>{panel?.recovery?.slice(0, 3).map((item) => <React.Fragment key={item.id}><RecoveryButton disabled={busy || !item.id} onClick={async () => { try { await runDesktopRuntimeAction('repository.recovery.preview', { journalId: item.id }); setPreviewedRecovery(item.id || null); setMessage('恢复预览已返回；没有执行任何 Git 变更。'); } catch (cause) { setMessage(cause instanceof Error ? cause.message : '恢复预览没有完成。'); } }}>{item.state === 'recovery_required' ? '预览恢复' : '查看记录'}</RecoveryButton>{previewedRecovery === item.id && <RecoveryButton primary disabled={busy} onClick={() => void action('repository.recovery.reconcile', { journalId: item.id }, '确认 reconcile 这条恢复记录？只有状态证据充分时才会写入回执，不会自动 reset。')}>确认 reconcile</RecoveryButton>}</React.Fragment>)}</div>{!panel?.recovery?.length && <p className="web-runtime-empty">当前没有待恢复记录。</p>}</section>
    <section className="web-runtime-operations-section"><header><h4>能力治理</h4><span>发布前必须有证据</span></header><div className="web-runtime-compact-grid"><div><b>发布策略</b><small>{panel?.policies?.length || 0} 条现有策略 · {activePolicy ? '已有 active 策略' : '尚无 active 策略'}</small><RecoveryButton disabled={busy} onClick={async () => { const result = await action('publication.policy.preview', { scope: 'project' }, '先预览当前项目的发布策略？不会发布文件。'); if (result?.previewId) setPolicyPreview(result); }}>预览策略</RecoveryButton><RecoveryButton primary disabled={busy || !policyPreview?.previewId} onClick={() => void action('publication.policy.adopt', { previewId: policyPreview?.previewId }, '确认采用刚才的发布策略预览？它只允许明确的能力发布，不会自动发布文件。')}>采用预览</RecoveryButton><RecoveryButton disabled={busy || !activePolicy?.id} onClick={() => void action('publication.policy.revoke', { policyId: activePolicy?.id, expectedRevision: activePolicy?.revision }, '确认撤回当前 active 发布策略？撤回后相关发布会被阻止。')}>撤回 active 策略</RecoveryButton></div><div><b>能力候选</b><small>{panel?.orchestrations?.length || 0} 条编排记录 · {candidate?.status || '未选择'}</small><RecoveryButton disabled={busy || !candidate?.id || !candidate.hasManifest} onClick={() => void action('capability.stage', { orchestrationId: candidate?.id, expectedRevision: candidate?.revision || 0 }, '确认把已由 producer 暂存的候选登记为 staged？这不是发布。')}>暂存候选</RecoveryButton><RecoveryButton disabled={busy || !candidate?.id || !['staged', 'trial_queued'].includes(candidate.status || '')} onClick={() => void action('capability.validate', { orchestrationId: candidate?.id, expectedRevision: candidate?.revision || 0, validation: { schema: 'passed', replay: 'passed', behavior: 'passed', rollback: 'passed', source_hashes: 'passed' } }, '确认你已经核对结构、回放、行为、回滚和来源哈希证据，并标记为通过？')}>标记验证通过</RecoveryButton></div><div><b>能力试用</b><small>{panel?.trials?.length || 0} 条试用 · 需要已暂存清单</small><input className="web-runtime-inline-input" value={trialScenario} maxLength={160} onChange={(event) => setTrialScenario(event.target.value)} aria-label="试用场景" placeholder="简短试用场景"/><RecoveryButton disabled={busy || !candidate?.id || !candidate.hasManifest} onClick={() => void action('capability.trial.create', { orchestrationId: candidate?.id, expectedRevision: candidate?.revision || 0, scenario: trialScenario })}>创建试用</RecoveryButton><RecoveryButton disabled={busy || !trial?.id} onClick={() => void action('capability.trial.complete', { trialId: trial?.id, expectedRevision: trial?.revision || 0, outcome: 'inconclusive', observed: '已从 Trace 工作现场完成一次显式试用，等待进一步证据。' })}>记录未决</RecoveryButton></div><div><b>发布与回滚</b><small>{candidate?.status === 'validated' ? '已通过验证，等待 publisher 回执' : candidate?.status === 'published' ? '已发布，可回滚' : '验证通过后开放'}</small><input className="web-runtime-inline-input" value={publicationReceipt} maxLength={160} onChange={(event) => setPublicationReceipt(event.target.value)} aria-label="发布回执" placeholder="CapabilityPublisher 发布回执 ID"/><input className="web-runtime-inline-input" value={rollbackReceipt} maxLength={160} onChange={(event) => setRollbackReceipt(event.target.value)} aria-label="回滚回执" placeholder="CapabilityPublisher 回滚回执"/><RecoveryButton primary disabled={busy || candidate?.status !== 'validated' || !publicationReceipt.trim() || !rollbackReceipt.trim()} onClick={() => void action('capability.publish', { orchestrationId: candidate?.id, expectedRevision: candidate?.revision || 0, producerStatus: 'published', publicationReceipt: { receipt_id: publicationReceipt.trim(), source: 'CapabilityPublisher' }, rollbackReceipt: rollbackReceipt.trim(), ...(activePolicy?.id ? { policyId: activePolicy.id } : {}) }, '确认按外部 CapabilityPublisher 回执发布这条能力？Trace 不会代替 publisher 写入能力文件。')}>发布能力</RecoveryButton><RecoveryButton disabled={busy || candidate?.status !== 'published' || !rollbackReceipt.trim()} onClick={() => void action('capability.rollback', { orchestrationId: candidate?.id, expectedRevision: candidate?.revision || 0, rollbackReceipt: rollbackReceipt.trim() }, '确认回滚这条已发布能力？这会写入回滚回执。')}>回滚能力</RecoveryButton></div></div><small>没有候选、暂存清单、验证回执或外部 publisher 回执时，后续动作会保持禁用；界面不展示路径、哈希或原始系统 JSON。</small></section>
  </section>;
}

function CodexConnectionPanel() {
  const [setup, setSetup] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('正在检查桌宠、项目和 Codex…');
  const load = async () => {
    try {
      const value = await desktopSetupStatus();
      setSetup(value);
      setMessage(value?.codex?.available ? '桌宠已连接。首次使用前，请检查一次 Codex 登录状态。' : '桌宠已连接，但还没有找到 Codex。');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '暂时无法检查本机接入。'); }
  };
  useEffect(() => { void load(); }, []);
  const chooseProject = async () => {
    setBusy(true);
    try {
      const project = await selectDesktopProject();
      setSetup((current: any) => ({ ...current, project: project?.projectName ? { ...project, connected: project.status === 'confirmed', name: project.projectName } : current?.project }));
      setMessage(project?.status === 'confirmed' ? `已确认项目「${project.projectName}」。` : project?.diagnostic?.message || '没有更改项目。');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '项目选择没有完成。'); }
    finally { setBusy(false); }
  };
  const confirmProject = async () => {
    setBusy(true); setMessage('正在核对项目描述与仓库身份…');
    try {
      const project = await confirmDesktopProject();
      setSetup((current: any) => ({ ...current, project: project?.projectName ? { ...project, connected: project.status === 'confirmed', name: project.projectName } : current?.project }));
      setMessage(project?.status === 'confirmed' ? `已确认项目「${project.projectName}」，现在可以交给 Codex。` : project?.diagnostic?.message || '项目仍未确认。');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '项目确认没有完成。'); }
    finally { setBusy(false); }
  };
  const chooseProfile = async (profileId: string) => {
    if (!profileId) return;
    setBusy(true); setMessage('正在保存 Codex profile 选择…');
    try {
      const selected = await selectCodexProfile(profileId);
      setSetup((current: any) => ({ ...current, codex: { ...current?.codex, profileId: selected?.profileId || profileId, profileStatus: 'resolved', ready: false, authenticated: false } }));
      setMessage(`已选择 Codex profile「${selected?.label || profileId}」。`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Codex profile 选择没有完成。'); }
    finally { setBusy(false); }
  };
  const check = async () => {
    setBusy(true); setMessage('正在通过受限连接检查 Codex 版本与登录状态…');
    try {
      const value = await checkCodexConnection();
      setSetup((current: any) => ({ ...current, codex: { ...current?.codex, ...value, checked: true } }));
      setMessage(value.ready ? `Codex ${value.version || ''} 已登录，可以接收 Trace 工作。` : 'Codex 已找到，但尚未登录。请先打开 Codex 完成登录。');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Codex 检查没有完成。'); }
    finally { setBusy(false); }
  };
  const connectPlugin = async () => {
    setBusy(true); setMessage('正在把 Trace 入口连接到 Codex…');
    try { const value = await connectTraceCodexPlugin(); setMessage(value.message || 'Trace 已连接到 Codex。'); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Codex 插件连接没有完成。'); }
    finally { setBusy(false); }
  };
  const ready = setup?.codex?.ready === true && setup?.project?.status === 'confirmed' && setup?.project?.connected === true;
  const projectStatus = setup?.project?.status || 'unbound';
  const projectStatusLabel = projectStatus === 'confirmed' ? '已确认' : projectStatus === 'candidate' ? '候选，待确认' : projectStatus === 'conflict-or-drift' ? '发生漂移' : '未绑定';
  return <section className="web-codex-setup" data-ready={ready ? 'true' : 'false'}>
    <header><h3>Codex 接入</h3><span>{ready ? '可以开始工作' : setup ? '需要一次检查' : '正在检查'}</span></header>
    <p role="status">{message}</p>
    <dl><div><dt>桌宠连接</dt><dd>{setup?.runtime?.connected ? setup.runtime.bundled ? '已随桌面版连接' : '已连接' : '正在检查'}</dd></div><div><dt>当前项目</dt><dd>{setup?.project?.name || '尚未选择'} · {projectStatusLabel}{setup?.project?.identityHint ? ` · 身份 ${setup.project.identityHint}` : ''}</dd></div><div><dt>候选来源</dt><dd>{setup?.project?.sourceLabel || setup?.project?.source || '启动目录候选'}</dd></div><div><dt>Codex</dt><dd>{setup?.codex?.ready ? '已登录，可以使用' : setup?.codex?.available ? setup?.codex?.profileStatus === 'unresolved' ? '多个 profile，等待明确选择' : '已找到，等待检查' : '尚未找到'}</dd></div><div><dt>结果回来后</dt><dd>先进入 Trace，由你确认</dd></div></dl>
    {Array.isArray(setup?.codex?.candidates) && setup.codex.candidates.length > 1 && <label className="web-codex-profile-select">Codex profile<select aria-label="Codex profile" value={setup.codex.profileId || ''} disabled={busy} onChange={(event) => void chooseProfile(event.target.value)}><option value="">请选择执行器</option>{setup.codex.candidates.map((profile: any) => <option key={profile.profileId} value={profile.profileId}>{profile.label || profile.profileId}</option>)}</select></label>}
    <div className="web-codex-actions"><RecoveryButton disabled={busy} onClick={() => void chooseProject()}>{setup?.project?.status === 'confirmed' ? '更换项目' : '选择项目'}</RecoveryButton>{projectStatus === 'candidate' && <RecoveryButton disabled={busy} onClick={() => void confirmProject()}>确认绑定</RecoveryButton>}<RecoveryButton primary disabled={busy || !setup?.codex?.available || setup?.codex?.profileStatus === 'unresolved'} onClick={() => void check()}>{busy ? '正在处理…' : '检查 Codex'}</RecoveryButton>{setup?.codex?.ready && <RecoveryButton disabled={busy} onClick={() => void connectPlugin()}>在 Codex 中使用 Trace</RecoveryButton>}</div>
    <small className="web-codex-note">“检查 Codex”用于从 Trace 把工作交给本机 Codex；“在 Codex 中使用 Trace”是可选入口，安装后请新开 Codex 任务。项目绝对路径只留在本机，不会显示在页面或发送给模型。</small>
  </section>;
}

function ZhihuAuthorization() {
  const [status, setStatus] = useState<ZhihuAuthorizationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resource, setResource] = useState<ZhihuUserContentKind | ''>('');
  const [favoriteId, setFavoriteId] = useState('');
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
  const read = async (kind: ZhihuUserContentKind, selectedFavoriteId?: string) => {
    setBusy(true); setError('');
    try {
      const value = await readZhihuUserContent(kind, 3, selectedFavoriteId);
      setResource(kind); setItems(value.items || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '没有读到知乎资料。'); }
    finally { setBusy(false); }
  };
  const authorized = status?.oauth?.status === 'authorized';
  const stateLabel = authorized ? '已连接' : status === null && !error ? '正在检查' : status?.oauth?.configured ? '未连接' : '暂不可用';
  const userContentUnavailable = status?.user_content_configured === false;
  return <section className="web-zhihu-auth" data-state={authorized ? 'authorized' : status?.oauth?.configured ? 'ready' : 'unconfigured'}><div className="web-auth-title"><h3>我的知乎内容</h3><span>{stateLabel}</span></div><p>{authorized ? '你可以选择读取近期创作、关注和收藏；Trace 不会自动导入。' : status?.oauth?.configured ? '连接后，你可以按需读取创作、关注和收藏。公开搜索不需要登录知乎。' : status === null && !error ? '正在检查是否可以连接知乎…' : '当前版本暂时不能连接个人知乎内容；知乎公开搜索仍可单独使用。'}</p>{status?.oauth?.expires_at && <small>本次授权最晚有效至 {new Date(status.oauth.expires_at).toLocaleString('zh-CN')}</small>}{error && <p className="web-auth-error" role="alert">{error}</p>}<div>{authorized ? <><RecoveryButton disabled={busy || userContentUnavailable} onClick={() => void read('contents')}>读取近期创作</RecoveryButton><RecoveryButton disabled={busy || userContentUnavailable} onClick={() => void read('favorites')}>读取近期收藏</RecoveryButton><RecoveryButton disabled={busy || userContentUnavailable} onClick={() => void read('favorite_lists')}>读取收藏夹</RecoveryButton><RecoveryButton disabled={busy || userContentUnavailable} onClick={() => void read('followees')}>读取关注</RecoveryButton><RecoveryButton disabled={busy} onClick={() => void disconnect()}>断开连接</RecoveryButton></> : <><RecoveryButton primary disabled={busy || status?.oauth?.configured !== true} onClick={() => void start()}>{busy ? '正在处理…' : status?.oauth?.status === 'pending_user_authorization' ? '重新打开知乎授权' : '连接我的知乎'}</RecoveryButton>{hasNativeCapabilityBridge() && status?.oauth?.status === 'pending_user_authorization' && <RecoveryButton disabled={busy} onClick={() => void check()}>我已授权，检查结果</RecoveryButton>}</>}<RecoveryButton disabled={busy} onClick={() => void load()}>刷新状态</RecoveryButton></div>{resource === 'favorite_lists' && <p className="web-zhihu-favorite-hint">先读取收藏夹列表，再选择一个收藏夹读取其中的内容。</p>}{resource === 'favorite_lists' && items.map((item) => <RecoveryButton key={item.id || item.title} disabled={busy || !item.id} onClick={() => { setFavoriteId(String(item.id || '')); void read('favorite_items', String(item.id || '')); }}>打开「{item.title || '未命名收藏夹'}」</RecoveryButton>)}{resource && <div className="web-zhihu-results" aria-live="polite"><strong>{({ contents: '近期创作', favorites: '近期收藏', favorite_lists: '我的收藏夹', favorite_items: favoriteId ? `收藏夹 ${favoriteId}` : '收藏夹内容', followees: '关注' } as Record<string, string>)[resource]} · {items.length} 条</strong>{items.length ? items.map((item, index) => <article key={item.id || `${resource}-${index}`}><b>{item.title || '未命名内容'}</b>{item.summary && <p>{item.summary}</p>}{item.url && <a href={item.url} target="_blank" rel="noreferrer">打开知乎原处</a>}</article>) : <p>这次没有读取到内容。</p>}<small>这里只展示你本次读取的 3 条，尚未保存到 Trace。</small></div>}<small>{authorized ? '这项连接只用于读取你明确选择的知乎资料。' : '公开搜索与个人知乎内容分开使用。'}</small></section>;
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


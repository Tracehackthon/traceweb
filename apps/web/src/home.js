import { animate, svg as animeSvg } from './vendor/anime.esm.js'
import { createState, transition, ENTRIES, LAYOUTS, PATHS, NODE_POSITIONS, BIRDS } from './home-model.js'
import { icon, mark } from './home-icons.js'
import { mountSceneGlass } from './home/scene-glass.js'
import { createCanvasController } from './product/canvas-controller.mjs'

export function mountHome({ root = document.querySelector('#app'), snapshot, entries = {}, onOpen, onContinue, onSource, onWork, onAll, onSearch, onCapture, onProfile, onWorks, onMatters, onDraft, product = false, assets = {}, services = {} } = {}) {
const controller = new AbortController()
const timers = new Set()
const setTimeout = (callback, delay) => { const id = window.setTimeout(() => { timers.delete(id); callback() }, delay); timers.add(id); return id }
const clearTimeout = id => { timers.delete(id); window.clearTimeout(id) }
const listen = (target, event, callback, options = {}) => target.addEventListener(event, callback, { ...options, signal: controller.signal })
const mount = root || document.querySelector('#app')
if (!mount) throw new Error('Trace 首页缺少挂载点')
const $ = s => mount.querySelector(s)
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const backgroundUrl = assets.background || ''
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
let state = snapshot?.state || createState(new URLSearchParams(location.search).get('state'))
let prototypePreview = !product && (snapshot?.prototypePreview ?? new URLSearchParams(location.search).has('state'))
if(product) state=createState('overview')
let actionRevision = 0
let toastTimer
let lastFocus
let captureSource = snapshot?.captureOptions?.source || (snapshot?.completeDemoMode ? 'zhihu' : 'none')
let captureAgent = snapshot?.captureOptions?.agent || (snapshot?.completeDemoMode ? 'codex-harness' : 'none')
const drafts = new Map(snapshot?.drafts || [])
const materials = new Map()
const animations = new Set()
const bubblePaths = [
  'M75 21 C177 -8 383 24 514 19 C679 9 832 1 928 57 C1010 101 1007 210 917 257 C831 299 650 266 489 279 C289 302 138 299 57 235 C-10 182 -2 65 75 21Z',
  'M97 24 C235 -6 414 33 543 16 C751 -12 900 10 958 79 C1033 170 969 270 881 284 C731 315 610 267 459 270 C238 292 110 270 43 219 C-20 157 3 54 97 24Z',
  'M105 13 C256 -5 394 33 534 22 C721 0 849 -6 936 70 C1018 139 1007 232 911 276 C794 307 634 272 480 281 C265 293 127 266 48 215 C-14 160 5 43 105 13Z',
]
const fullPath = 'M68 4 C267 -3 740 6 928 6 C981 6 998 43 996 86 L996 232 C996 282 970 297 914 296 L85 296 C23 299 3 273 4 227 L4 78 C3 34 19 12 68 4Z'
// The relation paths are deliberately finite around their authored nodes, but
// the river itself must never reveal those authored endpoints while the camera
// is panned.  These quiet extensions continue each branch into overscan.  They
// carry no records and are only used as the visual continuation/mist layer.
const riverBuffers = [
  { mid: '360,472', className: 'river-buffer-main', d: 'M -5200 330 C -4720 332 -4150 370 -3600 360 C -2880 347 -2280 426 -1700 398 C -1040 366 -520 438 -250 403 C -150 408 -70 393 -10 385 C 148 390 216 518 360 545' },
  { mid: '286,509', className: '', d: 'M -5200 520 C -4500 516 -3900 548 -3200 526 C -2430 502 -1740 532 -1100 506 C -650 488 -390 510 -110 512 C 30 514 154 509 286 509 C 369 508 392 434 443 407' },
  { mid: '1332,454', className: 'river-buffer-main', d: 'M 1156 529 C 1249 516 1261 460 1332 454 C 1420 448 1510 472 1615 450 C 1940 390 2300 478 2680 430 C 3140 372 3570 470 4050 418 C 4440 377 4830 436 5200 397' },
  { mid: '1332,662', className: 'river-buffer-main', d: 'M 1055 586 C 1163 698 1237 615 1332 662 C 1432 640 1518 682 1624 658 C 1940 590 2250 702 2630 640 C 3100 566 3500 700 3970 630 C 4420 564 4810 678 5200 616' },
  { mid: '1332,454', className: 'river-buffer-branch', d: 'M 1260 500 C 1290 480 1314 464 1332 454 C 1428 486 1457 540 1535 562 C 1810 646 2060 532 2380 586 C 2790 655 3130 546 3480 594 C 4050 671 4580 544 5200 582' },
  // PATHS.overview[2] previously stopped at (976,660), leaving a visible
  // branch endpoint after enough historical pan.  Continue from the exact
  // endpoint so the seam is geometrically coincident, then fade via the mask.
  { mid: '976,660', className: 'river-buffer-main', d: 'M 976 660 C 1086 624 1205 714 1280 690 C 1430 665 1530 720 1690 700 C 2050 656 2360 760 2700 710 C 3150 646 3500 760 3900 704 C 4350 642 4750 760 5200 704' },
]
const riverBufferMarkup = riverBuffers.map(({ mid, className, d }) => `<path class="river-buffer-path ${className}" data-river-mid="${mid}" d="${d}"/>`).join('')
const riverBufferUnderlayMarkup = riverBuffers.map(({ mid, d }) => `<path class="river-understroke river-buffer-understroke" data-river-mid="${mid}" d="${d}"/>`).join('')
const DETAIL_BOUNDS = {
  thinking: { left: 462, top: 336, width: 805, height: 522 },
  work: { left: 474, top: 350, width: 773, height: 480 },
}
const foot = { overview: [443,407], thinking: [521,379], growth: [867,521], work: [896,344], return: [1210,485] }

document.title = 'Trace · 把此刻的一点，带到以后'
document.body.classList.add('home-page')
mount.innerHTML = `
  <main class="home-viewport" aria-label="Trace 首页">
    <div class="scene" id="home-scene" data-state="${state.mode}">
      <header class="home-header">
        <button class="wordmark" type="button" data-action="home" aria-label="Trace，返回首页"><span class="brand-tile">${mark}</span><span>Trace</span></button>
        <nav class="home-nav" aria-label="首页导航">
          <button data-action="search" type="button">${icon('search')}<span>搜索</span></button>
          <span class="nav-separator"></span>
          <button data-action="all" type="button">${icon('layers')}<span>全部</span></button>
          <button class="project-pill" data-action="project" type="button"><i></i><span>${product?'工作现场':'Codex · harness'}</span></button>
        </nav>
      </header>
      <section class="home-hero" aria-labelledby="home-title">
        <h1 id="home-title">把此刻的一点，带到以后<span>。</span></h1>
        <p>留下一段触动、一个问题或工作中的发现；继续想，带去用，再让结果回来。</p>
      </section>
      <form class="home-composer" id="capture-form">
        <label class="sr-only" for="capture-input">留下一点</label>
        <textarea id="capture-input" rows="1" placeholder="写一句，贴一段，或者带回一个结果……" maxlength="3000"></textarea>
        <div class="composer-bottom"><div class="source-pills">${product?`<label class="capture-select"><span class="capability-icon">${icon('search')}</span><span class="sr-only">搜索范围</span><select id="capture-source" name="sourceMode" aria-label="搜索范围"><option value="none" ${captureSource==='none'?'selected':''}>不联网</option><option value="zhihu" ${captureSource==='zhihu'?'selected':''}>知乎搜索</option><option value="web" ${captureSource==='web'?'selected':''}>全网搜索</option></select><span class="select-chevron" aria-hidden="true">⌄</span></label><label class="capture-select"><span class="capability-icon">${icon('play')}</span><span class="sr-only">Agent 引擎</span><select id="capture-agent" name="agentMode" aria-label="Agent 引擎"><option value="none" ${captureAgent==='none'?'selected':''}>不交给 Agent</option><option value="codex-native" ${captureAgent==='codex-native'?'selected':''}>Codex 原生</option><option value="codex-harness" ${captureAgent==='codex-harness'?'selected':''}>Codex Harness</option><option value="custom" ${captureAgent==='custom'?'selected':''}>自定义 Agent</option></select><span class="select-chevron" aria-hidden="true">⌄</span></label>${snapshot?.completeDemoMode?`<button class="capture-demo-state" type="button" data-action="source" aria-label="查看知乎来源怎样参与这件事"><i>知</i><span><strong>知乎参与这件事</strong><small>${Number(snapshot.demoSourceCount)||0} 份公开来源 · 原现场与对照</small></span>${icon('next')}</button>`:''}`:`<button type="button" data-action="source">${icon('link')}知乎原文</button><button type="button" data-action="project">${icon('layers')}Codex · harness</button>`}</div><button type="submit" class="send-orb" aria-label="留下这段想法" disabled>${icon('arrow')}</button></div>
      </form>
      <div class="trace-canvas-viewport" data-canvas-viewport aria-label="可缩放的事项画布" tabindex="0">
        <div class="trace-canvas-world" data-canvas-world>
        <svg class="scene-paths" viewBox="0 0 1672 941" aria-hidden="true">
        <defs><linearGradient id="flow-color"><stop offset="0" stop-color="#fff5b0" stop-opacity="0"/><stop offset=".5" stop-color="#e9a733"/><stop offset="1" stop-color="#fff5b0" stop-opacity="0"/></linearGradient><radialGradient id="node-gold"><stop stop-color="#ffc45e"/><stop offset="1" stop-color="#e69c22"/></radialGradient><linearGradient id="river-buffer-alpha" x1="-5200" y1="0" x2="5200" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="white" stop-opacity="0"/><stop offset=".035" stop-color="white" stop-opacity=".35"/><stop offset=".11" stop-color="white"/><stop offset=".89" stop-color="white"/><stop offset=".965" stop-color="white" stop-opacity=".35"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient><mask id="river-buffer-mask" maskUnits="userSpaceOnUse" x="-5200" y="0" width="10400" height="941"><rect x="-5200" y="0" width="10400" height="941" fill="url(#river-buffer-alpha)"/></mask><filter id="node-halo" x="-300%" y="-300%" width="700%" height="700%"><feGaussianBlur stdDeviation="10"/></filter><path id="home-motion-target" d="${fullPath}"/><g id="home-path-targets">${PATHS.overview.map((d,i) => `<path id="home-path-target-${i}" d="${d}"/>`).join('')}</g></defs>
        <g id="home-motion-layer" class="scene-motion-layer" aria-hidden="true"><path id="home-motion-thread" class="scene-motion-thread" d="M 360 545 L 360 545"/><path id="home-motion-signal" class="scene-motion-signal" d="M 360 545 L 360 545"/><g id="home-motion-surface"><path id="home-motion-shape" class="scene-motion-shape" d="${bubblePaths[0]}"/></g><circle id="home-motion-node" class="scene-motion-node" cx="360" cy="545" r="7"/></g>
        ${product?`<g class="river-underlay" aria-hidden="true">${PATHS.overview.map((d,i) => `<path class="river-understroke under-${i}" data-under-path="${i}" d="${d}"/>`).join('')}</g>`:''}
        <g id="threads">${PATHS.overview.map((d,i) => `<path class="thread-path thread-${i}" data-path="${i}" d="${d}"/><path class="thread-light" data-light="${i}" d="${d}" pathLength="1"/>`).join('')}</g>
        <g class="river-buffer" mask="url(#river-buffer-mask)" aria-hidden="true">
          ${riverBufferMarkup}
          <g class="river-buffer-underlay">${riverBufferUnderlayMarkup}</g>
        </g>
        <g id="scene-nodes">${NODE_POSITIONS.overview.map(([x,y],i) => `<g class="scene-node node-${i} ${i===2||i===3?'gold':''}" data-dot="${i}" transform="translate(${x} ${y})"><circle class="node-bloom" r="17"/><circle class="node-disc" r="${i===0?11:8}"/><circle class="node-pin" r="2.2"/></g>`).join('')}</g>
        <path id="bird-route" fill="none" stroke="none" d="M443 407 L443 407"/>
        </svg>
        <section class="thought-field" aria-label="在意的事">${Object.entries(ENTRIES).map(([id,entry],i) => `<button class="thought-bubble ${entry.warm?'warm':''}" data-entry="${id}" data-shape="${i%3}" type="button" hidden><span class="bubble-material" aria-hidden="true"></span><span class="bubble-content"><span class="bubble-icon">${icon(entry.icon)}</span><span class="bubble-copy"><strong>${escape(entry.title)}</strong><span class="bubble-subtitle">${escape(entry.subtitle)}</span></span></span></button>`).join('')}</section>
        </div>
        ${product?'<div class="river-edge-fade" aria-hidden="true"></div>':''}
        <div class="scene-bird scene-bird-overlay" id="scene-bird" aria-hidden="true"><img class="bird-perched" src="${assets.birdPerched || '/home/bird-perched.png'}" alt=""/><img class="bird-flying" src="${assets.birdTakeoff || '/home/bird-takeoff.png'}" alt=""/></div>
        <div class="trace-canvas-controls" data-canvas-controls aria-label="画布缩放控制">
          <button type="button" data-canvas-action="zoom-out" aria-label="缩小画布" title="缩小">−</button>
          <output data-canvas-scale aria-live="polite">100%</output>
          <button type="button" data-canvas-action="zoom-in" aria-label="放大画布" title="放大">＋</button>
          <button type="button" data-canvas-action="fit" aria-label="适应全景">适应全景</button>
          <button type="button" data-canvas-action="reset" aria-label="复位画布">复位</button>
          ${product?'<button class="trace-roam-entry" type="button" data-action="enter-roam" aria-label="展开脉络">展开脉络</button>':''}
        </div>
        <span class="trace-canvas-hint" aria-hidden="true">拖动画布 · 滚轮缩放</span>
        ${product?'<button class="trace-roam-exit" type="button" data-action="exit-roam" aria-label="回到此刻" hidden>回到此刻</button>':''}
      </div>
      <section class="detail-card${product?' trace-reader-panel':''}" id="detail-card" aria-labelledby="detail-title" hidden><div class="detail-material" aria-hidden="true"></div><div id="detail-content"></div></section>
      <button class="profile-button" data-action="about" type="button" aria-label="${product?'个人与设置':'关于此原型'}">${icon('user')}</button>
      <button class="scene-back" data-action="home" type="button" hidden>${icon('back')}收回到首页</button>
      ${product?'':'<button class="prototype-caption" data-action="preview" type="button">交互原型 · 示例内容 · 仅本次会话</button>'}
      ${product&&!Object.keys(entries).length?'<div class="web-home-empty"><strong>先留下一点，接续就从这里开始。</strong><span>以后，你的原话、对照与工作结果会在同一件事里相遇。</span></div>':''}
    </div>
    <section class="utility-panel" id="utility-panel" aria-labelledby="utility-title" hidden></section>
    <div class="home-toast" id="home-toast" role="status" aria-live="polite"></div>
    <p class="sr-only" id="scene-announcement" aria-live="polite"></p>
  </main>`

const scene = $('#home-scene')
const canvasViewport = $('[data-canvas-viewport]')
const canvasWorld = $('[data-canvas-world]')
const bird = $('#scene-bird')
const detail = $('#detail-card')
const roamEntry = $('[data-action="enter-roam"]')
const roamExit = $('[data-action="exit-roam"]')
const nodeLayer=document.createElementNS('http://www.w3.org/2000/svg','svg')
nodeLayer.setAttribute('viewBox','0 0 1672 941');nodeLayer.setAttribute('class','scene-nodes-layer');nodeLayer.setAttribute('aria-hidden','true')
nodeLayer.append($('#scene-nodes'));canvasWorld.insertBefore(nodeLayer,canvasWorld.querySelector('.thought-field'))
const HISTORY_PIVOT = 836
const HISTORY_LATEST_ID = 'thought'
const historyLatestBox = LAYOUTS.overview[HISTORY_LATEST_ID]
const historyMirrorX = x => HISTORY_PIVOT * 2 - x
const historyMirrorBox = box => [historyMirrorX(box[0] + box[2]), box[1], box[2], box[3]]
const historyLatestCenter = () => {
  const box = historyMirrorBox(historyLatestBox)
  return box[0] + box[2] / 2
}
const historyDefaultX = scale => (canvasViewport.offsetWidth || 1672) / 2 - historyLatestCenter() * scale
const historyBounds = ({ camera }) => {
  if (scene.dataset.viewport === 'compact') return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  const scale = Number(camera.scale) || 1
  const baseline = historyDefaultX(scale)
  return {
    // The latest bubble sits in the middle at the baseline. Moving the
    // camera toward negative x exposes the not-yet-created side and gets a
    // short rubber band; positive x is the historical direction.
    minX: baseline - 86 * scale,
    maxX: baseline + 900 * scale,
    minY: -360 * scale,
    maxY: 140 * scale,
  }
}
const historyInitial = { x: historyDefaultX(1), y: 0, scale: 1 }
canvasWorld.classList.toggle('is-history-world', product)
canvasWorld.style.setProperty('--history-pivot', HISTORY_PIVOT + 'px')
let isRoaming = false
let roamTransitionTimer = 0
let riverFocusId = ''
let roamBirdIntentTimer = 0
let birdAnchor = 'composer'
let cameraBeforeReader = null
let selectedBubbleId = ''
let birdFlightTimer = 0
// The bird is a semantic pointer.  `birdHandoff` is the only temporary
// interpolation allowed to move it independently of its anchor; its progress
// is supplied by the camera controller's very same RAF as the world transform.
// This prevents a reader reveal from moving the bubble first and correcting the
// bird on a later frame.
let birdHandoff = null
let birdHandoffFrame = 0
let readerSequence = 0
const RIVER_PATH_BASE_OPACITY = [.82, .39, .82, .82, .82]
const RIVER_UNDER_OPACITY = [.105, .06, .075, .085, .085]
const RIVER_BUFFER_UNDER_OPACITY = .072
const RIVER_PATH_MIDS = [[360, 472], [520, 448], [878, 590], [1080, 510], [1080, 590]]
const RIVER_BUFFER_MIDS = {
  '360,472': [360, 472],
  '286,509': [286, 509],
  '1332,454': [1332, 454],
  '1332,662': [1332, 662],
  '976,660': [976, 660],
}
let canvas
canvas = createCanvasController({
  viewport: canvasViewport,
  world: canvasWorld,
  controls: canvasViewport.querySelector('[data-canvas-controls]'),
  initial: product ? historyInitial : { x: 0, y: 0, scale: 1 },
  bounds: product ? historyBounds : null,
  fitTarget: product ? ({ fallback }) => ({ ...fallback, x: scene.dataset.viewport === 'compact' ? 0 : historyDefaultX(fallback.scale), y: 0 }) : null,
  resetTarget: product ? () => ({ ...historyInitial, x: scene.dataset.viewport === 'compact' ? 0 : historyInitial.x }) : null,
  onChange: ({ scale, progress, phase }) => {
    const percent = Math.round(scale * 100);
    canvasViewport.setAttribute('aria-valuetext', `${percent}%`);
    canvasViewport.setAttribute('aria-valuenow', String(percent));
    updateRiverFocus();
    if (birdHandoff) updateBirdHandoff(progress, phase)
    else updateBirdAnchor();
  },
})
canvasViewport.setAttribute('role', 'application')
canvasViewport.setAttribute('aria-valuemin', '55')
canvasViewport.setAttribute('aria-valuemax', '180')
canvasViewport.setAttribute('aria-valuenow', '100')
function sceneUnitScale() {
  const rect = scene.getBoundingClientRect()
  const width = scene.offsetWidth || 1672
  return rect.width > 0 && width > 0 ? rect.width / width : 1
}
function birdPointInScene(clientX, clientY) {
  const rect = scene.getBoundingClientRect()
  const unit = sceneUnitScale()
  return [(clientX - rect.left) / unit, (clientY - rect.top) / unit]
}
function birdCurrentPoint() {
  const value = String(bird?.style.transform || '')
  const match = value.match(/translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px\s*\)/)
  return match ? [Number(match[1]), Number(match[2])] : composerAnchorPoint()
}
function anchorValue(target) {
  return target === 'composer' ? 'composer' : `bubble:${target}`
}
function setBirdPoint(point, { target = 'composer', state: birdState = '', edge = '', flying = false, preserveAnchor = false, preserveFlight = false } = {}) {
  if (!bird) return
  if (!preserveFlight) clearTimeout(birdFlightTimer)
  if (!preserveAnchor) {
    bird.dataset.anchor = target
    bird.dataset.birdAnchor = anchorValue(target)
  }
  bird.dataset.target = target
  bird.dataset.state = birdState || (target === 'composer' ? 'composer' : 'selected')
  if (edge) bird.dataset.edge = edge
  else delete bird.dataset.edge
  bird.classList.toggle('flying', flying || (preserveFlight && bird.classList.contains('flying')))
  bird.style.transform = `translate(${Number(point[0]) || 0}px,${Number(point[1]) || 0}px)`
  if (document.body.dataset.canvasDebug === 'true' && target === 'thought' && !bird.dataset.intent) {
    console.log('BIRD_SET_DEBUG', JSON.stringify({ target, state: birdState, mode: state.mode, roaming: isRoaming, edge: bird.dataset.edge, anchor: bird.dataset.birdAnchor, preserveAnchor, preserveFlight }))
  }
}
function composerElement() {
  return $('.home-composer')
}
function composerAnchorPoint() {
  const composer = composerElement()
  if (!composer) return BIRDS.overview || foot.overview
  const rect = composer.getBoundingClientRect()
  const unit = sceneUnitScale()
  // The image's local origin is its lower-right perch. Put it just outside
  // the composer's quiet left edge instead of using a viewport guess; the
  // small intentional gap keeps the bird attached without overlapping copy.
  return birdPointInScene(rect.left - 33 * unit, rect.top + rect.height * .58)
}
function bubbleElement(id) {
  const element = mount.querySelector(`[data-entry="${id}"]`)
  return element && !element.hidden ? element : null
}
function bubbleIsVisible(id, { allowDimmed = false } = {}) {
  const element = bubbleElement(id)
  if (!element) return false
  const bubble = element.getBoundingClientRect()
  const viewport = canvasViewport.getBoundingClientRect()
  if (bubble.width <= 0 || bubble.height <= 0 || bubble.right <= viewport.left || bubble.left >= viewport.right || bubble.bottom <= viewport.top || bubble.top >= viewport.bottom) return false
  const opacity = Number.parseFloat(getComputedStyle(element).opacity)
  return allowDimmed ? opacity > 0.01 : opacity > 0.08
}
function bubbleLocalRect(id) {
  const element = bubbleElement(id)
  if (!element) return null
  const sceneRect = scene.getBoundingClientRect()
  const unit = sceneUnitScale()
  const rect = element.getBoundingClientRect()
  const left = (rect.left - sceneRect.left) / unit
  const top = (rect.top - sceneRect.top) / unit
  const width = rect.width / unit
  const height = rect.height / unit
  return { left, top, right: left + width, bottom: top + height, width, height }
}
function readerLocalRect() {
  // During the opening handoff the panel has already been laid out while its
  // opacity is still zero.  Reserve that space immediately so the bird picks
  // a blank edge that remains clear once the reader fades in.
  if (!detail || detail.hidden || state.mode === 'overview') return null
  const sceneRect = scene.getBoundingClientRect()
  const unit = sceneUnitScale()
  const rect = detail.getBoundingClientRect()
  return {
    left: (rect.left - sceneRect.left) / unit,
    top: (rect.top - sceneRect.top) / unit,
    right: (rect.right - sceneRect.left) / unit,
    bottom: (rect.bottom - sceneRect.top) / unit,
  }
}
function bubbleEdgeAnchor(id, { reserveReader = true, preferredEdge = '', preserveEdge = false } = {}) {
  const bubble = bubbleLocalRect(id)
  if (!bubble) return { point: composerAnchorPoint(), edge: 'fallback' }
  const width = canvasViewport.offsetWidth || 1672
  const height = canvasViewport.offsetHeight || 941
  const reader = reserveReader ? readerLocalRect() : null
  // The perched bird's authored anchor is near its lower-right body edge:
  // these offsets leave the full image outside the bubble rather than placing
  // a decorative bird over its title or controls.
  const candidates = [
    { edge: 'left', point: [bubble.left - 35, bubble.top + bubble.height * .56], space: bubble.left },
    { edge: 'right', point: [bubble.right + 76, bubble.top + bubble.height * .44], space: width - bubble.right },
    { edge: 'top', point: [bubble.left + bubble.width * .57, bubble.top - 26], space: bubble.top },
    { edge: 'bottom', point: [bubble.left + bubble.width * .57, bubble.bottom + 59], space: height - bubble.bottom },
  ]
  const imageBounds = (point) => ({ left: point[0] - 70, right: point[0] + 29, top: point[1] - 54, bottom: point[1] + 21 })
  const boundsFor = candidate => {
    const bounds = imageBounds(candidate.point)
    const overflow = Math.max(0, -bounds.left, bounds.right - width, -bounds.top, bounds.bottom - height)
    const overlap = reader && bounds.left < reader.right && bounds.right > reader.left && bounds.top < reader.bottom && bounds.bottom > reader.top
    return { bounds, overflow, overlap: Boolean(overlap) }
  }

  const measured = candidates.map(candidate => ({ candidate, ...boundsFor(candidate) }))
  const usable = measured.filter(item => item.overflow <= 6 && !item.overlap)
  const preferred = measured.find(item => item.candidate.edge === preferredEdge)
  // Hysteresis is deliberate: a selected bird keeps its side through ordinary
  // pan/zoom even if another side has one or two pixels more breathing room.
  // We only release the side when the footprint is materially outside the
  // viewport or collides with the reader, preventing left/right chatter near
  // an edge.  The bubble itself is checked by updateBirdAnchor before this
  // function, so this never turns into a screen-fixed fallback.
  // Do not release a sticky side merely because a fast pan carries part of
  // the footprint past the viewport. The semantic bubble id/edge must remain
  // stable; updateBirdAnchor will hide the pointer only once the bubble is
  // entirely out of view. A reader collision is the one intentional release.
  if (preserveEdge && preferred && !preferred.overlap) return preferred.candidate

  // A right-side reader makes the left edge the calmest side. Otherwise rank
  // by collision-free viewport breathing room, keeping the authored candidate
  // order stable for ties.
  const readerPreferred = reader ? usable.find(item => item.candidate.edge === 'left') : null
  const chosen = (readerPreferred || usable.sort((a, b) => b.candidate.space - a.candidate.space)[0] || measured.sort((a, b) => a.overflow - b.overflow)[0] || measured[0])?.candidate || candidates[0]
  if (document.body.dataset.canvasDebug === 'true' && id === 'thought' && preferredEdge) {
    console.log('BIRD_EDGE_DEBUG', JSON.stringify({ preferredEdge, usable: usable.map(item => item.candidate.edge), chosen: chosen.edge, bubble, width, height, reader }))
  }
  return chosen
}
function birdPointForBubbleEdge(id, options) {
  const anchor = bubbleEdgeAnchor(id, options)
  if (bird && anchor.edge) bird.dataset.edge = anchor.edge
  return anchor.point
}
function setBirdAnchor(anchor, { flying = false, state: birdState = '', deferPoint = false, fromPoint = null } = {}) {
  if (!bird) return
  if (birdHandoffFrame) window.cancelAnimationFrame(birdHandoffFrame)
  birdHandoffFrame = 0
  const raw = String(anchor || 'composer')
  const id = raw === 'composer' ? '' : raw.startsWith('bubble:') ? raw.slice(7) : raw
  birdAnchor = id ? `bubble:${id}` : 'composer'
  bird.classList.remove('roam-hidden')
  birdHandoff = null
  if (birdAnchor === 'composer') {
    setBirdPoint(composerAnchorPoint(), { target: 'composer', state: birdState || 'composer', edge: 'composer-edge', flying, preserveAnchor: true })
    bird.dataset.anchor = 'composer'
  } else {
    // A new explicit selection gets a fresh side choice. Subsequent camera
    // changes are handled by updateBirdAnchor with the saved edge preference.
    delete bird.dataset.edge
    const targetState = birdState || (isRoaming ? 'roaming-idle' : 'selected')
    const point = deferPoint ? (fromPoint || birdCurrentPoint()) : birdPointForBubbleEdge(id, { reserveReader: state.mode !== 'overview' })
    const handoffFlying = deferPoint && !reduced.matches && document.documentElement.dataset.reduceMotion !== 'true'
    setBirdPoint(point, { target: id, state: targetState, edge: bird.dataset.edge, flying: flying || handoffFlying, preserveAnchor: true })
    bird.dataset.anchor = id
    bird.dataset.selected = id
    if (deferPoint) birdHandoff = { direction: 'to-bubble', id, from: point, edge: '', flying: handoffFlying, progress: 0, stableFrames: 0 }
  }
  bird.dataset.birdAnchor = birdAnchor
}
function updateBirdHandoff(progress, phase = '') {
  if (!birdHandoff || !bird) return
  const hasProgress = Number.isFinite(Number(progress))
  const progressValue = hasProgress ? Math.max(0, Math.min(1, Number(progress) || 0)) : (birdHandoff.progress || 0)
  birdHandoff.progress = progressValue
  const from = birdHandoff.from || birdCurrentPoint()
  let target
  if (birdHandoff.direction === 'to-composer') {
    target = composerAnchorPoint()
  } else {
    const preferredEdge = ['left', 'right', 'top', 'bottom'].includes(birdHandoff.edge) ? birdHandoff.edge : ''
    target = birdPointForBubbleEdge(birdHandoff.id, {
      reserveReader: state.mode !== 'overview',
      preferredEdge,
      preserveEdge: Boolean(preferredEdge),
    })
    birdHandoff.edge = bird.dataset.edge || birdHandoff.edge
  }
  const point = [
    from[0] + (target[0] - from[0]) * progressValue,
    from[1] + (target[1] - from[1]) * progressValue,
  ]
  const targetId = birdHandoff.direction === 'to-composer' ? 'composer' : birdHandoff.id
  const error = Math.hypot(target[0] - point[0], target[1] - point[1])
  setBirdPoint(point, {
    target: targetId,
    state: targetId === 'composer' ? 'composer' : 'selected',
    edge: targetId === 'composer' ? 'composer-edge' : birdHandoff.edge,
    flying: birdHandoff.flying,
    preserveAnchor: true,
    preserveFlight: true,
  })
  if (phase === 'settled' || progressValue >= 1) {
    const completed = birdHandoff
    birdHandoff = null
    bird.classList.remove('flying')
    if (completed.direction === 'to-composer') birdToComposer({ flying: false })
    else updateBirdAnchor()
  } else if (!hasProgress && error < 2) {
    birdHandoff.stableFrames = (birdHandoff.stableFrames || 0) + 1
    if (birdHandoff.stableFrames >= 2) {
      const completed = birdHandoff
      birdHandoff = null
      bird.classList.remove('flying')
      if (completed.direction === 'to-composer') birdToComposer({ flying: false })
      else updateBirdAnchor()
    }
  } else {
    birdHandoff.stableFrames = 0
  }
}
function beginBubbleHandoff(id, { state: birdState = 'selected', animateWithoutCamera = false } = {}) {
  clearRoamIntent({ restore: false })
  const from = birdCurrentPoint()
  setBirdAnchor(`bubble:${id}`, { state: birdState, deferPoint: true, fromPoint: from })
  if (animateWithoutCamera && birdHandoff) {
    // Reduced motion still uses the same semantic handoff, but it must land
    // synchronously rather than spending a few frames in a synthetic flight.
    if (!birdHandoff.flying) {
      updateBirdHandoff(1, 'settled')
      return
    }
    const started = performance.now()
    const tick = now => {
      if (!birdHandoff || birdHandoff.id !== id) { birdHandoffFrame = 0; return }
      const progress = Math.max(0, Math.min(1, (now - started) / 260))
      updateBirdHandoff(progress, progress >= 1 ? 'settled' : 'moving')
      if (birdHandoff && progress < 1) birdHandoffFrame = window.requestAnimationFrame(tick)
      else birdHandoffFrame = 0
    }
    birdHandoffFrame = window.requestAnimationFrame(tick)
  }
}
function beginComposerHandoff() {
  if (birdHandoffFrame) window.cancelAnimationFrame(birdHandoffFrame)
  birdHandoffFrame = 0
  if (!bird || birdAnchor === 'composer') {
    birdHandoff = null
    birdToComposer({ flying: false })
    return
  }
  const from = birdCurrentPoint()
  birdHandoff = { direction: 'to-composer', id: birdAnchor.slice(7), from, flying: !reduced.matches && document.documentElement.dataset.reduceMotion !== 'true', progress: 0, stableFrames: 0 }
  birdAnchor = 'composer'
  bird.dataset.anchor = 'composer'
  bird.dataset.birdAnchor = 'composer'
  bird.dataset.target = 'composer'
  bird.dataset.state = 'composer'
  delete bird.dataset.edge
  bird.classList.remove('roam-hidden')
  bird.classList.toggle('flying', birdHandoff.flying)
}
function updateBirdAnchor() {
  if (!product || !bird) return
  if (birdAnchor === 'composer') {
    setBirdPoint(composerAnchorPoint(), { target: 'composer', state: 'composer', edge: 'composer-edge', flying: false, preserveAnchor: true, preserveFlight: true })
    bird.dataset.anchor = 'composer'
    bird.dataset.birdAnchor = 'composer'
    return
  }
  const id = birdAnchor.slice(7)
  // Keep the semantic id sticky while its bubble is visible. If the camera
  // moves that bubble completely away, fade the pointer instead of pinning it
  // to a convenient screen coordinate or rebinding it to an unrelated node.
  if (!bubbleIsVisible(id, { allowDimmed: isRoaming })) {
    bird.classList.add('roam-hidden')
    return
  }
  bird.classList.remove('roam-hidden')
  const preferredEdge = ['left', 'right', 'top', 'bottom'].includes(bird.dataset.edge) ? bird.dataset.edge : ''
  const point = birdPointForBubbleEdge(id, { reserveReader: state.mode !== 'overview', preferredEdge, preserveEdge: true })
  setBirdPoint(point, { target: id, state: state.mode === 'overview' ? (isRoaming ? 'roaming-idle' : 'bubble-idle') : 'selected', edge: bird.dataset.edge, flying: false, preserveAnchor: true, preserveFlight: true })
  bird.dataset.anchor = id
  bird.dataset.birdAnchor = birdAnchor
}
function clearRoamIntent({ restore = true } = {}) {
  clearTimeout(roamBirdIntentTimer)
  roamBirdIntentTimer = 0
  if (!bird) return
  delete bird.dataset.intent
  bird.classList.remove('roam-intent')
  if (restore && product && state.mode === 'overview') updateBirdAnchor()
}
function birdToComposer({ flying = false } = {}) {
  clearTimeout(birdFlightTimer)
  birdFlightTimer = 0
  clearRoamIntent({ restore: false })
  setBirdAnchor('composer', { flying, state: 'composer' })
}
function scheduleRoamIntent(id) {
  // Hover/focus is only a pre-gesture: it may change posture, but it never
  // moves the bird toward a bubble or changes `birdAnchor`. This lets the
  // pointer remain attached to its semantic anchor until an explicit click.
  if (!product || state.mode !== 'overview' || !id || !bird) return
  clearTimeout(roamBirdIntentTimer)
  bird.dataset.intent = id
  bird.dataset.target = id
  bird.dataset.state = 'intent-pending'
  bird.classList.remove('roam-hidden')
  bird.classList.add('roam-intent')
  roamBirdIntentTimer = setTimeout(() => {
    roamBirdIntentTimer = 0
    if (state.mode !== 'overview' || bird.dataset.intent !== id) return
    // Hover is a preview only.  Keep the semantic anchor and coordinates
    // untouched; posture/orientation is supplied by the `.roam-intent` class.
    // Moving to the hovered bubble here made the bird steal focus from the
    // composer and caused a visible snap when the pointer left quickly.
    bird.dataset.target = id
    bird.dataset.state = 'intent'
    bird.dataset.intent = id
    bird.classList.add('roam-intent')
  }, duration(160))
}
function flyBirdToBubble(id) {
  beginBubbleHandoff(id, { state: 'selected' })
}

function focusWorldBox(id) {
  const source = LAYOUTS.overview[id] || LAYOUTS.overview.thought
  return product && scene.dataset.viewport !== 'compact' ? historyMirrorBox(source) : source
}
function riverOpacity(distance, minimum = .16) {
  return Math.max(minimum, Math.min(1, 1.04 - (Number(distance) || 0) / 1220))
}
function updateRiverFocus() {
  if (!product || !canvasWorld || !canvas) return
  // Use the camera transform instead of reading every bubble's DOM rect.  The
  // authored boxes are cached world coordinates, so pan/zoom/settle/resize
  // can update all visual depth without a layout read for each item.
  const camera = canvas.snapshot()
  const viewportCenter = [
    (canvasViewport.offsetWidth || 1672) / 2,
    (canvasViewport.offsetHeight || 941) / 2,
  ]
  const screenCenterForWorldBox = box => [
    camera.x + (box[0] + box[2] / 2) * camera.scale,
    camera.y + (box[1] + box[3] / 2) * camera.scale,
  ]
  const visualRadius = Math.max(viewportCenter[0], viewportCenter[1]) * .82
  const mirroredX = point => product && scene.dataset.viewport !== 'compact' ? historyMirrorX(point[0]) : point[0]
  mount.querySelectorAll('[data-entry]').forEach(el => {
    const box = focusWorldBox(el.dataset.entry)
    const screenCenter = screenCenterForWorldBox(box)
    const distance = Math.hypot(screenCenter[0] - viewportCenter[0], screenCenter[1] - viewportCenter[1])
    const proximity = riverOpacity(distance / Math.max(visualRadius, 1) * 1220, .16)
    const focused = el.dataset.entry === riverFocusId
    const focusBoost = focused ? Math.max(.92, proximity) : proximity
    const opacity = Math.min(1, focusBoost)
    el.style.setProperty('--river-opacity', opacity.toFixed(3))
    el.style.setProperty('--river-saturation', (0.52 + opacity * .48).toFixed(3))
    // Keep the glow coupled to the same distance field as opacity/saturation;
    // it is intentionally restrained so focus reads as clarity, not neon.
    const glow = focused ? Math.max(.105, opacity * .14) : opacity * .105
    el.style.setProperty('--river-glow', glow.toFixed(3))
  })
  mount.querySelectorAll('.scene-node').forEach(node => {
    const index = Number(node.dataset.dot)
    const point = NODE_POSITIONS.overview[index] || NODE_POSITIONS.overview[0]
    const screenCenter = [camera.x + mirroredX(point) * camera.scale, camera.y + point[1] * camera.scale]
    const distance = Math.hypot(screenCenter[0] - viewportCenter[0], screenCenter[1] - viewportCenter[1])
    node.style.opacity = riverOpacity(distance / Math.max(visualRadius, 1) * 1220, .2).toFixed(3)
  })
  mount.querySelectorAll('.thread-path').forEach(path => {
    const index = Number(path.dataset.path)
    const point = RIVER_PATH_MIDS[index] || RIVER_PATH_MIDS[0]
    const screenCenter = [camera.x + mirroredX(point) * camera.scale, camera.y + point[1] * camera.scale]
    const distance = Math.hypot(screenCenter[0] - viewportCenter[0], screenCenter[1] - viewportCenter[1])
    path.style.opacity = (RIVER_PATH_BASE_OPACITY[index] * riverOpacity(distance / Math.max(visualRadius, 1) * 1220, .22)).toFixed(3)
  })
  mount.querySelectorAll('.river-understroke:not(.river-buffer-understroke)').forEach(path => {
    const index = Number(path.dataset.underPath)
    const point = RIVER_PATH_MIDS[index] || RIVER_PATH_MIDS[0]
    const screenCenter = [camera.x + mirroredX(point) * camera.scale, camera.y + point[1] * camera.scale]
    const distance = Math.hypot(screenCenter[0] - viewportCenter[0], screenCenter[1] - viewportCenter[1])
    path.style.opacity = (RIVER_UNDER_OPACITY[index] * riverOpacity(distance / Math.max(visualRadius, 1) * 1220, .35)).toFixed(3)
  })
  mount.querySelectorAll('.river-buffer-understroke').forEach(path => {
    const point = RIVER_BUFFER_MIDS[path.dataset.riverMid] || [0, 0]
    const screenCenter = [camera.x + mirroredX(point[0]) * camera.scale, camera.y + point[1] * camera.scale]
    const distance = Math.hypot(screenCenter[0] - viewportCenter[0], screenCenter[1] - viewportCenter[1])
    path.style.opacity = (RIVER_BUFFER_UNDER_OPACITY * riverOpacity(distance / Math.max(visualRadius, 1) * 1220, .3)).toFixed(3)
  })
  mount.querySelectorAll('.river-buffer-path').forEach(path => {
    const point = RIVER_BUFFER_MIDS[path.dataset.riverMid] || [0, 0]
    const screenCenter = [camera.x + mirroredX(point) * camera.scale, camera.y + point[1] * camera.scale]
    const distance = Math.hypot(screenCenter[0] - viewportCenter[0], screenCenter[1] - viewportCenter[1])
    // The extension is allowed to mist out, but never down to an invisible
    // single-pixel stop before the viewport edge.  The screen-space edge mask
    // supplies the final fade while this floor preserves continuity.
    const bufferBase = path.classList.contains('river-buffer-main') ? .88 : path.classList.contains('river-buffer-branch') ? .48 : .58
    path.style.opacity = (bufferBase * riverOpacity(distance / Math.max(visualRadius, 1) * 1220, .35)).toFixed(3)
  })
}
function setRiverFocus(id = '') {
  riverFocusId = id || ''
  updateRiverFocus()
}
// The reader is chrome, not part of the authored canvas plane.  Keep its
// width in scene-space so resizing remains stable when the desktop shell is
// fitted to a different viewport.  The explicit wide mode is a shortcut for
// users who prefer a comfortable long reading column; the edge handle and
// keyboard arrows provide finer control.
let readerWidth = 510
let readerWidthBeforeWide = 510
let readerWide = false
let readerResizePointer = null
const glassPath = el => bubblePaths[Number(el.dataset.shape)||0]
const createSceneMotion = services?.createSceneMotion
const motionLayer = $('#home-motion-layer')
const motionShape = $('#home-motion-shape')
const motionTarget = $('#home-motion-target')
const motionSurface = $('#home-motion-surface')
const motionThread = $('#home-motion-thread')
const motionSignal = $('#home-motion-signal')
const motionNode = $('#home-motion-node')
const motionNodeIndex = { thought: 0, work: 3, fresh: 4, handoff: 5, insight: 2, practice: 3, result: 3 }
let sceneMotion = null
let sceneMotionEntry = ''

function motionNodeAt(mode, id) {
  const index = motionNodeIndex[id] ?? 0
  return NODE_POSITIONS[mode]?.[index] || NODE_POSITIONS.overview[index] || NODE_POSITIONS.overview[0]
}
function motionBox(mode, id) {
  return LAYOUTS[mode]?.[id] || LAYOUTS.overview[id] || LAYOUTS.overview.thought
}
function motionGeometry(mode, id, expanded) {
  const detail = DETAIL_BOUNDS[mode === 'work' ? 'work' : 'thinking']
  const box = expanded
    ? { x: detail.left, y: detail.top, w: detail.width, h: detail.height }
    : motionBox('overview', id)
  const origin = motionNodeAt('overview', id)
  const destination = expanded ? (foot[mode] || foot.thinking) : origin
  return { x: box[0] ?? box.x, y: box[1] ?? box.y, w: box[2] ?? box.w, h: box[3] ?? box.h, sx: origin[0], sy: origin[1], nx: destination[0], ny: destination[1] }
}
function drawMotionGeometry(geometry, opening) {
  if (!motionSurface || !motionShape) return
  const x = Number(geometry.x) || 0, y = Number(geometry.y) || 0
  const w = Number(geometry.w) || 1, h = Number(geometry.h) || 1
  // Only the decorative shape is transformed.  All content/form elements
  // remain ordinary DOM siblings and therefore never scale with the glass.
  motionSurface.setAttribute('transform', `translate(${x} ${y}) scale(${w / 1000} ${h / 300})`)
  const sx = Number(geometry.sx) || 0, sy = Number(geometry.sy) || 0
  const nx = Number(geometry.nx) || sx, ny = Number(geometry.ny) || sy
  const curve = `M ${sx} ${sy} C ${sx + (nx - sx) * .35} ${sy - 42} ${nx - (nx - sx) * .22} ${ny - 26} ${nx} ${ny}`
  motionThread?.setAttribute('d', curve)
  motionSignal?.setAttribute('d', curve)
  motionNode?.setAttribute('cx', String(nx)); motionNode?.setAttribute('cy', String(ny))
  // The two locked postures share this exact scene-space anchor.  The helper
  // flips posture at the start of a state change; no alternate identity is
  // created and no bird is baked into the environment artwork.
  bird.classList.toggle('flying', Boolean(opening))
}
function destroySceneMotion() {
  sceneMotion?.destroy?.(); sceneMotion = null; sceneMotionEntry = ''
  motionLayer?.removeAttribute('data-motion-active')
}
function mountSceneMotion(id, mode = 'thinking') {
  if (typeof createSceneMotion !== 'function' || !motionShape || !motionTarget || !motionLayer) return null
  if (sceneMotion && sceneMotionEntry === id) return sceneMotion
  destroySceneMotion()
  const shape = bubblePaths[Number(mount.querySelector(`[data-entry="${id}"]`)?.dataset.shape) || 0] || bubblePaths[0]
  const initial = motionGeometry(mode, id, false)
  const expanded = motionGeometry(mode, id, true)
  sceneMotionEntry = id
  try {
    sceneMotion = createSceneMotion({
      root: scene,
      shape: motionShape,
      targetPath: motionTarget,
      initialPath: shape,
      expandedPath: fullPath,
      initial,
      expanded,
      reducedMotion: () => reduced.matches || document.documentElement.dataset.reduceMotion === 'true',
      draw: drawMotionGeometry,
      onStart: opening => { motionLayer.dataset.motionActive = opening ? 'opening' : 'closing' },
      onSettled: opening => {
        motionLayer.dataset.motionActive = opening ? 'open' : 'closed'
        if (!opening) bird.classList.remove('flying')
      },
    })
    return sceneMotion
  } catch (error) {
    console.warn('首页场景动效不可用，保留静态表面', error)
    destroySceneMotion()
    return null
  }
}
function syncSceneMotion(oldState, nextState) {
  // The product home uses the stable canvas + adjacent reader.  The prototype
  // scene-motion glass is a separate visual treatment and would otherwise
  // paint a large rounded outline over the river when a product bubble opens.
  if (product) { destroySceneMotion(); return }
  const wasExpanded = ['thinking', 'work'].includes(oldState?.mode)
  const isExpanded = ['thinking', 'work'].includes(nextState?.mode)
  if (!isExpanded && !wasExpanded) { destroySceneMotion(); return }
  const motionOpen = sceneMotion?.getState?.().desired === true
  if (isExpanded && (!sceneMotion || sceneMotionEntry !== nextState.active || !motionOpen)) {
    mountSceneMotion(nextState.active, nextState.mode)?.setExpanded(true)
    return
  }
  if (sceneMotion && !isExpanded && wasExpanded) { sceneMotion.setExpanded(false); return }
  if (sceneMotion && isExpanded && wasExpanded && sceneMotionEntry !== nextState.active) {
    mountSceneMotion(nextState.active, nextState.mode)?.setExpanded(true)
  }
}

function duration(ms) { return reduced.matches || document.documentElement.dataset.reduceMotion==='true' ? 0 : ms }
function track(animation) { animations.add(animation); animation.then?.(() => animations.delete(animation)); return animation }
function cancelAnimations() { for (const a of animations) a.cancel(); animations.clear() }
function notify(text) { clearTimeout(toastTimer); const t=$('#home-toast'); t.textContent=text; t.classList.add('visible'); toastTimer=setTimeout(()=>t.classList.remove('visible'),3500) }
function ensureGlass(el, path, tone='cool') {
  const host = el.querySelector('.bubble-material,.detail-material')
  if (!materials.has(el)) materials.set(el, mountSceneGlass({host,scene:$('.home-viewport'),backgroundUrl,path,tone}))
  else materials.get(el).refresh()
}
function selectedEntry() { return entries[state.active] ? { ...(ENTRIES[state.active] || {}), ...entries[state.active] } : ENTRIES[state.active] || ENTRIES.thought }
function draftKey() { return `${state.mode}:${state.mode==='work'?'work':state.active}` }
function originalContext() { return state.active==='thought' ? state.captured || selectedEntry().subtitle || '原话已保留，还可以继续想。' : selectedEntry().subtitle }
function currentTitle() { const entry=selectedEntry();return state.active==='thought' && state.captured ? state.captured : state.active==='insight'&&state.insight ? state.insight : entry.detailTitle||entry.title }
function row(symbol, title, text) { return `<div class="context-row"><span class="context-icon">${icon(symbol)}</span><div><h3>${escape(title)}</h3><p>${escape(text)}</p></div></div>` }
function readerSection(symbol, title, text, className = '') {
  return `<section class="context-row reader-section ${className}" data-reader-section="${escape(title)}"><span class="context-icon">${icon(symbol)}</span><div><h3>${escape(title)}</h3><p>${escape(text || '暂时还没有留下内容。')}</p></div></section>`
}
function detailsMarkup() {
  const work = state.mode === 'work'
  const entry = selectedEntry()
  const title = work ? entry.detailTitle||entry.title : currentTitle()
  const original = entry.originalText || entry.whyCare || originalContext()
  const understanding = entry.understanding || state.insight || '还没有写下自己的理解；可以先保留原话，再决定要不要继续。'
  const why = entry.whyCare && entry.whyCare !== original ? entry.whyCare : '这件事还没有结束。把此刻出现的感受，接回它原来的现场。'
  const change = entry.stop || (state.mode === 'return' ? state.result : '') || '你可以继续补充，也可以写下一个新的理解；Trace 不会替你自动采用判断。'
  const sourceText = (entry.sources || []).map(source => [source.title, source.author && `作者：${source.author}`, source.excerpt].filter(Boolean).join('\n')).join('\n\n') || '还没有关联的来源材料。需要时可以从原现场或「找个对照」带回。'
  const resultText = (entry.results || []).map(result => [result.fact, result.interpretation && `理解：${result.interpretation}`, result.unconfirmed && `尚未确认：${result.unconfirmed}`].filter(Boolean).join('\n')).join('\n\n') || (work ? '工作还没有回传结果。完成后，事实和你的理解会分别保留在这里。' : '还没有工作结果回到这件事。')
  const historyText = (entry.history || []).map(item => [item.before && `之前：${item.before}`, item.after && `后来：${item.after}`].filter(Boolean).join('\n')).join('\n\n') || '还没有发生过可回看的理解变化。'
  const rows = readerSection('clock', '上次停在', original, 'reader-original')
    + readerSection('message', '当前理解', understanding, 'reader-understanding')
    + readerSection('message', '为什么现在回来', why, 'reader-return-reason')
    + readerSection('sprout', '此刻的变化', change, 'reader-change')
    + readerSection('layers', '相关来源', sourceText, 'reader-sources')
    + readerSection('briefcase', '工作结果', resultText, 'reader-results')
    + readerSection('clock', '历史变化', historyText, 'reader-history')
  return `<span class="detail-reader-resize" data-reader-resize role="separator" tabindex="0" aria-orientation="vertical" aria-valuemin="430" aria-valuemax="900" aria-valuenow="${readerWidth}" aria-label="拖动调整阅读栏宽度" title="拖动调整宽度"></span><div class="detail-topline"><span class="detail-status ${work?'warm-status':''}"><i></i>${work?'正在接续工作':'正在接续'}</span><div class="detail-reader-tools"><button type="button" class="detail-wide-toggle" data-action="toggle-reader-wide" aria-pressed="${readerWide?'true':'false'}">${readerWide?'收窄阅读':'宽屏阅读'}</button><button type="button" class="detail-close" data-action="home" aria-label="收起详情">${icon('close')}</button></div></div>
    <h2 id="detail-title">${escape(title)}</h2>
    ${work?`<div class="work-meta"><span>${icon('box')}项目 · harness</span><span>${icon('layers')}Agent · Codex</span><span>${icon('clock')}刚有新变化</span></div>`:''}
    <div class="detail-context">${rows}</div>
    <form id="detail-form" class="detail-composer"><label for="detail-input" class="sr-only">${work?'带回工作结果':'接着这里说'}</label><span class="input-link">${icon('link')}</span><textarea id="detail-input" rows="1" maxlength="3000" placeholder="${work?'补充实践发现，或者把结果带回来……':'接着这里说，或者带回一个新的变化……'}">${escape(drafts.get(draftKey())||'')}</textarea><button class="send-orb" type="submit" aria-label="${work?'带回结果':'形成新的理解'}" ${drafts.get(draftKey())?.trim()?'':'disabled'}>${icon('arrow')}</button></form>
    <div class="detail-actions">${work?`<button type="button" data-action="native-work">${icon('play')}查看完整工作</button><button type="button" data-action="reconsider">${icon('layers')}更新判断</button><button type="button" data-action="result-input">${icon('briefcase')}带回结果</button>`:`<button type="button" data-action="discuss">${icon('play')}继续想</button><button type="button" data-action="source">${icon('layers')}查看原现场</button><button type="button" data-action="work">${icon('briefcase')}带去工作</button>`}</div>`
}

function readerSafeRect() {
  const viewportRect = canvasViewport.getBoundingClientRect()
  const panelRect = detail.getBoundingClientRect()
  const unit = sceneUnitScale()
  const gap = 26 * unit
  const left = viewportRect.left + 38 * unit
  const right = Math.min(viewportRect.right - 38 * unit, panelRect.left - gap)
  const top = viewportRect.top + 124 * unit
  const bottom = viewportRect.bottom - 88 * unit
  return {
    left, right, top, bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  }
}
function revealActiveBubble(id, mode) {
  if (!product || !id || !['thinking', 'work'].includes(mode)) return
  const bubble = mount.querySelector(`[data-entry="${id}"]`)
  if (!bubble) return
  setRiverFocus(id)
  const sequence = readerSequence
  const revealDuration = duration(360)
  // `centerElement` emits the camera and bubble geometry on every RAF. The
  // bird handoff consumes the same progress in onChange, so the pointer never
  // trails a CSS-transformed bubble by one frame.
  canvas.centerElement(bubble, { safeRect: readerSafeRect(), duration: revealDuration, allowOutsideBounds: true, meta: { reason: 'reader-reveal', id } })
  setTimeout(() => {
    if (sequence !== readerSequence || state.active !== id) return
    detail.dataset.open = 'true'
  }, duration(400))
}

function setRoamChrome(active) {
  isRoaming = Boolean(active)
  scene.dataset.roam = active ? 'true' : 'false'
  canvasViewport.dataset.roaming = active ? 'true' : 'false'
  if (roamEntry) roamEntry.hidden = active
  if (roamExit) roamExit.hidden = !active
}
function chooseRoamAnchor() {
  const viewport = canvasViewport.getBoundingClientRect()
  const center = { x: viewport.left + viewport.width / 2, y: viewport.top + viewport.height / 2 }
  const ids = [...mount.querySelectorAll('[data-entry]')]
    .map(element => element.dataset.entry)
    .filter(id => bubbleIsVisible(id, { allowDimmed: true }))
  if (!ids.length) return ''
  // Distance is the primary signal. The latest authored record gets a small
  // recency tie-breaker, so a bubble that is only slightly farther from centre
  // does not steal focus from the current/latest record.
  const order = [...new Set([HISTORY_LATEST_ID, ...Object.keys(entries), ...Object.keys(ENTRIES)])]
  return ids.map(id => {
    const rect = bubbleElement(id)?.getBoundingClientRect()
    const distance = rect ? Math.hypot(rect.left + rect.width / 2 - center.x, rect.top + rect.height / 2 - center.y) : Infinity
    const recency = Math.max(0, order.length - order.indexOf(id))
    return { id, score: distance - (id === HISTORY_LATEST_ID ? 22 : recency * 2) }
  }).sort((a, b) => a.score - b.score)[0]?.id || ''
}
function finishExitRoam() {
  if (!isRoaming) return
  clearTimeout(roamTransitionTimer)
  roamTransitionTimer = 0
  setRoamChrome(false)
  // “回到此刻” is intentionally semantic rather than historical: return to
  // the latest authored bubble, while reader close still restores its exact
  // pre-reader camera before this branch is reached.
  beginComposerHandoff()
  canvas.reset({ reason: 'roam-exit' }, { duration: duration(300) })
  setRiverFocus('')
  const revision = actionRevision
  setTimeout(() => {
    if (revision === actionRevision) bird.classList.remove('flying')
  }, duration(300))
  $('#scene-announcement').textContent = '已回到此刻'
  roamEntry?.focus({ preventScroll: true })
}
function exitRoam() {
  if (!product || !isRoaming) return
  if (state.mode !== 'overview') {
    dispatch({ type: 'CLOSE' })
    roamTransitionTimer = setTimeout(finishExitRoam, duration(340))
    return
  }
  finishExitRoam()
}
function enterRoam() {
  if (!product || isRoaming) return
  if (state.mode !== 'overview') {
    dispatch({ type: 'CLOSE' })
    roamTransitionTimer = setTimeout(enterRoam, duration(340))
    return
  }
  const defaultAnchor = birdAnchor === 'composer' ? chooseRoamAnchor() : ''
  setRoamChrome(true)
  setRiverFocus('')
  // Entering roam is the one implicit anchor migration: the composer is
  // about to leave the stage, so bind the bird once to the latest visible
  // thought. After this point camera motion never changes the id.
  if (birdAnchor === 'composer') {
    if (defaultAnchor) beginBubbleHandoff(defaultAnchor, { state: 'roaming-idle', animateWithoutCamera: true })
    else {
      bird.classList.add('roam-hidden')
      bird.dataset.state = 'roam-empty'
    }
  } else updateBirdAnchor()
  $('#scene-announcement').textContent = '已展开脉络，可拖动画布回看更早内容'
  roamExit?.focus({ preventScroll: true })
}

function render(immediate=false, oldState=null) {
  scene.dataset.state=state.mode
  const expanded=state.mode==='thinking'||state.mode==='work'
  // The composer belongs to the fixed chrome. It must not disappear or scale
  // merely because the canvas reader is open on desktop or compact layouts.
  $('#capture-form').hidden=!product && expanded
  $('.scene-back').hidden=state.mode==='overview'
  // Product home is a persistent horizontal history. Opening a reader changes
  // only the camera and the chrome; it must never re-author bubble coordinates
  // or morph the saved relationship paths underneath the reader.
  const layout=product ? LAYOUTS.overview : LAYOUTS[state.mode]
  for (const el of mount.querySelectorAll('[data-entry]')) {
    const id=el.dataset.entry, box=layout[id]
    if(!box || (product&&!entries[id])){ el.hidden=true; continue }
    const wasHidden=el.hidden; el.hidden=false
    el.style.removeProperty('opacity')
    el.classList.toggle('subdued', expanded || (state.mode==='growth' && ['fresh','handoff','work'].includes(id)) || (state.mode==='return'&&['fresh','handoff','thought'].includes(id)))
    el.classList.toggle('result-bubble',id==='result')
    el.classList.toggle('focused-bubble',id==='insight'||id==='result')
    let title = id==='thought'&&state.captured ? state.captured : id==='insight'&&state.insight ? state.insight : id==='result'&&state.result ? state.result : ENTRIES[id].title
    if (!prototypePreview && entries[id]) title = entries[id].title
    if(entries[id]) el.dataset.matterId=entries[id].matterId
    el.querySelector('strong').textContent=title
    el.setAttribute('aria-label',title)
    el.title=title
    const subtitle=el.querySelector('.bubble-subtitle')
    if(subtitle) subtitle.textContent=!prototypePreview&&entries[id] ? entries[id].subtitle : id==='work'&&state.mode==='return'?'原判断：不复制一个新的 Agent 工作界面':ENTRIES[id].subtitle
    if(id==='result') {
      el.querySelector('.bubble-content').innerHTML=`<div class="return-copy"><span class="return-label"><i></i>带回的结果</span><strong>${escape(title)}</strong><p>${escape(state.sampleResult?ENTRIES.result.subtitle:'实践中的新发现，已经回到这件事里。')}</p><span class="result-badge">${icon('check')}${state.sampleResult?'得到验证 · 示例':'已带回 · 待再判断'}</span><small>原判断 → 带去工作 → 实践结果 → 更新理解</small></div>`
    }
    const [left,top,width,height]=box
    if(immediate||wasHidden){Object.assign(el.style,{left:`${left}px`,top:`${top}px`,width:`${width}px`,height:`${height}px`})}
    else track(animate(el,{left,top,width,height,duration:duration(720),ease:'out(4)'}))
    ensureGlass(el,()=>glassPath(el),ENTRIES[id].warm?'warm':'cool')
    if(wasHidden&&!immediate) track(animate(el,{opacity:[0,1],duration:duration(800),delay:duration(130),ease:'out(3)',onComplete:()=>el.style.removeProperty('opacity')}))
  }
  const leavingDetail=!expanded&&!immediate&&['thinking','work'].includes(oldState?.mode)
  if(product) {
    detail.classList.add('trace-reader-panel')
    if (expanded) {
      detail.hidden = false
      detail.dataset.open = 'false'
    } else if (immediate) {
      detail.hidden = true
      detail.dataset.open = 'false'
    } else {
      detail.hidden = false
      detail.dataset.open = 'false'
      const closeSequence = readerSequence
      setTimeout(() => {
        if (closeSequence === readerSequence && state.mode === 'overview') detail.hidden = true
      }, duration(300))
    }
    detail.dataset.readerWide=readerWide?'true':'false'
    detail.style.setProperty('--reader-width',`${readerWidth}px`)
    detail.style.removeProperty('left');detail.style.removeProperty('top');detail.style.removeProperty('width');detail.style.removeProperty('height')
  } else if(leavingDetail) {
    const [left,top,width,height]=LAYOUTS.overview[oldState.active]||LAYOUTS.overview.thought
    const revision=actionRevision
    track(animate($('#detail-content'),{opacity:0,duration:duration(160),ease:'out(3)'}))
    track(animate(detail,{left,top,width,height,duration:duration(650),ease:'out(4)',onComplete:()=>{if(revision===actionRevision)detail.hidden=true}}))
  } else detail.hidden=!expanded
  if(expanded) {
    $('#detail-content').style.removeProperty('opacity')
    $('#detail-content').innerHTML=detailsMarkup()
    detail.classList.toggle('work-detail',state.mode==='work')
    const dest=DETAIL_BOUNDS[state.mode==='work'?'work':'thinking']
    if(product) {
      // The reader is a chrome sibling, not a child of the transformed world.
      // Its layout is entirely controlled by CSS so long text can use one
      // comfortable scroll column.
      detail.style.removeProperty('left');detail.style.removeProperty('top');detail.style.removeProperty('width');detail.style.removeProperty('height')
      detail.dataset.readerWide=readerWide?'true':'false'
      detail.style.setProperty('--reader-width',`${readerWidth}px`)
    } else if(!immediate && oldState && !['thinking','work'].includes(oldState.mode)) {
      const origin=LAYOUTS[oldState.mode][state.active] || LAYOUTS.overview.thought
      Object.assign(detail.style,{left:`${origin[0]}px`,top:`${origin[1]}px`,width:`${origin[2]}px`,height:`${origin[3]}px`})
      track(animate(detail,{...dest,duration:duration(720),ease:'out(4)'}))
      track(animate($('#detail-content'),{opacity:[0,1],translateY:[10,0],duration:duration(380),delay:duration(300),ease:'out(3)'}))
    } else Object.assign(detail.style,Object.fromEntries(Object.entries(dest).map(([k,v])=>[k,`${v}px`])))
    if(!product) ensureGlass(detail,fullPath)
  }
  for(let i=0;i<5;i++) for(const selector of [`[data-path="${i}"]`,`[data-light="${i}"]`]) {
    const path=$(selector),d=(product ? PATHS.overview : PATHS[state.mode])[i]
    if(immediate || product) path.setAttribute('d',d)
    else {
      // Anime's raw SVG `d` tween pads paths with missing commands as
      // `C 0 0 …`, which paints the exact stray diagonals seen from (0,0).
      // morphTo normalizes command lists before interpolating and keeps every
      // frame inside the authored scene coordinates.
      const target = $(`#home-path-target-${i}`)
      if (!target) path.setAttribute('d', d)
      else { target.setAttribute('d', d); track(animate(path,{d:animeSvg.morphTo(target,.05),duration:duration(760),ease:'out(3)'})) }
    }
  }
  const nodePositions = product ? NODE_POSITIONS.overview : NODE_POSITIONS[state.mode]
  nodePositions.forEach(([x,y],i)=>{
    const dot=$(`[data-dot="${i}"]`)
    dot.removeAttribute('transform')
    if(immediate || product) dot.style.transform=`translate(${x}px,${y}px)`
    else track(animate(dot,{translateX:x,translateY:y,duration:duration(760),ease:'out(3)'}))
  })
  const end=foot[state.mode]
  const oldExpanded = ['thinking','work'].includes(oldState?.mode)
  const motionTransition = !immediate && typeof createSceneMotion === 'function' && oldState && (expanded !== oldExpanded || (expanded && oldState.active !== state.active))
  if (product) {
    if (immediate) birdToComposer()
    else if (!expanded && !isRoaming && !birdHandoff) birdToComposer({ flying: false })
    else if (!expanded && isRoaming) updateBirdAnchor()
  } else if(immediate) {bird.style.transform=`translate(${end[0]}px,${end[1]}px)`}
  else if(!motionTransition) {
    const start=foot[oldState?.mode||'overview']
    $('#bird-route').setAttribute('d',`M${start[0]} ${start[1]} Q${(start[0]+end[0])/2} ${Math.min(start[1],end[1])-100} ${end[0]} ${end[1]}`)
    bird.classList.add('flying')
    const {translateX,translateY}=animeSvg.createMotionPath($('#bird-route'))
    track(animate(bird,{translateX,translateY,duration:duration(950),ease:'inOutSine',onComplete:()=>bird.classList.remove('flying')}))
  }
  const revision=actionRevision
  setTimeout(()=>{if(revision!==actionRevision)return; for(const [el,material] of materials) if(!el.hidden) material.refresh(); if(expanded&&!immediate&&$('#utility-panel').hidden) $('#detail-input')?.focus({preventScroll:true})},duration(850))
  updateRiverFocus()
  $('#scene-announcement').textContent=({overview:'首页总览',thinking:'已接续这段思考',growth:'新的理解已形成，尚未采用',work:'正在接续工作',return:'结果已回到原判断'})[state.mode]
}

function dispatch(action) {
  closeUtility()
  const old=state,next=transition(state,action)
  if(next===state)return
  actionRevision++; cancelAnimations(); readerSequence++
  const closingReader = product && next.mode === 'overview' && cameraBeforeReader
  if (closingReader) {
    selectedBubbleId = ''
    setRiverFocus('')
    if (isRoaming) {
      // The reader is a temporary chrome layer. In roam mode keep the exact
      // bubble anchor selected by the user while the saved camera is restored;
      // closing a reader must never auto-rebind the bird to another bubble.
      clearRoamIntent({ restore: false })
      bird.classList.remove('roam-hidden')
    }
    else beginComposerHandoff()
  } else if (product && ['thinking', 'work'].includes(next.mode)) {
    selectedBubbleId = next.active
  }
  state=next
  render(false,old)
  syncSceneMotion(old,next)
  if(product && next.mode==='overview' && closingReader) {
    const restore=cameraBeforeReader;cameraBeforeReader=null
    // Restore after the close state has painted, so a reader animation never
    // causes a one-frame camera jump or loses the user's exact zoom anchor.
    setTimeout(()=>canvas.animateTo(restore,{duration:duration(300),meta:{reason:'reader-close'}}),duration(0))
  } else if(product && ['thinking','work'].includes(next.mode)) {
    requestAnimationFrame(()=>revealActiveBubble(next.active,next.mode))
  }
  const revision=actionRevision
  if(state.mode==='overview') setTimeout(()=>{ if(revision!==actionRevision||!$('#utility-panel').hidden)return; lastFocus?.isConnected?lastFocus.focus({preventScroll:true}):$('#capture-input').focus({preventScroll:true}) },duration(780))
}
// Product bubbles stay on the home scene for the first interaction.  The
// explicit actions in the expanded card own the transition to the canonical
// matter route; this keeps the visual wake-up reversible and avoids turning a
// hover/click into an implicit navigation.
 function openEntry(id) {
   lastFocus=$(`[data-entry="${id}"]`)
   if(product) {
     cameraBeforeReader=canvas.snapshot()
     // Selecting a bubble changes the semantic anchor immediately, but the
     // visual handoff is completed by the same camera RAF used to reveal the
     // reader.  There is no independent take-off/correction animation.
     beginBubbleHandoff(id)
   }
   if(!product&&!prototypePreview&&onOpen){onOpen(id);return}
   dispatch({type:'OPEN',id})
 }
function discussion() {
  const url=new URL(location.href); url.search=''; url.searchParams.set('view','discussion'); url.searchParams.set('observationId',`home-${state.active}`); url.searchParams.set('text',currentTitle()); url.searchParams.set('source','Trace 首页 · 会话内原型'); location.assign(url.href)
}

function closeUtility() { const panel=$('#utility-panel'); if(panel.hidden)return; panel.hidden=true; panel.innerHTML=''; lastFocus?.focus?.({preventScroll:true}) }
function openUtility(kind) {
  const panel=$('#utility-panel'); lastFocus=document.activeElement
  const title=({search:'找回在意的事',all:'全部在意的事',project:'当前工作现场',source:'原来的现场',about:'关于这个原型',preview:'交互状态预览'})[kind]
  let body=''
  if(kind==='search'||kind==='all') body=`<label class="search-field">${icon('search')}<input id="home-search" placeholder="搜索思考、发现或工作……" autocomplete="off"/></label><div id="search-results"></div>`
  if(kind==='source') body=`<span class="utility-tag">示例现场 · 知乎原文</span><h3>${escape(currentTitle())}</h3><p>当时留下的不只是文章，也是“为什么会在意它”。</p><blockquote>${escape(originalContext())}</blockquote><p>这是概念图对应的示例摘要，尚未绑定真实原文链接。</p><button class="utility-primary" data-action="resume">从这里接着</button>`
  if(kind==='project') body=`<span class="utility-tag">项目 · harness</span><h3>Codex 工作现场</h3><p>此处演示思考如何带入工作、以及结果如何返回。当前未连接真实 Codex 会话，不会创建新 Agent 或发送消息。</p><button class="utility-primary" data-action="work">查看工作接续</button>`
  if(kind==='about') body=`<h3>留下一点，让它继续变化。</h3><p>当前为可交互的桌面原型。输入与状态仅存在本次页面会话；刷新后重置，不写入长期状态，也不调用真实模型。</p><p>需要继续讨论时，会进入项目原有的 Mock Agent 讨论界面。</p><button class="utility-primary" data-action="preview">查看六态演示</button>`
  if(kind==='preview') body=`<p>预览使用概念图中的示例内容，不代表真实工作已经完成或判断已经验证。</p><div class="state-previews">${[['overview','01 · 首页静默总览'],['thinking','02—03 · 唤醒与思考接续'],['growth','04 · 思考生长'],['work','05 · 工作接续'],['return','06 · 结果回流']].map(([mode,label])=>`<button data-preview-mode="${mode}" type="button">${escape(label)}${icon('arrow')}</button>`).join('')}</div>`
  panel.innerHTML=`<header><h2 id="utility-title">${title}</h2><button type="button" data-action="close-utility" aria-label="关闭面板">${icon('close')}</button></header>${body}`
  panel.hidden=false
  if(kind==='search'||kind==='all'){updateSearch('');$('#home-search').focus()}
  else panel.querySelector('button').focus()
}
function updateSearch(query) {
  const entries=Object.entries(ENTRIES).filter(([id,e])=>['thought','work','fresh','handoff'].includes(id)&&`${e.title}${e.subtitle}${id==='thought'?state.captured:''}`.toLowerCase().includes(query.trim().toLowerCase()))
  $('#search-results').innerHTML=entries.length?entries.map(([id,e])=>`<button type="button" class="search-result" data-open-entry="${id}">${icon(e.icon)}<span><strong>${escape(id==='thought'&&state.captured?state.captured:e.title)}</strong><small>${escape(e.subtitle)}</small></span></button>`).join(''):'<p class="empty-search">没有找到。试试换一个词，或者先留下一点。</p>'
}

  listen(mount,'click',event=>{
  const button=event.target.closest('button'); if(!button)return
  if(button.dataset.entry){openEntry(button.dataset.entry);return}
  if(button.dataset.openEntry){openEntry(button.dataset.openEntry);return}
  if(button.dataset.previewMode){prototypePreview=true;dispatch({type:'MODE',mode:button.dataset.previewMode});return}
  const action=button.dataset.action
  if(product && action==='enter-roam'){enterRoam();return}
  if(product && action==='exit-roam'){exitRoam();return}
  if(action==='all'&&onAll){onAll();return}
  if(action==='search'&&onSearch){onSearch();return}
  if(action==='about'&&onProfile){onProfile();return}
  if(action==='project'&&onWorks){onWorks();return}
  if(action==='matters'&&onMatters){onMatters();return}
  if(product && action==='discuss' && onContinue){onContinue(state.active,'discussion');return}
  if(product && action==='resume' && onContinue){onContinue(state.active,'resume');return}
  if(product && action==='source' && onSource){onSource(state.active);return}
  if(product && action==='work' && onWork){onWork(state.active);return}
  if(product && action==='native-work' && onWork){onWork(state.active);return}
  if(product && action==='toggle-reader-wide'){
    readerWide=!readerWide
    if(readerWide){readerWidthBeforeWide=readerWidth;readerWidth=Math.max(readerWidth,700)}
    else readerWidth=Math.min(readerWidthBeforeWide,readerWidth)
    detail.dataset.readerWide=readerWide?'true':'false'
    detail.style.setProperty('--reader-width',`${readerWidth}px`)
    const toggle=detail.querySelector('[data-action="toggle-reader-wide"]')
    if(toggle){toggle.setAttribute('aria-pressed',String(readerWide));toggle.textContent=readerWide?'收窄阅读':'宽屏阅读'}
    detail.querySelector('[data-reader-resize]')?.setAttribute('aria-valuenow',String(readerWidth))
    return
  }
  if(product && action==='reconsider' && onContinue){onContinue(state.active,'understanding');return}
  if(['search','all','project','source','about','preview'].includes(action)){openUtility(action);return}
  if(action==='home')dispatch({type:'CLOSE'})
  if(action==='close-utility')closeUtility()
  if(action==='resume')dispatch({type:'OPEN',id:state.active})
  if(action==='work')dispatch({type:'WORK'})
  if(action==='discuss')discussion()
  if(action==='native-work')notify('原型尚未连接真实 Codex 会话；不会替你发送消息。')
  if(action==='reconsider'){dispatch({type:'OPEN',id:'thought'});notify('把实践发现放回原判断，继续分清。')}
  if(action==='result-input'){$('#detail-input')?.focus();notify('写下真实发生的结果，再按箭头带回来。')}
})
listen(mount,'submit',event=>{
  if(!['capture-form','detail-form'].includes(event.target.id))return
  event.preventDefault()
  const input=event.target.querySelector('textarea'),text=input.value.trim()
  if(!text)return
  if(event.target.id==='capture-form'){if(!prototypePreview&&onCapture){onCapture(text,{source:captureSource,agent:captureAgent});return}input.value='';event.target.querySelector('[type=submit]').disabled=true;dispatch({type:'CAPTURE',text})}
  else{drafts.delete(draftKey());dispatch({type:state.mode==='work'?'RETURN':'GROW',text})}
})
listen(mount,'change',event=>{
  if(event.target.id==='capture-source'){
    captureSource=event.target.value
    notify(captureSource==='none'?'这次只保留原话，不联网。':snapshot?.completeDemoMode?`演示会使用已保存的${captureSource==='zhihu'?'知乎':'全网'}来源，不会再次联网。`:`已选择${captureSource==='zhihu'?'知乎搜索':'全网搜索'}；原话会先保存，搜索结果由你确认后再保留。`)
  }
  if(event.target.id==='capture-agent'){
    captureAgent=event.target.value
    const label={none:'这次先不交给 Agent。','codex-native':'Codex 原生','codex-harness':'Codex Harness',custom:'自定义 Agent'}[captureAgent]
    notify(captureAgent==='none'?label:`已选择 ${label}；提交后先准备交接，只有桌宠连接时才会运行。`)
  }
})
listen(mount,'input',event=>{
  if(event.target.id==='home-search'){updateSearch(event.target.value);return}
  if(event.target.matches('textarea')){event.target.form.querySelector('[type=submit]').disabled=!event.target.value.trim();if(event.target.id==='detail-input')drafts.set(draftKey(),event.target.value)}
  if(event.target.id==='capture-input')onDraft?.(event.target.value)
})
  listen(mount,'keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(onSearch)onSearch();else openUtility('search');return}
  if(event.key==='Escape'){
    if(!$('#utility-panel').hidden) closeUtility()
    else if(state.mode!=='overview') dispatch({type:'CLOSE'})
    else if(isRoaming) exitRoam()
    return
  }
  if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.target.matches('textarea')){event.preventDefault();event.target.form.requestSubmit()}
  })
  function clampReaderWidth(value){
    const sceneWidth=scene.offsetWidth||1672
    return Math.round(Math.max(430,Math.min(900,sceneWidth-220,Number(value)||510)))
  }
  function startReaderResize(event){
    if(!product || event.button!==0 || !event.target.closest('[data-reader-resize]'))return
    event.preventDefault();event.stopPropagation()
    readerResizePointer={id:event.pointerId,startX:event.clientX,startWidth:readerWidth}
    detail.classList.add('is-resizing')
    event.target.setPointerCapture?.(event.pointerId)
  }
  function moveReaderResize(event){
    if(!readerResizePointer || event.pointerId!==readerResizePointer.id)return
    const sceneScale=scene.getBoundingClientRect().width/(scene.offsetWidth||1672)||1
    readerWidth=clampReaderWidth(readerResizePointer.startWidth-(event.clientX-readerResizePointer.startX)/sceneScale)
    detail.style.setProperty('--reader-width',`${readerWidth}px`)
    detail.dataset.readerWide=readerWidth>=650?'true':'false'
    readerWide=readerWidth>=650
    const toggle=detail.querySelector('[data-action="toggle-reader-wide"]')
    if(toggle){toggle.setAttribute('aria-pressed',String(readerWide));toggle.textContent=readerWide?'收窄阅读':'宽屏阅读'}
    detail.querySelector('[data-reader-resize]')?.setAttribute('aria-valuenow',String(readerWidth))
  }
  function endReaderResize(event){
    if(!readerResizePointer || (event.pointerId!=null && event.pointerId!==readerResizePointer.id))return
    readerResizePointer=null;detail.classList.remove('is-resizing')
  }
  listen(detail,'pointerdown',startReaderResize)
  listen(window,'pointermove',moveReaderResize)
  listen(window,'pointerup',endReaderResize)
  listen(window,'pointercancel',endReaderResize)
  listen(detail,'keydown',event=>{
    const handle=event.target.closest('[data-reader-resize]');if(!handle)return
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
      event.preventDefault();readerWidth=clampReaderWidth(readerWidth+(event.key==='ArrowLeft'?24:-24));readerWide=readerWidth>=650;detail.dataset.readerWide=readerWide?'true':'false';detail.style.setProperty('--reader-width',`${readerWidth}px`);handle.setAttribute('aria-valuenow',String(readerWidth));const toggle=detail.querySelector('[data-action="toggle-reader-wide"]');if(toggle){toggle.setAttribute('aria-pressed',String(readerWide));toggle.textContent=readerWide?'收窄阅读':'宽屏阅读'}
    } else if(event.key==='Enter'||event.key===' '){event.preventDefault();readerWide=!readerWide;readerWidth=readerWide?Math.max(readerWidth,700):Math.min(readerWidthBeforeWide,readerWidth);detail.dataset.readerWide=readerWide?'true':'false';detail.style.setProperty('--reader-width',`${readerWidth}px`);handle.setAttribute('aria-valuenow',String(readerWidth));const toggle=detail.querySelector('[data-action="toggle-reader-wide"]');if(toggle){toggle.setAttribute('aria-pressed',String(readerWide));toggle.textContent=readerWide?'收窄阅读':'宽屏阅读'}
    }
  })
listen(mount,'pointerdown',event=>{if(!$('#utility-panel').hidden&&!event.target.closest('#utility-panel,.home-nav,.profile-button,.prototype-caption'))closeUtility()})
for(const el of mount.querySelectorAll('[data-entry]')) {
  el.addEventListener('pointerenter',()=>{scene.dataset.awake=el.dataset.entry;if(product)scheduleRoamIntent(el.dataset.entry)})
  el.addEventListener('pointerleave',()=>{delete scene.dataset.awake;if(product&&state.mode==='overview')clearRoamIntent()})
  el.addEventListener('focus',()=>{scene.dataset.awake=el.dataset.entry;if(product)scheduleRoamIntent(el.dataset.entry)})
  el.addEventListener('blur',()=>{delete scene.dataset.awake;if(product&&state.mode==='overview')clearRoamIntent()})
}
let resizeTimer
function resizeScene(){
  const previousWidth = canvasViewport.offsetWidth || 1672
  const previousCamera = canvas.snapshot()
  const previousBaseline = (previousWidth / 2) - historyLatestCenter() * previousCamera.scale
  const compact=innerWidth<=720
  const scale=Math.min(innerWidth/1672,innerHeight/941)
  scene.style.setProperty('--scene-scale',compact?1:scale)
  scene.style.setProperty('--compact-scene-scale',Math.min(.5,innerWidth/1672))
  scene.dataset.viewport=compact?'compact':'desktop'
  scene.style.left=`${compact?0:(innerWidth-1672*scale)/2}px`
  scene.style.top=`${compact?0:Math.max(0,(innerHeight-941*scale)/2)}px`
  if (product) {
    canvasWorld.classList.toggle('is-history-world', !compact)
    if (compact) {
      // Product mobile already has a deliberate horizontal card strip. Keep
      // that native strip readable instead of applying the desktop mirror.
      canvas.set({ x: 0, y: 0 }, { reason: 'resize-compact' })
    } else {
      // The compact scene changes the viewport width but not the authored
      // world. Carry the camera by the baseline delta so the latest node
      // remains in the same visual place instead of jumping.
      const nextLayoutWidth = compact ? innerWidth : 1672
      const nextBaseline = (nextLayoutWidth / 2) - historyLatestCenter() * previousCamera.scale
      canvas.set({ x: previousCamera.x + nextBaseline - previousBaseline }, { reason: 'resize-history' })
    }
  }
  canvas.refresh()
  clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{for(const [el,material]of materials)if(!el.hidden)material.refresh()},180)
}
listen(window,'resize',resizeScene)
for(const image of bird.querySelectorAll('img')) image.addEventListener('error',()=>{image.hidden=true;bird.classList.add('asset-unavailable')})
resizeScene();render(true)
// The route can mount one frame before the stylesheet/font layout has a
// non-zero composer rect. Re-derive the sticky edge once layout is ready so
// the first visible frame is attached, not parked at the (0, 0) fallback.
if (product) {
  requestAnimationFrame(() => updateBirdAnchor())
  document.fonts?.ready?.then(() => updateBirdAnchor())
}
if (['thinking','work'].includes(state.mode)) {
  mountSceneMotion(state.active, state.mode)?.setExpanded(true, { immediate: true })
}
if(snapshot?.captureDraft){$('#capture-input').value=snapshot.captureDraft;$('#capture-form [type=submit]').disabled=!snapshot.captureDraft.trim()}
function destroy() {
  controller.abort();actionRevision++;cancelAnimations()
  destroySceneMotion()
  canvas.destroy()
  for(const id of timers)window.clearTimeout(id)
  timers.clear()
  for(const material of materials.values())material.destroy()
  materials.clear()
}
return { destroy, snapshot: () => ({ state, prototypePreview, drafts: [...drafts], captureDraft: $('#capture-input')?.value || '' }) }
}


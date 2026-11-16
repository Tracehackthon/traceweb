import React from 'react'
import { createRoot } from 'react-dom/client'
import { TraceOverlay } from '../client/TraceOverlay'
import traceStyles from '../client/style.css'
import nativeStyles from './native.css'
import geometryStyles from '../../../../shared/ui-geometry.css'

type NativeBridge = {
  setIgnoreMouseEvents: (ignore: boolean) => void
  reportInteractiveBounds?: (bounds: Array<{ x: number; y: number; width: number; height: number }>) => void
}

const style = document.createElement('style')
style.dataset.pluginCss = 'trace-native-ui-v1'
style.textContent = `${geometryStyles}\n${traceStyles}\n${nativeStyles}`
document.head.appendChild(style)

const bridge = (window as Window & { traceNative?: NativeBridge }).traceNative
let ignoringMouseEvents = false

function setIgnoringMouseEvents(ignore: boolean) {
  if (!bridge || ignore === ignoringMouseEvents) return
  ignoringMouseEvents = ignore
  bridge.setIgnoreMouseEvents(ignore)
}

function updateMousePassthrough(event: MouseEvent) {
  const target = document.elementFromPoint(event.clientX, event.clientY)
  const interactive = target instanceof Element && Boolean(target.closest(
    'button, input, textarea, select, a, [role="button"], [data-trace-interactive-region], .trace-detail-panel, .trace-reminder-bubble',
  ))
  setIgnoringMouseEvents(!interactive)
}

let boundsReportFrame: number | undefined
let boundsTrackUntil = 0
function reportInteractiveBounds() {
  if (!bridge?.reportInteractiveBounds || boundsReportFrame !== undefined) return
  boundsReportFrame = window.requestAnimationFrame(() => {
    boundsReportFrame = undefined
    const bounds = [...document.querySelectorAll('[data-trace-interactive-region]:not([data-trace-interactive-region="backdrop"]):not([data-trace-interactive-region="orbit"]), .trace-orbit-item, .trace-quick-notice, .trace-new-orb-label, .trace-stack-summary')]
      .map((node) => node.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0 && rect.width < window.innerWidth + 2 && rect.height < window.innerHeight + 2)
      .slice(0, 64)
      .map((rect) => ({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }))
    bridge.reportInteractiveBounds?.(bounds)
    if (performance.now() < boundsTrackUntil) reportInteractiveBounds()
  })
}

function trackSurfaceBounds() {
  // Fan/panel motion changes geometry without changing DOM attributes on each
  // animation frame. Track only a bounded settling window, never an idle loop.
  boundsTrackUntil = performance.now() + 720
  reportInteractiveBounds()
}

window.addEventListener('mousemove', updateMousePassthrough, { passive: true })
window.addEventListener('resize', reportInteractiveBounds, { passive: true })
window.addEventListener('blur', () => setIgnoringMouseEvents(true))
document.documentElement.addEventListener('mouseleave', () => setIgnoringMouseEvents(true))
setIgnoringMouseEvents(true)

const root = document.querySelector('#trace-native-root')
if (!(root instanceof HTMLElement)) throw new Error('Trace native root is missing')

createRoot(root).render(React.createElement(TraceOverlay))
const boundsObserver = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(records => {
  // Bitmap/facing frames do not move the pet's button. Do not turn a working
  // pose into a permanent 60Hz geometry/IPC loop.
  const geometryMayAnimate = records.some(record => record.type === 'childList'
    || !(record.target instanceof Element && record.target.closest('.trace-pet-button')))
  if (geometryMayAnimate) trackSurfaceBounds()
  else reportInteractiveBounds()
})
boundsObserver?.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'open'] })
root.addEventListener('animationstart', event => {
  if (event.target instanceof Element && getComputedStyle(event.target).animationIterationCount !== 'infinite') trackSurfaceBounds()
})
root.addEventListener('transitionrun', trackSurfaceBounds)
reportInteractiveBounds()

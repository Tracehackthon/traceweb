import React from 'react'
import { createRoot } from 'react-dom/client'
import { TraceOverlay } from '../client/TraceOverlay'
import traceStyles from '../client/style.css'
import nativeStyles from './native.css'

type NativeBridge = {
  setIgnoreMouseEvents: (ignore: boolean) => void
  reportInteractiveBounds?: (bounds: Array<{ x: number; y: number; width: number; height: number }>) => void
}

const style = document.createElement('style')
style.dataset.pluginCss = 'trace-native-ui-v1'
style.textContent = `${traceStyles}\n${nativeStyles}`
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
function reportInteractiveBounds() {
  if (!bridge?.reportInteractiveBounds || boundsReportFrame !== undefined) return
  boundsReportFrame = window.requestAnimationFrame(() => {
    boundsReportFrame = undefined
    const bounds = [...document.querySelectorAll('[data-trace-interactive-region]')]
      .map((node) => node.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0 && rect.width < window.innerWidth + 2 && rect.height < window.innerHeight + 2)
      .slice(0, 64)
      .map((rect) => ({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }))
    bridge.reportInteractiveBounds?.(bounds)
  })
}

window.addEventListener('mousemove', updateMousePassthrough, { passive: true })
window.addEventListener('resize', reportInteractiveBounds, { passive: true })
window.addEventListener('blur', () => setIgnoringMouseEvents(true))
document.documentElement.addEventListener('mouseleave', () => setIgnoringMouseEvents(true))
setIgnoringMouseEvents(true)

const root = document.querySelector('#trace-native-root')
if (!(root instanceof HTMLElement)) throw new Error('Trace native root is missing')

createRoot(root).render(React.createElement(TraceOverlay))
const boundsObserver = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(reportInteractiveBounds)
boundsObserver?.observe(root, { subtree: true, childList: true, attributes: true })
reportInteractiveBounds()

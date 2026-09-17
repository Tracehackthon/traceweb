/**
 * Shared camera controller for Trace's scene canvases.
 *
 * `viewport` owns the pointer surface and controls while only `world` receives
 * the camera transform. Coordinates are expressed in the world's unscaled CSS
 * pixels. Bounds are deliberately supplied by the screen that owns the world:
 * the home history canvas has a soft future edge while the comparison canvas
 * can remain an ordinary free canvas.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function reducedMotion() {
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
    || document.documentElement?.dataset.reduceMotion === 'true'
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function axisBounds(value, min, max) {
  if (!Number.isFinite(min) && !Number.isFinite(max)) return value
  if (!Number.isFinite(min)) return Math.min(value, max)
  if (!Number.isFinite(max)) return Math.max(value, min)
  return clamp(value, Math.min(min, max), Math.max(min, max))
}

export function createCanvasController({
  viewport,
  world,
  controls,
  minScale = 0.55,
  maxScale = 1.8,
  initial = { x: 0, y: 0, scale: 1 },
  interactiveSelector = 'button,a,input,textarea,select,[data-canvas-interactive]',
  bounds = null,
  rubberBand = 0.2,
  settleDuration = 280,
  fitTarget = null,
  resetTarget = null,
  onChange = () => {},
  onDrag = () => {},
  onSettle = () => {},
} = {}) {
  if (!viewport || !world) throw new TypeError('createCanvasController requires viewport and world')

  const initialCamera = {
    x: finite(initial.x),
    y: finite(initial.y),
    scale: clamp(finite(initial.scale, 1), minScale, maxScale),
  }
  let camera = { ...initialCamera }
  let destroyed = false
  let dragging = null
  let suppressClick = false
  let settleTimer = 0
  let settleFrame = 0
  // Camera hand-offs (reader reveal/restore) use the same RAF that emits
  // `onChange`.  Consumers such as the home bird can therefore derive their
  // geometry from the exact camera snapshot that painted the world instead of
  // following a second CSS transition one frame later.
  let motionFrame = 0
  let changeFrame = 0
  let pendingChange = null
  let settleToken = 0
  const listeners = []
  const add = (target, type, listener, options) => {
    target.addEventListener(type, listener, options)
    listeners.push(() => target.removeEventListener(type, listener, options))
  }

  function outerScale() {
    const rect = viewport.getBoundingClientRect()
    const layoutWidth = viewport.offsetWidth || world.offsetWidth || 1
    return rect.width > 0 && layoutWidth > 0 ? rect.width / layoutWidth : 1
  }

  function resolveBounds(forCamera = camera) {
    const value = typeof bounds === 'function'
      ? bounds({ camera: { ...forCamera }, viewport, world })
      : bounds
    return value && typeof value === 'object' ? value : null
  }

  function bounded(next, { overscroll = false } = {}) {
    const value = {
      x: finite(next.x, camera.x),
      y: finite(next.y, camera.y),
      scale: clamp(finite(next.scale, camera.scale), minScale, maxScale),
    }
    if (overscroll) return value
    const limits = resolveBounds(value)
    if (!limits) return value
    value.x = axisBounds(value.x, Number(limits.minX), Number(limits.maxX))
    value.y = axisBounds(value.y, Number(limits.minY), Number(limits.maxY))
    return value
  }

  function rubber(value, min, max) {
    if (!Number.isFinite(min) && !Number.isFinite(max)) return value
    const resistance = clamp(Number(rubberBand) || 0.2, 0.05, 0.8)
    if (Number.isFinite(min) && value < min) return min + (value - min) * resistance
    if (Number.isFinite(max) && value > max) return max + (value - max) * resistance
    return value
  }

  function rubberBounded(next) {
    const value = bounded(next, { overscroll: true })
    const limits = resolveBounds(value)
    if (!limits) return value
    value.x = rubber(value.x, Number(limits.minX), Number(limits.maxX))
    value.y = rubber(value.y, Number(limits.minY), Number(limits.maxY))
    return value
  }

  function stopSettle({ keepClass = false } = {}) {
    if (settleFrame) window.cancelAnimationFrame(settleFrame)
    settleFrame = 0
    if (motionFrame) window.cancelAnimationFrame(motionFrame)
    motionFrame = 0
    window.clearTimeout(settleTimer)
    settleTimer = 0
    settleToken += 1
    if (!keepClass) world.classList.remove('is-camera-settling')
  }

  function apply(next, meta = {}, options = {}) {
    if (destroyed) return camera
    // A reader focus may temporarily place a selected historical node beyond
    // the roam edge so it can sit in the unobscured reading lane.  The saved
    // camera is restored on close; ordinary pan/zoom still uses bounded or
    // rubber-banded coordinates.
    if (options.unbounded) {
      camera = {
        x: finite(next.x, camera.x),
        y: finite(next.y, camera.y),
        scale: clamp(finite(next.scale, camera.scale), minScale, maxScale),
      }
    } else camera = options.overscroll ? rubberBounded(next) : bounded(next)
    world.style.transformOrigin = '0 0'
    world.style.transform = `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.scale})`
    viewport.dataset.canvasScale = String(Math.round(camera.scale * 100))
    viewport.style.setProperty('--canvas-scale', String(camera.scale))
    viewport.setAttribute('aria-valuenow', String(Math.round(camera.scale * 100)))
    viewport.setAttribute('aria-valuetext', `${Math.round(camera.scale * 100)}%`)
    const output = controls?.querySelector?.('[data-canvas-scale]')
    if (output) output.textContent = `${Math.round(camera.scale * 100)}%`
    const change = { ...camera, ...meta, bounds: resolveBounds(camera) }
    if (options.syncChange) {
      pendingChange = null
      if (changeFrame) window.cancelAnimationFrame(changeFrame)
      changeFrame = 0
      onChange(change)
    } else {
      // Pointer and wheel input can produce several events before the next
      // paint. Coalesce them and read the target bubble rect once, after the
      // final camera transform has been written, in that same RAF. This keeps
      // the semantic pointer on the final target without a trailing frame.
      pendingChange = change
      if (!changeFrame) {
        changeFrame = window.requestAnimationFrame(() => {
          changeFrame = 0
          const finalChange = pendingChange
          pendingChange = null
          if (!destroyed && finalChange) onChange(finalChange)
        })
      }
    }
    return camera
  }

  function snapshot() { return { ...camera } }

  function targetFor(kind, fallback) {
    const resolver = kind === 'fit' ? fitTarget : resetTarget
    if (typeof resolver === 'function') {
      const value = resolver({ camera: snapshot(), viewport, world, fallback: { ...fallback } })
      if (value && typeof value === 'object') return { ...fallback, ...value }
    }
    return fallback
  }

  function set(next, meta = {}) {
    stopSettle()
    return apply({ ...camera, ...(next || {}) }, meta)
  }

  function settle(meta = {}) {
    if (destroyed) return camera
    const target = bounded(camera)
    const same = Math.abs(target.x - camera.x) < 0.01 && Math.abs(target.y - camera.y) < 0.01
      && Math.abs(target.scale - camera.scale) < 0.0001
    if (same) {
      world.classList.remove('is-camera-settling')
      onSettle({ ...camera, ...meta })
      return camera
    }
    return animateTo(target, { duration: settleDuration, meta: { ...meta, reason: meta.reason || 'settle' } })
  }

  /**
   * Animate one camera hand-off in JavaScript rather than combining a CSS
   * transform transition with JS writes.  `progress` and `phase` are emitted
   * on every frame; this is intentionally part of the controller contract so a
   * semantic companion (the home bird) can use the same progress as the
   * bubble/camera hand-off.
   */
  function animateTo(next, { duration: animationDuration = settleDuration, meta = {}, unbounded = false } = {}) {
    if (destroyed) return camera
    const target = unbounded
      ? bounded(next, { overscroll: true })
      : bounded(next)
    const same = Math.abs(target.x - camera.x) < 0.01 && Math.abs(target.y - camera.y) < 0.01
      && Math.abs(target.scale - camera.scale) < 0.0001
    if (same || reducedMotion() || animationDuration <= 0) {
      stopSettle()
      const result = apply(target, { ...meta, progress: 1, phase: 'settled' }, unbounded ? { unbounded: true, syncChange: true } : { syncChange: true })
      onSettle({ ...result, ...meta, progress: 1, phase: 'settled' })
      return result
    }
    stopSettle({ keepClass: true })
    const token = settleToken
    const start = snapshot()
    const started = performance.now()
    world.classList.add('is-camera-settling')
    const tick = now => {
      if (destroyed || token !== settleToken) return
      const progress = clamp((now - started) / animationDuration, 0, 1)
      // Ease only the shared scalar.  Both the world and its semantic pointer
      // consume this value in the same `onChange` call, so there is no second
      // settling pass for the bird to catch up with.
      const eased = 1 - Math.pow(1 - progress, 3)
      apply({
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
        scale: start.scale + (target.scale - start.scale) * eased,
      }, { ...meta, progress, phase: progress < 1 ? 'moving' : 'settled' }, unbounded ? { unbounded: true, syncChange: true } : { overscroll: true, syncChange: true })
      if (progress < 1) motionFrame = window.requestAnimationFrame(tick)
      else {
        motionFrame = 0
        world.classList.remove('is-camera-settling')
        onSettle({ ...camera, ...meta, progress: 1, phase: 'settled' })
      }
    }
    motionFrame = window.requestAnimationFrame(tick)
    return target
  }

  function pointFromEvent(event) {
    const rect = viewport.getBoundingClientRect()
    const unit = outerScale()
    return {
      x: (event.clientX - rect.left) / unit,
      y: (event.clientY - rect.top) / unit,
    }
  }

  function zoomAt(clientX, clientY, nextScale) {
    stopSettle()
    const rect = viewport.getBoundingClientRect()
    const unit = outerScale()
    const local = { x: (clientX - rect.left) / unit, y: (clientY - rect.top) / unit }
    const worldPoint = { x: (local.x - camera.x) / camera.scale, y: (local.y - camera.y) / camera.scale }
    const scale = clamp(nextScale, minScale, maxScale)
    return apply({ scale, x: local.x - worldPoint.x * scale, y: local.y - worldPoint.y * scale }, { reason: 'zoom' })
  }

  function zoomBy(delta, anchor) {
    const factor = Math.exp(delta * 0.0015)
    const center = anchor || (() => {
      const rect = viewport.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })()
    return zoomAt(center.x, center.y, camera.scale * factor)
  }

  function fit(meta = {}) {
    const rect = viewport.getBoundingClientRect()
    const layoutWidth = viewport.offsetWidth || world.offsetWidth || 1
    const layoutHeight = viewport.offsetHeight || world.offsetHeight || 1
    const worldWidth = world.offsetWidth || layoutWidth
    const worldHeight = world.offsetHeight || layoutHeight
    const availableWidth = Math.max(1, layoutWidth - 32)
    const availableHeight = Math.max(1, layoutHeight - 32)
    const fitScale = clamp(Math.min(availableWidth / worldWidth, availableHeight / worldHeight), minScale, 1)
    const fallback = {
      scale: fitScale,
      x: Math.max(0, (layoutWidth - worldWidth * fitScale) / 2),
      y: Math.max(0, (layoutHeight - worldHeight * fitScale) / 2),
    }
    void rect
    stopSettle()
    const target = targetFor('fit', fallback)
    return apply(target, { ...meta, reason: 'fit' })
  }

  function reset(meta = {}, { duration: transitionDuration = 0, unbounded = false } = {}) {
    stopSettle()
    const target = targetFor('reset', { ...initialCamera })
    return transitionDuration > 0
      ? animateTo(target, { duration: transitionDuration, meta: { ...meta, reason: 'reset' }, unbounded })
      : apply(target, { ...meta, reason: 'reset' })
  }

  function centerRect(element, { safeRect, meta = {}, settleAfter = false, allowOutsideBounds = false, duration: transitionDuration = 0 } = {}) {
    if (!element?.getBoundingClientRect) return camera
    const viewportRect = viewport.getBoundingClientRect()
    const current = element.getBoundingClientRect()
    const safe = safeRect || viewportRect
    const safeWidth = Number.isFinite(safe.width) ? safe.width : safe.right - safe.left
    const safeHeight = Number.isFinite(safe.height) ? safe.height : safe.bottom - safe.top
    const targetX = safe.left + safeWidth / 2
    const targetY = safe.top + safeHeight / 2
    const dx = (targetX - (current.left + current.width / 2)) / outerScale()
    const dy = (targetY - (current.top + current.height / 2)) / outerScale()
    const target = { ...camera, x: camera.x + dx, y: camera.y + dy }
    const result = transitionDuration > 0
      ? animateTo(target, { duration: transitionDuration, meta: { ...meta, reason: meta.reason || 'center-element' }, unbounded: allowOutsideBounds })
      : apply(target, { ...meta, reason: meta.reason || 'center-element' }, { unbounded: allowOutsideBounds })
    if (settleAfter && transitionDuration <= 0) settle({ ...meta, reason: meta.reason || 'center-element-settle' })
    void viewportRect
    return result
  }

  function pointerDown(event) {
    if (destroyed || event.button !== 0 || event.defaultPrevented) return
    if (event.target.closest?.(interactiveSelector)) return
    stopSettle()
    dragging = {
      id: event.pointerId,
      start: pointFromEvent(event),
      origin: snapshot(),
      moved: false,
    }
    viewport.setPointerCapture?.(event.pointerId)
    viewport.classList.add('is-panning')
    event.preventDefault()
  }

  function pointerMove(event) {
    if (!dragging || event.pointerId !== dragging.id) return
    const point = pointFromEvent(event)
    const dx = point.x - dragging.start.x
    const dy = point.y - dragging.start.y
    if (!dragging.moved && Math.hypot(dx, dy) < 3) return
    dragging.moved = true
    suppressClick = true
    apply({ ...camera, x: dragging.origin.x + dx, y: dragging.origin.y + dy }, { reason: 'pan', overscrolled: true }, { overscroll: true })
    onDrag({ ...camera, dx, dy, bounds: resolveBounds(camera) })
  }

  function pointerEnd(event) {
    if (!dragging || event.pointerId !== dragging.id) return
    viewport.releasePointerCapture?.(event.pointerId)
    viewport.classList.remove('is-panning')
    if (dragging.moved) {
      settle({ reason: 'pan-settle' })
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => { suppressClick = false }, 0)
    }
    dragging = null
  }

  function wheel(event) {
    if (destroyed || event.ctrlKey) return
    event.preventDefault()
    zoomBy(-event.deltaY, { x: event.clientX, y: event.clientY })
  }

  function clickCapture(event) {
    if (!suppressClick) return
    event.preventDefault()
    event.stopPropagation()
    suppressClick = false
  }

  function controlClick(event) {
    const button = event.target.closest?.('[data-canvas-action]')
    if (!button || button.disabled) return
    const action = button.dataset.canvasAction
    if (action === 'zoom-in') zoomBy(160)
    if (action === 'zoom-out') zoomBy(-160)
    if (action === 'fit') fit()
    if (action === 'reset') reset()
  }

  function keyDown(event) {
    if (destroyed || event.defaultPrevented || event.target !== viewport) return
    const key = event.key.toLowerCase()
    if (key === '+' || key === '=') { event.preventDefault(); zoomBy(160); return }
    if (key === '-' || key === '_') { event.preventDefault(); zoomBy(-160); return }
    if (key === '0') { event.preventDefault(); reset(); return }
    if (key === 'f') { event.preventDefault(); fit(); return }
    const step = event.shiftKey ? 96 : 36
    const delta = { arrowleft: [step, 0], arrowright: [-step, 0], arrowup: [0, step], arrowdown: [0, -step] }[key]
    if (!delta) return
    event.preventDefault()
    apply({ ...camera, x: camera.x + delta[0], y: camera.y + delta[1] }, { reason: 'keyboard-pan', overscrolled: true }, { overscroll: true })
    settle({ reason: 'keyboard-settle' })
  }

  add(viewport, 'pointerdown', pointerDown)
  add(viewport, 'pointermove', pointerMove)
  add(viewport, 'pointerup', pointerEnd)
  add(viewport, 'pointercancel', pointerEnd)
  add(viewport, 'wheel', wheel, { passive: false })
  add(viewport, 'click', clickCapture, true)
  add(viewport, 'keydown', keyDown)
  if (controls) add(controls, 'click', controlClick)

  viewport.setAttribute('aria-keyshortcuts', '+ - 0 F ArrowLeft ArrowRight ArrowUp ArrowDown')
  apply(camera, { reason: 'init' })

  return {
    getState: snapshot,
    snapshot,
    set,
    zoomAt,
    zoomBy,
    fit,
    reset,
    settle,
    animateTo,
    centerRect,
    centerElement: centerRect,
    getBounds: () => resolveBounds(camera),
    refresh() { if (!destroyed) apply(camera, { reason: 'refresh' }) },
    isDragging: () => Boolean(dragging?.moved),
    destroy() {
      if (destroyed) return
      destroyed = true
      stopSettle()
      viewport.classList.remove('is-panning')
      listeners.splice(0).forEach(remove => remove())
      if (changeFrame) window.cancelAnimationFrame(changeFrame)
      changeFrame = 0
      pendingChange = null
      world.style.removeProperty('transform')
      world.style.removeProperty('transform-origin')
      delete viewport.dataset.canvasScale
      viewport.style.removeProperty('--canvas-scale')
      viewport.removeAttribute('aria-keyshortcuts')
    },
  }
}

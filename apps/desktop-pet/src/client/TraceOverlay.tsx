import React, { useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import crawlAImage from './assets/pet/crawl_A.png'
import crawlBImage from './assets/pet/crawl_B.png'
import sitAImage from './assets/pet/sit_A.png'
import transitionAImage from './assets/pet/transition_A.png'
import transitionBImage from './assets/pet/transition_B.png'
import {
  createInitialTraceCodexState,
  normalizeTraceCodexEvent,
  projectTraceCodexState,
  reduceTraceCodexEvent,
  type PetProjection,
  type TraceCodexApprovalDecision,
  type TraceCodexInteraction,
  type TraceCodexEvent,
  type TraceCodexState,
} from './codex-events'
import { type CandidateStatus, type Observation, type ObservationStatus } from './mock-data'
import { TracePanel } from './TracePanel'

// Module-level session store: closing/reopening the surface preserves the
// current page session, while a full refresh still resets this V1 mock state.
const traceSessionStore: {
  observations: Observation[]
  candidateStatus: CandidateStatus
} = {
  observations: [],
  candidateStatus: '候选中',
}

const petSize = { width: 92, height: 116 }
const petBottomInset = 6
// Compact memory bubbles: the fan geometry remains unchanged, while the cards
// themselves are one size tighter so they do not cover the reading canvas.
const orbitCardSize = { width: 188, height: 74 }
const orbitPadding = 12
const panelSize = { width: 460, height: 590 }
const panelInset = 16

type Viewport = { width: number; height: number }
type PetPosition = { x: number; y: number }
type NativePlacement = { x: number; y: number; displayId?: string; isFreelyPositioned?: boolean }
type InteractiveBounds = { x: number; y: number; width: number; height: number }
type TraceReminder = { observationId: string; text: string }
type DesktopCandidatePayload = { type?: string; observationId?: string; status?: ObservationStatus }
type TraceNativeBridge = {
  openDiscussion?: (url: string) => void
  requestCapability?: (request: Record<string, unknown>) => Promise<any>
  onCandidate?: (listener: (payload: DesktopCandidatePayload) => void) => (() => void) | undefined
  onCodexEvent?: (listener: (event: TraceCodexEvent) => void) => (() => void) | undefined
  getPlacement?: () => Promise<NativePlacement | null>
  savePlacement?: (placement: NativePlacement & { placement?: string }) => Promise<void> | void
  reportInteractiveBounds?: (bounds: InteractiveBounds[]) => void
}
type ReminderPlacement = { side: 'top' | 'bottom' | 'inside'; style: CSSProperties }
type QuickComposerPlacement = {
  side: 'left' | 'right' | 'top'
  style: CSSProperties & { '--trace-quick-composer-width': string }
}
type PetPose = 'crawl' | 'sit'
type PetFacing = 'left' | 'right'
type PoseTransition = 'to-crawl' | 'to-sit'
type PoseTransitionPhase = 0 | 1 | 2
type OrbitPosition = {
  x: number
  y: number
  rotate: number
  originX: number
  originY: number
  originRotate: number
  stacked: boolean
  stackTop: boolean
}
type OrbitItem =
  | { id: string; kind: 'observation'; observation: Observation }
  | { id: string; kind: 'guide' | 'capture'; kicker: string; title: string; detail: string; tone: string; action: 'capture' | 'focus-first' | 'quick' }

const reminderTemplates = ['还在待确认，要看看吗？', '想复核一下它的适用范围吗？', '需要回顾，要补一条反例吗？', '也许值得带一条证据继续讨论。']

function getTraceNativeBridge() {
  return (window as Window & { traceNative?: TraceNativeBridge }).traceNative
}

function getViewport(): Viewport {
  if (typeof window === 'undefined') return { width: 1280, height: 720 }
  return { width: window.innerWidth, height: window.innerHeight }
}

function getDefaultPetPosition(viewport: Viewport): PetPosition {
  return {
    x: Math.max(8, viewport.width - 22 - petSize.width),
    y: Math.max(8, viewport.height - petBottomInset - petSize.height),
  }
}

function clampPetPosition(position: PetPosition, viewport: Viewport): PetPosition {
  return {
    x: Math.min(Math.max(8, position.x), Math.max(8, viewport.width - petSize.width - 8)),
    y: Math.min(Math.max(8, position.y), Math.max(8, viewport.height - petSize.height - petBottomInset)),
  }
}

function getPanelSize(viewport: Viewport, compact = false) {
  return {
    width: Math.min(compact ? 360 : panelSize.width, Math.max(280, viewport.width - panelInset * 2)),
    height: Math.min(compact ? 344 : panelSize.height, Math.max(compact ? 260 : 330, viewport.height - panelInset * 2)),
  }
}

function clampPanelPosition(position: PetPosition, viewport: Viewport, compact = false): PetPosition {
  const panel = getPanelSize(viewport, compact)
  return {
    x: Math.min(Math.max(panelInset, position.x), Math.max(panelInset, viewport.width - panel.width - panelInset)),
    y: Math.min(Math.max(panelInset, position.y), Math.max(panelInset, viewport.height - panel.height - panelInset)),
  }
}

function getDefaultPanelPosition(petPosition: PetPosition, viewport: Viewport): PetPosition {
  const panel = getPanelSize(viewport, true)
  const gap = 18
  const fitsRight = petPosition.x + petSize.width + gap + panel.width <= viewport.width - panelInset
  const fitsLeft = petPosition.x - gap - panel.width >= panelInset
  const x = fitsRight
    ? petPosition.x + petSize.width + gap
    : fitsLeft
      ? petPosition.x - panel.width - gap
      : petPosition.x < viewport.width / 2
        ? viewport.width - panel.width - panelInset
        : panelInset
  return clampPanelPosition({
    x,
    y: petPosition.y - panel.height * 0.55,
  }, viewport, true)
}

function distanceBetween(first: PetPosition, second: PetPosition) {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function getOrbitPositions(petPosition: PetPosition, viewport: Viewport, items: OrbitItem[]): OrbitPosition[] {
  if (items.length === 0) return []

  const petCenter = {
    x: petPosition.x + petSize.width / 2,
    y: petPosition.y + petSize.height / 2,
  }
  const viewportCenter = { x: viewport.width / 2, y: viewport.height / 2 }
  const innerAngle = Math.atan2(viewportCenter.y - petCenter.y, viewportCenter.x - petCenter.x)
  // Compact fan: cards stay close to the pet and overlap as a deliberate
  // stack instead of spreading across a sparse outer orbit. The inner-facing
  // direction follows the pet as it is dragged around the viewport.
  const fanSpan = Math.min(2.55, Math.max(2.1, Math.min(viewport.width, viewport.height) * .00355))
  const step = items.length === 1 ? 0 : fanSpan / (items.length - 1)
  const radius = Math.max(150, Math.min(184, Math.min(viewport.width, viewport.height) * .255))
  const radialOffsets = [-10, 7, -4, 11, -8, 5, -3, 8]
  const tangentOffsets = [-5, 4, -3, 5, -4, 3, -2, 4]
  const rotations = [-6, 3, -2, 5, -4, 2, 6, -3]

  // Keep the stack inside the viewport, including the rotated card bounds.
  const cardHalfWidth = orbitCardSize.width / 2 + 18
  const cardHalfHeight = orbitCardSize.height / 2 + 22

  const naturalCenters = items.map((_, index) => {
    const angle = innerAngle - fanSpan / 2 + step * index
    const radialOffset = radialOffsets[index % radialOffsets.length]
    const tangentOffset = tangentOffsets[index % tangentOffsets.length]
    const radialRadius = radius + radialOffset
    const targetCenter = {
      x: petCenter.x + radialRadius * Math.cos(angle) - tangentOffset * Math.sin(angle),
      y: petCenter.y + radialRadius * Math.sin(angle) + tangentOffset * Math.cos(angle),
    }
    const safeCenter = {
      x: Math.min(Math.max(cardHalfWidth + orbitPadding, targetCenter.x), viewport.width - cardHalfWidth - orbitPadding),
      y: Math.min(Math.max(cardHalfHeight + orbitPadding, targetCenter.y), viewport.height - cardHalfHeight - orbitPadding),
    }
    return safeCenter
  })

  // Compression is driven by actual viewport pressure, not by a corner flag.
  // Use the overlap over the smaller card's area so a card covered by >=80% of
  // another card joins the same compact stack.
  const overlapRatio = (first: PetPosition, second: PetPosition) => {
    const firstLeft = first.x - orbitCardSize.width / 2
    const firstRight = first.x + orbitCardSize.width / 2
    const firstTop = first.y - orbitCardSize.height / 2
    const firstBottom = first.y + orbitCardSize.height / 2
    const secondLeft = second.x - orbitCardSize.width / 2
    const secondRight = second.x + orbitCardSize.width / 2
    const secondTop = second.y - orbitCardSize.height / 2
    const secondBottom = second.y + orbitCardSize.height / 2
    const width = Math.max(0, Math.min(firstRight, secondRight) - Math.max(firstLeft, secondLeft))
    const height = Math.max(0, Math.min(firstBottom, secondBottom) - Math.max(firstTop, secondTop))
    return (width * height) / (orbitCardSize.width * orbitCardSize.height)
  }

  const parent = items.map((_, index) => index)
  const find = (index: number): number => {
    if (parent[index] === index) return index
    parent[index] = find(parent[index])
    return parent[index]
  }
  const join = (first: number, second: number) => {
    const firstRoot = find(first)
    const secondRoot = find(second)
    if (firstRoot !== secondRoot) parent[secondRoot] = firstRoot
  }
  for (let first = 0; first < naturalCenters.length; first += 1) {
    for (let second = first + 1; second < naturalCenters.length; second += 1) {
      if (overlapRatio(naturalCenters[first], naturalCenters[second]) >= .8) join(first, second)
    }
  }

  const groups = new Map<number, number[]>()
  parent.forEach((_, index) => {
    const root = find(index)
    const group = groups.get(root) ?? []
    group.push(index)
    groups.set(root, group)
  })
  const stackedByIndex = new Map<number, { center: PetPosition; top: boolean }>()
  const clampCardCenter = (center: PetPosition) => ({
    x: Math.min(Math.max(cardHalfWidth + orbitPadding, center.x), viewport.width - cardHalfWidth - orbitPadding),
    y: Math.min(Math.max(cardHalfHeight + orbitPadding, center.y), viewport.height - cardHalfHeight - orbitPadding),
  })
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const average = members.reduce((sum, index) => ({
      x: sum.x + naturalCenters[index].x / members.length,
      y: sum.y + naturalCenters[index].y / members.length,
    }), { x: 0, y: 0 })
    const anchor = clampCardCenter(average)
    const direction = {
      x: anchor.x <= viewport.width / 2 ? 1 : -1,
      y: anchor.y <= viewport.height / 2 ? 1 : -1,
    }
    const length = Math.hypot(direction.x, direction.y * .35)
    const tangent = { x: direction.x / length, y: direction.y * .35 / length }
    members.forEach((index, stackIndex) => {
      stackedByIndex.set(index, {
        center: clampCardCenter({ x: anchor.x + tangent.x * stackIndex * 20, y: anchor.y + tangent.y * stackIndex * 20 }),
        top: stackIndex === members.length - 1,
      })
    })
  }

  return naturalCenters.map((naturalCenter, index) => {
    const stacked = stackedByIndex.get(index)
    const center = stacked?.center ?? naturalCenter
    return {
      x: center.x - petPosition.x - 46,
      y: center.y - petPosition.y - 58,
      rotate: rotations[index % rotations.length],
      originX: 0,
      originY: 0,
      originRotate: 0,
      stacked: Boolean(stacked),
      stackTop: stacked?.top ?? false,
    }
  })
}

function getReminderPlacement(petPosition: PetPosition, viewport: Viewport, preferredSide?: ReminderPlacement['side']): ReminderPlacement {
  const width = Math.max(0, Math.min(232, viewport.width - 32))
  const height = 72
  const gap = 42
  const petCenter = {
    x: petPosition.x + petSize.width / 2,
    y: petPosition.y + petSize.height / 2,
  }
  const clampLeft = (left: number) => Math.min(Math.max(16, left), Math.max(16, viewport.width - width - 16))
  const clampTop = (top: number) => Math.min(Math.max(16, top), Math.max(16, viewport.height - height - 16))
  const top = petPosition.y - gap - height
  const bottom = petPosition.y + petSize.height + gap
  const side = preferredSide ?? (top >= 16 ? 'top' : bottom + height <= viewport.height - 16 ? 'bottom' : 'inside')
  const globalLeft = clampLeft(petCenter.x - width / 2)
  const toRelativeStyle = (globalTop: number): CSSProperties => ({
    left: `${globalLeft - petPosition.x}px`,
    top: `${clampTop(globalTop) - petPosition.y}px`,
    width: `${width}px`,
  })

  if (side === 'top') return { side, style: toRelativeStyle(top) }
  if (side === 'bottom') return { side, style: toRelativeStyle(bottom) }

  const inwardLeft = petCenter.x < viewport.width / 2
    ? petPosition.x + petSize.width + 18
    : petPosition.x - width - 18
  return {
    side: 'inside',
    style: {
      left: `${clampLeft(inwardLeft) - petPosition.x}px`,
      top: `${clampTop(petCenter.y - height / 2) - petPosition.y}px`,
      width: `${width}px`,
    },
  }
}

function isPetWorking(status: PetProjection['status']) {
  return status === 'thinking'
    || status === 'running-command'
    || status === 'editing'
    || status === 'searching'
}

function codexStatusPosition(position: PetPosition, viewport: Viewport): CSSProperties {
  const width = 244
  return {
    left: `${Math.min(Math.max(12, position.x + petSize.width / 2 - width / 2), Math.max(12, viewport.width - width - 12))}px`,
    top: `${Math.max(12, position.y - 74)}px`,
  }
}

function getQuickComposerPlacement(petPosition: PetPosition, viewport: Viewport): QuickComposerPlacement {
  const gap = 12
  const composerWidth = Math.min(224, Math.max(188, viewport.width - 76))
  const shortcutRailWidth = 34
  const width = composerWidth + shortcutRailWidth
  const height = 56
  const leftSpace = petPosition.x - 16
  const rightSpace = viewport.width - petPosition.x - petSize.width - 16
  const belowTop = petPosition.y + petSize.height + 8
  const top = Math.min(Math.max(16, petPosition.y + petSize.height - height - 12), viewport.height - height - 16)

  if (belowTop + height <= viewport.height - 16) {
    return {
      side: 'top',
      style: {
        left: `${Math.min(Math.max(16, petPosition.x + petSize.width - width), viewport.width - width - 16)}px`,
        top: `${belowTop}px`,
        width: `${width}px`,
        '--trace-quick-composer-width': `${composerWidth}px`,
      },
    }
  }

  if (leftSpace >= width + gap || leftSpace >= rightSpace) {
    return {
      side: 'left',
      style: {
        left: `${Math.max(16, petPosition.x - width - gap)}px`,
        top: `${top}px`,
        width: `${width}px`,
        '--trace-quick-composer-width': `${composerWidth}px`,
      },
    }
  }
  if (rightSpace >= width + gap) {
    return {
      side: 'right',
      style: {
        left: `${Math.min(viewport.width - width - 16, petPosition.x + petSize.width + gap)}px`,
        top: `${top}px`,
        width: `${width}px`,
        '--trace-quick-composer-width': `${composerWidth}px`,
      },
    }
  }
  return {
    side: 'top',
    style: {
      left: `${Math.min(Math.max(16, petPosition.x + petSize.width / 2 - width / 2), viewport.width - width - 16)}px`,
      top: `${Math.max(16, petPosition.y - height - gap)}px`,
      width: `${width}px`,
      '--trace-quick-composer-width': `${composerWidth}px`,
    },
  }
}

export function TraceOverlay() {
  const [open, setOpen] = useState(false)
  const [collapsing, setCollapsing] = useState(false)
  const [showPanel, setShowPanel] = useState(false)
  const [surfaceMode, setSurfaceMode] = useState<'quick' | 'bubbles'>('quick')
  const [panelMode, setPanelMode] = useState<'compact' | 'expanded'>('compact')
  const [quickDraft, setQuickDraft] = useState('')
  const [quickNotice, setQuickNotice] = useState('')
  const [focusedObservationId, setFocusedObservationId] = useState<string | undefined>()
  const [viewport, setViewport] = useState<Viewport>(() => getViewport())
  const [petPosition, setPetPosition] = useState<PetPosition | null>(null)
  const [observations, setObservations] = useState<Observation[]>(() => traceSessionStore.observations)
  const [candidateStatus, setCandidateStatus] = useState<CandidateStatus>(() => traceSessionStore.candidateStatus)
  const [discussionNotice, setDiscussionNotice] = useState('')
  const [capabilities, setCapabilities] = useState<any>({ connected: false, loading: true })
  const [codexState, setCodexState] = useState<TraceCodexState>(() => createInitialTraceCodexState())
  const [nativeCodexEventsEnabled, setNativeCodexEventsEnabled] = useState(false)
  const [codexInteractionBusy, setCodexInteractionBusy] = useState(false)
  const [codexInteractionNotice, setCodexInteractionNotice] = useState('')
  const codexDecisionInFlightRef = useRef(false)
  // A request can time out locally after the runtime accepted it. Keep the
  // same idempotency key for an exact retry instead of accidentally issuing a
  // second decision. Input fingerprints only live in renderer memory and are
  // never sent or rendered; this avoids retaining a secret in the key itself.
  const codexInteractionKeysRef = useRef(new Map<string, { key: string; fingerprint: string }>())
  const [reminder, setReminder] = useState<TraceReminder | null>(null)
  const [reminderSide, setReminderSide] = useState<ReminderPlacement['side'] | null>(null)
  const [panelPosition, setPanelPosition] = useState<PetPosition | null>(null)
  const [hugging, setHugging] = useState(false)
  // Idle and reminder states are calm, fixed-frame sitting. The low crawling
  // posture belongs specifically to the expanded memory fan.
  const [petPose, setPetPose] = useState<PetPose>('sit')
  const [petFrame, setPetFrame] = useState<0 | 1>(0)
  const [petFacing, setPetFacing] = useState<PetFacing>('left')
  const [crawlRunning, setCrawlRunning] = useState(false)
  const [poseTransition, setPoseTransition] = useState<PoseTransition | null>(null)
  const [poseTransitionPhase, setPoseTransitionPhase] = useState<PoseTransitionPhase>(0)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: PetPosition; moved: boolean } | null>(null)
  const panelDragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: PetPosition } | null>(null)
  const suppressClickRef = useRef(false)
  const petClickTimerRef = useRef<number | undefined>(undefined)
  const hugTimerRef = useRef<number | undefined>(undefined)
  const crawlTimerRef = useRef<number | undefined>(undefined)
  const poseTransitionTimersRef = useRef<number[]>([])
  const poseTransitionLockRef = useRef(false)
  const petClickSideRef = useRef<'left' | 'right'>('left')
  const lastReminderIndexRef = useRef(-1)
  const openRef = useRef(open)

  const codexProjection = projectTraceCodexState(codexState)

  useEffect(() => {
    const handleResize = () => {
      const nextViewport = getViewport()
      setViewport(nextViewport)
      setPetPosition((current) => (current ? clampPetPosition(current, nextViewport) : current))
      setPanelPosition((current) => (current ? clampPanelPosition(current, nextViewport, panelMode === 'compact') : current))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [panelMode])

  useEffect(() => {
    const bridge = getTraceNativeBridge()
    if (!bridge?.requestCapability) { setCapabilities({ connected: false, loading: false, error: { message: '当前宿主没有连接 Trace Runtime。' } }); return }
    let active = true
    void bridge.requestCapability({ operation: 'capabilities' }).then((value) => { if (active) setCapabilities({ ...value, loading: false }) }, (error) => { if (active) setCapabilities({ connected: false, loading: false, error: { message: error instanceof Error ? error.message : String(error) } }) })
    const refresh = () => void bridge.requestCapability?.({ operation: 'workspace.summary' }).then((value) => {
      if (!active || !Array.isArray(value.observations)) return
      traceSessionStore.observations = value.observations
      setObservations(value.observations)
      setFocusedObservationId((current) => current && value.observations.some((item: Observation) => item.id === current) ? current : value.observations[0]?.id)
    }, () => {})
    refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    const bridge = getTraceNativeBridge()
    if (!bridge?.onCodexEvent) return
    // A native desktop instance is event-driven even when the adapter is
    // temporarily quiet. It must not fall back to a fabricated reminder loop.
    setNativeCodexEventsEnabled(true)
    const receiveEvent = (payload: TraceCodexEvent) => {
      const event = normalizeTraceCodexEvent(payload)
      if (!event) return
      setCodexState((current) => reduceTraceCodexEvent(current, event))
    }
    const remove = bridge.onCodexEvent(receiveEvent)
    return () => remove?.()
  }, [])

  useEffect(() => {
    const bridge = getTraceNativeBridge()
    if (!bridge?.getPlacement) return
    let active = true
    void bridge.getPlacement().then((placement) => {
      if (!active || !placement || !Number.isFinite(placement.x) || !Number.isFinite(placement.y)) return
      setPetPosition(clampPetPosition({ x: placement.x, y: placement.y }, getViewport()))
    }).catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => () => {
    if (petClickTimerRef.current !== undefined) window.clearTimeout(petClickTimerRef.current)
    if (hugTimerRef.current !== undefined) window.clearTimeout(hugTimerRef.current)
    if (crawlTimerRef.current !== undefined) window.clearTimeout(crawlTimerRef.current)
    poseTransitionTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    poseTransitionTimersRef.current = []
    poseTransitionLockRef.current = false
  }, [])

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    if (!reminder) {
      if (reminderSide) setReminderSide(null)
      return
    }
    if (!reminderSide) setReminderSide(getReminderPlacement(petPosition ?? getDefaultPetPosition(viewport), viewport).side)
  }, [reminder?.text, reminderSide, petPosition, viewport])

  useEffect(() => {
    // Only the intentional crawl step cycles bitmap frames. Sitting stays on
    // sit_A; its sense of life comes from CSS sway, not image-frame flicker.
    if (petPose !== 'crawl' || !crawlRunning) {
      setPetFrame(0)
      return
    }
    const interval = window.setInterval(() => {
      setPetFrame((frame) => frame === 0 ? 1 : 0)
    }, 200)
    return () => window.clearInterval(interval)
  }, [petPose, crawlRunning])

  useEffect(() => {
    if (nativeCodexEventsEnabled) return
    let timer: number | undefined
    const scheduleReminder = () => {
      const delay = 60_000 + Math.floor(Math.random() * 30_001)
      timer = window.setTimeout(() => {
        const available = reminderTemplates.filter((_, index) => index !== lastReminderIndexRef.current)
        const template = available[Math.floor(Math.random() * available.length)] ?? reminderTemplates[0]
        const selectedIndex = reminderTemplates.indexOf(template)
        lastReminderIndexRef.current = selectedIndex
        const observation = traceSessionStore.observations[Math.floor(Math.random() * traceSessionStore.observations.length)]
        if (observation) {
          // A reminder may arrive while the fan is already open. In that case
          // retain its crawl posture; closed/idle reminder states sit calmly.
          setPetPose(openRef.current ? 'crawl' : 'sit')
          setPetFrame(0)
          setReminder({ observationId: observation.id, text: `上次那条「${observation.text}」${template}` })
        }
        scheduleReminder()
      }, delay)
    }
    scheduleReminder()
    return () => { if (timer !== undefined) window.clearTimeout(timer) }
  }, [nativeCodexEventsEnabled])

  useEffect(() => {
    if (!nativeCodexEventsEnabled || codexProjection.status === 'idle') return
    // The sprite remains a projection of session state. It does not run an
    // Agent; motion is only a visual acknowledgement of the incoming event.
    const nextPose: PetPose = isPetWorking(codexProjection.status) ? 'crawl' : 'sit'
    setPetPose(nextPose)
    setCrawlRunning(isPetWorking(codexProjection.status))
    setPetFrame(0)
  }, [codexProjection.status, nativeCodexEventsEnabled])

  useEffect(() => {
    const receiveCandidate = (payload: DesktopCandidatePayload) => {
      if (payload.type !== 'trace.desktop.candidate' || !payload.observationId || !payload.status) return
      const nextStatus = payload.status
      if (nextStatus !== '候选中' && nextStatus !== '待确认') return

      traceSessionStore.observations = traceSessionStore.observations.map((observation) => (
        observation.id === payload.observationId ? { ...observation, status: nextStatus } : observation
      ))
      traceSessionStore.candidateStatus = nextStatus === '候选中' ? '候选中' : traceSessionStore.candidateStatus
      setObservations(traceSessionStore.observations)
      setCandidateStatus(traceSessionStore.candidateStatus)
      setFocusedObservationId(payload.observationId)
      setDiscussionNotice(nextStatus === '候选中'
        ? '桌面端已将这条观察标记为候选中。'
        : '桌面端已撤回候选，这条观察回到待确认。')
    }

    const receiveDesktopCandidate = (event: MessageEvent) => {
      if (event.origin !== 'http://127.0.0.1:4173') return
      receiveCandidate(event.data as DesktopCandidatePayload)
    }

    window.addEventListener('message', receiveDesktopCandidate)
    const removeNativeListener = getTraceNativeBridge()?.onCandidate?.(receiveCandidate)
    return () => {
      window.removeEventListener('message', receiveDesktopCandidate)
      removeNativeListener?.()
    }
  }, [])

  const currentPetPosition = petPosition ?? getDefaultPetPosition(viewport)
  const lastPetCenterXRef = useRef<number | null>(null)
  useEffect(() => {
    const centerX = currentPetPosition.x + petSize.width / 2
    const lastX = lastPetCenterXRef.current
    if (lastX === null) {
      setPetFacing(centerX < viewport.width / 2 ? 'right' : 'left')
    } else if (Math.abs(centerX - lastX) > 1) {
      setPetFacing(centerX > lastX ? 'right' : 'left')
    }
    lastPetCenterXRef.current = centerX
  }, [currentPetPosition.x, viewport.width])
  const reminderPlacement = getReminderPlacement(currentPetPosition, viewport, reminderSide ?? undefined)
  const quickComposerPlacement = getQuickComposerPlacement(currentPetPosition, viewport)
  const defaultCompactPanelPosition = getDefaultPanelPosition(currentPetPosition, viewport)
  const defaultPanelPosition = panelMode === 'compact'
    ? defaultCompactPanelPosition
    : clampPanelPosition({ x: defaultCompactPanelPosition.x, y: defaultCompactPanelPosition.y }, viewport, false)
  const currentPanelPosition = panelPosition ?? defaultPanelPosition
  const panelIsDetached = showPanel && panelMode === 'expanded'
  const codexStatusStyle = codexStatusPosition(currentPetPosition, viewport)
  const guideItems: OrbitItem[] = [
    { id: 'guide-quick', kind: 'guide', kicker: '极简对话', title: '回到快速输入', detail: '不展开小窗，直接写一句', tone: 'warm', action: 'quick' },
  ]
  const visibleObservationCount = 4
  const observationItems: OrbitItem[] = observations.slice(0, visibleObservationCount).map((observation) => ({
    id: observation.id,
    kind: 'observation',
    observation,
  }))
  const overflowItems: OrbitItem[] = observations.length > visibleObservationCount ? [{
    id: 'more-observations',
    kind: 'guide',
    kicker: '历史观察',
    title: `还有 ${observations.length - visibleObservationCount} 条`,
    detail: '打开小窗查看全部内容',
    tone: 'mint',
    action: 'focus-first',
  }] : []
  const orbitItems = [...guideItems, ...observationItems, ...overflowItems]
  const orbitPositions = getOrbitPositions(currentPetPosition, viewport, orbitItems)
  const petImage = poseTransition === 'to-crawl'
    ? poseTransitionPhase === 0 ? sitAImage
      : poseTransitionPhase === 1 ? transitionAImage
        : transitionBImage
    : poseTransition === 'to-sit'
      ? poseTransitionPhase === 0 ? crawlAImage
        : poseTransitionPhase === 1 ? transitionBImage
          : transitionAImage
      : petPose === 'sit'
        ? sitAImage
        : petFrame === 0 ? crawlAImage : crawlBImage
  const overlayStyle: CSSProperties | undefined = petPosition
    ? { left: `${petPosition.x}px`, top: `${petPosition.y}px`, right: 'auto', bottom: 'auto' }
    : undefined
  const detailPanelStyle: CSSProperties = { left: `${currentPanelPosition.x}px`, top: `${currentPanelPosition.y}px`, right: 'auto', bottom: 'auto' }
  const panelSide = currentPanelPosition.x > currentPetPosition.x ? 'right' : 'left'

  const acceptObservation = async (text: string, source?: string) => {
    const saved = await requestCapability({ operation: 'workspace.capture', text, ...(source ? { source } : {}) })
    const nextObservation: Observation = { ...saved.observation, isNew: true }
    traceSessionStore.observations = [nextObservation, ...traceSessionStore.observations]
    setObservations(traceSessionStore.observations)
    setFocusedObservationId(nextObservation.id)
    setDiscussionNotice('已接住：这条内容已保存到 Trace 桌面端。')
  }

  const submitQuickObservation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = quickDraft.trim()
    if (!text) return
    void acceptObservation(text, '桌宠快速输入').then(() => {
      setQuickDraft('')
      setQuickNotice('已接住，桌面端里也能看到。')
      window.setTimeout(() => setQuickNotice(''), 2400)
    }, (error) => setQuickNotice(error instanceof Error ? error.message : '暂时没有保存成功'))
  }

  const requestCapability = async (request: Record<string, unknown>) => {
    const bridge = getTraceNativeBridge()
    if (!bridge?.requestCapability) throw new Error('当前宿主没有连接 Trace Runtime。')
    return bridge.requestCapability(request)
  }

  const interactionFingerprint = (answers: Record<string, { answers: string[] }>) => JSON.stringify(
    Object.keys(answers).sort().map((questionId) => [questionId, answers[questionId]?.answers ?? []]),
  )

  const idempotencyKeyFor = (scope: string, fingerprint = '') => {
    const current = codexInteractionKeysRef.current.get(scope)
    if (current?.fingerprint === fingerprint) return current.key
    const key = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `trace-${Date.now()}-${Math.random().toString(36).slice(2)}`
    codexInteractionKeysRef.current.set(scope, { key, fingerprint })
    while (codexInteractionKeysRef.current.size > 32) {
      codexInteractionKeysRef.current.delete(codexInteractionKeysRef.current.keys().next().value as string)
    }
    return key
  }

  const decideCodexInteraction = async (decision: TraceCodexApprovalDecision) => {
    if (codexDecisionInFlightRef.current) return
    const interaction: TraceCodexInteraction | null = codexProjection.pendingInteraction
    if (!interaction) return
    if (interaction.kind !== 'approval') {
      if (decision !== 'cancel') {
        setCodexInteractionNotice('这类请求需要填写问题答案，Trace 不会把批准决定误当成输入。')
        return
      }
      if (!interaction.runId) {
        setCodexInteractionNotice('这条输入请求缺少可恢复的运行身份，Trace 没有猜测目标。')
        return
      }
      codexDecisionInFlightRef.current = true
      setCodexInteractionBusy(true)
      setCodexInteractionNotice('正在停止本轮运行…')
      try {
        await requestCapability({ operation: 'agent.run.cancel', runId: interaction.runId })
        setCodexInteractionNotice('已停止本轮运行。')
        const resolved = normalizeTraceCodexEvent({
          eventId: `${interaction.runId}:${interaction.interactionId}:cancel`,
          type: 'runtime.interaction.resolved',
          runId: interaction.runId,
          threadId: interaction.threadId || undefined,
          turnId: interaction.turnId || undefined,
          itemId: interaction.itemId || undefined,
          data: { state: 'cancelled', status: 'cancelled', interaction: { interactionId: interaction.interactionId } },
        })
        if (resolved) setCodexState((current) => reduceTraceCodexEvent(current, resolved))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setCodexInteractionNotice(/409|conflict|revision|stale|expired|already.?handled|已处理|版本/i.test(message)
          ? '这条输入请求已经结束或版本发生变化，请刷新当前状态。'
          : message)
      } finally {
        codexDecisionInFlightRef.current = false
        setCodexInteractionBusy(false)
      }
      return
    }
    if (!interaction.runId || interaction.expectedRevision === null) {
      setCodexInteractionNotice('这条审批缺少可恢复的运行版本，Trace 已保持拒绝。请重新打开当前 Codex 任务。')
      return
    }
    if (!interaction.recoverable) {
      setCodexInteractionNotice('这条审批已经过期或不可恢复，Trace 没有继续提交。')
      return
    }
    if (interaction.expiresAt !== null && interaction.expiresAt <= Date.now()) {
      setCodexInteractionNotice('这条审批已经过期，Trace 没有继续提交。请重新触发当前 Codex 操作。')
      return
    }
    codexDecisionInFlightRef.current = true
    setCodexInteractionBusy(true)
    setCodexInteractionNotice(
      decision === 'accept'
        ? '正在提交允许决定…'
        : decision === 'cancel'
          ? '正在提交停止本轮…'
          : '正在提交拒绝决定…',
    )
    const idempotencyScope = `${interaction.interactionId}:approval:${interaction.expectedRevision}:${decision}`
    const idempotencyKey = idempotencyKeyFor(idempotencyScope)
    try {
      await requestCapability({
        operation: 'agent.run.approval',
        runId: interaction.runId,
        interactionId: interaction.interactionId,
        expectedRevision: interaction.expectedRevision,
        idempotencyKey,
        decision,
      })
      setCodexInteractionNotice(
        decision === 'accept'
          ? '已允许这一次，正在继续。'
          : decision === 'cancel'
            ? '已停止本轮运行。'
            : '已拒绝这次操作，Agent 可以继续处理其它步骤。',
      )
      codexInteractionKeysRef.current.delete(idempotencyScope)
      // The runtime emits runtime.approval.resolved as the authoritative
      // event.  Optimistically clear only after the endpoint accepted the
      // idempotent decision; a later event can still move the session to a
      // terminal/review state without re-opening the prompt.
      const resolved = normalizeTraceCodexEvent({
        eventId: `${interaction.runId}:${interaction.interactionId}:${decision}`,
        type: 'runtime.approval.resolved',
        runId: interaction.runId,
        threadId: interaction.threadId || undefined,
        turnId: interaction.turnId || undefined,
        itemId: interaction.itemId || undefined,
        data: {
          interaction: { interactionId: interaction.interactionId },
          status: decision === 'accept' || decision === 'accept_for_session'
            ? 'accepted'
            : decision === 'cancel'
              ? 'cancelled'
              : 'declined',
        },
      })
      if (resolved) setCodexState((current) => reduceTraceCodexEvent(current, resolved))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setCodexInteractionNotice(/409|conflict|revision|stale|expired|already.?handled|已处理|版本/i.test(message)
        ? '这条审批已经被处理、过期或版本发生变化，请刷新当前状态。'
        : message)
    } finally {
      codexDecisionInFlightRef.current = false
      setCodexInteractionBusy(false)
    }
  }

  const submitCodexInput = async (answers: Record<string, { answers: string[] }>) => {
    if (codexDecisionInFlightRef.current) return
    const interaction: TraceCodexInteraction | null = codexProjection.pendingInteraction
    if (!interaction || interaction.kind !== 'input') return
    if (!interaction.runId || interaction.expectedRevision === null) {
      setCodexInteractionNotice('这条输入请求缺少可恢复的运行版本，Trace 没有猜测目标。')
      return
    }
    if (!interaction.recoverable || (interaction.expiresAt !== null && interaction.expiresAt <= Date.now())) {
      setCodexInteractionNotice('这条输入请求已经过期或不可恢复，请重新触发当前 Codex 操作。')
      return
    }
    codexDecisionInFlightRef.current = true
    setCodexInteractionBusy(true)
    setCodexInteractionNotice('正在提交回答…')
    const idempotencyScope = `${interaction.interactionId}:input:${interaction.expectedRevision}`
    const idempotencyKey = idempotencyKeyFor(idempotencyScope, interactionFingerprint(answers))
    try {
      await requestCapability({
        operation: 'agent.run.input',
        runId: interaction.runId,
        interactionId: interaction.interactionId,
        expectedRevision: interaction.expectedRevision,
        idempotencyKey,
        answers,
      })
      setCodexInteractionNotice('已提交回答，正在继续。')
      codexInteractionKeysRef.current.delete(idempotencyScope)
      const resolved = normalizeTraceCodexEvent({
        eventId: `${interaction.runId}:${interaction.interactionId}:input`,
        type: 'runtime.interaction.resolved',
        runId: interaction.runId,
        threadId: interaction.threadId || undefined,
        turnId: interaction.turnId || undefined,
        itemId: interaction.itemId || undefined,
        data: { state: 'resolved', status: 'resolved', interaction: { interactionId: interaction.interactionId } },
      })
      if (resolved) setCodexState((current) => reduceTraceCodexEvent(current, resolved))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setCodexInteractionNotice(/409|conflict|revision|stale|expired|already.?handled|已处理|版本/i.test(message)
        ? '这条输入请求已经被处理、过期或版本发生变化，请刷新当前状态。'
        : message)
    } finally {
      codexDecisionInFlightRef.current = false
      setCodexInteractionBusy(false)
    }
  }

  const continueDiscussion = () => {
    const observation = observations.find((item) => item.id === focusedObservationId) ?? observations[0]
    if (!observation) {
      setDiscussionNotice('没有找到可继续讨论的观察。')
      return
    }
    const desktopUrl = new URL('http://127.0.0.1:4173/')
    desktopUrl.searchParams.set('from', 'deepseek-harness')
    desktopUrl.searchParams.set('observationId', observation.id)
    desktopUrl.searchParams.set('text', observation.text)
    desktopUrl.searchParams.set('status', observation.status)
    desktopUrl.searchParams.set('source', observation.source ?? 'Trace 历史观察')

    const nativeBridge = getTraceNativeBridge()
    if (nativeBridge?.openDiscussion) {
      desktopUrl.searchParams.set('from', 'trace-native')
      nativeBridge.openDiscussion(desktopUrl.toString())
      setDiscussionNotice('正在打开原生 Trace 深度讨论窗口。')
      return
    }

    window.open(desktopUrl.toString(), 'trace-desktop-agent', 'popup,width=1440,height=900')
    setDiscussionNotice('正在打开 Trace 桌面 Agent；如果页面未加载，请先启动 desktop 开发服务。')
  }

  const clearPoseTransitionTimers = () => {
    poseTransitionTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    poseTransitionTimersRef.current = []
  }

  const startPoseTransition = (direction: PoseTransition, onComplete?: () => void) => {
    if (poseTransitionLockRef.current) return false
    poseTransitionLockRef.current = true
    clearPoseTransitionTimers()
    if (crawlTimerRef.current !== undefined) {
      window.clearTimeout(crawlTimerRef.current)
      crawlTimerRef.current = undefined
    }
    setCrawlRunning(false)
    setPetFrame(0)
    setPoseTransition(direction)
    setPoseTransitionPhase(0)

    const transitionA = window.setTimeout(() => setPoseTransitionPhase(1), 140)
    const transitionB = window.setTimeout(() => setPoseTransitionPhase(2), 280)
    const complete = window.setTimeout(() => {
      setPetPose(direction === 'to-crawl' ? 'crawl' : 'sit')
      setPetFrame(0)
      setPoseTransition(null)
      setPoseTransitionPhase(0)
      poseTransitionTimersRef.current = []
      poseTransitionLockRef.current = false
      onComplete?.()
    }, 420)
    poseTransitionTimersRef.current = [transitionA, transitionB, complete]
    return true
  }

  const showFan = (mode: 'quick' | 'bubbles' = 'quick') => {
    setCollapsing(false)
    setHugging(false)
    setCrawlRunning(false)
    setPetPose('crawl')
    setPetFrame(0)
    setSurfaceMode(mode)
    setOpen(true)
  }

  const settleToSit = (onComplete: () => void) => {
    if (poseTransitionLockRef.current) return false
    if (petPose === 'sit') {
      setCrawlRunning(false)
      setPetFrame(0)
      onComplete()
      return true
    }
    return startPoseTransition('to-sit', onComplete)
  }

  const collapseTrace = () => {
    if (!open || collapsing || poseTransitionLockRef.current) return
    setShowPanel(false)
    setPanelMode('compact')
    setSurfaceMode('quick')
    setPanelPosition(null)
    setCollapsing(true)
    const finishCollapse = () => {
      setOpen(false)
      setCollapsing(false)
      setPetPose('sit')
      setPetFrame(0)
    }
    if (petPose === 'crawl') {
      startPoseTransition('to-sit', finishCollapse)
      return
    }
    window.setTimeout(finishCollapse, 230)
  }

  const closePanelToFan = () => {
    if (poseTransitionLockRef.current) return
    const revealFan = () => {
      setShowPanel(false)
      setPanelMode('compact')
      setPanelPosition(null)
      showFan('bubbles')
    }
    if (petPose === 'crawl') {
      revealFan()
      return
    }
    startPoseTransition('to-crawl', revealFan)
  }

  const persistPetPosition = (position: PetPosition) => {
    const bridge = getTraceNativeBridge()
    if (!bridge?.savePlacement) return
    void Promise.resolve(bridge.savePlacement({
      x: position.x,
      y: position.y,
      placement: 'free',
      isFreelyPositioned: true,
    })).catch(() => {})
  }

  const handlePetPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || poseTransitionLockRef.current) return
    const rect = event.currentTarget.getBoundingClientRect()
    const origin = { x: rect.left, y: rect.top }
    petClickSideRef.current = event.clientX < rect.left + rect.width / 2 ? 'left' : 'right'
    setPetPosition(origin)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const handlePetPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) drag.moved = true
    if (!drag.moved) return
    setPetPosition(clampPetPosition({ x: drag.origin.x + deltaX, y: drag.origin.y + deltaY }, viewport))
    event.preventDefault()
  }

  const handlePetPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) suppressClickRef.current = true
    if (drag.moved) {
      const rect = event.currentTarget.getBoundingClientRect()
      persistPetPosition(clampPetPosition({ x: rect.left, y: rect.top }, viewport))
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
  }

  const handlePetClick = () => {
    if (poseTransitionLockRef.current) return
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (petClickTimerRef.current !== undefined) window.clearTimeout(petClickTimerRef.current)
    petClickTimerRef.current = window.setTimeout(() => {
      if (poseTransitionLockRef.current) return
      if (open) {
        collapseTrace()
      } else if (nativeCodexEventsEnabled && codexProjection.pendingInteraction) {
        // Waiting is an actionable pet state: a click opens the bounded
        // approval panel directly instead of routing through the quick box.
        openCapturePanel()
      } else {
        const direction = petClickSideRef.current
        const beginCrawlStep = () => {
          showFan()
          setCrawlRunning(true)
          setPetPosition((current) => {
            const origin = current ?? getDefaultPetPosition(viewport)
            return clampPetPosition({ x: origin.x + (direction === 'left' ? -70 : 70), y: origin.y }, viewport)
          })
          if (crawlTimerRef.current !== undefined) window.clearTimeout(crawlTimerRef.current)
          crawlTimerRef.current = window.setTimeout(() => {
            setCrawlRunning(false)
            crawlTimerRef.current = undefined
          }, 440)
        }
        // Turn before the intermediate frames begin, so scaleX consistently
        // applies to the complete sit → crawl bitmap sequence.
        setPetFacing(direction)
        if (petPose === 'sit') startPoseTransition('to-crawl', beginCrawlStep)
        else beginCrawlStep()
      }
      petClickTimerRef.current = undefined
    }, 240)
  }

  const handlePetDoubleClick = () => {
    if (poseTransitionLockRef.current) return
    if (petClickTimerRef.current !== undefined) window.clearTimeout(petClickTimerRef.current)
    petClickTimerRef.current = undefined
    if (crawlTimerRef.current !== undefined) window.clearTimeout(crawlTimerRef.current)
    crawlTimerRef.current = undefined
    openCapturePanel()
  }

  const openPanel = (observationId?: string) => {
    if (poseTransitionLockRef.current) return
    const showPanel = () => {
      setCollapsing(false)
      setHugging(false)
      setCrawlRunning(false)
      setPetPose('sit')
      setPetFrame(0)
      setOpen(true)
      setFocusedObservationId(observationId)
      setShowPanel(true)
      setPanelMode('compact')
      setPanelPosition(null)
    }
    settleToSit(showPanel)
  }

  const openCapturePanel = () => {
    openPanel()
  }

  const handleOrbitItem = (item: OrbitItem) => {
    if (item.kind === 'observation') {
      openPanel(item.observation.id)
      return
    }
    if (item.action === 'quick') {
      setSurfaceMode('quick')
      return
    }
    if (item.action === 'focus-first' && observations[0]) {
      openPanel(observations[0].id)
      return
    }
    openCapturePanel()
  }

  const handlePanelPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    panelDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: currentPanelPosition,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const handlePanelPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = panelDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const nextPosition = {
      x: drag.origin.x + event.clientX - drag.startX,
      y: drag.origin.y + event.clientY - drag.startY,
    }
    const wasDetached = distanceBetween(currentPanelPosition, defaultPanelPosition) > 170
    const becomesDetached = distanceBetween(nextPosition, defaultPanelPosition) > 170
    if (wasDetached && !becomesDetached) {
      setPanelPosition(null)
      setHugging(true)
      if (hugTimerRef.current !== undefined) window.clearTimeout(hugTimerRef.current)
      hugTimerRef.current = window.setTimeout(() => {
        setHugging(false)
        hugTimerRef.current = undefined
      }, 600)
    } else {
      setPanelPosition(clampPanelPosition(nextPosition, viewport, panelMode === 'compact'))
    }
    event.preventDefault()
  }

  const handlePanelPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = panelDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    panelDragRef.current = null
  }

  const openReminder = () => {
    if (!reminder) return
    openPanel(reminder.observationId)
    setReminder(null)
    setReminderSide(null)
  }

  const togglePanelMode = () => {
    setPanelMode((current) => current === 'compact' ? 'expanded' : 'compact')
    setPanelPosition(null)
  }

  return (
    <div className={`trace-overlay ${open ? 'trace-overlay-open' : ''} ${collapsing ? 'trace-overlay-collapsing' : ''} ${poseTransition ? 'trace-overlay-transitioning' : ''}`} style={overlayStyle}>
      {nativeCodexEventsEnabled && codexProjection.status !== 'idle' && !open && (
        <div
          className={`trace-codex-status trace-codex-status-${codexProjection.status}`}
          style={codexStatusStyle}
          data-trace-interactive-region="status"
          role="status"
          aria-live="polite"
        >
          <span className="trace-codex-status-kicker">Codex · {codexProjection.label}</span>
          <strong>{codexProjection.title}</strong>
          {codexProjection.detail && <small>{codexProjection.detail}</small>}
          {codexProjection.pendingInteraction && <button className="trace-codex-status-action" type="button" onClick={() => openCapturePanel()}>{codexProjection.pendingInteraction.kind === 'approval' ? '查看并决定' : '查看请求'}</button>}
        </div>
      )}
      {reminder && !open && (
        <div className={`trace-reminder-bubble trace-reminder-bubble-${reminderPlacement.side}`} style={reminderPlacement.style} data-trace-interactive-region="reminder" role="status">
          <span className="trace-reminder-cloud-bump" aria-hidden="true" />
          <span className="trace-reminder-bubbles" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <button className="trace-reminder-open" type="button" onClick={openReminder} aria-label="打开被提醒的观察">
            <span className="trace-reminder-kicker">Trace 提醒</span>
            <strong>{reminder.text}</strong>
          </button>
          <button className="trace-reminder-close" type="button" onClick={() => { setReminder(null); setReminderSide(null) }} aria-label="关闭本次提醒">×</button>
        </div>
      )}
      {open && (
        <button className="trace-gesture-backdrop" data-trace-interactive-region="backdrop" type="button" onClick={collapseTrace} aria-label="收回 Trace 卡片" />
      )}

      {open && !showPanel && surfaceMode === 'quick' && (
        <div
          className={`trace-quick-cluster trace-quick-cluster-${quickComposerPlacement.side}`}
          style={quickComposerPlacement.style}
          data-trace-interactive-region="quick"
          onClick={(event) => event.stopPropagation()}
        >
          <form className="trace-quick-composer" onSubmit={submitQuickObservation} aria-label="快速记录">
            <div className="trace-quick-composer-field">
              <span className="trace-quick-composer-status" aria-hidden="true" />
              <input
                value={quickDraft}
                onChange={(event) => setQuickDraft(event.target.value)}
                placeholder="写一句，回车接住"
                aria-label="快速记录此刻的想法"
                autoFocus
              />
            </div>
            <button className="trace-quick-submit" type="submit" disabled={!quickDraft.trim()} aria-label="接住这句话" title="接住这句话">
              <span aria-hidden="true">↑</span>
            </button>
            {quickNotice && <span className="trace-quick-notice" role="status">{quickNotice}</span>}
          </form>
          <div className="trace-quick-shortcuts" aria-label="Trace 快捷入口">
            <button className="trace-quick-bubbles" type="button" onClick={() => setSurfaceMode('bubbles')} aria-label="展开记忆气泡" title="记忆气泡">
              <span className="trace-quick-bubbles-icon" aria-hidden="true"><i /><i /><i /></span>
            </button>
            <button className="trace-quick-expand" type="button" onClick={openCapturePanel} aria-label="打开 Trace 悬浮窗" title="Trace 悬浮窗">
              <span className="trace-quick-window-icon" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      {open && !showPanel && surfaceMode === 'bubbles' && (
        <div className="trace-orbit-stage" data-trace-interactive-region="orbit" aria-label="Trace 历史观察卡片">
          {orbitItems.map((item, index) => {
            const position = orbitPositions[index]
            const brightnessClass = item.kind === 'observation'
              ? item.observation.isNew
                ? 'trace-orbit-item-level-2'
                : 'trace-orbit-item-level-3'
              : 'trace-orbit-item-level-1'
            const toneClass = item.kind === 'observation'
              ? item.observation.isNew ? 'trace-orbit-item-new' : 'trace-orbit-item-existing'
              : `trace-orbit-item-${item.tone}`
            const orbitStyle = {
              '--trace-orbit-x': `${position.x}px`,
              '--trace-orbit-y': `${position.y}px`,
              '--trace-orbit-rotate': `${position.rotate}deg`,
              '--trace-orbit-origin-x': `${position.originX}px`,
              '--trace-orbit-origin-y': `${position.originY}px`,
              '--trace-orbit-origin-rotate': `${position.originRotate}deg`,
              '--trace-orbit-delay': `${index * 40}ms`,
              '--trace-collapse-delay': `${(orbitItems.length - index - 1) * 40}ms`,
            } as CSSProperties
            return (
              <button
                className={`trace-orbit-item ${brightnessClass} ${toneClass} ${position.stacked ? 'trace-orbit-item-stacked' : ''}`}
                key={item.id}
                type="button"
                style={orbitStyle}
                onClick={() => handleOrbitItem(item)}
                aria-label={item.kind === 'observation' ? `打开观察：${item.observation.text}` : item.title}
              >
                {item.kind === 'observation' && item.observation.isNew && <span className="trace-new-orb-label">新想法</span>}
                {position.stackTop && (
                  <span className="trace-stack-summary" title={item.kind === 'observation' ? item.observation.text : item.title}>
                    {item.kind === 'observation' ? item.observation.text : item.title}
                  </span>
                )}
                <span className="trace-memory-card-body">
                  <span className="trace-memory-card-status">{item.kind === 'observation' ? item.observation.status : item.kicker}</span>
                  <strong>{item.kind === 'observation' ? item.observation.text : item.title}</strong>
                  <small>{item.kind === 'observation' ? item.observation.source ? `来源 ${item.observation.source}` : `置信度 ${item.observation.confidence}%` : item.detail}</small>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {showPanel && (
        <div className={`trace-detail-panel ${panelIsDetached ? 'trace-detail-panel-detached' : `trace-detail-panel-linked trace-detail-panel-side-${panelSide}`}`} style={detailPanelStyle} data-trace-interactive-region="panel" onClick={(event) => event.stopPropagation()}>
          <TracePanel
            observations={observations}
            focusedObservationId={focusedObservationId}
            onAccept={acceptObservation}
            onContinue={continueDiscussion}
            onClose={closePanelToFan}
            onToggleSize={togglePanelMode}
            discussionNotice={discussionNotice}
            onHeaderPointerDown={handlePanelPointerDown}
            onHeaderPointerMove={handlePanelPointerMove}
            onHeaderPointerUp={handlePanelPointerUp}
            compact={panelMode === 'compact'}
            capabilities={capabilities}
            onCapabilityRequest={requestCapability}
            codexProjection={codexProjection}
            onCodexDecision={decideCodexInteraction}
            onCodexInput={submitCodexInput}
            codexInteractionBusy={codexInteractionBusy}
            codexInteractionNotice={codexInteractionNotice}
          />
        </div>
      )}

      <button
        className={`trace-pet-button trace-pet-button-${petPose} trace-pet-button-frame-${petFrame} trace-pet-button-facing-${petFacing} ${poseTransition ? `trace-pet-button-transition-${poseTransition}` : ''} ${crawlRunning ? 'trace-pet-button-crawling' : ''} ${open ? 'trace-pet-button-active' : ''} ${panelIsDetached || (nativeCodexEventsEnabled && isPetWorking(codexProjection.status)) ? 'trace-pet-button-thinking' : ''} ${nativeCodexEventsEnabled ? `trace-pet-button-status-${codexProjection.status}` : ''} ${hugging ? 'trace-pet-button-hugging' : ''}`}
        data-trace-interactive-region="pet"
        type="button"
        disabled={Boolean(poseTransition)}
        onPointerDown={handlePetPointerDown}
        onPointerMove={handlePetPointerMove}
        onPointerUp={handlePetPointerUp}
        onPointerCancel={handlePetPointerUp}
        onClick={handlePetClick}
        onDoubleClick={handlePetDoubleClick}
        aria-expanded={open}
        aria-label={open ? '收回 Trace' : '打开 Trace'}
      >
        <span className="trace-pet-shadow" aria-hidden="true" />
        <span className="trace-pet-visual" data-pose={petPose} data-frame={petFrame} data-transition={poseTransition ?? 'none'}>
          <img className="trace-pet-image" src={petImage} alt="刘看山" />
        </span>
      </button>
    </div>
  )
}

/** Display-aware pet placement. Coordinates are screen/work-area coordinates
 * when persisted and viewport-local coordinates when handed to React. */

export type DisplayBounds = { x: number; y: number; width: number; height: number }
export type PetPlacementAnchor = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end' | 'free'
export type PetSize = { width: number; height: number }

export type PlacementRecord = {
  displayId: string
  displayBounds: DisplayBounds
  x: number
  y: number
  placement: PetPlacementAnchor
  isFreelyPositioned: boolean
  updatedAt: number
}

export type PetPlacementState = {
  version: 1
  displayId: string | null
  displayBounds: DisplayBounds | null
  byDisplayId: Record<string, PlacementRecord>
  byResolution: Record<string, PlacementRecord>
  placement: PlacementRecord | null
  isFreelyPositioned: boolean
}

function validNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
}

export function normalizeDisplayBounds(value: unknown): DisplayBounds | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (![raw.x, raw.y, raw.width, raw.height].every(validNumber)) return null
  if (Number(raw.width) <= 0 || Number(raw.height) <= 0 || Number(raw.width) > 100_000 || Number(raw.height) > 100_000) return null
  return { x: Number(raw.x), y: Number(raw.y), width: Number(raw.width), height: Number(raw.height) }
}

export function resolutionKey(bounds: DisplayBounds) {
  return `${Math.round(bounds.width)}x${Math.round(bounds.height)}`
}

function displayKey(displayId: unknown, bounds: DisplayBounds) {
  return typeof displayId === 'string' && displayId.trim() ? displayId.trim() : resolutionKey(bounds)
}

function validRecord(value: unknown): PlacementRecord | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const displayBounds = normalizeDisplayBounds(raw.displayBounds)
  if (!displayBounds || !validNumber(raw.x) || !validNumber(raw.y)) return null
  const anchor = ['top-start', 'top-end', 'bottom-start', 'bottom-end', 'free'].includes(String(raw.placement))
    ? raw.placement as PetPlacementAnchor
    : 'free'
  return {
    displayId: String(raw.displayId || displayKey(raw.displayId, displayBounds)),
    displayBounds,
    x: Number(raw.x),
    y: Number(raw.y),
    placement: anchor,
    isFreelyPositioned: raw.isFreelyPositioned !== false,
    updatedAt: validNumber(raw.updatedAt) ? Number(raw.updatedAt) : 0,
  }
}

export function createPlacementState(displayId: string, displayBounds: DisplayBounds): PetPlacementState {
  const bounds = normalizeDisplayBounds(displayBounds) ?? { x: 0, y: 0, width: 1280, height: 720 }
  return { version: 1, displayId: displayId || null, displayBounds: bounds, byDisplayId: {}, byResolution: {}, placement: null, isFreelyPositioned: false }
}

export function clampPlacement(record: PlacementRecord, workArea: DisplayBounds, petSize: PetSize): PlacementRecord {
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - petSize.width)
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - petSize.height)
  return {
    ...record,
    displayBounds: workArea,
    x: Math.min(Math.max(workArea.x, record.x), maxX),
    y: Math.min(Math.max(workArea.y, record.y), maxY),
  }
}

export function recordPlacement(state: PetPlacementState, input: PlacementRecord): PetPlacementState {
  const record = validRecord(input)
  if (!record) return state
  const key = displayKey(record.displayId, record.displayBounds)
  return {
    version: 1,
    displayId: record.displayId,
    displayBounds: record.displayBounds,
    byDisplayId: { ...state.byDisplayId, [key]: record },
    byResolution: { ...state.byResolution, [resolutionKey(record.displayBounds)]: record },
    placement: record,
    isFreelyPositioned: record.isFreelyPositioned,
  }
}

export function restorePlacement(state: unknown, displayId: string, displayBounds: DisplayBounds, petSize: PetSize): PlacementRecord | null {
  const bounds = normalizeDisplayBounds(displayBounds)
  if (!bounds || !state || typeof state !== 'object') return null
  const raw = state as Partial<PetPlacementState>
  const byDisplay = raw.byDisplayId && typeof raw.byDisplayId === 'object' ? raw.byDisplayId as Record<string, unknown> : {}
  const byResolution = raw.byResolution && typeof raw.byResolution === 'object' ? raw.byResolution as Record<string, unknown> : {}
  const candidate = validRecord(byDisplay[displayId])
    ?? validRecord(byResolution[resolutionKey(bounds)])
    ?? validRecord(raw.placement)
  if (!candidate) return null
  const sourceBounds = candidate.displayBounds
  const sourceX = candidate.x - sourceBounds.x
  const sourceY = candidate.y - sourceBounds.y
  const xRatio = sourceBounds.width > 0 ? sourceX / sourceBounds.width : 0.5
  const yRatio = sourceBounds.height > 0 ? sourceY / sourceBounds.height : 0.5
  const sameResolution = sourceBounds.width === bounds.width && sourceBounds.height === bounds.height
  const translated = {
    ...candidate,
    displayId,
    displayBounds: bounds,
    x: bounds.x + (sameResolution ? sourceX : xRatio * bounds.width),
    y: bounds.y + (sameResolution ? sourceY : yRatio * bounds.height),
  }
  return clampPlacement(translated, bounds, petSize)
}

/** Accepts the old single-position shape and produces the versioned skeleton. */
export function migratePlacement(value: unknown, displayId: string, displayBounds: DisplayBounds, now = Date.now()): PetPlacementState {
  const state = createPlacementState(displayId, displayBounds)
  if (!value || typeof value !== 'object') return state
  const raw = value as Record<string, unknown>
  const oldBounds = normalizeDisplayBounds(raw.displayBounds) ?? normalizeDisplayBounds(displayBounds)
  if (!oldBounds || !validNumber(raw.x) || !validNumber(raw.y)) return state
  return recordPlacement(state, {
    displayId,
    displayBounds: oldBounds,
    x: Number(raw.x),
    y: Number(raw.y),
    placement: 'free',
    isFreelyPositioned: raw.isFreelyPositioned !== false,
    updatedAt: validNumber(raw.updatedAt) ? Number(raw.updatedAt) : now,
  })
}

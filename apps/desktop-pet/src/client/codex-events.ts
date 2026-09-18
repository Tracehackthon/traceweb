/**
 * The desktop pet is a projection of an existing Codex/Trace session.  This
 * module intentionally contains no agent runner and no transport code: the
 * native bridge supplies already-authorised events and the reducer turns them
 * into a small, privacy-bounded visual state.
 */

export const TRACE_CODEX_EVENT_KINDS = [
  'run.queued',
  'run.running',
  'run.succeeded',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.stale',
  'run.timed_out',
  'run.interrupted',
  'runtime.connected',
  'runtime.item',
  'runtime.approval.required',
  'runtime.input.required',
  'runtime.interaction.resolved',
  'runtime.approval.resolved',
  'runtime.input.resolved',
  'thread.started',
  'thread.updated',
  'turn.started',
  'turn.updated',
  'turn.completed',
  'turn.failed',
  'turn.cancelled',
  'item.started',
  'item.updated',
  'item.completed',
  'item.failed',
  'session.updated',
] as const

export type TraceCodexEventKind = typeof TRACE_CODEX_EVENT_KINDS[number]

export type TraceCodexItemType =
  | 'reasoning'
  | 'command_execution'
  | 'file_change'
  | 'mcp_tool_call'
  | 'web_search'
  | 'dynamic_tool_call'
  | 'agent_message'
  | 'user_input'
  | 'approval'
  | 'plan'

export type TraceCodexEventStatus = 'in_progress' | 'completed' | 'failed' | 'waiting' | 'cancelled'

export type TraceCodexApprovalDecision = 'accept' | 'accept_for_session' | 'decline' | 'cancel'

export type TraceCodexInputQuestion = {
  id: string
  header: string
  question: string
  isSecret: boolean
  optionCount: number
}

/**
 * A runtime interaction is the only identity the approval bridge is allowed
 * to send back.  The renderer never receives a Codex RPC id or a raw request
 * object; those stay inside trace-runtime.  `interactionId` is intentionally
 * opaque and is only used to correlate the user's explicit decision.
 */
export type TraceCodexInteraction = {
  interactionId: string
  requestId: string | null
  runId: string | null
  threadId: string | null
  turnId: string | null
  itemId: string | null
  kind: 'approval' | 'input'
  method: string
  title: string
  summary: string
  impact: string
  state: 'waiting' | 'submitting' | 'accepted' | 'declined' | 'cancelled' | 'expired' | 'conflict' | 'unavailable'
  recoverable: boolean
  expectedRevision: number | null
  expiresAt: number | null
  questions?: TraceCodexInputQuestion[]
}

export type TraceCodexEvent = {
  eventId?: string
  sequence?: number
  at?: number
  threadId: string
  turnId?: string | null
  itemId?: string | null
  runId?: string | null
  requestId?: string | null
  kind: TraceCodexEventKind
  itemType?: TraceCodexItemType | null
  status?: TraceCodexEventStatus | null
  title?: string
  detail?: string
  requiresUserInput?: boolean
  interaction?: TraceCodexInteraction | null
}

export type TraceCodexStatus =
  | 'idle'
  | 'thinking'
  | 'running-command'
  | 'editing'
  | 'searching'
  | 'waiting'
  | 'review'
  | 'failed'

export type TraceCodexActiveItem = {
  itemId: string | null
  itemType: TraceCodexItemType | null
  title: string
  detail: string
  status: TraceCodexEventStatus | null
}

export type TraceCodexSession = {
  threadId: string
  runId: string | null
  turnId: string | null
  status: TraceCodexStatus
  activeItem: TraceCodexActiveItem | null
  latestEventAt: number
  latestEventId: string | null
  terminal: boolean
  unread: boolean
  pendingInteraction: TraceCodexInteraction | null
}

export type TraceCodexState = {
  sessions: Record<string, TraceCodexSession>
  order: string[]
  /** Bounded event identities. This is intentionally part of the reducer state. */
  seenEventKeys: string[]
  lastEventAt: number
  revision: number
}

export type PetProjection = {
  status: TraceCodexStatus
  label: string
  title: string
  detail: string
  threadId: string | null
  turnId: string | null
  itemId: string | null
  terminal: boolean
  unread: boolean
  activeTaskCount: number
  updatedAt: number | null
  pendingInteraction: TraceCodexInteraction | null
}

const MAX_SEEN_EVENTS = 512
const MAX_DISPLAY_TEXT = 160

export const TRACE_CODEX_STATUS_LABELS: Record<TraceCodexStatus, string> = {
  idle: '待机',
  thinking: '思考中',
  'running-command': '执行命令',
  editing: '修改文件',
  searching: '搜索中',
  waiting: '等待确认',
  review: '需要回顾',
  failed: '运行失败',
}

function text(value: unknown, limit = MAX_DISPLAY_TEXT) {
  if (typeof value !== 'string') return ''
  // Do not surface raw command output, absolute paths or common credentials in
  // a persistent always-on-top overlay. The full event remains in the runtime.
  return value
    .replace(/(?:[A-Za-z]:[\\/]|\\\\|\/Users\/|\/home\/|\/private\/|\/tmp\/)[^\s"'<>]{1,240}/g, '<path>')
    .replace(/\b(?:sk|gh[pousr]|xox[baprs])_[A-Za-z0-9_-]{8,}\b/g, '<secret>')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi, 'Bearer <secret>')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, limit)
}

function approvalText(value: unknown, limit = 240) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/(?:[A-Za-z]:[\\/]|\\\\|\/Users\/|\/home\/|\/private\/|\/tmp\/|\/var\/)[^\s"'<>]{1,240}/g, '<项目路径>')
    .replace(/\b(?:sk|gh[pousr]|xox[baprs])_[A-Za-z0-9_-]{8,}\b/g, '<敏感信息>')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi, 'Bearer <敏感信息>')
    .replace(/(?:token|secret|access[_ -]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=<敏感信息>')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, limit)
}

function id(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512
    ? value.trim()
    : ''
}

function eventKind(value: unknown): TraceCodexEventKind | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/[/:]/g, '.')
  return (TRACE_CODEX_EVENT_KINDS as readonly string[]).includes(normalized)
    ? normalized as TraceCodexEventKind
    : null
}

function interactionKind(value: unknown): TraceCodexInteraction['kind'] {
  const normalized = typeof value === 'string' ? value.toLowerCase().replace(/[ -]/g, '_') : ''
  return normalized.includes('input') || normalized.includes('elicitation') ? 'input' : 'approval'
}

function interactionState(value: unknown): TraceCodexInteraction['state'] {
  const normalized = typeof value === 'string' ? value.toLowerCase().replace(/[ -]/g, '_') : ''
  if (normalized === 'accepted' || normalized === 'accept') return 'accepted'
  if (normalized === 'declined' || normalized === 'decline' || normalized === 'rejected' || normalized === 'reject') return 'declined'
  if (normalized === 'cancelled' || normalized === 'cancel') return 'cancelled'
  if (normalized === 'expired' || normalized === 'timeout' || normalized === 'timed_out') return 'expired'
  if (normalized === 'conflict') return 'conflict'
  if (normalized === 'unavailable') return 'unavailable'
  if (normalized === 'submitting') return 'submitting'
  return 'waiting'
}

function interactionFromRaw(raw: Record<string, unknown>, nested: Record<string, unknown>, eventId: string | null, runId: string | null, threadId: string | null, turnId: string | null, itemId: string | null, kind: TraceCodexInteraction['kind']): TraceCodexInteraction | null {
  // Runtime approval identity may be exposed as `data.interaction` on the
  // event or as `runtime.pendingInteraction` on a run snapshot.  Both are
  // opaque runtime-owned records; only the bounded presentation fields below
  // cross into the renderer.
  const runtime = nested.runtime && typeof nested.runtime === 'object' ? nested.runtime as Record<string, unknown> : {}
  const pending = nested.pendingInteraction && typeof nested.pendingInteraction === 'object'
    ? nested.pendingInteraction
    : runtime.pendingInteraction && typeof runtime.pendingInteraction === 'object'
      ? runtime.pendingInteraction
      : null
  const source = (nested.interaction && typeof nested.interaction === 'object'
    ? nested.interaction
    : pending || nested) as Record<string, unknown>
  const interactionId = id(source.interactionId ?? source.interaction_id ?? source.requestId ?? source.request_id ?? source.approvalId ?? source.approval_id ?? raw.interactionId ?? raw.requestId ?? eventId)
  if (!interactionId) return null
  const method = approvalText(source.method ?? source.kind ?? nested.method ?? raw.method, 96) || (kind === 'input' ? 'user_input' : 'approval')
  const rawImpact = source.impactSummary ?? source.impact_summary ?? source.commandSummary ?? source.command_summary ?? source.fileChangeSummary ?? source.file_change_summary ?? source.command ?? source.reason ?? source.message
  const summary = approvalText(source.summary ?? source.title ?? source.reason ?? nested.summary ?? raw.title, 180)
  const commandActions = Array.isArray(source.commandActions) ? source.commandActions : []
  const fileChanges = Array.isArray(source.fileChanges) ? source.fileChanges : []
  const impactParts = []
  if (typeof rawImpact === 'string') {
    const safeImpact = approvalText(rawImpact, 260)
    if (safeImpact) impactParts.push(safeImpact)
  }
  if (commandActions.length) impactParts.push(`读取或搜索 ${Math.min(commandActions.length, 32)} 项项目内容`)
  if (fileChanges.length) impactParts.push(`涉及 ${Math.min(fileChanges.length, 32)} 个项目文件`)
  if (source.permissions && typeof source.permissions === 'object') impactParts.push('申请本次运行所需的项目权限')
  const network = source.network && typeof source.network === 'object' ? source.network as Record<string, unknown> : null
  const networkHost = network && typeof network.host === 'string'
    ? network.host
    : ''
  if (networkHost) impactParts.push(`连接 ${approvalText(networkHost, 96)}`)
  const impact = impactParts.join('；')
  const questions = Array.isArray(source.questions)
    ? source.questions.slice(0, 16).flatMap((question): TraceCodexInputQuestion[] => {
      if (!question || typeof question !== 'object') return []
      const item = question as Record<string, unknown>
      const questionId = id(item.id ?? item.questionId ?? item.question_id)
      if (!questionId) return []
      return [{
        id: questionId,
        header: approvalText(item.header, 120),
        question: approvalText(item.question, 500),
        isSecret: item.isSecret === true || item.is_secret === true,
        optionCount: Number.isSafeInteger(item.optionCount) && Number(item.optionCount) >= 0 ? Number(item.optionCount) : 0,
      }]
    })
    : []
  const expiresAt = source.expiresAt ?? source.expires_at
  const expires = typeof expiresAt === 'number' && Number.isFinite(expiresAt)
    ? (expiresAt > 10_000_000_000 ? expiresAt : expiresAt * 1000)
    : typeof expiresAt === 'string' && Number.isFinite(Date.parse(expiresAt))
      ? Date.parse(expiresAt)
      : null
  const revision = source.expectedRevision ?? source.expected_revision ?? source.revision
    ?? nested.expectedRevision ?? nested.expected_revision ?? nested.revision
    ?? raw.expectedRevision ?? raw.expected_revision ?? raw.revision
  const resolvedState = expires !== null && expires <= Date.now() ? 'expired' : interactionState(source.state ?? nested.state ?? raw.status)
  return {
    interactionId,
    requestId: id(source.requestId ?? source.request_id ?? nested.requestId ?? nested.request_id ?? raw.requestId ?? raw.request_id) || null,
    runId: id(source.runId ?? source.run_id ?? nested.runId ?? nested.run_id ?? runtime.runId ?? raw.runId) || runId,
    threadId: id(source.threadId ?? source.thread_id ?? nested.threadId ?? nested.thread_id ?? runtime.threadId ?? raw.threadId) || threadId,
    turnId: id(source.turnId ?? source.turn_id ?? nested.turnId ?? nested.turn_id ?? runtime.turnId ?? raw.turnId) || turnId,
    itemId: id(source.itemId ?? source.item_id ?? nested.itemId ?? nested.item_id ?? runtime.itemId ?? raw.itemId) || itemId,
    kind,
    method,
    title: summary || (kind === 'input'
      ? 'Codex 需要你的输入'
      : method.includes('fileChange') || fileChanges.length ? 'Codex 请求修改项目文件'
        : method.includes('permission') || source.permissions ? 'Codex 请求访问项目权限'
          : 'Codex 请求一次确认'),
    summary: summary || (kind === 'input' ? '请检查问题后再继续' : '请检查这次操作的影响后再继续'),
    impact: impact || 'Trace 没有收到可展示的影响摘要，请在 Codex 中查看详情。',
    state: resolvedState,
    recoverable: source.recoverable !== false && nested.recoverable !== false && resolvedState !== 'expired',
    expectedRevision: Number.isSafeInteger(revision)
      ? Number(revision)
      : null,
    expiresAt: expires,
    ...(questions.length ? { questions } : {}),
  }
}

function itemType(value: unknown): TraceCodexItemType | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/[ -]/g, '_')
  const allowed: readonly string[] = [
    'reasoning', 'command_execution', 'file_change', 'mcp_tool_call',
    'web_search', 'dynamic_tool_call', 'agent_message', 'user_input',
    'approval', 'plan',
  ]
  return allowed.includes(normalized) ? normalized as TraceCodexItemType : null
}

function eventStatus(value: unknown): TraceCodexEventStatus | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/[- ]/g, '_')
  if (normalized === 'inprogress') return 'in_progress'
  return ['in_progress', 'completed', 'failed', 'waiting', 'cancelled'].includes(normalized)
    ? normalized as TraceCodexEventStatus
    : null
}

function runKindStatus(kind: TraceCodexEventKind | null): TraceCodexEventStatus | null {
  if (kind === 'run.queued' || kind === 'run.running') return 'in_progress'
  if (kind === 'run.succeeded' || kind === 'run.completed') return 'completed'
  if (kind === 'run.cancelled') return 'cancelled'
  if (kind === 'run.failed' || kind === 'run.stale' || kind === 'run.timed_out' || kind === 'run.interrupted') return 'failed'
  return null
}

function finiteTime(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 10_000_000_000 ? value : value * 1000
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return Date.now()
}

/**
 * Accepts the small bridge contract as well as the field naming used by the
 * Codex app-server/Trace host adapters. Unknown or incomplete events are
 * rejected rather than becoming a fabricated pet state.
 */
export function normalizeTraceCodexEvent(input: unknown): TraceCodexEvent | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const nested = raw.data && typeof raw.data === 'object' ? raw.data as Record<string, unknown> : raw
  const runtime = raw.runtime && typeof raw.runtime === 'object' ? raw.runtime as Record<string, unknown> : (nested.runtime && typeof nested.runtime === 'object' ? nested.runtime as Record<string, unknown> : {})
  const sourceRunId = id(raw.runId ?? raw.run_id ?? nested.runId ?? nested.run_id)
  const thread = raw.threadId ?? raw.thread_id ?? nested.threadId ?? nested.thread_id ?? runtime.threadId ?? runtime.thread_id ?? (raw.thread as Record<string, unknown> | undefined)?.id
  // A run event can arrive before Codex has emitted runtime.connected. Keep a
  // stable temporary session keyed by runId rather than dropping the event.
  const threadId = id(thread) || (sourceRunId ? `run:${sourceRunId}` : '')
  if (!threadId) return null

  const kind = eventKind(raw.kind ?? raw.type ?? raw.event ?? raw.name)
    ?? (nested.status !== undefined || raw.status !== undefined ? 'session.updated' : null)
  if (!kind) return null

  const turnId = id(raw.turnId ?? raw.turn_id ?? nested.turnId ?? nested.turn_id ?? (raw.turn as Record<string, unknown> | undefined)?.id) || null
  const itemId = id(raw.itemId ?? raw.item_id ?? nested.itemId ?? nested.item_id ?? (raw.item as Record<string, unknown> | undefined)?.id) || null
  const normalizedStatus = eventStatus(raw.status ?? nested.status ?? (raw.item as Record<string, unknown> | undefined)?.status) ?? runKindStatus(kind)
  const rawAt = raw.at ?? raw.timestamp ?? raw.createdAt ?? raw.created_at ?? raw.updatedAt ?? raw.updated_at ?? nested.at ?? nested.timestamp
  const sequence = Number.isSafeInteger(raw.sequence) && Number(raw.sequence) >= 0 ? Number(raw.sequence) : undefined
  const eventId = id(raw.eventId ?? raw.event_id) || (sourceRunId && sequence !== undefined ? `${sourceRunId}:${sequence}` : id(raw.id))
  const rawItem = nested.item && typeof nested.item === 'object' ? nested.item as Record<string, unknown> : (raw.item && typeof raw.item === 'object' ? raw.item as Record<string, unknown> : {})
  const rawInteraction = nested.interaction && typeof nested.interaction === 'object'
    ? nested.interaction as Record<string, unknown>
    : nested.pendingInteraction && typeof nested.pendingInteraction === 'object'
      ? nested.pendingInteraction as Record<string, unknown>
      : runtime.pendingInteraction && typeof runtime.pendingInteraction === 'object'
        ? runtime.pendingInteraction as Record<string, unknown>
        : {}
  const normalizedItemType = itemType(raw.itemType ?? raw.item_type ?? nested.itemType ?? nested.item_type ?? rawItem.type)
  const interactionType = kind === 'runtime.input.required' ? 'input' : kind === 'runtime.approval.required' ? 'approval' : null
  const interaction = interactionType ? interactionFromRaw(raw, nested, eventId, sourceRunId, threadId, turnId, itemId, interactionType) : null
  const normalized: TraceCodexEvent = {
    ...(eventId ? { eventId } : {}),
    ...(sequence === undefined ? {} : { sequence }),
    at: finiteTime(rawAt),
    threadId,
    turnId,
    itemId,
    ...(sourceRunId ? { runId: sourceRunId } : {}),
    ...(id(raw.requestId ?? raw.request_id ?? nested.requestId ?? nested.request_id ?? rawInteraction.requestId ?? rawInteraction.request_id) ? { requestId: id(raw.requestId ?? raw.request_id ?? nested.requestId ?? nested.request_id ?? rawInteraction.requestId ?? rawInteraction.request_id) } : {}),
    kind,
    itemType: normalizedItemType || (interactionType === 'input' ? 'user_input' : interactionType === 'approval' ? 'approval' : itemType(nested.kind)),
    status: normalizedStatus,
    title: text(raw.title ?? raw.label ?? nested.title ?? nested.label ?? nested.summary ?? rawItem.title),
    detail: text(raw.detail ?? raw.message ?? raw.description ?? nested.detail ?? nested.message ?? rawItem.detail),
    requiresUserInput: raw.requiresUserInput === true || raw.requires_user_input === true || nested.requiresUserInput === true || nested.requires_user_input === true || normalizedStatus === 'waiting' || interactionType !== null,
    ...(interaction ? { interaction } : {}),
  }
  return normalized
}

export function createInitialTraceCodexState(): TraceCodexState {
  return { sessions: {}, order: [], seenEventKeys: [], lastEventAt: 0, revision: 0 }
}

function identityKey(event: TraceCodexEvent) {
  // The stable unit is thread + turn + item. Kind/status form the phase so an
  // item.updated(in_progress) is not mistaken for item.completed. When the
  // upstream adapter supplies an eventId it is the stronger replay key;
  // otherwise replays of the same phase remain idempotent.
  if (event.eventId) return `event\u001f${event.eventId}`
  return [event.threadId, event.turnId ?? '', event.itemId ?? '', event.kind, event.status ?? '', event.itemType ?? ''].join('\u001f')
}

function itemStatusToPetStatus(event: TraceCodexEvent): TraceCodexStatus {
  if (event.requiresUserInput || event.status === 'waiting' || event.itemType === 'approval' || event.itemType === 'user_input') return 'waiting'
  if (event.status === 'failed' || event.kind === 'item.failed') return 'failed'
  if (event.itemType === 'command_execution') return 'running-command'
  if (event.itemType === 'file_change') return 'editing'
  if (event.itemType === 'web_search') return 'searching'
  return 'thinking'
}

function sessionFor(state: TraceCodexState, event: TraceCodexEvent): TraceCodexSession {
  return state.sessions[event.threadId] ?? {
    threadId: event.threadId,
    runId: event.runId ?? null,
    turnId: event.turnId ?? null,
    status: 'idle',
    activeItem: null,
    latestEventAt: 0,
    latestEventId: null,
    terminal: false,
    unread: false,
    pendingInteraction: null,
  }
}

function updateOrder(order: string[], threadId: string) {
  return [threadId, ...order.filter((value) => value !== threadId)]
}

/** Apply one event synchronously. Terminal events are never delayed here. */
export function reduceTraceCodexEvent(state: TraceCodexState, event: TraceCodexEvent): TraceCodexState {
  let normalized = normalizeTraceCodexEvent(event)
  if (!normalized) return state
  // Early run.* frames do not carry a native thread id. They are temporarily
  // keyed as run:<id>; once runtime.connected/approval supplies the real
  // thread, migrate that temporary session so a later run.succeeded frame
  // cannot leave the visible approval session stuck in waiting.
  const eventRunId = normalized.runId
  const temporaryThreadId = eventRunId ? `run:${eventRunId}` : null
  const knownThread = eventRunId
    ? Object.values(state.sessions).find((session) => session.runId === eventRunId && session.threadId !== temporaryThreadId)
    : undefined
  let workingState = state
  if (knownThread && normalized.threadId === temporaryThreadId) {
    normalized = { ...normalized, threadId: knownThread.threadId }
  } else if (temporaryThreadId && normalized.threadId !== temporaryThreadId && state.sessions[temporaryThreadId]) {
    const temporary = state.sessions[temporaryThreadId]
    const existing = state.sessions[normalized.threadId]
    const migrated: TraceCodexSession = {
      ...(existing ?? temporary),
      ...(existing ? {} : { threadId: normalized.threadId }),
      runId: normalized.runId ?? existing?.runId ?? temporary.runId,
      pendingInteraction: existing?.pendingInteraction ?? temporary.pendingInteraction,
      latestEventAt: Math.max(existing?.latestEventAt ?? 0, temporary.latestEventAt),
    }
    const sessions = { ...state.sessions, [normalized.threadId]: migrated }
    delete sessions[temporaryThreadId]
    workingState = {
      ...state,
      sessions,
      order: [normalized.threadId, ...state.order.filter((id) => id !== temporaryThreadId && id !== normalized?.threadId)],
    }
  }
  const key = identityKey(normalized)
  if (workingState.seenEventKeys.includes(key)) return workingState

  const previous = sessionFor(workingState, normalized)
  if (previous.terminal
    && previous.turnId === (normalized.turnId ?? previous.turnId)
    && normalized.kind !== 'thread.started'
    && normalized.kind !== 'turn.started'
    && normalized.kind !== 'run.queued'
    && normalized.kind !== 'run.running'
    && normalized.kind !== 'runtime.interaction.resolved'
    && normalized.kind !== 'runtime.approval.resolved'
    && normalized.kind !== 'runtime.input.resolved') {
    // A late progress frame must not reopen a completed/failed turn. A new
    // turn.started is the explicit boundary that clears the terminal latch.
    // Preserve a possible run:<id> → native thread migration performed above.
    // Returning the pre-migration state here would resurrect the temporary
    // session on the next event and could leave the real session out of sync.
    return workingState
  }
  const next: TraceCodexSession = {
    ...previous,
    runId: normalized.runId ?? previous.runId,
    turnId: normalized.turnId ?? previous.turnId,
    latestEventAt: Math.max(previous.latestEventAt, normalized.at ?? Date.now()),
    latestEventId: normalized.eventId ?? previous.latestEventId,
  }

  if (normalized.kind === 'thread.started' || normalized.kind === 'turn.started' || normalized.kind === 'turn.updated') {
    next.status = 'thinking'
    next.terminal = false
    next.unread = false
  }

  if (normalized.kind === 'run.queued' || normalized.kind === 'run.running') {
    next.status = 'thinking'
    next.terminal = false
    next.unread = false
  }

  if (normalized.kind === 'run.succeeded' || normalized.kind === 'run.completed') {
    next.status = 'review'
    next.activeItem = null
    next.pendingInteraction = null
    next.terminal = true
    next.unread = true
  }

  if (normalized.kind === 'run.failed' || normalized.kind === 'run.stale' || normalized.kind === 'run.timed_out' || normalized.kind === 'run.interrupted' || normalized.kind === 'run.cancelled') {
    next.status = 'failed'
    next.activeItem = null
    next.pendingInteraction = null
    next.terminal = true
    next.unread = true
  }

  if (normalized.kind === 'item.started' || normalized.kind === 'item.updated' || normalized.kind === 'item.failed') {
    next.status = itemStatusToPetStatus(normalized)
    next.terminal = normalized.status === 'failed'
    next.unread = false
    next.activeItem = {
      itemId: normalized.itemId ?? null,
      itemType: normalized.itemType ?? null,
      title: normalized.title || (normalized.itemType ? normalized.itemType.replace(/_/g, ' ') : '正在处理'),
      detail: normalized.detail ?? '',
      status: normalized.status ?? 'in_progress',
    }
  }

  if (normalized.kind === 'runtime.connected' || normalized.kind === 'runtime.item') {
    next.status = normalized.itemType ? itemStatusToPetStatus(normalized) : 'thinking'
    next.terminal = false
    next.unread = false
    if (normalized.itemId || normalized.title || normalized.detail) next.activeItem = {
      itemId: normalized.itemId ?? null,
      itemType: normalized.itemType ?? null,
      title: normalized.title || 'Codex 正在处理',
      detail: normalized.detail ?? '',
      status: normalized.status ?? 'in_progress',
    }
  }

  if (normalized.kind === 'runtime.approval.required' || normalized.kind === 'runtime.input.required') {
    next.status = 'waiting'
    next.terminal = false
    next.unread = true
    next.pendingInteraction = normalized.interaction ?? next.pendingInteraction
    next.activeItem = {
      itemId: normalized.itemId ?? normalized.interaction?.itemId ?? null,
      itemType: normalized.itemType ?? (normalized.kind === 'runtime.input.required' ? 'user_input' : 'approval'),
      title: normalized.interaction?.title || normalized.title || (normalized.kind === 'runtime.input.required' ? 'Codex 需要你的输入' : 'Codex 等待确认'),
      detail: normalized.interaction?.impact || normalized.detail || '',
      status: 'waiting',
    }
  }

  if (normalized.kind === 'runtime.interaction.resolved' || normalized.kind === 'runtime.approval.resolved' || normalized.kind === 'runtime.input.resolved') {
    next.pendingInteraction = null
    if (normalized.status === 'cancelled') {
      next.status = 'failed'
      next.terminal = true
      next.unread = true
    } else if (!next.terminal) {
      next.status = 'thinking'
      next.unread = false
    }
  }

  if (normalized.kind === 'item.completed') {
    next.activeItem = null
    next.status = 'thinking'
    next.terminal = false
  }

  if (normalized.kind === 'session.updated') {
    if (normalized.status === 'failed') next.status = 'failed'
    else if (normalized.status === 'waiting' || normalized.requiresUserInput) next.status = 'waiting'
    else if (normalized.status === 'completed') next.status = 'review'
    else if (normalized.status === 'in_progress') next.status = next.activeItem ? itemStatusToPetStatus(normalized) : 'thinking'
    next.terminal = normalized.status === 'completed' || normalized.status === 'failed'
    next.unread = next.terminal
  }

  if (normalized.kind === 'turn.completed') {
    next.status = 'review'
    next.activeItem = null
    next.terminal = true
    next.unread = true
  }
  if (normalized.kind === 'turn.failed' || normalized.kind === 'turn.cancelled') {
    next.status = 'failed'
    next.activeItem = null
    next.terminal = true
    next.unread = true
  }

  const seenEventKeys = [...workingState.seenEventKeys, key].slice(-MAX_SEEN_EVENTS)
  return {
    sessions: { ...workingState.sessions, [normalized.threadId]: next },
    order: updateOrder(workingState.order, normalized.threadId),
    seenEventKeys,
    lastEventAt: Math.max(workingState.lastEventAt, normalized.at ?? Date.now()),
    revision: workingState.revision + 1,
  }
}

function sessionProjection(session: TraceCodexSession): PetProjection {
  const item = session.activeItem
  const title = item?.title || (session.status === 'review' ? 'Codex 已完成一轮工作' : session.status === 'failed' ? 'Codex 这轮工作没有完成' : 'Codex 正在接住这件事')
  return {
    status: session.status,
    label: TRACE_CODEX_STATUS_LABELS[session.status],
    title: text(title) || TRACE_CODEX_STATUS_LABELS[session.status],
    detail: text(item?.detail || ''),
    threadId: session.threadId,
    turnId: session.turnId,
    itemId: item?.itemId ?? null,
    terminal: session.terminal,
    unread: session.unread,
    activeTaskCount: session.status === 'idle' || session.terminal ? 0 : 1,
    updatedAt: session.latestEventAt || null,
    pendingInteraction: session.pendingInteraction,
  }
}

export function projectTraceCodexState(state: TraceCodexState, activeThreadId?: string): PetProjection {
  const candidates = activeThreadId && state.sessions[activeThreadId]
    ? [state.sessions[activeThreadId]]
    : state.order.map((threadId) => state.sessions[threadId]).filter(Boolean)
  const selected = candidates.find((session) => session.status !== 'idle' && !session.terminal)
    ?? candidates.find((session) => session.unread)
    ?? candidates[0]
  if (!selected) {
    return { status: 'idle', label: TRACE_CODEX_STATUS_LABELS.idle, title: 'Trace 在这里', detail: '', threadId: null, turnId: null, itemId: null, terminal: false, unread: false, activeTaskCount: 0, updatedAt: null, pendingInteraction: null }
  }
  const activeTaskCount = Object.values(state.sessions).filter((session) => session.status !== 'idle' && !session.terminal).length
  return { ...sessionProjection(selected), activeTaskCount }
}

export function isTerminalTraceCodexEvent(event: TraceCodexEvent) {
  return event.kind === 'run.succeeded'
    || event.kind === 'run.completed'
    || event.kind === 'run.failed'
    || event.kind === 'run.cancelled'
    || event.kind === 'run.stale'
    || event.kind === 'run.timed_out'
    || event.kind === 'run.interrupted'
    || event.kind === 'turn.completed'
    || event.kind === 'turn.failed'
    || event.kind === 'turn.cancelled'
    || event.status === 'completed'
    || event.status === 'failed'
    || event.status === 'cancelled'
}

export type TraceCodexEventCoalescer = {
  enqueue: (event: TraceCodexEvent) => void
  flush: () => void
  dispose: () => void
}

/** Coalesce noisy progress updates without ever debouncing terminal states. */
export function createTraceCodexEventCoalescer(emit: (event: TraceCodexEvent) => void, delayMs = 80): TraceCodexEventCoalescer {
  const pending = new Map<string, TraceCodexEvent>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let disposed = false
  const keyFor = (event: TraceCodexEvent) => [event.threadId, event.turnId ?? '', event.itemId ?? ''].join('\u001f')
  const flushKey = (key: string) => {
    const event = pending.get(key)
    pending.delete(key)
    const timer = timers.get(key)
    if (timer !== undefined) clearTimeout(timer)
    timers.delete(key)
    if (!disposed && event) emit(event)
  }
  const dropPendingForTerminal = (event: TraceCodexEvent) => {
    for (const [key, pendingEvent] of pending) {
      const sameTurn = pendingEvent.threadId === event.threadId && pendingEvent.turnId === event.turnId
      const sameItem = pendingEvent.itemId === event.itemId
      // A turn terminal closes every item in that turn. An item terminal only
      // invalidates progress for that one item.
      if (!sameTurn || (event.itemId && !sameItem)) continue
      pending.delete(key)
      const timer = timers.get(key)
      if (timer !== undefined) clearTimeout(timer)
      timers.delete(key)
    }
  }
  return {
    enqueue(event) {
      if (disposed) return
      const normalized = normalizeTraceCodexEvent(event)
      if (!normalized) return
      const key = keyFor(normalized)
      if (isTerminalTraceCodexEvent(normalized)) {
        // A terminal frame is decisive. Drop stale progress for the closed
        // item/turn and deliver this frame now so a short debounce window
        // cannot hide or later overwrite a completion/error.
        dropPendingForTerminal(normalized)
        emit(normalized)
        return
      }
      pending.set(key, normalized)
      if (!timers.has(key)) timers.set(key, setTimeout(() => flushKey(key), Math.max(0, delayMs)))
    },
    flush() { for (const key of [...pending.keys()]) flushKey(key) },
    dispose() {
      disposed = true
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      pending.clear()
    },
  }
}

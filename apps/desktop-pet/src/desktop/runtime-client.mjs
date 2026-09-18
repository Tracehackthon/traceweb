import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Safe fallback for standalone client construction. The packaged desktop
// host asks the OS for a free loopback port and passes that resolved origin
// explicitly, so it does not depend on this fixed port.
export const DEFAULT_RUNTIME_ORIGIN = 'http://127.0.0.1:42731'
// OAuth start, callback, status and user-data reads must use one cookie
// origin. The registered Zhihu callback is on the public Trace domain, so
// native cloud requests deliberately stay on that same origin instead of
// using the deployment alias.
export const DEFAULT_CLOUD_ORIGIN = 'https://trace.neutrom.store'
const TERMINAL_AGENT_STATES = new Set(['succeeded', 'success', 'completed', 'failed', 'cancelled', 'stale', 'timed_out', 'interrupted'])
const TERMINAL_AGENT_EVENT_TYPES = new Set([
  'run.succeeded', 'run.completed', 'run.failed', 'run.cancelled',
  'run.stale', 'run.timed_out', 'run.interrupted',
])
const NO_NOT_FOUND_FALLBACK = Symbol('no-not-found-fallback')
const DESKTOP_HOST = 'codex'
const DESKTOP_HOST_SESSION = 'trace-desktop'

export function resolveCodexExecutable({ env = process.env, platform = process.platform } = {}) {
  const explicit = typeof env.TRACE_CODEX_BIN === 'string' ? env.TRACE_CODEX_BIN.trim() : ''
  if (explicit) return explicit
  const names = platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex.bat'] : ['codex']
  const candidates = []
  for (const directory of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) candidates.push(path.join(directory, name))
  }
  if (platform === 'win32') {
    const localBin = env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin')
    if (localBin && fs.existsSync(localBin)) {
      for (const name of names) candidates.push(path.join(localBin, name))
      try {
        for (const entry of fs.readdirSync(localBin, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          for (const name of names) candidates.push(path.join(localBin, entry.name, name))
        }
      } catch { /* A missing/inaccessible optional install location is not fatal. */ }
    }
    if (env.APPDATA) for (const name of names) candidates.push(path.join(env.APPDATA, 'npm', name))
  }
  const existing = candidates.filter((candidate) => {
    try { return fs.statSync(candidate).isFile() } catch { return false }
  })
  existing.sort((left, right) => {
    try { return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs } catch { return 0 }
  })
  return existing[0]
}

function findProjectDir(start = process.env.TRACE_PROJECT_DIR || process.cwd()) {
  let current = path.resolve(start)
  if (!fs.existsSync(current) || !fs.statSync(current).isDirectory()) throw new Error('当前项目位置不可用，请从项目目录启动 Trace 桌宠')
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error('没有找到当前项目，请从项目目录启动 Trace 桌宠，或设置 TRACE_PROJECT_DIR')
}

function safeProjectName(projectDir) {
  const value = path.basename(projectDir).normalize('NFKC').trim()
  if (!value || value.length > 200) throw new Error('当前项目名称不可用')
  return value
}

function boundedText(value, name, max = 16_000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\0]/.test(value)) throw new Error(`${name}不完整或过长`)
  return value.trim()
}

function publicRuntimeError(value, status) {
  const fallback = `Trace 没有完成这次请求（${status}）`
  const message = typeof value?.error?.message === 'string' ? value.error.message.trim() : ''
  if (!message) return fallback
  if (message.length > 500 || /(?:[A-Za-z]:[\\/]|\/(?:Users|home|var|tmp|private|opt|srv)\/|\b(?:projectDir|contextHash|deliveryId|endpoint|cwd|profileId)\b)/i.test(message)) return fallback
  return message
}

function safeWorkResult(workspace, workId) {
  const work = workspace?.host?.worksite?.works?.[workId]
  const session = workspace?.host?.worksite?.sessions?.[workId]
  if (!work || !session) return null
  const returned = session.codexReturns?.at(-1)
  return {
    workId,
    connected: work.connected === true,
    status: work.connection?.status || (returned ? 'returned_for_review' : 'prepared'),
    projectName: work.project,
    agentLabel: work.agent,
    result: returned?.result ? {
      fact: returned.result.fact,
      interpretation: returned.result.interpretation || '',
      unconfirmed: returned.result.unconfirmed || '',
      proposedUnderstanding: returned.result.proposedUnderstanding || '',
    } : session.result?.externalReturnId ? {
      fact: session.result.fact || '',
      interpretation: session.result.interpretation || '',
      unconfirmed: session.result.unconfirmed || '',
      proposedUnderstanding: session.result.proposedUnderstanding || '',
    } : null,
  }
}

function safePanelText(value, limit = 240) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  // Product Workspace deliberately omits private turn bodies from its list
  // projections. Keep this second boundary in the desktop bridge as well:
  // operational panels must never turn an absolute path, prompt or token into
  // product copy by accident.
  if (!text || text.length > limit || /(?:[A-Za-z]:[\\/]|\/(?:Users|home|var|tmp|private|opt|srv)\/|(?:token|secret|access[_ -]?key|authorization)\s*[:=])/i.test(text)) return ''
  return text
}

function safePanelItem(item, fields = []) {
  const result = {}
  for (const field of fields) {
    const value = item?.[field]
    if (typeof value === 'string') result[field] = safePanelText(value)
    else if (typeof value === 'number' && Number.isFinite(value)) result[field] = value
    else if (typeof value === 'boolean') result[field] = value
  }
  return result
}

export function validateRuntimeOrigin(value = DEFAULT_RUNTIME_ORIGIN) {
  const url = new URL(value)
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
  if (url.protocol !== 'http:' || !loopback || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('TRACE_BACKEND_ORIGIN must be a loopback HTTP origin')
  }
  return url.origin
}

export function createRuntimeCapabilityClient({
  origin = process.env.TRACE_BACKEND_ORIGIN || DEFAULT_RUNTIME_ORIGIN,
  cloudOrigin = process.env.TRACE_CLOUD_ORIGIN || DEFAULT_CLOUD_ORIGIN,
  projectDir: configuredProjectDir,
  fetchImpl = globalThis.fetch,
  cloudFetchImpl = fetchImpl,
  randomId = randomUUID,
  desktopSnapshotToken = process.env.TRACE_DESKTOP_SNAPSHOT_TOKEN,
  now = Date.now,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onCodexEvent = null,
} = {}) {
  const backendOrigin = validateRuntimeOrigin(origin)
  const cloudBase = new URL(cloudOrigin)
  if (cloudBase.protocol !== 'https:' || cloudBase.username || cloudBase.password || cloudBase.pathname !== '/' || cloudBase.search || cloudBase.hash) throw new Error('TRACE_CLOUD_ORIGIN must be an HTTPS origin')
  let projectContext
  let selectedProjectDir = configuredProjectDir
  const repositoryPreflights = new Map()
  const recoveryPreviews = new Map()
  const publicationPreviews = new Map()
  const agentEventSubscriptions = new Map()
  let lastPanelRows = null
  const remember = (map, key, value) => {
    map.set(key, {...value, createdAt: now()})
    while (map.size > 16) map.delete(map.keys().next().value)
    return key
  }
  const confirmationRequired = (request, message) => {
    if (request.confirmation !== 'user-confirmed') throw new Error(message)
  }
  const currentProject = () => {
    if (!projectContext) {
      const projectDir = findProjectDir(selectedProjectDir)
      projectContext = { projectDir, projectName: safeProjectName(projectDir) }
    }
    return projectContext
  }
  const setProjectDir = (projectDir) => {
    selectedProjectDir = projectDir
    projectContext = undefined
    const selected = currentProject()
    return { connected: true, projectName: selected.projectName, agentLabel: 'Codex', locationLabel: '已选择项目' }
  }

  async function runtimeRequest(pathname, body, timeoutMs = 35_000, notFoundFallback = NO_NOT_FOUND_FALLBACK) {
    const url = new URL(pathname, backendOrigin)
    if (url.origin !== backendOrigin || !url.pathname.startsWith('/api/')) throw new Error('Unsupported Trace Runtime path')
    let response
    try {
      response = await fetchImpl(url, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          origin: backendOrigin,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      throw new Error('Trace 本机能力没有启动，请重新打开 Trace 后再试')
    }
    const text = await response.text()
    if (text.length > 1_048_576) throw new Error('Trace Runtime response exceeded 1 MiB')
    if (response.status === 404 && notFoundFallback !== NO_NOT_FOUND_FALLBACK) return notFoundFallback
    let value
    try { value = JSON.parse(text) } catch { throw new Error('Trace 本机能力没有正确响应，请重新打开 Trace 后再试') }
    if (!response.ok) throw new Error(publicRuntimeError(value, response.status))
    return value
  }

  async function runtimeEventStream(runId, after = 0) {
    const encoded = encodeURIComponent(requireId(runId, 'Agent 运行'))
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('Agent 事件游标不正确')
    const url = new URL(`/api/agent/runs/${encoded}/events?after=${after}`, backendOrigin)
    let response
    try {
      response = await fetchImpl(url, { method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(190_000), headers: { origin: backendOrigin, accept: 'text/event-stream' } })
    } catch { throw new Error('Agent 实时进度连接没有建立，运行仍会在本机继续') }
    if (!response.ok) throw new Error(`Agent 实时进度暂时不可用（${response.status}）`)
    const reader = response.body?.getReader?.()
    if (!reader) throw new Error('Agent 实时进度返回为空')
    const decoder = new TextDecoder()
    let buffer = '', events = []
    const parse = (block) => {
      const lines = block.split(/\r?\n/); let type = 'message', id = '', data = ''
      for (const line of lines) {
        if (line.startsWith('event:')) type = line.slice(6).trim().slice(0, 80)
        else if (line.startsWith('id:')) id = line.slice(3).trim().slice(0, 40)
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (!data || events.length >= 256) return
      try { events.push({ type, id, data: JSON.parse(data) }) } catch { /* ignore malformed progress frame */ }
    }
    while (true) {
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done })
      let boundary
      while ((boundary = buffer.indexOf('\n\n')) >= 0) { parse(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2) }
      if (chunk.done) break
    }
    return { runId, after, events }
  }

  /**
   * Consume one Agent run's persisted SSE stream.  Unlike the old host-turn
   * sampler this forwards runtime.approval.required immediately, so the
   * desktop can ask the user before the run reaches a terminal state.  The
   * sequence cursor is retained across a dropped loopback connection.
   */
  async function subscribeAgentRun(runId, onEvent = onCodexEvent, { signal } = {}) {
    const safeRunId = requireId(runId, 'Agent 运行')
    if (typeof onEvent !== 'function') throw new Error('Agent 事件订阅没有接收器')
    const existing = agentEventSubscriptions.get(safeRunId)
    if (existing) return existing.promise
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener?.('abort', abort, { once: true })
    const subscription = { controller, promise: null }
    const promise = (async () => {
      let after = 0
      let retries = 0
      let terminal = false
      try {
        while (!controller.signal.aborted && !terminal) {
          let response
          try {
            const url = new URL(`/api/agent/runs/${encodeURIComponent(safeRunId)}/events?after=${after}`, backendOrigin)
            response = await fetchImpl(url, {
              method: 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal,
              headers: { origin: backendOrigin, accept: 'text/event-stream', ...(after ? { 'last-event-id': String(after) } : {}) },
            })
          } catch {
            if (controller.signal.aborted) break
            if (++retries > 8) throw new Error('Agent 实时进度连接已断开，请重新打开桌宠')
            await wait(Math.min(1_000 * retries, 5_000))
            continue
          }
          if (!response.ok) {
            if (response.status === 404 || response.status === 409) throw new Error(`Agent 运行已不可恢复（${response.status}）`)
            if (++retries > 8) throw new Error(`Agent 实时进度暂时不可用（${response.status}）`)
            await wait(Math.min(1_000 * retries, 5_000))
            continue
          }
          retries = 0
          const reader = response.body?.getReader?.()
          if (!reader) throw new Error('Agent 实时进度返回为空')
          const decoder = new TextDecoder()
          let buffer = ''
          const deliver = (block) => {
            const lines = block.split(/\r?\n/)
            let type = 'message', idValue = '', data = ''
            for (const line of lines) {
              if (line.startsWith('event:')) type = line.slice(6).trim().slice(0, 96)
              else if (line.startsWith('id:')) idValue = line.slice(3).trim().slice(0, 96)
              else if (line.startsWith('data:')) data += line.slice(5).trim()
            }
            if (!data) return
            let payload
            try { payload = JSON.parse(data) } catch { return }
            const sequence = Number.isSafeInteger(payload?.sequence) ? payload.sequence : Number(idValue)
            if (Number.isSafeInteger(sequence) && sequence > after) after = sequence
            const event = {
              ...payload,
              runId: payload?.runId || safeRunId,
              sequence: Number.isSafeInteger(sequence) ? sequence : undefined,
              type: payload?.type || type,
              eventId: payload?.eventId || `${safeRunId}:${Number.isSafeInteger(sequence) ? sequence : idValue || Date.now()}`,
            }
            try { onEvent(event) } catch { /* UI subscribers must not stop transport. */ }
            const status = String(payload?.data?.status || payload?.status || '').toLowerCase()
            terminal = TERMINAL_AGENT_EVENT_TYPES.has(String(event.type))
              || TERMINAL_AGENT_STATES.has(status)
          }
          while (!controller.signal.aborted) {
            const chunk = await reader.read()
            buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done })
            let boundary
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              deliver(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2)
            }
            if (chunk.done) break
          }
          if (!terminal && !controller.signal.aborted) await wait(200)
        }
      } finally {
        signal?.removeEventListener?.('abort', abort)
        if (agentEventSubscriptions.get(safeRunId) === subscription) agentEventSubscriptions.delete(safeRunId)
      }
      return { runId: safeRunId, after, terminal }
    })()
    subscription.promise = promise
    agentEventSubscriptions.set(safeRunId, subscription)
    return promise
  }

  function beginAgentEventSubscription(runId) {
    if (typeof onCodexEvent !== 'function') return
    void subscribeAgentRun(runId).catch(() => {
      // The run/read response remains authoritative; no synthetic failure is
      // emitted when only the optional live projection is disconnected.
    })
  }

  async function cloudRequest(pathname, body, timeoutMs = 35_000) {
    const url = new URL(pathname, cloudBase.origin)
    if (url.origin !== cloudBase.origin || !url.pathname.startsWith('/api/')) throw new Error('Unsupported Trace Cloud path')
    let response
    try {
      response = await cloudFetchImpl(url, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        // The public domain previously served a permanent redirect. Chromium
        // can retain that 308 across desktop upgrades, so every live capability
        // request must bypass the persistent HTTP cache while still refusing
        // an actual redirect response.
        cache: 'no-store',
        credentials: 'include',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          origin: cloudBase.origin,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      throw new Error('知乎与联网能力暂时不可用，请稍后重试')
    }
    const text = await response.text()
    if (text.length > 1_048_576) throw new Error('Trace Cloud response exceeded 1 MiB')
    let value
    try { value = JSON.parse(text) } catch { throw new Error('Trace 云端能力暂时不可用，请稍后重试') }
    if (!response.ok) throw new Error(publicRuntimeError(value, response.status))
    return value
  }

  function hostSessionId(request) {
    const value = request?.sessionId
    if (value === undefined) return DESKTOP_HOST_SESSION
    if (typeof value !== 'string' || !/^[a-zA-Z0-9._:-]{1,200}$/.test(value)) throw new Error('工作现场身份不完整')
    return value
  }

  function hostCommandId(kind, request) {
    return `desktop-${kind}-${randomId()}`
  }

  function listQuery(pathname, query = {}) {
    const url = new URL(pathname, backendOrigin)
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
    return `${url.pathname}${url.search}`
  }

  function safePanelSession(item) {
    return {
      host: safePanelText(item?.host, 40) || DESKTOP_HOST,
      sessionId: safePanelText(item?.session_id || item?.sessionId, 200),
      status: safePanelText(item?.status, 40) || 'unknown',
      project: item?.project_ref ? '已绑定当前项目' : '个人空间（未绑定项目）',
      updatedAt: safePanelText(item?.last_event_at || item?.updated_at, 80),
    }
  }

  function safePanelFinding(item) {
    return {
      kind: safePanelText(item?.finding_kind || item?.origin || 'captured', 80),
      status: safePanelText(item?.status, 40),
      turn: safePanelText(item?.turn_id, 160),
      summary: safePanelText(item?.observation || item?.desired_behavior, 260) || '已记录一条工作发现',
    }
  }

  function safePanelProposal(item) {
    return {
      id: safePanelText(item?.proposal_id, 200),
      status: safePanelText(item?.status, 40),
      target: safePanelText(item?.target_kind, 80) || '待判断',
      scope: safePanelText(item?.scope, 120) || '未知范围',
      rationale: safePanelText(item?.rationale, 260),
      revision: Number.isSafeInteger(item?.revision) ? item.revision : 0,
    }
  }

  function safePanelActivation(item) {
    return {
      id: safePanelText(item?.receipt_id, 200),
      status: safePanelText(item?.status, 40),
      count: Number.isFinite(item?.item_count) ? item.item_count : 0,
      createdAt: safePanelText(item?.created_at, 80),
    }
  }

  /**
   * Safe, transport-only projection for the native pet. The current product
   * host endpoint exposes turn rows rather than a dedicated event stream, so
   * this adapter emits a turn-level event when those rows carry stable IDs.
   * A future Codex app-server adapter can return the same contract without
   * changing the renderer or pet reducer.
   */
  async function readCodexEvents() {
    const response = await runtimeRequest(listQuery('/api/product/host/turns', { host: DESKTOP_HOST, session_id: DESKTOP_HOST_SESSION }), undefined, 8_000, { items: [] })
    const rows = Array.isArray(response?.items) ? response.items : []
    return {
      source: 'trace-runtime/codex-host',
      events: rows.slice(0, 128).flatMap((item) => {
        const threadId = safePanelText(item?.thread_id || item?.threadId || item?.session_id || item?.sessionId, 512)
        const turnId = safePanelText(item?.turn_id || item?.turnId || item?.id, 512)
        if (!threadId || !turnId) return []
        const status = String(item?.status || item?.state || '').toLowerCase().replace(/[- ]/g, '_')
        const failed = ['failed', 'error', 'timed_out', 'cancelled', 'canceled'].includes(status)
        const completed = ['completed', 'complete', 'succeeded', 'success', 'done'].includes(status)
        const kind = failed ? 'turn.failed' : completed ? 'turn.completed' : 'turn.updated'
        const at = item?.updated_at || item?.updatedAt || item?.last_event_at || item?.lastEventAt || item?.created_at || item?.createdAt
        const title = safePanelText(item?.title || item?.summary || item?.label, 160)
        const detail = safePanelText(item?.detail || item?.message, 160)
        return [{
          eventId: `turn:${threadId}:${turnId}:${status || 'unknown'}:${String(at || '')}`.slice(0, 512),
          threadId,
          turnId,
          itemId: null,
          kind,
          status: failed ? 'failed' : completed ? 'completed' : 'in_progress',
          title,
          detail,
          ...(at ? { at } : {}),
        }]
      }),
    }
  }

  /**
   * A deliberately small projection for the desktop "本机能力" surface.
   * The renderer does not receive raw Product Workspace rows, private turn
   * bodies, repository paths, hashes or provider credentials.
   */
  async function readRuntimePanel() {
    const optional = (pathname) => runtimeRequest(pathname, undefined, 12_000, { items: [] }).catch(() => ({ items: [] }))
    const [workspace, sessions, turns, findings, jobs, proposals, activations, worker, guard, policies, orchestrations, trials] = await Promise.all([
      runtimeRequest('/api/product/workspace'),
      runtimeRequest(listQuery('/api/product/host/sessions', { host: DESKTOP_HOST })),
      runtimeRequest(listQuery('/api/product/host/turns', { host: DESKTOP_HOST, session_id: DESKTOP_HOST_SESSION })),
      runtimeRequest(listQuery('/api/product/host/findings', { host: DESKTOP_HOST, session_id: DESKTOP_HOST_SESSION })),
      runtimeRequest(listQuery('/api/product/host/sensemaking/jobs', { host: DESKTOP_HOST, session_id: DESKTOP_HOST_SESSION })),
      runtimeRequest(listQuery('/api/product/host/routing/proposals', { host: DESKTOP_HOST, session_id: DESKTOP_HOST_SESSION })),
      runtimeRequest(listQuery('/api/product/host/activation/history', { host: DESKTOP_HOST, session_id: DESKTOP_HOST_SESSION })),
      runtimeRequest('/api/agent/sensemaking/health', undefined, 12_000, { status: 'unavailable', queue_depth: 0, failed_count: 0 }),
      optional('/api/product/host/repository/recovery/status'),
      optional('/api/product/host/publication-policies'),
      optional(listQuery('/api/product/host/capability/orchestrations', { host: DESKTOP_HOST, session_id: DESKTOP_HOST_SESSION })),
      optional('/api/product/host/capability/trials'),
    ])
    const array = (value) => Array.isArray(value?.items) ? value.items : []
    const orchestrationRows = array(orchestrations)
    const trialRows = array(trials)
    const policyRows = array(policies)
    lastPanelRows = { orchestrations: orchestrationRows, trials: trialRows, policies: policyRows }
    return {
      connected: true,
      host: DESKTOP_HOST,
      sessionId: DESKTOP_HOST_SESSION,
      revision: Number.isSafeInteger(workspace?.revision) ? workspace.revision : 0,
      sessions: array(sessions).slice(0, 24).map(safePanelSession),
      turnCount: array(turns).length,
      findings: array(findings).slice(0, 24).map(safePanelFinding),
      jobs: array(jobs).slice(0, 24).map((item) => safePanelItem(item, ['status', 'execution_mode', 'error_code'])),
      proposals: array(proposals).slice(0, 24).map(safePanelProposal),
      activations: array(activations).slice(0, 24).map(safePanelActivation),
      worker: {
        status: safePanelText(worker?.status, 40) || 'unavailable',
        mode: safePanelText(worker?.mode, 40),
        queueDepth: Number.isFinite(worker?.queue_depth) ? worker.queue_depth : 0,
        failedCount: Number.isFinite(worker?.failed_count) ? worker.failed_count : 0,
      },
      recovery: array(guard).slice(0, 24).map((item) => ({
        state: safePanelText(item?.state, 40),
        id: safePanelText(item?.journal_id, 200),
        expectedBranch: item?.expected_branch ? '已记录目标分支' : '',
      })),
      policies: policyRows.slice(0, 12).map((item) => ({ status: safePanelText(item?.status, 40), scope: safePanelText(item?.scope, 80), id: safePanelText(item?.policy_id, 200), revision: Number.isSafeInteger(item?.revision) ? item.revision : 0 })),
      orchestrations: orchestrationRows.slice(0, 12).map((item) => ({ status: safePanelText(item?.status, 40), id: safePanelText(item?.orchestration_id, 200), revision: Number.isSafeInteger(item?.revision) ? item.revision : 0, hasCandidate: Boolean(item?.candidate_dir), hasManifest: Boolean(item?.manifest_sha256), producerStatus: safePanelText(item?.candidate?.producer_status, 40) })),
      trials: trialRows.slice(0, 12).map((item) => ({ status: safePanelText(item?.status, 40), id: safePanelText(item?.trial_id, 200), orchestrationId: safePanelText(item?.orchestration_id, 200), revision: Number.isSafeInteger(item?.revision) ? item.revision : 0, outcome: safePanelText(item?.outcome, 80) })),
    }
  }

  function requireId(value, name = '身份') {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9._:-]{1,512}$/.test(value)) throw new Error(`${name}不完整`)
    return value
  }

  async function runtimePanelAction(request) {
    if (!request || typeof request !== 'object') throw new Error('本机能力动作不完整')
    const action = request.action
    const sessionId = hostSessionId(request)
    const host = DESKTOP_HOST
    const base = { protocolVersion: 1, commandId: hostCommandId(action, request), host, sessionId }
    if (action === 'session.attach' || action === 'session.pause' || action === 'session.detach') {
      if (action === 'session.attach') {
        let projectRef
        try { projectRef = currentProject().projectDir } catch { projectRef = undefined }
        return runtimeRequest('/api/product/host/session/attach', { ...base, ...(projectRef ? { projectRef } : {}) })
      }
      return runtimeRequest(`/api/product/host/session/${action.slice('session.'.length)}`, base)
    }
    if (action === 'sensemaking.drain') {
      const limit = request.limit === undefined ? 16 : request.limit
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('排空数量需要在 1—100 之间')
      return runtimeRequest('/api/agent/sensemaking/drain', { protocolVersion: 1, limit })
    }
    if (action === 'routing.decide') {
      return runtimeRequest('/api/product/host/routing/decide', { ...base, proposalId: requireId(request.proposalId, '路由提案'), action: ['trial', 'adopt', 'reject'].includes(request.decision) ? request.decision : 'reject', expectedRevision: Number.isSafeInteger(request.expectedRevision) ? request.expectedRevision : 0 })
    }
    if (action === 'activation.mark') {
      const status = ['used', 'affected', 'dismissed', 'snoozed', 'released'].includes(request.status) ? request.status : 'dismissed'
      return runtimeRequest('/api/product/host/activation/mark', { ...base, receiptId: requireId(request.receiptId, '回带记录'), status, expectedRevision: Number.isSafeInteger(request.expectedRevision) ? request.expectedRevision : 0 })
    }
    if (action === 'repository.preflight') {
      const project = currentProject()
      const proposalId = request.proposalId ? requireId(request.proposalId, '路由提案') : undefined
      const result = await runtimeRequest('/api/product/host/repository/preflight', { ...base, repoRoot: project.projectDir, executionMode: 'local', taskIntent: typeof request.taskIntent === 'string' ? request.taskIntent.slice(0, 500) : '', ...(proposalId ? { proposalId } : {}) })
      if (!result?.preflight_id || typeof result.state_hash !== 'string') throw new Error('仓库预检没有返回可验证回执')
      const token = `preflight:${randomId()}`
      remember(repositoryPreflights, token, { preflightId: result.preflight_id, proposalId: proposalId || null, expectedStateHash: result.state_hash, action: result.action })
      return { protocolVersion: 1, status: 'preview', preflightId: token, canApply: Boolean(proposalId && result.action === 'create-branch'), action: safePanelText(result.action, 80), boundProposal: Boolean(proposalId) }
    }
    if (action === 'repository.apply') {
      confirmationRequired(request, '执行仓库保护前需要确认这次预检回执')
      const token = requireId(request.preflightId, '仓库预检回执')
      const cached = repositoryPreflights.get(token)
      if (!cached || now() - cached.createdAt > 10 * 60_000) throw new Error('仓库预检已过期，请重新做只读预检')
      if (!cached.proposalId || cached.action !== 'create-branch') throw new Error('这条预检没有绑定可采用的 runtime-guard 提案')
      const result = await runtimeRequest('/api/product/host/repository/apply', { ...base, preflightId: cached.preflightId, proposalId: cached.proposalId, expectedStateHash: cached.expectedStateHash, approval: `adopt:${cached.proposalId}` })
      repositoryPreflights.delete(token)
      return { protocolVersion: 1, status: safePanelText(result?.status, 40) || 'applied', applied: true }
    }
    if (action === 'repository.recovery.preview') {
      const value = request.journalId || request.targetCommandId
      if (!value) throw new Error('先选择一条待恢复记录')
      const journalId = request.journalId ? requireId(request.journalId, '恢复记录') : undefined
      const result = await runtimeRequest('/api/product/host/repository/recovery/preview', { ...base, ...(journalId ? { journalId } : { targetCommandId: requireId(request.targetCommandId, '命令记录') }) })
      if (journalId) remember(recoveryPreviews, journalId, { action: result?.action })
      return { protocolVersion: 1, action: safePanelText(result?.action, 80), previewed: true }
    }
    if (action === 'repository.recovery.reconcile') {
      confirmationRequired(request, '完成恢复回执前需要确认预览结果')
      const journalId = requireId(request.journalId, '恢复记录')
      if (!recoveryPreviews.has(journalId)) throw new Error('请先预览这条恢复记录')
      return runtimeRequest('/api/product/host/repository/recovery/reconcile', { ...base, journalId })
    }
    if (action === 'publication.policy.preview') {
      const project = currentProject()
      const body = { ...base, scope: ['personal', 'project', 'cross-project'].includes(request.scope) ? request.scope : 'project', targetRoot: project.projectDir, ...(Array.isArray(request.allowedCapabilityKinds) ? { allowedCapabilityKinds: request.allowedCapabilityKinds.slice(0, 16) } : {}), ...(request.validationRequirements && typeof request.validationRequirements === 'object' ? { validationRequirements: request.validationRequirements } : {}) }
      const result = await runtimeRequest('/api/product/host/publication-policy/preview', body)
      if (!result?.policy_id) throw new Error('发布策略预览没有返回可确认回执')
      const token = `policy-preview:${randomId()}`
      remember(publicationPreviews, token, { body, policyId: result.policy_id, scope: result.scope, targetRoot: result.target_root, allowedCapabilityKinds: result.allowed_capability_kinds, validationRequirements: result.validation_requirements, expiresAt: result.expires_at })
      return { protocolVersion: 1, status: 'preview', previewId: token, scope: safePanelText(result.scope, 80), requiresConfirmation: true }
    }
    if (action === 'publication.policy.adopt') {
      confirmationRequired(request, '采用发布策略前需要确认预览内容')
      const previewId = requireId(request.previewId, '策略预览')
      const cached = publicationPreviews.get(previewId)
      if (!cached || now() - cached.createdAt > 10 * 60_000) throw new Error('策略预览已过期，请重新预览')
      const result = await runtimeRequest('/api/product/host/publication-policy/adopt', { ...base, scope: cached.scope, targetRoot: cached.targetRoot, allowedCapabilityKinds: cached.allowedCapabilityKinds, validationRequirements: cached.validationRequirements, ...(cached.expiresAt ? { expiresAt: cached.expiresAt } : {}), approval: `adopt:${cached.policyId}` })
      publicationPreviews.delete(previewId)
      return { protocolVersion: 1, status: safePanelText(result?.status, 40) || 'active', adopted: true }
    }
    if (action === 'publication.policy.revoke') {
      confirmationRequired(request, '撤回发布策略需要再次确认')
      const policyId = requireId(request.policyId, '发布策略')
      const policy = lastPanelRows?.policies?.find((item) => item.policy_id === policyId && item.status === 'active')
      if (!policy) throw new Error('这条发布策略已不存在或不是 active 状态，请刷新现场')
      return runtimeRequest('/api/product/host/publication-policy/revoke', { ...base, policyId, expectedRevision: Number.isSafeInteger(request.expectedRevision) ? request.expectedRevision : policy.revision, reason: typeof request.reason === 'string' ? request.reason.slice(0, 500) : '用户从 Trace 工作现场撤回' })
    }
    if (action === 'capability.trial.create') {
      const orchestrationId = requireId(request.orchestrationId, '能力编排')
      const orchestration = lastPanelRows?.orchestrations?.find((item) => item.orchestration_id === orchestrationId)
      if (!orchestration || !['candidate', 'producer_required', 'staged', 'validated'].includes(orchestration.status)) throw new Error('当前能力候选还不能创建试用')
      const hash = typeof request.capabilityHash === 'string' ? request.capabilityHash : orchestration.manifest_sha256
      if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) throw new Error('请先让 CapabilityPublisher 生成并暂存候选清单')
      return runtimeRequest('/api/product/host/capability/trial/create', { ...base, orchestrationId, expectedRevision: Number.isSafeInteger(request.expectedRevision) ? request.expectedRevision : orchestration.revision, capabilityVersion: typeof request.capabilityVersion === 'string' ? request.capabilityVersion.slice(0, 120) : 'candidate', capabilityHash: hash, scenario: typeof request.scenario === 'string' && request.scenario.trim() ? request.scenario.slice(0, 500) : '验证这条能力在当前项目中的边界', task: typeof request.task === 'string' ? request.task.slice(0, 500) : '验证当前能力', expected: typeof request.expected === 'string' ? request.expected.slice(0, 500) : '按试用回执判断结果' })
    }
    if (action === 'capability.trial.complete') {
      const trialId = requireId(request.trialId, '试用记录')
      const trial = lastPanelRows?.trials?.find((item) => item.trial_id === trialId)
      if (!trial || !['queued', 'running'].includes(trial.status)) throw new Error('当前试用记录还不能收尾')
      return runtimeRequest('/api/product/host/capability/trial/complete', { ...base, trialId, expectedRevision: Number.isSafeInteger(request.expectedRevision) ? request.expectedRevision : trial.revision, outcome: ['support', 'limit', 'challenge', 'inconclusive'].includes(request.outcome) ? request.outcome : 'inconclusive', observed: typeof request.observed === 'string' ? request.observed.slice(0, 1000) : '已完成一次显式试用' })
    }
    if (['capability.stage', 'capability.validate', 'capability.publish', 'capability.rollback'].includes(action)) {
      const orchestrationId = requireId(request.orchestrationId, '能力编排')
      const orchestration = lastPanelRows?.orchestrations?.find((item) => item.orchestration_id === orchestrationId)
      if (!orchestration) throw new Error('请先刷新工作现场并选择能力候选')
      const body = { ...base, orchestrationId, expectedRevision: Number.isSafeInteger(request.expectedRevision) ? request.expectedRevision : orchestration.revision }
      if (action === 'capability.stage') {
        if (!orchestration.candidate_dir || !orchestration.manifest_sha256) throw new Error('候选内容尚未由 CapabilityPublisher 暂存')
        Object.assign(body, { producerStatus: 'staged', candidateDir: orchestration.candidate_dir, manifestSha256: orchestration.manifest_sha256 })
      }
      if (action === 'capability.validate') {
        confirmationRequired(request, '标记能力通过验证前需要确认验证证据')
        if (!['staged', 'trial_queued'].includes(orchestration.status)) throw new Error('只有已暂存候选可以验证')
        Object.assign(body, { validation: request.validation && typeof request.validation === 'object' ? request.validation : { schema: 'passed', replay: 'passed', behavior: 'passed', rollback: 'passed', source_hashes: 'passed' } })
      }
      if (action === 'capability.publish') {
        confirmationRequired(request, '发布能力前需要确认 publisher 回执')
        if (orchestration.status !== 'validated') throw new Error('只有全部验证通过的候选可以发布')
        if (request.producerStatus !== 'published' || !request.publicationReceipt || typeof request.publicationReceipt !== 'object' || typeof request.rollbackReceipt !== 'string' || !request.rollbackReceipt.trim()) throw new Error('发布需要现有 CapabilityPublisher 的发布与回滚回执')
        Object.assign(body, { producerStatus: 'published', approval: typeof request.policyId === 'string' ? 'user-confirmed-from-trace' : `publish:${orchestrationId}`, ...(request.policyId ? { policyId: requireId(request.policyId, '发布策略') } : {}), publicationReceipt: request.publicationReceipt, rollbackReceipt: request.rollbackReceipt.slice(0, 4000) })
      }
      if (action === 'capability.rollback') {
        confirmationRequired(request, '回滚能力前需要再次确认')
        if (orchestration.status !== 'published') throw new Error('只有已发布能力可以回滚')
        if (typeof request.rollbackReceipt !== 'string' || !request.rollbackReceipt.trim()) throw new Error('回滚需要 publisher 提供回滚回执')
        Object.assign(body, { producerStatus: 'rolled_back', rollbackReceipt: request.rollbackReceipt.slice(0, 4000) })
      }
      const endpoint = action.split('.').at(-1)
      return runtimeRequest(`/api/product/host/capability/${endpoint}`, body)
    }
    throw new Error('暂不支持这个本机能力动作')
  }

  async function nativeWorkspaceRequest(pathname, method = 'GET', body) {
    if (!['/api/web/workspace', '/api/web/export'].includes(pathname)
      || !['GET', 'PUT'].includes(method)
      || method === 'PUT' && pathname !== '/api/web/workspace'
      || method === 'PUT' && typeof body !== 'string') throw new Error('不支持这个桌面工作区操作')
    const url = new URL(pathname, backendOrigin)
    let response
    try {
      response = await fetchImpl(url, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(35_000),
        headers: {
          origin: backendOrigin,
          accept: 'application/json',
          ...(method === 'PUT' ? {
            'content-type': 'application/json',
            ...(desktopSnapshotToken ? { 'x-trace-desktop-token': desktopSnapshotToken } : {}),
          } : {}),
        },
        ...(method === 'PUT' ? { body } : {}),
      })
    } catch {
      throw new Error('Trace 本机内容暂时无法访问，请重新打开 Trace 后再试')
    }
    let text = await response.text()
    if (text.length > 8 * 1024 * 1024) throw new Error('Trace 本机内容响应过大')
    // The renderer needs the workspace contents, not implementation details such as
    // the absolute SQLite path on the host. Keep those details inside the main
    // process so they cannot accidentally surface in product copy or diagnostics.
    if (pathname === '/api/web/workspace') {
      try {
        const value = JSON.parse(text)
        if (value && typeof value === 'object' && value.storage && typeof value.storage === 'object') {
          value.storage = { kind: value.storage.kind || 'sqlite', label: 'Trace 桌面端本机空间' }
        }
        text = JSON.stringify(value)
      } catch {
        // Preserve non-JSON error responses so the renderer can show the public
        // message returned by the runtime without exposing a parser exception.
      }
    }
    return {
      status: response.status,
      body: text,
      contentType: response.headers.get('content-type') || 'application/json; charset=utf-8',
      contentDisposition: response.headers.get('content-disposition') || '',
    }
  }

  const observationFromMatter = (matter, host) => {
    const session = host?.chain?.sessions?.[matter.id]
    const workNeedsReview = Object.values(host?.worksite?.sessions || {}).some((value) => value?.result?.matterId === matter.id && value?.result?.decision === 'pending')
    return {
      id: matter.id,
      text: matter.originalText || matter.whyCare || matter.title || '未命名事项',
      status: matter.understandingVersion > 0 ? '已采用' : session?.suggestion ? '候选中' : workNeedsReview ? '需回顾' : '待确认',
      source: 'Trace 本机工作区',
      createdAt: '',
    }
  }

  async function readObservationSummary() {
    const workspace = await runtimeRequest('/api/product/workspace')
    return {
      revision: workspace.revision,
      observations: [...(workspace.host?.chain?.matters || [])].reverse().slice(0, 20).map((matter) => observationFromMatter(matter, workspace.host)),
    }
  }

  async function captureObservation(text, source) {
    const workspace = await runtimeRequest('/api/product/workspace')
    const matterId = `pet-${randomId()}`
    const saved = await runtimeRequest('/api/product/commands', {
      protocolVersion: 1,
      commandId: `pet-capture-${randomId()}`,
      expectedRevision: workspace.revision,
      operations: [{ type: 'capture.create', matterId, text: boundedText(text, '原话') }],
    })
    const matter = saved.host?.chain?.matters?.find((item) => item.id === matterId)
    if (!matter) throw new Error('这条内容还没有进入 Trace，请重试')
    return { revision: saved.revision, observation: { ...observationFromMatter(matter, saved.host), ...(source ? { source: boundedText(source, '来源', 200) } : {}) } }
  }

  async function remoteSourceContext(source, query) {
    if (source === 'none') return null
    const result = await cloudRequest(source === 'global' ? '/api/search/global' : '/api/search/zhihu', { query: query.trim().slice(0, 500), count: 3 })
    const items = Array.isArray(result.items) ? result.items.slice(0, 3) : []
    if (!items.length) return { source, items: [], prompt: '本次联网检索没有返回可用来源。' }
    const prompt = items.map((item, index) => {
      const title = String(item.title || '未命名来源').slice(0, 300)
      const author = item.author ? ` · ${String(item.author).slice(0, 120)}` : ''
      const url = item.url ? `\n原文：${String(item.url).slice(0, 1000)}` : ''
      const excerpt = String(item.excerpt || '').slice(0, 2200)
      return `[${index + 1}] ${title}${author}${url}\n摘要：${excerpt}`
    }).join('\n\n')
    return { source, items, prompt: `以下是 Trace 刚刚取得的公开来源摘要，只作为本次判断的材料；请区分原文摘要、你的推断和仍不确定之处。\n\n${prompt}` }
  }

  async function capabilityRequest(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.operation !== 'string') throw new Error('Invalid capability request')
    if (request.operation === 'capabilities') {
      const [searchResult, agentResult] = await Promise.allSettled([
        cloudRequest('/api/search/capabilities'),
        runtimeRequest('/api/agent/capabilities'),
      ])
      const connected = searchResult.status === 'fulfilled' || agentResult.status === 'fulfilled'
      return {
        connected,
        search: searchResult.status === 'fulfilled' ? searchResult.value : { enabled: false, error: { message: searchResult.reason?.message || 'Search capability unavailable' } },
        agent: agentResult.status === 'fulfilled' ? agentResult.value : { enabled: false, profiles: [], error: { message: agentResult.reason?.message || 'Agent capability unavailable' } },
        ...(connected ? {} : { error: { message: 'Trace Runtime is not reachable' } }),
      }
    }
    if (request.operation === 'workspace.request') return nativeWorkspaceRequest(request.pathname, request.method || 'GET', request.body)
    if (request.operation === 'product.command') {
      if (request.protocolVersion !== 1 || !Array.isArray(request.operations) || request.operations.length < 1 || request.operations.length > 256) throw new Error('产品命令不完整')
      const commandId = requireId(request.commandId, '产品命令')
      if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) throw new Error('产品命令需要当前工作区版本')
      // Keep the desktop bridge as a thin, authenticated transport. Product
      // Workspace remains the authority for operation schemas, CAS and
      // idempotency; the renderer never sends a whole host snapshot here.
      return runtimeRequest('/api/product/commands', {
        protocolVersion: 1,
        commandId,
        expectedRevision: request.expectedRevision,
        operations: request.operations,
      })
    }
    if (request.operation === 'workspace.summary') return readObservationSummary()
    if (request.operation === 'codex.events') return readCodexEvents()
    if (request.operation === 'workspace.capture') return captureObservation(request.text, request.source)
    if (request.operation === 'host.panel.read') return readRuntimePanel()
    if (request.operation === 'host.panel.action') return runtimePanelAction(request)
    if (request.operation === 'setup.status') {
      const capabilities = await runtimeRequest('/api/agent/capabilities')
      const codex = capabilities.profiles?.find((profile) => profile.kind === 'codex')
      let project
      try { project = currentProject() } catch { project = null }
      return {
        runtime: { connected: true, bundled: process.env.TRACE_BUNDLED_RUNTIME === '1' },
        project: project ? { connected: true, name: project.projectName } : { connected: false },
        codex: { available: Boolean(codex), checked: false, profileId: codex?.profileId || null, label: codex?.label || 'Codex' },
      }
    }
    if (request.operation === 'setup.codex.check') {
      const capabilities = await runtimeRequest('/api/agent/capabilities')
      const codex = capabilities.profiles?.find((profile) => profile.kind === 'codex')
      if (!codex) throw new Error('这台设备还没有可用的 Codex 执行器')
      const checked = await runtimeRequest('/api/agent/check', { profileId: codex.profileId }, 45_000)
      return { ready: checked.authenticated === true, authenticated: checked.authenticated === true, version: checked.version || null, label: codex.label || 'Codex' }
    }
    if (request.operation === 'setup.codex.connect') {
      const runtimeRoot = process.env.TRACE_RUNTIME_ROOT
      const installer = runtimeRoot && path.join(runtimeRoot, 'native', 'install-codex-plugin.mjs')
      if (!installer || !path.isAbsolute(installer) || !fs.existsSync(installer)) throw new Error('当前安装没有找到 Codex 连接组件')
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [installer, '--confirm', 'true', '--replace'], {
          windowsHide: true,
          shell: false,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let bytes = 0
        const drain = chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) child.kill() }
        child.stdout.on('data', drain); child.stderr.on('data', drain)
        const timer = setTimeout(() => child.kill(), 90_000)
        child.once('error', () => { clearTimeout(timer); reject(new Error('无法启动 Codex 连接程序')) })
        child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Codex 插件连接没有完成；请先确认 Codex 已安装并登录')) })
      })
      return { connected: true, message: 'Trace 已连接到 Codex；请新开一个 Codex 任务加载插件。' }
    }
    if (request.operation === 'search') {
      if (!['zhihu', 'global'].includes(request.source) || typeof request.query !== 'string' || !request.query.trim() || request.query.length > 500 || !Number.isInteger(request.count) || request.count < 1 || request.count > 5) throw new Error('Invalid bounded search request')
      return cloudRequest(request.source === 'global' ? '/api/search/global' : '/api/search/zhihu', { query: request.query.trim(), count: request.count })
    }
    if (request.operation === 'zhihu.status') return cloudRequest('/api/zhihu/status')
    if (request.operation === 'zhihu.oauth.start') return cloudRequest('/api/zhihu/oauth/start', {})
    if (request.operation === 'zhihu.oauth.check') return cloudRequest('/api/zhihu/oauth/check', {})
    if (request.operation === 'zhihu.oauth.disconnect') return cloudRequest('/api/zhihu/oauth/disconnect', {})
    if (request.operation === 'zhihu.user.read') {
      if (!['contents', 'favorites', 'favorite_lists', 'favorite_items', 'followees'].includes(request.kind)) throw new Error('Invalid bounded Zhihu user request')
      const limit = request.limit === undefined ? 3 : request.limit
      const offset = request.offset === undefined ? '0' : request.offset
      if (!Number.isInteger(limit) || limit < 1 || limit > 10 || typeof offset !== 'string' || !/^\d{1,18}$/.test(offset)) throw new Error('Invalid bounded Zhihu user request')
      const body = { kind: request.kind, limit, offset }
      if (request.kind === 'favorite_items') {
        if (typeof request.favorite_id !== 'string' || !/^[a-zA-Z0-9._:-]{1,200}$/.test(request.favorite_id)) throw new Error('请先选择一个知乎收藏夹')
        body.favorite_id = request.favorite_id
      }
      return cloudRequest('/api/zhihu/user/read', body)
    }
    if (request.operation === 'agent.run.start') {
      if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 16_000 || !['none', 'zhihu', 'global'].includes(request.source)) throw new Error('Invalid bounded Agent request')
      const capabilities = await runtimeRequest('/api/agent/capabilities')
      if (!capabilities.enabled) throw new Error('Trace Agent Runtime is not enabled')
      const profileId = typeof request.profileId === 'string' && capabilities.profiles?.some((profile) => profile.profileId === request.profileId) ? request.profileId : capabilities.defaultProfileId
      const current = await runtimeRequest('/api/product/workspace')
      const matterId = `pet-${randomId()}`
      const created = await runtimeRequest('/api/product/commands', { protocolVersion: 1, commandId: `pet-command-${randomId()}`, expectedRevision: current.revision, operations: [{ type: 'capture.create', matterId, text: request.text.trim() }] })
      const session = created.host?.chain?.sessions?.[matterId]
      if (!session) throw new Error('Trace Runtime did not return the captured matter')
      const sources = await remoteSourceContext(request.source, request.text)
      const submitted = await runtimeRequest('/api/agent/runs', { protocolVersion: 1, requestId: `pet-run-${randomId()}`, expectedRevision: created.revision, matterId, contextMode: session.contextMode, contextEpoch: session.contextEpoch, purpose: 'discuss', input: `请帮助我分清这段原话里的条件、证据与仍不确定之处。结果只作为候选。${sources ? `\n\n${sources.prompt}` : ''}`, ...(profileId ? { profileId } : {}) })
      if (!submitted.run?.runId) throw new Error('Trace Runtime did not return a run identity')
      beginAgentEventSubscription(submitted.run.runId)
      return { ...submitted.run, ...(sources ? { sources: { source: sources.source, items: sources.items } } : {}) }
    }
    if (request.operation === 'agent.run.read') {
      const runId = requireId(request.runId, 'Agent 运行')
      return runtimeRequest(`/api/agent/runs/${encodeURIComponent(runId)}`, undefined, 10_000)
    }
    if (request.operation === 'agent.run.events') return runtimeEventStream(request.runId, request.after === undefined ? 0 : request.after)
    if (request.operation === 'agent.run.approval') {
      const runId = requireId(request.runId, 'Agent 运行')
      const interactionId = requireId(request.interactionId, '交互请求')
      if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) throw new Error('审批需要当前运行版本')
      const idempotencyKey = requireId(request.idempotencyKey, '审批幂等键')
      const decision = ['accept', 'accept_for_session', 'decline', 'cancel'].includes(request.decision) ? request.decision : null
      if (!decision) throw new Error('审批决定不正确')
      return runtimeRequest(`/api/agent/runs/${encodeURIComponent(runId)}/approval`, {
        interactionId, expectedRevision: request.expectedRevision, idempotencyKey, decision,
      })
    }
    if (request.operation === 'agent.run.input') {
      const runId = requireId(request.runId, 'Agent 运行')
      const interactionId = requireId(request.interactionId, '交互请求')
      if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) throw new Error('输入请求需要当前运行版本')
      const idempotencyKey = requireId(request.idempotencyKey, '输入幂等键')
      if (!request.answers || typeof request.answers !== 'object' || Array.isArray(request.answers)) throw new Error('输入答案不完整')
      return runtimeRequest(`/api/agent/runs/${encodeURIComponent(runId)}/input`, {
        interactionId, expectedRevision: request.expectedRevision, idempotencyKey, answers: request.answers,
      })
    }
    if (request.operation === 'agent.run.cancel') {
      const runId = requireId(request.runId, 'Agent 运行')
      return runtimeRequest(`/api/agent/runs/${encodeURIComponent(runId)}/cancel`, {})
    }
    if (request.operation === 'agent.run.adoption') {
      const runId = requireId(request.runId, 'Agent 运行')
      const action = ['accept', 'dismiss', 'undo'].includes(request.action) ? request.action : null
      if (!action) throw new Error('Agent 结果动作不正确')
      if (action === 'dismiss') return runtimeRequest(`/api/agent/runs/${encodeURIComponent(runId)}/adoption`, { action })
      if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) throw new Error('Agent 结果需要当前工作区版本')
      return runtimeRequest(`/api/agent/runs/${encodeURIComponent(runId)}/adoption`, { action, commandId: `desktop-agent-${action}-${randomId()}`, expectedRevision: request.expectedRevision })
    }
    if (request.operation === 'agent.run') {
      if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 16_000 || !['none', 'zhihu', 'global'].includes(request.source)) throw new Error('Invalid bounded Agent request')
      const capabilities = await runtimeRequest('/api/agent/capabilities')
      if (!capabilities.enabled) throw new Error('Trace Agent Runtime is not enabled')
      const profileId = typeof request.profileId === 'string' && capabilities.profiles?.some((profile) => profile.profileId === request.profileId)
        ? request.profileId
        : capabilities.defaultProfileId
      const current = await runtimeRequest('/api/product/workspace')
      const matterId = `pet-${randomId()}`
      const created = await runtimeRequest('/api/product/commands', {
        protocolVersion: 1,
        commandId: `pet-command-${randomId()}`,
        expectedRevision: current.revision,
        operations: [{ type: 'capture.create', matterId, text: request.text.trim() }],
      })
      const session = created.host?.chain?.sessions?.[matterId]
      if (!session) throw new Error('Trace Runtime did not return the captured matter')
      const sources = await remoteSourceContext(request.source, request.text)
      const submitted = await runtimeRequest('/api/agent/runs', {
        protocolVersion: 1,
        requestId: `pet-run-${randomId()}`,
        expectedRevision: created.revision,
        matterId,
        contextMode: session.contextMode,
        contextEpoch: session.contextEpoch,
        purpose: 'discuss',
        input: `请帮助我分清这段原话里的条件、证据与仍不确定之处。结果只作为候选。${sources ? `\n\n${sources.prompt}` : ''}`,
        ...(profileId ? { profileId } : {}),
      })
      const runId = submitted.run?.runId
      if (!runId) throw new Error('Trace Runtime did not return a run identity')
      beginAgentEventSubscription(runId)
      const deadline = now() + 190_000
      let run = submitted.run
      while (!TERMINAL_AGENT_STATES.has(run.status)) {
        if (now() >= deadline) throw new Error('Timed out while waiting for the Trace Agent run')
        await wait(500)
        run = await runtimeRequest(`/api/agent/runs/${encodeURIComponent(runId)}`, undefined, 10_000)
      }
      return { ...run, ...(sources ? { sources: { source: sources.source, items: sources.items } } : {}) }
    }
    if (request.operation === 'work.environment') {
      try {
        const { projectName } = currentProject()
        return { connected: true, projectName, agentLabel: 'Codex', locationLabel: '当前项目' }
      } catch (error) {
        return { connected: false, projectName: '当前项目', agentLabel: 'Codex', locationLabel: '等待识别', error: { message: error instanceof Error ? error.message : '当前项目不可用' } }
      }
    }
    if (request.operation === 'work.read') {
      const workId = boundedText(request.workId, '工作', 512)
      const workspace = await runtimeRequest('/api/product/workspace')
      return safeWorkResult(workspace, workId)
    }
    if (request.operation === 'work.run') {
      const { projectDir, projectName } = currentProject()
      const workId = boundedText(request.workId, '工作', 512)
      const matterId = boundedText(request.matterId, '事项', 512)
      const title = boundedText(request.title, '任务', 1_000)
      const text = boundedText(request.text, '带入内容')
      const note = typeof request.note === 'string' && request.note.length <= 16_000 ? request.note.trim() : ''
      const role = ['reference', 'trial'].includes(request.role) ? request.role : 'reference'
      const source = ['none', 'zhihu', 'global'].includes(request.source) ? request.source : 'none'
      const sessionId = `trace-desktop:${workId}`

      let workspace = await runtimeRequest('/api/product/workspace')
      const existingWork = workspace.host?.worksite?.works?.[workId]
      const existingMatter = workspace.host?.chain?.matters?.find((item) => item.id === matterId)
      if (existingMatter && existingMatter.originalText !== text) throw new Error('同一事项已经保存了不同的原话，未覆盖')
      if (!existingWork) {
        const operations = []
        if (!existingMatter) operations.push({ type: 'capture.create', matterId, text })
        operations.push({
          type: 'handoff.create', matterId, workId,
          destination: { agent: 'Codex', project: projectName, task: title },
          role, note, selectedText: text,
        })
        workspace = await runtimeRequest('/api/product/commands', {
          protocolVersion: 1,
          commandId: `desktop-work-create:${workId}`,
          expectedRevision: workspace.revision,
          operations,
        })
      } else if (existingWork.project !== projectName || existingWork.agent !== 'Codex') {
        throw new Error('这次工作属于另一个执行位置，未重新绑定')
      }

      let visible = safeWorkResult(workspace, workId)
      if (visible?.status === 'returned_for_review' && visible.result) return visible

      let delivery = workspace.host?.worksite?.sessions?.[workId]?.codexDelivery
      if (!delivery) {
        const received = await runtimeRequest('/api/product/codex/receive', {
          protocolVersion: 1,
          commandId: `desktop-work-receive:${workId}`,
          workId,
          sessionId,
          projectDir,
        })
        delivery = { ...received.receipt, snapshot: received.context }
      }

      workspace = await runtimeRequest('/api/product/workspace')
      const matterSession = workspace.host?.chain?.sessions?.[matterId]
      if (!matterSession) throw new Error('本次事项没有可交给 Codex 的上下文')
      const capabilities = await runtimeRequest('/api/agent/capabilities')
      if (!capabilities.enabled) throw new Error('本机 Agent 尚未启用')
      const requestedProfile = typeof request.profileId === 'string'
        ? capabilities.profiles?.find((profile) => profile.profileId === request.profileId)
        : null
      const profile = requestedProfile?.kind === 'codex'
        ? requestedProfile
        : capabilities.profiles?.find((item) => item.kind === 'codex')
      if (!profile) throw new Error('本机没有可用的 Codex 执行器')

      const sources = await remoteSourceContext(source, `${title} ${text}`)
      const submitted = await runtimeRequest('/api/agent/runs', {
        protocolVersion: 1,
        requestId: `desktop-work-run:${workId}`,
        expectedRevision: workspace.revision,
        matterId,
        contextMode: matterSession.contextMode,
        contextEpoch: matterSession.contextEpoch,
        purpose: 'discuss',
        profileId: profile.profileId,
        input: `完成这次工作：${title}\n\n请只返回实际得到的结果、你的解释与仍需确认的条件；不要自动修改用户的理解。${sources ? `\n\n${sources.prompt}` : ''}`,
      })
      const runId = submitted.run?.runId
      if (!runId) throw new Error('Codex 没有返回本次运行')
      beginAgentEventSubscription(runId)
      const deadline = now() + 190_000
      let run = submitted.run
      while (!TERMINAL_AGENT_STATES.has(run.status)) {
        if (now() >= deadline) throw new Error('等待 Codex 返回结果超时；可以稍后重新接回')
        await wait(500)
        run = await runtimeRequest(`/api/agent/runs/${encodeURIComponent(runId)}`, undefined, 10_000)
      }
      if (run.status !== 'succeeded' || !run.result?.answer) throw new Error(run.error?.message || `Codex 本次工作未完成（${run.status}）`)

      const returned = await runtimeRequest('/api/product/codex/return', {
        protocolVersion: 1,
        commandId: `desktop-work-return:${workId}`,
        workId,
        sessionId,
        projectDir,
        deliveryId: delivery.deliveryId,
        contextHash: delivery.contextHash,
        result: {
          matterId,
          summary: run.result.answer.slice(0, 1_000),
          fact: run.result.answer,
          interpretation: `由 ${run.profile?.label || 'Codex'} 根据本次明确带入的内容完成。`,
          unconfirmed: Array.isArray(run.result.uncertainties) ? run.result.uncertainties.join('\n') : '',
          proposedUnderstanding: '',
          artifacts: [],
        },
      })
      workspace = await runtimeRequest('/api/product/workspace')
      visible = safeWorkResult(workspace, workId)
      if (!visible?.result || returned.receipt?.status !== 'returned_for_review') throw new Error('Codex 结果尚未进入 Trace 复核区')
      return visible
    }
    throw new Error('Unsupported capability operation')
  }

  return { origin: backendOrigin, request: capabilityRequest, setProjectDir, subscribeAgentRun }
}

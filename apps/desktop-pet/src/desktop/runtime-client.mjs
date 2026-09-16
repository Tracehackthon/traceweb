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
const TERMINAL_AGENT_STATES = new Set(['succeeded', 'failed', 'cancelled', 'stale', 'timed_out', 'interrupted'])
const NO_NOT_FOUND_FALLBACK = Symbol('no-not-found-fallback')

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
} = {}) {
  const backendOrigin = validateRuntimeOrigin(origin)
  const cloudBase = new URL(cloudOrigin)
  if (cloudBase.protocol !== 'https:' || cloudBase.username || cloudBase.password || cloudBase.pathname !== '/' || cloudBase.search || cloudBase.hash) throw new Error('TRACE_CLOUD_ORIGIN must be an HTTPS origin')
  let projectContext
  let selectedProjectDir = configuredProjectDir
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

  async function cloudRequest(pathname, body, timeoutMs = 35_000) {
    const url = new URL(pathname, cloudBase.origin)
    if (url.origin !== cloudBase.origin || !url.pathname.startsWith('/api/')) throw new Error('Unsupported Trace Cloud path')
    let response
    try {
      response = await cloudFetchImpl(url, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
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
    if (request.operation === 'workspace.summary') return readObservationSummary()
    if (request.operation === 'workspace.capture') return captureObservation(request.text, request.source)
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
      if (!['contents', 'favorites', 'followees'].includes(request.kind)) throw new Error('Invalid bounded Zhihu user request')
      const limit = request.limit === undefined ? 3 : request.limit
      const offset = request.offset === undefined ? '0' : request.offset
      if (!Number.isInteger(limit) || limit < 1 || limit > 20 || typeof offset !== 'string' || !/^\d{1,18}$/.test(offset)) throw new Error('Invalid bounded Zhihu user request')
      return cloudRequest('/api/zhihu/user/read', { kind: request.kind, limit, offset })
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

  return { origin: backendOrigin, request: capabilityRequest, setProjectDir }
}

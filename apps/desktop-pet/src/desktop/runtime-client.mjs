import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_ORIGIN = 'http://127.0.0.1:4173'
const TERMINAL_AGENT_STATES = new Set(['succeeded', 'failed', 'cancelled', 'stale', 'timed_out', 'interrupted'])

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
  const fallback = `本机 Trace 没有完成这次请求（${status}）`
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

export function validateRuntimeOrigin(value = DEFAULT_ORIGIN) {
  const url = new URL(value)
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
  if (url.protocol !== 'http:' || !loopback || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('TRACE_BACKEND_ORIGIN must be a loopback HTTP origin')
  }
  return url.origin
}

export function createRuntimeCapabilityClient({
  origin = process.env.TRACE_BACKEND_ORIGIN || DEFAULT_ORIGIN,
  projectDir: configuredProjectDir,
  fetchImpl = globalThis.fetch,
  randomId = randomUUID,
  now = Date.now,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const backendOrigin = validateRuntimeOrigin(origin)
  let projectContext
  const currentProject = () => {
    if (!projectContext) {
      const projectDir = findProjectDir(configuredProjectDir)
      projectContext = { projectDir, projectName: safeProjectName(projectDir) }
    }
    return projectContext
  }

  async function runtimeRequest(pathname, body, timeoutMs = 35_000) {
    const url = new URL(pathname, backendOrigin)
    if (url.origin !== backendOrigin || !url.pathname.startsWith('/api/')) throw new Error('Unsupported Trace Runtime path')
    const response = await fetchImpl(url, {
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
    const text = await response.text()
    if (text.length > 1_048_576) throw new Error('Trace Runtime response exceeded 1 MiB')
    let value
    try { value = JSON.parse(text) } catch { throw new Error(`Trace Runtime returned an unreadable response (${response.status})`) }
    if (!response.ok) throw new Error(publicRuntimeError(value, response.status))
    return value
  }

  async function capabilityRequest(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.operation !== 'string') throw new Error('Invalid capability request')
    if (request.operation === 'capabilities') {
      const [searchResult, agentResult] = await Promise.allSettled([
        runtimeRequest('/api/search/capabilities'),
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
    if (request.operation === 'search') {
      if (!['zhihu', 'global'].includes(request.source) || typeof request.query !== 'string' || !request.query.trim() || request.query.length > 500 || !Number.isInteger(request.count) || request.count < 1 || request.count > 5) throw new Error('Invalid bounded search request')
      return runtimeRequest(request.source === 'global' ? '/api/search/global' : '/api/search/zhihu', { query: request.query.trim(), count: request.count })
    }
    if (request.operation === 'zhihu.status') return runtimeRequest('/api/zhihu/status')
    if (request.operation === 'zhihu.oauth.start') return runtimeRequest('/api/zhihu/oauth/start', {})
    if (request.operation === 'zhihu.oauth.check') return runtimeRequest('/api/zhihu/oauth/check', {})
    if (request.operation === 'zhihu.oauth.disconnect') return runtimeRequest('/api/zhihu/oauth/disconnect', {})
    if (request.operation === 'zhihu.user.read') {
      if (!['contents', 'favorites', 'followees'].includes(request.kind)) throw new Error('Invalid bounded Zhihu user request')
      const limit = request.limit === undefined ? 3 : request.limit
      const offset = request.offset === undefined ? '0' : request.offset
      if (!Number.isInteger(limit) || limit < 1 || limit > 20 || typeof offset !== 'string' || !/^\d{1,18}$/.test(offset)) throw new Error('Invalid bounded Zhihu user request')
      return runtimeRequest('/api/zhihu/user/read', { kind: request.kind, limit, offset })
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
      const submitted = await runtimeRequest('/api/agent/runs', {
        protocolVersion: 1,
        requestId: `pet-run-${randomId()}`,
        expectedRevision: created.revision,
        matterId,
        contextMode: session.contextMode,
        contextEpoch: session.contextEpoch,
        purpose: 'discuss',
        input: '请帮助我分清这段原话里的条件、证据与仍不确定之处。结果只作为候选。',
        ...(profileId ? { profileId } : {}),
        ...(request.source === 'none' ? {} : { retrieval: { sources: [request.source] } }),
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
      return run
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

      const submitted = await runtimeRequest('/api/agent/runs', {
        protocolVersion: 1,
        requestId: `desktop-work-run:${workId}`,
        expectedRevision: workspace.revision,
        matterId,
        contextMode: matterSession.contextMode,
        contextEpoch: matterSession.contextEpoch,
        purpose: 'discuss',
        profileId: profile.profileId,
        input: `完成这次工作：${title}\n\n请只返回实际得到的结果、你的解释与仍需确认的条件；不要自动修改用户的理解。`,
        ...(source === 'none' ? {} : { retrieval: { sources: [source] } }),
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

  return { origin: backendOrigin, request: capabilityRequest }
}

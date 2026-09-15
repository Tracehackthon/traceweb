import { randomUUID } from 'node:crypto'

const DEFAULT_ORIGIN = 'http://127.0.0.1:4173'
const TERMINAL_AGENT_STATES = new Set(['succeeded', 'failed', 'cancelled', 'stale', 'timed_out', 'interrupted'])

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
  fetchImpl = globalThis.fetch,
  randomId = randomUUID,
  now = Date.now,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const backendOrigin = validateRuntimeOrigin(origin)

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
    if (!response.ok) throw new Error(value?.error?.message || `Trace Runtime request failed (${response.status})`)
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
        origin: backendOrigin,
        search: searchResult.status === 'fulfilled' ? searchResult.value : { enabled: false, error: { message: searchResult.reason?.message || 'Search capability unavailable' } },
        agent: agentResult.status === 'fulfilled' ? agentResult.value : { enabled: false, profiles: [], error: { message: agentResult.reason?.message || 'Agent capability unavailable' } },
        ...(connected ? {} : { error: { message: 'Trace Runtime is not reachable' } }),
      }
    }
    if (request.operation === 'search') {
      if (!['zhihu', 'global'].includes(request.source) || typeof request.query !== 'string' || !request.query.trim() || request.query.length > 500 || !Number.isInteger(request.count) || request.count < 1 || request.count > 5) throw new Error('Invalid bounded search request')
      return runtimeRequest(request.source === 'global' ? '/api/search/global' : '/api/search/zhihu', { query: request.query.trim(), count: request.count })
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
    throw new Error('Unsupported capability operation')
  }

  return { origin: backendOrigin, request: capabilityRequest }
}

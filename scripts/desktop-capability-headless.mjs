import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRuntimeCapabilityClient } from '../apps/desktop-pet/src/desktop/runtime-client.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = path.resolve(process.env.TRACE_HEADLESS_RUNTIME_ROOT || path.join(root, 'apps', 'desktop-pet', 'runtime-dist'))
const liveCloud = process.argv.includes('--live-cloud')
const keep = process.argv.includes('--keep')
const tempRoot = path.resolve(root, '.tmp')
fs.mkdirSync(tempRoot, { recursive: true })
if (!fs.existsSync(path.join(runtimeRoot, 'apps', 'desktop', 'server.mjs'))) {
  throw new Error(`Staged Trace Runtime was not found at ${runtimeRoot}; run runtime staging first or set TRACE_HEADLESS_RUNTIME_ROOT.`)
}
const runRoot = fs.mkdtempSync(path.join(tempRoot, 'desktop-capability-headless-'))
const projectDir = path.join(runRoot, 'selected-project')
const reportDir = path.join(root, 'artifacts', 'desktop-capability-headless')
fs.mkdirSync(projectDir, { recursive: true })
fs.mkdirSync(reportDir, { recursive: true })

const matrix = []
const add = (capability, status, detail, evidence = {}) => matrix.push({ capability, status, detail, evidence })
const pass = (capability, detail, evidence) => add(capability, 'pass', detail, evidence)
const blocked = (capability, detail, evidence) => add(capability, 'blocked', detail, evidence)
const fail = (capability, error, evidence) => add(capability, 'fail', error instanceof Error ? error.message : String(error), evidence)

function listen(server) {
  server.listen(0, '127.0.0.1')
  return once(server, 'listening').then(() => server.address().port)
}

function jsonResponse(response, value, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

let modelCall = 0
const modelServer = http.createServer(async (request, response) => {
  let raw = ''
  request.setEncoding('utf8')
  for await (const chunk of request) raw += chunk
  const body = JSON.parse(raw)
  const serialized = JSON.stringify(body)
  const userText = (body.messages || []).filter((message) => message.role === 'user').map((message) => String(message.content || '')).join('\n')
  const revisionRequest = userText.includes('revise：')
  if (serialized.includes('等待取消')) {
    await new Promise((resolve) => setTimeout(resolve, 10_000))
    if (response.destroyed) return
  }
  modelCall += 1
  const hasToolResult = body.messages?.some((message) => message.role === 'tool')
  const message = !hasToolResult
    ? { role: 'assistant', content: null, tool_calls: [{ id: `read-${modelCall}`, type: 'function', function: { name: 'trace_context_read', arguments: '{"id":"matter:original"}' } }] }
    : { role: 'assistant', content: JSON.stringify({
      answer: revisionRequest ? '建议把条件写得更明确。' : '已区分事实、判断与未确认条件。',
      replacement: revisionRequest ? '原始观察（条件已明确）' : null,
      citations: [{ contextId: 'matter:original', quote: serialized.includes('原始观察') ? '原始观察' : serialized.includes('等待取消') ? '等待取消' : '底层链路观察' }],
      uncertainties: [],
    }) }
  jsonResponse(response, { choices: [{ message }] })
})

let runtime
let client
try {
  const modelPort = await listen(modelServer)
  const profiles = path.join(runRoot, 'profiles.json')
  fs.writeFileSync(profiles, `${JSON.stringify({
    protocolVersion: 1,
    configVersion: 1,
    ownerId: 'headless-harness',
    defaultProfileId: 'fixture-model',
    profiles: [{
      id: 'fixture-model', label: 'Headless fixture model', kind: 'model', enabled: true, version: 1,
      endpoint: `http://127.0.0.1:${modelPort}/v1/chat/completions`, model: 'fixture',
      credentialEnv: 'TRACE_HEADLESS_MODEL_TOKEN',
    }],
  }, null, 2)}\n`, 'utf8')

  Object.assign(process.env, {
    TRACE_RUNTIME_ROOT: runtimeRoot,
    TRACE_DESKTOP_PORT: '0',
    TRACE_WEB_STATE_FILE: path.join(runRoot, 'web.sqlite'),
    TRACE_AGENT_STATE_FILE: path.join(runRoot, 'agent.sqlite'),
    TRACE_AGENT_RUNTIME_ROOT: path.join(runRoot, 'agent-runs'),
    TRACE_AGENT_PROFILES_FILE: profiles,
    TRACE_HEADLESS_MODEL_TOKEN: 'fixture-only-secret',
    TRACE_INSTALLATION_ID: `installation-${randomUUID()}`,
    TRACE_WORKSPACE_ID: `workspace-${randomUUID()}`,
    TRACE_UPGRADE_LEGACY_IDENTITY: '1',
    TRACE_AGENT_ENABLED: '1',
  })
  const entry = path.join(runtimeRoot, 'apps', 'desktop', 'server.mjs')
  runtime = await import(`${pathToFileURL(entry).href}?headless=${Date.now()}`)
  const binding = await runtime.ready
  const origin = `http://127.0.0.1:${binding.port}`
  client = createRuntimeCapabilityClient({
    origin,
    cloudOrigin: 'https://trace.neutrom.store',
    projectDir,
    runtimeRoot,
    randomId: randomUUID,
  })

  const api = async (pathname, body) => {
    const response = await fetch(new URL(pathname, origin), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { origin, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    let value
    try { value = JSON.parse(text) } catch { value = text }
    return { response, value }
  }

  try {
    const selected = client.setProjectDir(projectDir)
    const environment = await client.request({ operation: 'work.environment' })
    if (!selected.connected || !environment.connected || selected.projectName !== path.basename(projectDir)) throw new Error('selected project was not retained')
    pass('project.select', '显式选择的普通文件夹已成为当前工作目录。', { projectName: selected.projectName, repository: selected.repository })
  } catch (error) { fail('project.select', error) }

  let capture
  try {
    capture = await client.request({ operation: 'workspace.capture', text: '底层链路观察', source: 'headless-harness' })
    const summary = await client.request({ operation: 'workspace.summary' })
    const found = summary.observations.find((item) => item.id === capture.observation.id)
    if (!found || summary.revision !== capture.revision) throw new Error('saved observation did not round-trip from authoritative workspace')
    pass('workspace.save-read', '写入已从同一临时 SQLite 权威工作区读回。', { revision: summary.revision, observationId: found.id })
  } catch (error) { fail('workspace.save-read', error) }

  try {
    const capabilities = await client.request({ operation: 'capabilities' })
    if (!capabilities.agent?.enabled || capabilities.agent.defaultProfileId !== 'fixture-model') throw new Error('configured Agent profile is not active')
    pass('agent.capabilities', '桌面 Bridge 读取到 Runtime 实际启用的执行器。', { defaultProfileId: capabilities.agent.defaultProfileId })
  } catch (error) { fail('agent.capabilities', error) }

  let completedRun
  try {
    completedRun = await client.request({ operation: 'agent.run.start', text: '底层链路观察', source: 'none', profileId: 'fixture-model' })
    for (let index = 0; index < 200 && !['succeeded', 'failed', 'cancelled', 'timed_out', 'stale'].includes(completedRun.status); index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      completedRun = await client.request({ operation: 'agent.run.read', runId: completedRun.runId })
    }
    if (completedRun.status !== 'succeeded') throw new Error(`run ended as ${completedRun.status}: ${JSON.stringify(completedRun.error || null)}`)
    const events = await client.request({ operation: 'agent.run.events', runId: completedRun.runId, after: 0 })
    if (!events.events.some((event) => event.data?.type === 'run.succeeded' || event.type === 'run.succeeded')) throw new Error('terminal SSE event was not persisted')
    pass('agent.run-read-events', '创建、读取和持久 SSE 终态均由真实 Runtime/agent.sqlite 返回。', { runId: completedRun.runId, status: completedRun.status, eventCount: events.events.length })
  } catch (error) { fail('agent.run-read-events', error, completedRun?.runId ? { runId: completedRun.runId } : {}) }

  try {
    let slow = await client.request({ operation: 'agent.run.start', text: '等待取消', source: 'none', profileId: 'fixture-model' })
    const cancelled = await client.request({ operation: 'agent.run.cancel', runId: slow.runId })
    slow = await client.request({ operation: 'agent.run.read', runId: slow.runId })
    if (cancelled.status !== 'cancelled' || slow.status !== 'cancelled') throw new Error('cancel did not become authoritative terminal state')
    pass('agent.cancel', '取消已写入 agent.sqlite 并从 run read 返回终态。', { runId: slow.runId, status: slow.status })
  } catch (error) { fail('agent.cancel', error) }

  let revisionRun
  try {
    const workspace = (await api('/api/product/workspace')).value
    const matterId = `headless-revise-${randomUUID()}`
    const created = (await api('/api/product/commands', {
      protocolVersion: 1, commandId: `headless-seed-${randomUUID()}`, expectedRevision: workspace.revision,
      operations: [
        { type: 'capture.create', matterId, text: '原始观察' },
        { type: 'chain.action', matterId, action: { type: 'UNDERSTANDING_DRAFT', text: '原始观察' } },
        { type: 'chain.action', matterId, action: { type: 'SAVE_UNDERSTANDING' } },
      ],
    })).value
    const session = created.host.chain.sessions[matterId]
    const submitted = await api('/api/agent/runs', {
      protocolVersion: 1, requestId: `headless-revise-run-${randomUUID()}`, expectedRevision: created.revision,
      matterId, contextMode: session.contextMode, contextEpoch: session.contextEpoch, purpose: 'revise',
      input: 'revise：把条件写明确', profileId: 'fixture-model',
      selection: { field: 'understandingDraft', start: 0, end: 4, text: '原始观察' },
    })
    if (!submitted.response.ok || !submitted.value?.run) throw new Error(`revision run was rejected (${submitted.response.status}): ${JSON.stringify(submitted.value)}`)
    revisionRun = submitted.value.run
    for (let index = 0; index < 200 && !['succeeded', 'failed', 'cancelled'].includes(revisionRun.status); index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      revisionRun = await client.request({ operation: 'agent.run.read', runId: revisionRun.runId })
    }
    if (revisionRun.status !== 'succeeded' || revisionRun.result?.kind !== 'revision_candidate') throw new Error(`revision candidate ended as ${revisionRun.status}`)
    let current = (await api('/api/product/workspace')).value
    const accepted = await client.request({ operation: 'agent.run.adoption', runId: revisionRun.runId, action: 'accept', expectedRevision: current.revision })
    current = (await api('/api/product/workspace')).value
    const undone = await client.request({ operation: 'agent.run.adoption', runId: revisionRun.runId, action: 'undo', expectedRevision: current.revision })
    if (accepted.run?.result?.adoption !== 'applied' || undone.run?.result?.adoption !== 'undone') throw new Error('candidate adoption did not round-trip')
    pass('agent.candidate-accept-undo', '修订候选的采纳与撤销均改变了权威 Product/Agent 状态。', { runId: revisionRun.runId, revision: current.revision })
  } catch (error) { fail('agent.candidate-accept-undo', error, revisionRun?.runId ? { runId: revisionRun.runId } : {}) }

  try {
    if (!completedRun?.runId) throw new Error('no completed run available')
    const dismissed = await client.request({ operation: 'agent.run.adoption', runId: completedRun.runId, action: 'dismiss' })
    if (dismissed.run?.result?.adoption !== 'dismissed') throw new Error('dismiss was not persisted')
    pass('agent.candidate-dismiss', '普通结果的忽略状态已持久化。', { runId: completedRun.runId })
  } catch (error) { fail('agent.candidate-dismiss', error) }

  try {
    const targetRun = completedRun?.runId
    const response = await api(`/api/agent/runs/${targetRun}/approval`, {
      interactionId: 'not-waiting', expectedRevision: 0, idempotencyKey: randomUUID(), decision: 'accept',
    })
    if (response.response.status !== 409) throw new Error(`expected fail-closed 409, got ${response.response.status}`)
    pass('agent.approval-endpoint', '审批接口存在，并对非 waiting run 失败关闭。', { status: response.response.status, code: response.value?.error?.code })
    blocked('agent.approval-resume', '本 harness 不运行真实 Native Codex turn；同一 turn 的 waiting→approve→resume 由原生专项 live test 验证。')
  } catch (error) { fail('agent.approval-endpoint', error) }

  try {
    const targetRun = completedRun?.runId
    const response = await api(`/api/agent/runs/${targetRun}/input`, {
      interactionId: 'not-waiting', expectedRevision: 0, idempotencyKey: randomUUID(), answers: { q: 'answer' },
    })
    if (response.response.status !== 409) throw new Error(`expected fail-closed 409, got ${response.response.status}`)
    pass('agent.input-endpoint', '用户输入接口存在，并对非 waiting run 失败关闭。', { status: response.response.status, code: response.value?.error?.code })
    blocked('agent.input-resume', '需要产生真实 Native Codex input waiting 事件；本 harness 不调用用户模型。')
  } catch (error) { fail('agent.input-endpoint', error) }

  try {
    const capabilities = (await api('/api/agent/capabilities')).value
    const codex = capabilities.profiles?.find((profile) => profile.kind === 'codex')
    if (!codex) blocked('codex.qualification', '隔离 profile 明确只启用 fixture model；没有伪装成 Codex qualification 通过。')
    else {
      const checked = await client.request({ operation: 'setup.codex.check' })
      checked.ready ? pass('codex.qualification', 'Codex 非模型连接检查通过。', { version: checked.version }) : blocked('codex.qualification', 'Codex 已发现但尚未认证。')
    }
  } catch (error) { blocked('codex.qualification', error instanceof Error ? error.message : String(error)) }

  if (liveCloud) {
    for (const [capability, request] of [
      ['search.zhihu', { operation: 'search', source: 'zhihu', query: 'AI Agent 工作流', count: 1 }],
      ['search.global', { operation: 'search', source: 'global', query: 'AI Agent 工作流', count: 1 }],
      ['zhihu.oauth.status', { operation: 'zhihu.status' }],
      ['zhihu.oauth.start', { operation: 'zhihu.oauth.start' }],
      ['zhihu.oauth.check', { operation: 'zhihu.oauth.check' }],
    ]) {
      try {
        const value = await client.request(request)
        if (capability.startsWith('search.') && !Array.isArray(value.items)) throw new Error('search response has no item list')
        if (capability === 'zhihu.oauth.start' && value.status !== 'user_action_required') throw new Error('OAuth start did not return a bounded user action')
        pass(capability, '生产云端接口从无界面客户端返回了有效契约。', { itemCount: Array.isArray(value.items) ? value.items.length : undefined, oauthStatus: value.oauth?.status || value.status })
      } catch (error) { fail(capability, error) }
    }
    blocked('zhihu.oauth.callback', 'OAuth start 已验证；完成授权必须由用户在知乎页面确认，headless harness 不冒充用户授权。')
  } else {
    for (const capability of ['search.zhihu', 'search.global', 'zhihu.oauth.status', 'zhihu.oauth.start', 'zhihu.oauth.check', 'zhihu.oauth.callback']) {
      blocked(capability, '未传 --live-cloud，普通回归不会访问生产云端。')
    }
  }

  const workspaceFile = path.join(runRoot, 'web.sqlite')
  const agentFile = path.join(runRoot, 'agent.sqlite')
  if (!fs.existsSync(workspaceFile) || !fs.existsSync(agentFile)) throw new Error('authoritative SQLite files were not created')
  const report = {
    schemaVersion: 'trace.desktop-capability-headless@1',
    generatedAt: new Date().toISOString(),
    runtime: { root: runtimeRoot, origin, productDatabase: workspaceFile, agentDatabase: agentFile },
    liveCloud,
    summary: {
      pass: matrix.filter((item) => item.status === 'pass').length,
      blocked: matrix.filter((item) => item.status === 'blocked').length,
      fail: matrix.filter((item) => item.status === 'fail').length,
    },
    matrix,
  }
  const reportFile = path.join(reportDir, `run-${Date.now()}.json`)
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...report.summary, report: reportFile }))
  for (const item of matrix) console.log(`${item.status.toUpperCase()}\t${item.capability}\t${item.detail}`)
  if (report.summary.fail) process.exitCode = 1
} finally {
  client?.close()
  try { await runtime?.close?.() } catch {}
  modelServer.closeAllConnections?.()
  if (modelServer.listening) await new Promise((resolve) => modelServer.close(resolve))
  if (!keep) fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

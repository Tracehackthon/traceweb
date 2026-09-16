import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  DEFAULT_CLOUD_ORIGIN,
  DEFAULT_RUNTIME_ORIGIN,
  createRuntimeCapabilityClient,
  resolveCodexExecutable,
  validateRuntimeOrigin,
} from '../../desktop-pet/src/desktop/runtime-client.mjs'
import { REDIRECT_URI } from '../../../lib/zhihu-oauth.mjs'

const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})
test('desktop runtime client accepts only loopback HTTP origins', () => {
  assert.equal(DEFAULT_RUNTIME_ORIGIN, 'http://127.0.0.1:42731')
  assert.equal(DEFAULT_CLOUD_ORIGIN, new URL(REDIRECT_URI).origin, 'OAuth start and callback must share one cookie origin')
  assert.equal(validateRuntimeOrigin('http://127.0.0.1:4173'), 'http://127.0.0.1:4173')
  assert.equal(validateRuntimeOrigin('http://localhost:9000'), 'http://localhost:9000')
  assert.throws(() => validateRuntimeOrigin('https://trace.example.test'), /loopback HTTP origin/)
  assert.throws(() => validateRuntimeOrigin('http://user:pass@127.0.0.1:4173'), /loopback HTTP origin/)
  assert.throws(() => validateRuntimeOrigin('http://127.0.0.1:4173/api'), /loopback HTTP origin/)
})

test('desktop discovers the Codex App executable outside a stale Explorer PATH', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'trace-codex-discovery-'))
  const executable = path.join(root, 'OpenAI', 'Codex', 'bin', 'release-hash', 'codex.exe')
  await mkdir(path.dirname(executable), { recursive: true })
  await import('node:fs/promises').then(({ writeFile }) => writeFile(executable, 'fixture'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.equal(resolveCodexExecutable({ env: { LOCALAPPDATA: root, PATH: '' }, platform: 'win32' }), executable)
  assert.equal(resolveCodexExecutable({ env: { TRACE_CODEX_BIN: 'C:\\explicit\\codex.exe', LOCALAPPDATA: root }, platform: 'win32' }), 'C:\\explicit\\codex.exe')
})

test('desktop runtime client discovers search and Agent independently', async () => {
  const calls = []
  const client = createRuntimeCapabilityClient({
    origin: 'http://127.0.0.1:4417',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      if (url.pathname === '/api/search/capabilities') return response({ enabled: true, sources: { zhihu: { enabled: true }, global: { enabled: true } } })
      if (url.pathname === '/api/agent/capabilities') return response({ enabled: true, defaultProfileId: 'local-codex', profiles: [{ profileId: 'local-codex', kind: 'codex' }] })
      return response({ error: { message: 'not found' } }, 404)
    },
  })
  const value = await client.request({ operation: 'capabilities' })
  assert.equal(value.connected, true)
  assert.equal('origin' in value, false)
  assert.equal(value.search.enabled, true)
  assert.equal(value.agent.profiles[0].kind, 'codex')
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname).sort(), ['/api/agent/capabilities', '/api/search/capabilities'])
  assert.deepEqual(calls.map((call) => call.init.headers.origin).sort(), ['http://127.0.0.1:4417', 'https://trace.neutrom.store'])
})

test('desktop runtime client never sends backend paths or protocol fields to the renderer in errors', async () => {
  const client = createRuntimeCapabilityClient({
    origin: 'http://127.0.0.1:4416',
    fetchImpl: async () => response({ error: { message: 'projectDir C:\\private\\repo failed with contextHash abc' } }, 500),
  })
  await assert.rejects(
    client.request({ operation: 'search', source: 'zhihu', query: '边界', count: 1 }),
    (error) => error.message === 'Trace 没有完成这次请求（500）',
  )
})

test('desktop first-run setup reports only safe project and verified Codex details', async (t) => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'trace-desktop-setup-'))
  const projectDir = path.join(fixtureRoot, 'private-workspace')
  await mkdir(path.join(projectDir, '.git'), { recursive: true })
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }))
  const calls = []
  const client = createRuntimeCapabilityClient({
    projectDir,
    fetchImpl: async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : undefined
      calls.push({ pathname: url.pathname, body })
      if (url.pathname === '/api/agent/capabilities') return response({ enabled: true, profiles: [{ profileId: 'local-codex', label: 'Codex', kind: 'codex' }] })
      if (url.pathname === '/api/agent/check') return response({ authenticated: true, version: 'codex-cli 0.153.4' })
      return response({ error: { message: 'not found' } }, 404)
    },
  })

  const setup = await client.request({ operation: 'setup.status' })
  assert.equal(setup.project.name, 'private-workspace')
  assert.equal(JSON.stringify(setup).includes(projectDir), false)
  const checked = await client.request({ operation: 'setup.codex.check' })
  assert.deepEqual(checked, { ready: true, authenticated: true, version: 'codex-cli 0.153.4', label: 'Codex' })
  assert.deepEqual(calls.map((call) => call.pathname), ['/api/agent/capabilities', '/api/agent/capabilities', '/api/agent/check'])
  assert.deepEqual(calls[2].body, { profileId: 'local-codex' })
})

test('desktop first-run Zhihu status fails safely when the cloud route is unavailable', async () => {
  const client = createRuntimeCapabilityClient({
    fetchImpl: async () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } }),
  })
  await assert.rejects(client.request({ operation: 'zhihu.status' }), (error) => {
    assert.equal(error.message, 'Trace 云端能力暂时不可用，请稍后重试')
    assert.equal(error.message.includes('Not found'), false)
    return true
  })
})

test('desktop setup hides transport and non-JSON runtime errors from the product UI', async () => {
  const networkFailure = createRuntimeCapabilityClient({
    fetchImpl: async () => { throw new TypeError('fetch failed: ECONNREFUSED 127.0.0.1:42731') },
  })
  await assert.rejects(networkFailure.request({ operation: 'setup.status' }), (error) => {
    assert.equal(error.message, 'Trace 本机能力没有启动，请重新打开 Trace 后再试')
    assert.equal(error.message.includes('ECONNREFUSED'), false)
    return true
  })

  const htmlFailure = createRuntimeCapabilityClient({
    fetchImpl: async () => new Response('<h1>Not found</h1>', { status: 404, headers: { 'content-type': 'text/html' } }),
  })
  await assert.rejects(htmlFailure.request({ operation: 'setup.status' }), (error) => {
    assert.equal(error.message, 'Trace 本机能力没有正确响应，请重新打开 Trace 后再试')
    assert.equal(error.message.includes('404'), false)
    return true
  })
})

test('desktop Zhihu status hides redirect and transport implementation errors', async () => {
  const client = createRuntimeCapabilityClient({
    cloudFetchImpl: async () => { throw new TypeError("Attempted to redirect, but redirect policy was 'error'") },
  })
  await assert.rejects(client.request({ operation: 'zhihu.status' }), (error) => {
    assert.equal(error.message, '知乎与联网能力暂时不可用，请稍后重试')
    assert.equal(error.message.includes('redirect'), false)
    return true
  })
})

test('desktop runtime client executes the bounded product to Agent chain', async () => {
  const calls = []
  let id = 0
  const client = createRuntimeCapabilityClient({
    origin: 'http://127.0.0.1:4418',
    randomId: () => `id-${++id}`,
    wait: async () => {},
    now: () => 0,
    fetchImpl: async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : undefined
      calls.push({ pathname: url.pathname, method: init.method, body })
      if (url.pathname === '/api/agent/capabilities') return response({ enabled: true, defaultProfileId: 'local-codex', profiles: [{ profileId: 'local-codex', kind: 'codex' }] })
      if (url.pathname === '/api/product/workspace') return response({ revision: 7, host: null })
      if (url.pathname === '/api/product/commands') return response({ revision: 8, host: { chain: { sessions: { 'pet-id-1': { contextMode: 'resume', contextEpoch: 0 } } } } })
      if (url.pathname === '/api/search/zhihu') return response({ source: 'zhihu', items: [{ id: 'z-1', title: '知乎材料', author: '答主', url: 'https://www.zhihu.com/question/1/answer/2', excerpt: '这是本次取得的摘要。' }] })
      if (url.pathname === '/api/agent/runs' && init.method === 'POST') return response({ run: { runId: 'run-1', status: 'queued' } }, 202)
      if (url.pathname === '/api/agent/runs/run-1') return response({ runId: 'run-1', status: 'succeeded', profile: { profileId: 'local-codex', kind: 'codex' }, result: { answer: '候选回答', adoption: 'not_applied' } })
      return response({ error: { message: 'not found' } }, 404)
    },
  })

  const run = await client.request({ operation: 'agent.run', text: '  保留原话，再核对依据。  ', source: 'zhihu', profileId: 'local-codex' })
  assert.equal(run.status, 'succeeded')
  assert.equal(run.result.adoption, 'not_applied')
  assert.deepEqual(calls.map((call) => call.pathname), [
    '/api/agent/capabilities',
    '/api/product/workspace',
    '/api/product/commands',
    '/api/search/zhihu',
    '/api/agent/runs',
    '/api/agent/runs/run-1',
  ])
  assert.deepEqual(calls[2].body.operations, [{ type: 'capture.create', matterId: 'pet-id-1', text: '保留原话，再核对依据。' }])
  assert.equal(calls[4].body.expectedRevision, 8)
  assert.equal(calls[4].body.profileId, 'local-codex')
  assert.equal('retrieval' in calls[4].body, false)
  assert.match(calls[4].body.input, /知乎材料/)
  assert.equal(run.sources.items[0].id, 'z-1')
})

test('desktop workspace bridge proxies only bounded local storage routes with its private token', async () => {
  const calls = []
  const client = createRuntimeCapabilityClient({
    origin: 'http://127.0.0.1:4430',
    desktopSnapshotToken: 'private-desktop-token',
    fetchImpl: async (url, init) => {
      calls.push({ pathname: url.pathname, method: init.method, headers: init.headers, body: init.body })
      return response({
        revision: 1,
        host: null,
        storage: { kind: 'sqlite', location: 'C:\\Users\\example\\AppData\\Trace\\web.sqlite' },
      })
    },
  })
  const read = await client.request({ operation: 'workspace.request', pathname: '/api/web/workspace', method: 'GET' })
  const write = await client.request({ operation: 'workspace.request', pathname: '/api/web/workspace', method: 'PUT', body: '{"expectedRevision":0}' })
  assert.equal(read.status, 200)
  assert.equal(write.status, 200)
  assert.equal(calls[0].headers['x-trace-desktop-token'], undefined)
  assert.equal(calls[1].headers['x-trace-desktop-token'], 'private-desktop-token')
  assert.deepEqual(JSON.parse(read.body).storage, { kind: 'sqlite', label: 'Trace 桌面端本机空间' })
  assert.equal(read.body.includes('AppData'), false)
  await assert.rejects(client.request({ operation: 'workspace.request', pathname: '/api/product/workspace', method: 'GET' }), /不支持/)
})

test('desktop pet reads and writes the same authoritative workspace as the product window', async () => {
  let revision = 0
  let host = null
  const client = createRuntimeCapabilityClient({
    origin: 'http://127.0.0.1:4431',
    randomId: (() => { let id = 0; return () => `shared-${++id}` })(),
    fetchImpl: async (url, init) => {
      if (url.pathname === '/api/product/workspace') return response({ revision, host })
      if (url.pathname === '/api/product/commands') {
        const body = JSON.parse(init.body)
        revision += 1
        const matterId = body.operations[0].matterId
        host = { chain: { matters: [{ id: matterId, originalText: body.operations[0].text, understandingVersion: 0 }], sessions: { [matterId]: {} } }, worksite: { sessions: {} } }
        return response({ revision, host })
      }
      return response({ error: { message: 'not found' } }, 404)
    },
  })
  assert.deepEqual((await client.request({ operation: 'workspace.summary' })).observations, [])
  const captured = await client.request({ operation: 'workspace.capture', text: '桌宠和桌面共用这一条', source: '桌宠快速输入' })
  assert.equal(captured.observation.text, '桌宠和桌面共用这一条')
  const summary = await client.request({ operation: 'workspace.summary' })
  assert.equal(summary.revision, 1)
  assert.equal(summary.observations[0].id, captured.observation.id)
})

test('desktop runtime client routes public searches by explicit source', async () => {
  const paths = []
  const client = createRuntimeCapabilityClient({
    fetchImpl: async (url, init) => {
      paths.push({ pathname: url.pathname, body: JSON.parse(init.body) })
      return response({ source: url.pathname.endsWith('global') ? 'global' : 'zhihu', items: [] })
    },
  })
  await client.request({ operation: 'search', source: 'zhihu', query: ' 产品判断 ', count: 2 })
  await client.request({ operation: 'search', source: 'global', query: ' 产品判断 ', count: 2 })
  assert.deepEqual(paths, [
    { pathname: '/api/search/zhihu', body: { query: '产品判断', count: 2 } },
    { pathname: '/api/search/global', body: { query: '产品判断', count: 2 } },
  ])
})

test('desktop runtime client keeps Zhihu OAuth and user reads behind bounded native operations', async () => {
  const calls = []
  const client = createRuntimeCapabilityClient({
    fetchImpl: async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : undefined
      calls.push({ pathname: url.pathname, method: init.method, body })
      if (url.pathname === '/api/zhihu/status') return response({ oauth: { configured: true, status: 'not_authorized' } })
      if (url.pathname === '/api/zhihu/oauth/start') return response({ status: 'user_action_required', login_url: 'https://trace.neutrom.store/api/trace-oauth/connect?id=test' })
      if (url.pathname === '/api/zhihu/oauth/check') return response({ oauth: { configured: true, status: 'authorized' } })
      if (url.pathname === '/api/zhihu/oauth/disconnect') return response({ status: 'disconnected' })
      if (url.pathname === '/api/zhihu/user/read') return response({ resource: body.kind, items: [] })
      return response({ error: { message: 'not found' } }, 404)
    },
  })

  await client.request({ operation: 'zhihu.status' })
  await client.request({ operation: 'zhihu.oauth.start' })
  await client.request({ operation: 'zhihu.oauth.check' })
  await client.request({ operation: 'zhihu.user.read', kind: 'contents', limit: 3, offset: '0' })
  await client.request({ operation: 'zhihu.oauth.disconnect' })
  await assert.rejects(client.request({ operation: 'zhihu.user.read', kind: 'arbitrary', limit: 3, offset: '0' }), /Invalid bounded/)
  assert.deepEqual(calls, [
    { pathname: '/api/zhihu/status', method: 'GET', body: undefined },
    { pathname: '/api/zhihu/oauth/start', method: 'POST', body: {} },
    { pathname: '/api/zhihu/oauth/check', method: 'POST', body: {} },
    { pathname: '/api/zhihu/user/read', method: 'POST', body: { kind: 'contents', limit: 3, offset: '0' } },
    { pathname: '/api/zhihu/oauth/disconnect', method: 'POST', body: {} },
  ])
})

test('desktop bridge auto-binds the current project and returns a Codex work result without exposing paths', async (t) => {
  const calls = []
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'trace-desktop-test-'))
  const projectDir = path.join(fixtureRoot, 'traceweb')
  await mkdir(path.join(projectDir, '.git'), { recursive: true })
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }))
  let phase = 'empty'
  const baseHost = () => ({
    chain: {
      matters: [{ id: 'matter-1', originalText: '核对这次工作里的条件。' }],
      sessions: { 'matter-1': { contextMode: 'resume', contextEpoch: 0 } },
    },
    worksite: {
      works: { 'work-1': { id: 'work-1', title: '核对条件', agent: 'Codex', project: 'traceweb', connected: phase !== 'created', ...(phase === 'returned' ? { connection: { status: 'returned_for_review' } } : {}) } },
      sessions: { 'work-1': {
        ...(phase === 'created' ? {} : { codexDelivery: { deliveryId: 'delivery-1', contextHash: 'a'.repeat(64) } }),
        ...(phase === 'returned' ? { codexReturns: [{ result: { fact: '已核对条件。', interpretation: '来自 Codex。', unconfirmed: '仍需用户确认。', proposedUnderstanding: '' } }] } : {}),
      } },
    },
  })
  const client = createRuntimeCapabilityClient({
    origin: 'http://127.0.0.1:4420',
    projectDir,
    wait: async () => {},
    now: () => 0,
    fetchImpl: async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : undefined
      calls.push({ pathname: url.pathname, body })
      if (url.pathname === '/api/product/workspace') return response(phase === 'empty' ? { revision: 0, host: null } : { revision: phase === 'created' ? 1 : phase === 'received' ? 2 : 3, host: baseHost() })
      if (url.pathname === '/api/product/commands') { phase = 'created'; return response({ revision: 1, host: baseHost() }) }
      if (url.pathname === '/api/product/codex/receive') { phase = 'received'; return response({ receipt: { deliveryId: 'delivery-1', contextHash: 'a'.repeat(64) }, context: { kind: 'trace.codex-context' } }) }
      if (url.pathname === '/api/agent/capabilities') return response({ enabled: true, profiles: [{ profileId: 'local-codex', label: 'Codex', kind: 'codex' }] })
      if (url.pathname === '/api/agent/runs') return response({ run: { runId: 'run-1', status: 'succeeded', profile: { label: 'Codex' }, result: { answer: '已核对条件。', uncertainties: ['仍需用户确认。'] } } }, 202)
      if (url.pathname === '/api/product/codex/return') { phase = 'returned'; return response({ receipt: { status: 'returned_for_review' } }) }
      return response({ error: { message: 'not found' } }, 404)
    },
  })

  const environment = await client.request({ operation: 'work.environment' })
  assert.deepEqual(environment, { connected: true, projectName: 'traceweb', agentLabel: 'Codex', locationLabel: '当前项目' })
  const returned = await client.request({ operation: 'work.run', workId: 'work-1', matterId: 'matter-1', title: '核对条件', text: '核对这次工作里的条件。', role: 'reference', source: 'none' })
  assert.equal(returned.status, 'returned_for_review')
  assert.equal(returned.result.fact, '已核对条件。')
  assert.equal(JSON.stringify(returned).includes(projectDir), false)
  assert.deepEqual(calls.map((call) => call.pathname), [
    '/api/product/workspace',
    '/api/product/commands',
    '/api/product/codex/receive',
    '/api/product/workspace',
    '/api/agent/capabilities',
    '/api/agent/runs',
    '/api/product/codex/return',
    '/api/product/workspace',
  ])
  assert.equal(calls[1].body.operations[1].destination.project, 'traceweb')
  assert.equal(calls[2].body.projectDir, projectDir)
  assert.deepEqual(calls[6].body.result.artifacts, [])
})

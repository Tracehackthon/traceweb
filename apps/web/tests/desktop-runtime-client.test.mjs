import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  DEFAULT_CLOUD_ORIGIN,
  DEFAULT_RUNTIME_ORIGIN,
  CODEX_APP_SERVER_COMPATIBLE_VERSIONS,
  PROJECT_BINDING_STATES,
  createRuntimeCapabilityClient,
  inspectCodexExecutables,
  inspectDesktopProject,
  probeCodexExecutable,
  resolveAgentProfile,
  resolveCodexExecutable,
  resolveCodexProfile,
  validateRuntimeOrigin,
} from '../../desktop-pet/src/desktop/runtime-client.mjs'
import { REDIRECT_URI } from '../../../lib/zhihu-oauth.mjs'

const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

async function makeTraceProject(projectDir, { projectId = 'project-fixture', instanceId = `instance-${projectId}` } = {}) {
  await mkdir(path.join(projectDir, '.git'), { recursive: true })
  await writeFile(path.join(projectDir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  await mkdir(path.join(projectDir, '.trace'), { recursive: true })
  await writeFile(path.join(projectDir, '.trace', 'project.json'), JSON.stringify({
    protocol_id: 'trace.project-instance', protocol_version: '0.2.0', project_id: projectId,
    instance_id: instanceId, template_id: 'fixture', template_version: '0.1.0',
    source_mode: 'local', source_scope: 'project', state_file: '.trace/state/trace.sqlite',
    source_root: '.trace/source', created_at: '2026-09-17T00:00:00.000Z',
  }))
}
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

test('desktop Codex discovery uses deterministic verified compatibility instead of mtime', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'trace-codex-probe-'))
  const executableName = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const first = path.join(root, 'first', executableName)
  const second = path.join(root, 'second', executableName)
  await mkdir(path.dirname(first), { recursive: true })
  await mkdir(path.dirname(second), { recursive: true })
  await writeFile(first, 'fixture')
  await writeFile(second, 'fixture')
  t.after(() => rm(root, { recursive: true, force: true }))
  const probes = []
  const probe = async (candidate) => {
    probes.push(candidate)
    return { candidate, version: '0.153.4', appServerCapable: true, versionCompatible: true, compatible: candidate === first }
  }
  const details = await inspectCodexExecutables({ env: { PATH: `${path.dirname(second)}${path.delimiter}${path.dirname(first)}` }, platform: process.platform, probe })
  assert.deepEqual(details.candidates, [first, second], 'candidate ordering is lexical, not mtime order')
  assert.equal(details.selected, first)
  assert.deepEqual(probes, [first, second])
  const noCompatible = await inspectCodexExecutables({ env: { PATH: `${path.dirname(first)}${path.delimiter}${path.dirname(second)}` }, platform: process.platform, probe: async (candidate) => ({ candidate, compatible: false, reason: 'version-unverified' }) })
  assert.equal(noCompatible.selected, null)
  await assert.rejects(
    resolveCodexExecutable({ env: { TRACE_CODEX_BIN: second, PATH: path.dirname(first) }, verify: true, probe: async () => ({ compatible: false, reason: 'version-unverified' }) }),
    /不会回退到未经验证的可执行文件/,
  )
  assert.deepEqual(CODEX_APP_SERVER_COMPATIBLE_VERSIONS, ['0.153.4', '0.154.0-alpha.6.2'])
})

test('desktop rejects a Trace descriptor with unsupported fields instead of trusting a marker', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'trace-project-descriptor-'))
  const projectDir = path.join(root, 'project')
  await makeTraceProject(projectDir)
  await writeFile(path.join(projectDir, '.trace', 'project.json'), JSON.stringify({
    protocol_id: 'trace.project-instance', protocol_version: '0.2.0', project_id: 'project-fixture',
    instance_id: 'instance-project-fixture', template_id: 'fixture', template_version: '0.1.0',
    source_mode: 'local', source_scope: 'project', state_file: '.trace/state/trace.sqlite',
    source_root: '.trace/source', created_at: '2026-09-17T00:00:00.000Z', decoy: true,
  }))
  t.after(() => rm(root, { recursive: true, force: true }))
  const binding = inspectDesktopProject({ projectDir, source: 'user-selection' })
  assert.equal(binding.status, PROJECT_BINDING_STATES.CANDIDATE)
  assert.equal(binding.repositoryVerified, false)
  assert.equal(binding.diagnostic.code, 'trace-descriptor-invalid')
})

test('desktop Codex probe requires both an allow-listed version and app-server capability', async () => {
  const spawnProcess = (_candidate, args) => {
    const output = args[0] === '--version' ? 'Codex CLI 0.153.4\n' : 'Usage: codex app-server --stdio\n'
    const callbacks = new Map()
    const stream = { on(type, callback) { if (type === 'data') queueMicrotask(() => callback(output)) } }
    const child = {
      stdout: stream,
      stderr: { on() {} },
      once(type, callback) { callbacks.set(type, callback); if (type === 'close') queueMicrotask(() => callback(0)) },
      kill() {},
    }
    return child
  }
  const result = await probeCodexExecutable('codex-fixture', { spawnProcess, timeoutMs: 100, compatibleVersions: ['0.153.4'] })
  assert.equal(result.compatible, true)
  assert.equal(result.version, '0.153.4')
  assert.equal(result.appServerCapable, true)
})

test('desktop project binding treats cwd and saved settings as candidates until confirmation', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'trace-project-binding-'))
  const repo = path.join(root, 'same-name')
  const nested = path.join(repo, 'packages', 'child')
  await makeTraceProject(repo, { projectId: 'cwd-project' })
  await mkdir(nested, { recursive: true })
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.equal(inspectDesktopProject({ projectDir: nested, source: 'startup-cwd' }).status, PROJECT_BINDING_STATES.CANDIDATE)
  const client = createRuntimeCapabilityClient({
    origin: 'http://127.0.0.1:4441', savedProjectDir: repo, startupCwd: nested, projectSource: 'saved-setting',
    fetchImpl: async () => response({ revision: 0, host: null }),
  })
  const candidate = await client.request({ operation: 'work.environment' })
  assert.equal(candidate.connected, false)
  assert.equal(candidate.projectBinding.status, PROJECT_BINDING_STATES.CANDIDATE)
  assert.equal(candidate.projectBinding.source, 'saved-setting')
  await assert.rejects(client.request({ operation: 'work.run', workId: 'work-1', matterId: 'matter-1', title: '不会执行', text: '候选不可执行', role: 'reference', source: 'none' }), /候选|确认/)
  const confirmed = await client.request({ operation: 'work.project.confirm' })
  assert.equal(confirmed.status, PROJECT_BINDING_STATES.CONFIRMED)
  assert.equal((await client.request({ operation: 'work.environment' })).connected, true)

  const stale = createRuntimeCapabilityClient({
    origin: 'http://127.0.0.1:4442', savedProjectDir: path.join(root, 'deleted-project'), startupCwd: nested, projectSource: 'saved-setting',
    fetchImpl: async () => response({ revision: 0, host: null }),
  })
  const staleEnvironment = await stale.request({ operation: 'work.environment' })
  assert.equal(staleEnvironment.connected, false)
  assert.equal(staleEnvironment.projectBinding.status, PROJECT_BINDING_STATES.UNBOUND)
  assert.equal(staleEnvironment.projectBinding.source, 'saved-setting')
  assert.equal(staleEnvironment.projectBinding.diagnostic.code, 'project-path-invalid')
})

test('desktop project identity distinguishes repositories with the same basename', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'trace-project-identity-'))
  const left = path.join(root, 'left', 'same-name')
  const right = path.join(root, 'right', 'same-name')
  await makeTraceProject(left, { projectId: 'left-project' })
  await makeTraceProject(right, { projectId: 'right-project' })
  t.after(() => rm(root, { recursive: true, force: true }))
  const leftClient = createRuntimeCapabilityClient({ origin: 'http://127.0.0.1:4443', projectDir: left, fetchImpl: async () => response({ revision: 0, host: null }) })
  const rightClient = createRuntimeCapabilityClient({ origin: 'http://127.0.0.1:4444', projectDir: right, fetchImpl: async () => response({ revision: 0, host: null }) })
  const leftBinding = await leftClient.request({ operation: 'work.environment' })
  const rightBinding = await rightClient.request({ operation: 'work.environment' })
  assert.equal(leftBinding.projectName, 'same-name')
  assert.equal(rightBinding.projectName, 'same-name')
  assert.notEqual(leftBinding.projectBinding.identityHint, rightBinding.projectBinding.identityHint)
  assert.notEqual(leftBinding.projectBinding.projectId, rightBinding.projectBinding.projectId)
  const switchingClient = createRuntimeCapabilityClient({ origin: 'http://127.0.0.1:4447', projectDir: left, fetchImpl: async () => response({ revision: 0, host: null }) })
  const switched = switchingClient.setProjectDir(right)
  assert.equal(switched.status, PROJECT_BINDING_STATES.CONFIRMED)
  assert.equal(switched.projectId, 'right-project')
})

test('desktop does not bind a legacy work by its display basename alone', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'trace-project-legacy-work-'))
  const projectDir = path.join(root, 'same-name')
  await makeTraceProject(projectDir, { projectId: 'legacy-project' })
  t.after(() => rm(root, { recursive: true, force: true }))
  const client = createRuntimeCapabilityClient({
    origin: 'http://127.0.0.1:4446', projectDir,
    fetchImpl: async (url) => url.pathname === '/api/product/workspace' ? response({ revision: 1, host: {
      chain: { matters: [{ id: 'matter-1', originalText: '原话' }], sessions: { 'matter-1': { contextMode: 'resume', contextEpoch: 0 } } },
      worksite: { works: { 'work-legacy': { id: 'work-legacy', agent: 'Codex', project: 'same-name' } }, sessions: { 'work-legacy': {} } },
    } }) : response({ error: { message: 'unexpected' } }, 404),
  })
  await assert.rejects(client.request({ operation: 'work.run', workId: 'work-legacy', matterId: 'matter-1', title: '测试', text: '原话', role: 'reference', source: 'none' }), /没有可验证的项目身份|basename|重新创建/)
})

test('desktop profile resolution never selects the first Codex profile silently', () => {
  const capabilities = {
    enabled: true,
    profiles: [
      { profileId: 'codex-a', kind: 'codex', label: 'A' },
      { profileId: 'codex-b', kind: 'codex', label: 'B' },
      { profileId: 'model-a', kind: 'model', label: 'Model' },
    ],
  }
  assert.equal(resolveCodexProfile(capabilities).status, 'unresolved')
  assert.equal(resolveCodexProfile(capabilities).reason, 'multiple-codex-profiles-no-default')
  assert.equal(resolveCodexProfile({ ...capabilities, defaultProfileId: 'codex-b' }).profile.profileId, 'codex-b')
  assert.equal(resolveCodexProfile(capabilities, { selectedProfileId: 'codex-a' }).profile.profileId, 'codex-a')
  assert.equal(resolveAgentProfile(capabilities, { requestedProfileId: 'model-a' }).profile.kind, 'model')
  assert.equal(resolveAgentProfile(capabilities).reason, 'multiple-agent-profiles-no-default')
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
  assert.equal(calls.find((call) => new URL(call.url).origin === DEFAULT_CLOUD_ORIGIN).init.cache, 'no-store')
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
  await makeTraceProject(projectDir, { projectId: 'private-workspace-project' })
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
  assert.equal(setup.project.status, PROJECT_BINDING_STATES.CONFIRMED)
  assert.equal(setup.project.source, 'explicit-env')
  assert.equal(setup.project.repositoryVerified, true)
  assert.equal(JSON.stringify(setup).includes(projectDir), false)
  const checked = await client.request({ operation: 'setup.codex.check' })
  assert.deepEqual(checked, { ready: true, authenticated: true, version: 'codex-cli 0.153.4', label: 'Codex', profileId: 'local-codex', profileStatus: 'resolved', resolutionReason: 'unique-candidate' })
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
  await makeTraceProject(projectDir, { projectId: 'traceweb-project' })
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
      if (url.pathname === '/api/agent/runs') return response({ run: { runId: 'run-1', status: 'succeeded', runtime: { threadId: 'thread-native-1' }, profile: { label: 'Codex' }, result: { answer: '已核对条件。', uncertainties: ['仍需用户确认。'] } } }, 202)
      if (url.pathname === '/api/product/codex/return') { phase = 'returned'; return response({ receipt: { status: 'returned_for_review' } }) }
      return response({ error: { message: 'not found' } }, 404)
    },
  })

  const environment = await client.request({ operation: 'work.environment' })
  assert.equal(environment.connected, true)
  assert.equal(environment.projectName, 'traceweb')
  assert.equal(environment.agentLabel, 'Codex')
  assert.equal(environment.locationLabel, '已确认项目')
  assert.equal(environment.projectBinding.status, PROJECT_BINDING_STATES.CONFIRMED)
  assert.equal(environment.projectBinding.repositoryVerified, true)
  const returned = await client.request({ operation: 'work.run', workId: 'work-1', matterId: 'matter-1', title: '核对条件', text: '核对这次工作里的条件。', role: 'reference', source: 'none' })
  assert.equal(returned.status, 'returned_for_review')
  assert.equal(returned.result.fact, '已核对条件。')
  assert.equal(returned.execution.trace_work_id, 'work-1')
  assert.equal(returned.execution.adapter_execution_id, 'run-1')
  assert.equal(returned.execution.host_session_id, 'trace-desktop:work-1')
  assert.equal(returned.execution.codex_thread_id, 'thread-native-1')
  assert.equal(returned.execution.synthetic_host_session, true)
  assert.equal(returned.execution.native_codex_thread, true)
  assert.notEqual(returned.execution.host_session_id, returned.execution.codex_thread_id)
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

test('desktop work execution cancels the adapter and refuses return when the project drifts', async (t) => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'trace-desktop-drift-'))
  const projectDir = path.join(fixtureRoot, 'traceweb')
  await makeTraceProject(projectDir, { projectId: 'drift-project', instanceId: 'drift-instance-1' })
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }))
  const descriptorFile = path.join(projectDir, '.trace', 'project.json')
  const calls = []
  let phase = 'empty'
  const host = () => ({
    chain: { matters: [{ id: 'matter-1', originalText: '核对条件' }], sessions: { 'matter-1': { contextMode: 'resume', contextEpoch: 0 } } },
    worksite: {
      works: { 'work-1': { id: 'work-1', title: '核对', agent: 'Codex', project: 'traceweb', connected: true } },
      sessions: { 'work-1': { codexDelivery: { deliveryId: 'delivery-1', contextHash: 'a'.repeat(64) } } },
    },
  })
  let drifted = false
  const client = createRuntimeCapabilityClient({
    origin: 'http://127.0.0.1:4445', projectDir, wait: async () => {
      if (!drifted) {
        drifted = true
        await writeFile(path.join(projectDir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
        await writeFile(descriptorFile, JSON.stringify({
          protocol_id: 'trace.project-instance', protocol_version: '0.2.0', project_id: 'drift-project',
          instance_id: 'drift-instance-2', template_id: 'fixture', template_version: '0.1.0',
          source_mode: 'local', source_scope: 'project', state_file: '.trace/state/trace.sqlite',
          source_root: '.trace/source', created_at: '2026-09-17T00:00:00.000Z',
        }))
      }
    }, now: () => 0,
    fetchImpl: async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : undefined
      calls.push({ pathname: url.pathname, body })
      if (url.pathname === '/api/product/workspace') return response(phase === 'empty' ? { revision: 0, host: null } : { revision: 1, host: host() })
      if (url.pathname === '/api/product/commands') { phase = 'created'; return response({ revision: 1, host: host() }) }
      if (url.pathname === '/api/product/codex/receive') return response({ receipt: { deliveryId: 'delivery-1', contextHash: 'a'.repeat(64) }, context: {} })
      if (url.pathname === '/api/agent/capabilities') return response({ enabled: true, profiles: [{ profileId: 'local-codex', kind: 'codex' }] })
      if (url.pathname === '/api/agent/runs') return response({ run: { runId: 'run-drift', status: 'queued' } }, 202)
      if (url.pathname === '/api/agent/runs/run-drift/cancel') return response({ status: 'cancelled' })
      throw new Error(`unexpected request ${url.pathname}`)
    },
  })
  await assert.rejects(
    client.request({ operation: 'work.run', workId: 'work-1', matterId: 'matter-1', title: '核对', text: '核对条件', role: 'reference', source: 'none' }),
    /项目或仓库 worktree 已变化|漂移/,
  )
  assert.equal(calls.some(call => call.pathname === '/api/agent/runs/run-drift/cancel'), true)
  assert.equal(calls.some(call => call.pathname === '/api/product/codex/return'), false)
})

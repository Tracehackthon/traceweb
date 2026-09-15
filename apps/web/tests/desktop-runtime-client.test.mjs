import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntimeCapabilityClient, validateRuntimeOrigin } from '../../desktop-pet/src/desktop/runtime-client.mjs'

const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

test('desktop runtime client accepts only loopback HTTP origins', () => {
  assert.equal(validateRuntimeOrigin('http://127.0.0.1:4173'), 'http://127.0.0.1:4173')
  assert.equal(validateRuntimeOrigin('http://localhost:9000'), 'http://localhost:9000')
  assert.throws(() => validateRuntimeOrigin('https://trace.example.test'), /loopback HTTP origin/)
  assert.throws(() => validateRuntimeOrigin('http://user:pass@127.0.0.1:4173'), /loopback HTTP origin/)
  assert.throws(() => validateRuntimeOrigin('http://127.0.0.1:4173/api'), /loopback HTTP origin/)
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
  assert.equal(value.search.enabled, true)
  assert.equal(value.agent.profiles[0].kind, 'codex')
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname).sort(), ['/api/agent/capabilities', '/api/search/capabilities'])
  assert.equal(calls.every((call) => call.init.headers.origin === 'http://127.0.0.1:4417'), true)
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
    '/api/agent/runs',
    '/api/agent/runs/run-1',
  ])
  assert.deepEqual(calls[2].body.operations, [{ type: 'capture.create', matterId: 'pet-id-1', text: '保留原话，再核对依据。' }])
  assert.equal(calls[3].body.expectedRevision, 8)
  assert.equal(calls[3].body.profileId, 'local-codex')
  assert.deepEqual(calls[3].body.retrieval, { sources: ['zhihu'] })
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

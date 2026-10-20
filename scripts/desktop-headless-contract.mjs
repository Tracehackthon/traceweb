import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRuntimeCapabilityClient } from '../apps/desktop-pet/src/desktop/runtime-client.mjs'

const origin = 'http://127.0.0.1:1'
const cloudOrigin = 'https://trace.invalid'
const calls = []
const run = { runId: 'run-headless', status: 'waiting', revision: 3, pendingInteraction: { interactionId: 'ix', kind: 'approval', revision: 3 } }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

const fetchImpl = async (url, options = {}) => {
  const pathname = new URL(url).pathname
  const body = options.body ? JSON.parse(options.body) : {}
  calls.push({ pathname, method: options.method || 'GET', body })
  if (pathname === '/api/product/workspace') return json({ revision: 7, host: { chain: { sessions: { 'pet-m': { contextMode: 'bounded', contextEpoch: 1 } } } } })
  if (pathname === '/api/product/commands') {
    const matterId = body.operations?.find((item) => item.matterId)?.matterId || 'pet-m'
    return json({ revision: 8, host: { chain: { sessions: { [matterId]: { contextMode: 'bounded', contextEpoch: 1 } } } } })
  }
  if (pathname === '/api/agent/capabilities') return json({ enabled: true, defaultProfileId: 'fixture-model', profiles: [{ profileId: 'fixture-model', kind: 'codex', capabilities: ['run'] }] })
  if (pathname === '/api/agent/runs') return json({ run })
  if (pathname === '/api/agent/runs/run-headless') return json(run)
  if (pathname === '/api/agent/runs/run-headless/events') return new Response('id: 1\nevent: run.succeeded\ndata: {"runId":"run-headless","status":"succeeded"}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
  if (pathname.endsWith('/cancel')) return json({ ...run, status: 'cancelled' })
  if (pathname.endsWith('/approval') || pathname.endsWith('/input')) return json({ ...run, status: 'running', pendingInteraction: null })
  if (pathname.endsWith('/adoption')) return json({ action: body.action, run: { ...run, status: 'succeeded' } })
  if (pathname === '/api/search/zhihu' || pathname === '/api/search/global') return json({ source: pathname.endsWith('/global') ? 'global' : 'zhihu', query: body.query, items: [] })
  throw new Error(`Unexpected mocked route: ${pathname}`)
}

const temporaryProject = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-headless-contract-'))
const client = createRuntimeCapabilityClient({ origin, cloudOrigin, projectDir: temporaryProject, fetchImpl, cloudFetchImpl: fetchImpl })
const verified = []
const record = (name, condition) => { assert.ok(condition, `contract failed: ${name}`); verified.push(name) }

try {
  const selectedProject = client.setProjectDir(temporaryProject)
  record('project.select', selectedProject.connected === true && selectedProject.locationLabel === '已选择工作文件夹')
  const environment = await client.request({ operation: 'work.environment' })
  record('project.environment', environment.projectName && environment.locationLabel)

  const command = await client.request({
    operation: 'product.command', protocolVersion: 1, commandId: 'headless-contract', expectedRevision: 7,
    operations: [{ type: 'capture.draft', text: 'offline contract probe' }],
  })
  record('workspace.command', command.revision === 8)

  await client.request({ operation: 'search', source: 'zhihu', query: 'probe', count: 1 })
  await client.request({ operation: 'search', source: 'global', query: 'probe', count: 1 })
  record('search.routing', calls.some((call) => call.pathname === '/api/search/zhihu') && calls.some((call) => call.pathname === '/api/search/global'))

  const started = await client.request({ operation: 'agent.run.start', text: 'offline contract probe', source: 'none' })
  const runId = started.runId || started.run?.runId
  record('agent.start', runId === 'run-headless')
  await client.request({ operation: 'agent.run.read', runId })
  const events = await client.request({ operation: 'agent.run.events', runId, after: 0 })
  record('agent.read-events', events.events?.some((event) => event.type === 'run.succeeded' || event.data?.status === 'succeeded'))
  await client.request({ operation: 'agent.run.cancel', runId })
  await client.request({ operation: 'agent.run.approval', runId, interactionId: 'ix', expectedRevision: 3, idempotencyKey: 'approve-1', decision: 'accept' })
  await client.request({ operation: 'agent.run.input', runId, interactionId: 'ix', expectedRevision: 3, idempotencyKey: 'input-1', answers: { answer: 'continue' } })
  await client.request({ operation: 'agent.run.adoption', runId, action: 'dismiss' })
  await client.request({ operation: 'agent.run.adoption', runId, action: 'accept', expectedRevision: 8 })

  const requiredPaths = [
    '/api/product/commands', '/api/search/zhihu', '/api/search/global', '/api/agent/runs',
    '/api/agent/runs/run-headless/events', '/api/agent/runs/run-headless/cancel',
    '/api/agent/runs/run-headless/approval', '/api/agent/runs/run-headless/input',
    '/api/agent/runs/run-headless/adoption',
  ]
  const missing = requiredPaths.filter((pathname) => !calls.some((call) => call.pathname === pathname))
  record('endpoint.matrix', missing.length === 0)
  console.log(JSON.stringify({ status: 'desktop-headless-contract-passed', mode: 'offline-mocked', realCloud: false, realAgent: false, verified }))
} finally {
  client.close()
  fs.rmSync(temporaryProject, { recursive: true, force: true })
}

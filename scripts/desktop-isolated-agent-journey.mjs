// Opt-in Windows desktop test with a real local Codex run and synthetic data.
// It uses an isolated Trace profile/project and never reads the user's Trace DBs.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { once } from 'node:events'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const exe = path.join(repo, 'apps', 'desktop-pet', 'release', 'win-unpacked', 'Trace.exe')
const output = process.argv[2] ? path.resolve(process.argv[2]) : null
if (process.env.TRACE_DESKTOP_AGENT_LIVE !== '1') throw new Error('Set TRACE_DESKTOP_AGENT_LIVE=1 to opt in to one real Codex run')
if (process.platform !== 'win32' || !output || fs.existsSync(output)) throw new Error('Provide a fresh Windows evidence directory')
if (!fs.existsSync(exe)) throw new Error(`Package not found: ${exe}`)
const userData = path.join(output, 'user-data'), project = path.join(output, 'project'), evidence = path.join(output, 'evidence')
await mkdir(userData, { recursive: true }); await mkdir(project, { recursive: true }); await mkdir(evidence, { recursive: true })
const temp = path.join(output, 'tmp')
await mkdir(temp, { recursive: true })
// Codex schema generation can be larger than the remaining space on C:.
// Keep all temporary qualification files inside this isolated D: evidence root.
process.env.TEMP = temp; process.env.TMP = temp
execFileSync('git', ['init', '-q', project])
await writeFile(path.join(project, 'AGENTS.md'), '# Isolated Trace test project\n\nThis project contains only synthetic test data. Do not run shell commands, edit files, or access external services. Answer using only the selected Trace content.\n')
const runtimeRoot = path.join(path.dirname(exe), 'resources', 'trace-runtime')
const qualificationRecord = process.env.TRACE_DESKTOP_AGENT_QUALIFICATION_RECORD
  ? path.resolve(process.env.TRACE_DESKTOP_AGENT_QUALIFICATION_RECORD)
  : path.join(evidence, 'codex-qualification.json')
let qualification
try {
  if (process.env.TRACE_DESKTOP_AGENT_QUALIFICATION_RECORD) {
    qualification = JSON.parse(await readFile(qualificationRecord, 'utf8'))
  } else {
    const { qualifyCodexAppServer } = await import(pathToFileURL(path.join(runtimeRoot, 'native', 'qualify-codex-app-server.mjs')).href)
    const codex = process.env.TRACE_DESKTOP_CODEX_BIN || execFileSync('where.exe', ['codex'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
    await qualifyCodexAppServer({ executable: codex, projectCwd: project, recordPath: qualificationRecord, schemaCacheRoot: path.join(evidence, 'codex-schema') })
    qualification = JSON.parse(await readFile(qualificationRecord, 'utf8'))
  }
} catch (error) {
  await writeFile(path.join(evidence, 'failure.json'), JSON.stringify({ stage: 'qualification', error: error instanceof Error ? error.message : String(error) }, null, 2) + '\n')
  throw error
}
const original = '隔离桌面试用：本次只验证一条合成工作能否从 Trace 交给 Codex 并返回。'
const understanding = '先保存原话和理解，再让 Codex 只根据明确带入的内容报告可核验结果。'
const task = '仅根据本次带入的合成文字，简短说明你实际读到的内容和一项仍待确认的条件；不要运行命令或修改文件。'
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
async function until(task, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try { const result = await task(); if (result) return result } catch (error) { last = error }
    await wait(200)
  }
  throw last || new Error('Timed out waiting for desktop state')
}
async function freePort() {
  const server = net.createServer()
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = server.address().port
  server.close(); await once(server, 'close')
  return port
}
async function launch(label) {
  const port = await freePort(), log = path.join(evidence, `${label}.log`), stream = fs.openSync(log, 'a')
  const child = spawn(exe, [`--user-data-dir=${userData}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], {
    cwd: path.dirname(exe), detached: true, stdio: ['ignore', stream, stream],
    env: { ...process.env, TRACE_AGENT_ENABLED: '1', TRACE_CODEX_QUALIFICATION_RECORD: qualificationRecord,
      TRACE_CLOUD_ORIGIN: 'https://127.0.0.1:1', TRACE_PROJECT_DIR: project, TRACE_DESKTOP_INTEGRATIONS_FILE: path.join(output, 'integrations.json') },
  })
  child.unref(); fs.closeSync(stream)
  const cdp = `http://127.0.0.1:${port}`
  await until(async () => (await (await fetch(`${cdp}/json/list`)).json()).some((item) => item.url?.startsWith('trace-app://')), 25_000)
  const browser = await chromium.connectOverCDP(cdp)
  const page = browser.contexts().flatMap((context) => context.pages()).find((item) => item.url().startsWith('trace-app://'))
  assert.ok(page, 'Product window not found')
  const origin = await until(async () => (await readFile(log, 'utf8')).match(/Trace Web: (http:\/\/127\.0\.0\.1:\d+\/)\r?\n/)?.[1])
  page.setDefaultTimeout(15_000)
  return { child, browser, page, origin, log }
}
async function close(instance) {
  if (!instance) return
  await instance.browser.close().catch(() => {})
  if (!alive(instance.child.pid)) return
  const stream = fs.openSync(path.join(evidence, 'shutdown.log'), 'a')
  const helper = spawn(exe, [`--user-data-dir=${userData}`, '--trace-shutdown-for-update'], { cwd: path.dirname(exe), stdio: ['ignore', stream, stream] })
  fs.closeSync(stream); await once(helper, 'exit')
  await until(() => !alive(instance.child.pid), 20_000)
}
async function api(instance, pathname, body) {
  const response = await fetch(new URL(pathname, instance.origin), body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json', origin: new URL(instance.origin).origin }, body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}
function inspect(workspace) {
  assert.equal(workspace.host.chain.matters.length, 1)
  const matter = workspace.host.chain.matters[0]
  assert.equal(matter.originalText, original); assert.equal(matter.understanding, understanding)
  const works = Object.values(workspace.host.worksite.works)
  assert.equal(works.length, 1)
  const work = works[0], session = workspace.host.worksite.sessions[work.id]
  assert.equal(work.project, path.basename(project))
  assert.equal(work.connected, true)
  assert.equal(work.connection?.status, 'returned_for_review')
  assert.ok(session.codexDelivery?.deliveryId)
  assert.equal(session.codexReturns?.length, 1)
  assert.ok(session.codexReturns[0].result?.fact)
  assert.equal(session.result?.externalReturnId, session.codexReturns[0].returnId)
  assert.equal(session.result?.fact, session.codexReturns[0].result.fact)
  assert.ok(fs.existsSync(path.join(userData, 'state', 'agent.sqlite')))
  return { revision: workspace.revision, matterId: matter.id, workId: work.id, resultDecision: session.result.decision, deliveryId: session.codexDelivery.deliveryId, returnId: session.codexReturns[0].returnId, fact: session.codexReturns[0].result.fact }
}

let first, second
let stage = 'qualification'
try {
  first = await launch('first-start'); stage = 'preflight'
  const capabilities = await api(first, '/api/agent/capabilities')
  assert.equal(capabilities.status, 200); assert.equal(capabilities.body.enabled, true)
  const check = await api(first, '/api/agent/check', {})
  assert.equal(check.status, 200, JSON.stringify(check.body)); assert.equal(check.body.authenticated, true)
  const page = first.page; stage = 'ui'
  await page.locator('#capture-input').waitFor(); await wait(700)
  const closeProfile = page.getByRole('button', { name: '关闭' })
  if (await closeProfile.isVisible().catch(() => false)) await closeProfile.click()
  await page.locator('#capture-input').fill(original)
  await until(async () => await page.locator('#capture-form button[type=submit]').isEnabled())
  await page.locator('#capture-form button[type=submit]').click()
  await page.waitForURL('**screen=resume')
  await page.getByRole('button', { name: '写下我的理解' }).click()
  await page.waitForURL('**screen=understanding')
  await page.locator('[data-field=understanding]').fill(understanding)
  await page.locator('[data-field=stop]').fill('未决：Codex 的回答应保留为待复核结果，不改写我的理解。')
  await page.getByRole('button', { name: '保存我的理解' }).click()
  await page.getByText('我的理解 v1').waitFor()
  await page.getByRole('button', { name: '带去用' }).click()
  await page.waitForURL('**screen=handoff')
  await page.getByRole('button', { name: '交给 Codex' }).waitFor()
  await page.locator('[data-field=task]').fill(task)
  await page.screenshot({ path: path.join(evidence, 'handoff-ui.png') })
  await page.getByRole('button', { name: '交给 Codex' }).click()
  stage = 'agent-run'
  const workId = await until(async () => Object.keys((await api(first, '/api/product/workspace')).body.host.worksite.works)[0], 20_000)
  const requestId = `desktop-work-run:${workId}`
  let request, run
  const returned = await until(async () => {
    const current = await api(first, '/api/product/workspace')
    request = await api(first, `/api/agent/requests/${encodeURIComponent(requestId)}`)
    run = request.status === 200 ? request.body.run ?? request.body : null
    if (run?.status === 'failed' || run?.status === 'cancelled' || run?.status === 'waiting') throw new Error(`Agent run ${run.status}: ${JSON.stringify(run.error || run.pendingInteraction || run)}`)
    const work = current.body.host.worksite.works[workId]
    if (work?.connection?.status === 'returned_for_review') return current.body
    return null
  }, 210_000)
  const before = inspect(returned)
  assert.equal(run.status, 'succeeded')
  assert.ok(run.result?.answer)
  await page.waitForURL('**screen=results', { timeout: 20_000 })
  await until(async () => await page.locator('[data-field=result-fact]').inputValue() === before.fact, 10_000)
  assert.doesNotMatch(await page.locator('body').innerText(), /另一处已有更新|这项工作还未交给 Agent/)
  await page.screenshot({ path: path.join(evidence, 'result-ui.png') })
  assert.equal((await readFile(first.log, 'utf8')).match(/^Trace Web:/gm)?.length, 1)
  await close(first); first = null
  stage = 'restart'
  second = await launch('after-restart')
  const after = inspect((await api(second, '/api/product/workspace')).body)
  assert.deepEqual(after, before)
  const runAfter = await api(second, `/api/agent/requests/${encodeURIComponent(requestId)}`)
  assert.equal(runAfter.status, 200)
  assert.equal((runAfter.body.run ?? runAfter.body).status, 'succeeded')
  const route = new URL(second.page.url())
  route.search = new URLSearchParams({ view: 'worksite', work: before.workId, matter: before.matterId, screen: 'results' }).toString()
  await second.page.goto(route.href)
  await until(async () => await second.page.locator('[data-field=result-fact]').inputValue() === before.fact, 15_000)
  await second.page.screenshot({ path: path.join(evidence, 'after-restart.png') })
  const runtime = JSON.parse(await readFile(path.join(runtimeRoot, 'desktop-runtime-source.json'), 'utf8'))
  const report = { status: 'agent-return-recovered', warning: 'Isolated unpacked candidate, not installed or published', package: {
    exeSha256: hash(exe), appAsarSha256: hash(path.join(path.dirname(exe), 'resources', 'app.asar')), runtimeSource: runtime.source_identity,
  }, qualification: { version: qualification.cli_version, schemaFingerprint: qualification.schema.fingerprint, recordPath: qualificationRecord },
  before, after, agent: { runId: run.runId, status: run.status, answer: run.result.answer }, userData }
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ status: report.status, output, before, agent: report.agent }))
} catch (error) {
  const failure = { stage, error: error instanceof Error ? error.message : String(error), output }
  await writeFile(path.join(evidence, 'failure.json'), JSON.stringify(failure, null, 2) + '\n').catch(() => {})
  if (first?.page) await first.page.screenshot({ path: path.join(evidence, 'failure-ui.png') }).catch(() => {})
  console.error(JSON.stringify(failure))
  process.exitCode = 1
} finally {
  await close(second); await close(first)
}

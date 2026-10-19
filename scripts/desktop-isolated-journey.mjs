// Windows-only, opt-in packaged desktop smoke. Uses synthetic content and an
// isolated Electron profile; it never connects to a model or the cloud.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const exe = path.join(repo, 'apps', 'desktop-pet', 'release', 'win-unpacked', 'Trace.exe')
const output = process.argv[2] ? path.resolve(process.argv[2]) : await fs.promises.mkdtemp(path.join(os.tmpdir(), 'trace-desktop-journey-'))
if (process.platform !== 'win32') throw new Error('This smoke requires the Windows desktop package')
if (!fs.existsSync(exe)) throw new Error(`Package not found: ${exe}`)
if (process.argv[2] && fs.existsSync(output)) throw new Error(`Evidence directory already exists: ${output}`)
await mkdir(path.join(output, 'user-data'), { recursive: true })
await mkdir(path.join(output, 'project'), { recursive: true })
await mkdir(path.join(output, 'evidence'), { recursive: true })

const userData = path.join(output, 'user-data')
const project = path.join(output, 'project')
const evidence = path.join(output, 'evidence')
const original = '隔离试用：把一条发现留到以后复查。'
const understanding = '我的理解：先保留原话，再用隔离工作记录验证能否重启接续。'
const fact = '隔离桌面窗口中，原话、理解和工作准备已保存；Agent 未启用，本次结果由维护者手工记录。'
const pending = '实际 Agent 执行、自动回流和安装后的实例仍未验证。'
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

async function freePort() {
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  server.close()
  await once(server, 'close')
  return port
}

async function until(task, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try { const result = await task(); if (result) return result } catch (error) { last = error }
    await wait(150)
  }
  throw last || new Error('Timed out waiting for desktop state')
}

async function launch(label) {
  const port = await freePort()
  const log = path.join(evidence, `${label}.log`)
  const stream = fs.openSync(log, 'a')
  const child = spawn(exe, [`--user-data-dir=${userData}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], {
    cwd: path.dirname(exe), detached: true, stdio: ['ignore', stream, stream],
    env: { ...process.env, TRACE_AGENT_ENABLED: '0', TRACE_CLOUD_ORIGIN: 'https://127.0.0.1:1', TRACE_PROJECT_DIR: project, TRACE_DESKTOP_INTEGRATIONS_FILE: path.join(output, 'integrations.json') },
  })
  child.unref()
  fs.closeSync(stream)
  const cdp = `http://127.0.0.1:${port}`
  await until(async () => (await (await fetch(`${cdp}/json/list`)).json()).some((item) => item.url?.startsWith('trace-app://')))
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
  fs.closeSync(stream)
  await once(helper, 'exit')
  await until(() => !alive(instance.child.pid), 20_000)
}

async function workspace(instance) {
  const response = await fetch(new URL('/api/product/workspace', instance.origin))
  assert.equal(response.status, 200)
  return response.json()
}

function inspect(state) {
  assert.equal(state.host.chain.matters.length, 1)
  const matter = state.host.chain.matters[0]
  assert.equal(matter.originalText, original)
  assert.equal(matter.understanding, understanding)
  const works = Object.values(state.host.worksite.works)
  assert.equal(works.length, 1)
  assert.equal(works[0].project, path.basename(project))
  assert.equal(works[0].connected, false)
  const session = state.host.worksite.sessions[works[0].id]
  assert.equal(session.codexDelivery ?? null, null)
  assert.equal(session.result.decision, 'result-only')
  assert.equal(session.result.fact, fact)
  assert.equal(session.result.unconfirmed, pending)
  assert.equal(fs.existsSync(path.join(userData, 'state', 'agent.sqlite')), false)
  return { revision: state.revision, matterId: matter.id, workId: works[0].id, resultId: session.result.id }
}

let first
let second
try {
  first = await launch('first-start')
  const page = first.page
  await page.locator('#capture-input').waitFor()
  await wait(700) // Allow first-run capability/status projection to settle.
  const closeProfile = page.getByRole('button', { name: '关闭' })
  if (await closeProfile.isVisible().catch(() => false)) await closeProfile.click()
  await page.locator('#capture-input').fill(original)
  await until(async () => await page.locator('#capture-form button[type=submit]').isEnabled())
  await page.locator('#capture-form button[type=submit]').click()
  await page.waitForURL('**screen=resume')
  await page.getByRole('button', { name: '写下我的理解' }).click()
  await page.waitForURL('**screen=understanding')
  await page.locator('[data-field=understanding]').fill(understanding)
  await page.locator('[data-field=stop]').fill('未决：实际 Agent 返回仍未验证。')
  await page.getByRole('button', { name: '保存我的理解' }).click()
  await page.getByText('我的理解 v1').waitFor()
  await page.getByRole('button', { name: '带去用' }).click()
  await page.waitForURL('**screen=handoff')
  await page.getByRole('button', { name: '保存工作准备' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '交给 Codex' }).count(), 0)
  await page.getByRole('button', { name: '保存工作准备' }).click()
  await page.waitForURL('**view=worksite**')
  await page.locator('.worksite-result-entry').click()
  await page.waitForURL('**screen=results')
  await page.locator('[data-field=result-fact]').fill(fact)
  await page.locator('[data-field=result-proposed]').fill('本机内容与手工结果可恢复；Agent 自动回流另验。')
  await page.locator('[data-field=result-unknown]').fill(pending)
  await page.getByRole('button', { name: '只留下结果' }).click()
  await page.getByText('已保存结果，理解未变').waitFor()
  await page.screenshot({ path: path.join(evidence, 'result-ui.png') })
  const before = inspect(await workspace(first))
  assert.equal((await readFile(first.log, 'utf8')).match(/^Trace Web:/gm)?.length, 1, 'Runtime restarted while UI was open')
  await close(first)
  first = null

  second = await launch('after-restart')
  await second.page.locator('#capture-input').waitFor()
  const after = inspect(await workspace(second))
  assert.deepEqual(after, before)
  assert.match(await second.page.locator('body').innerText(), /隔离试用：把一条发现留到以后复查。/)
  await second.page.screenshot({ path: path.join(evidence, 'after-restart.png') })
  assert.equal((await readFile(second.log, 'utf8')).match(/^Trace Web:/gm)?.length, 1)

  const runtimeRoot = path.join(path.dirname(exe), 'resources', 'trace-runtime')
  const runtime = JSON.parse(await readFile(path.join(runtimeRoot, 'desktop-runtime-source.json'), 'utf8'))
  await writeFile(path.join(evidence, 'report.json'), `${JSON.stringify({
    status: 'product-manual-result-recovered',
    warning: 'Agent disabled: no model run or automatic Codex return; unpacked candidate is not an installed release',
    package: { exeSha256: hash(exe), appAsarSha256: hash(path.join(path.dirname(exe), 'resources', 'app.asar')), runtimeSource: runtime.source_identity },
    before, after, userData, origin: second.origin,
  }, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ status: 'ok', output, before, after }))
} finally {
  await close(second)
  await close(first)
}

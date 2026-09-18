import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, screen, session, shell, Tray } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DEFAULT_CLOUD_ORIGIN, DEFAULT_RUNTIME_ORIGIN, createRuntimeCapabilityClient, resolveCodexExecutable } from './runtime-client.mjs'
import { ensureRuntimeIdentity } from './runtime-installation-identity.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const discussionOrigin = 'http://127.0.0.1:4173'
const configuredBackendOrigin = process.env.TRACE_BACKEND_ORIGIN
let backendOrigin = configuredBackendOrigin || (app.isPackaged ? undefined : discussionOrigin)
const openProductOnStart = app.isPackaged || process.env.TRACE_DESKTOP_OPEN_ON_START === '1'
const appIconPath = join(root, 'trace-app-icon-256.png')
const trayIconPath = join(root, 'trace-app-icon-20.png')
const allowedDiscussionKeys = new Set(['from', 'observationId', 'text', 'status', 'source'])
const tracePublicOrigin = 'https://trace.neutrom.store'
const traceCloudOrigin = process.env.TRACE_CLOUD_ORIGIN || DEFAULT_CLOUD_ORIGIN
const traceAuthCompletionOrigins = new Set([tracePublicOrigin, traceCloudOrigin])
const discussionScheme = 'trace-app'

protocol.registerSchemesAsPrivileged([{
  scheme: discussionScheme,
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}])

let overlayWindow
let tray
let quitting = false
let capabilityClient
let bundledRuntime
const discussionWindows = new Set()
let zhihuAuthWindow
let interactiveBounds = []
let codexEventPollTimer
let codexEventPollInFlight = false
let overlayReady = false
const IPC_TIMEOUT_MS = 45_000
const WORKSPACE_IPC_TIMEOUT_MS = 15_000
const RUNTIME_START_TIMEOUT_MS = 45_000
let bundledRuntimeStatus = {
  connected: !app.isPackaged,
  bundled: app.isPackaged,
  state: app.isPackaged ? 'starting' : 'external',
  message: app.isPackaged ? '正在启动 Trace 本机内容服务…' : '正在连接 Trace 本机内容服务…',
}
let bundledRuntimeStartPromise = null
let bundledRuntimeAttempt = 0
const pendingCodexEvents = []

function sendCodexEvent(event) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (!overlayReady) {
    pendingCodexEvents.push(event)
    while (pendingCodexEvents.length > 256) pendingCodexEvents.shift()
    return
  }
  overlayWindow.webContents.send('trace-native:codex-event', event)
}

function sendSetupProgress(event) {
  for (const window of discussionWindows) {
    if (!window.isDestroyed()) window.webContents.send('trace-native:setup-progress', event)
  }
}

function setBundledRuntimeStatus(next) {
  bundledRuntimeStatus = {
    connected: next.connected === true,
    bundled: next.bundled === true,
    state: typeof next.state === 'string' ? next.state : next.connected === true ? 'connected' : 'failed',
    message: typeof next.message === 'string' && next.message.length <= 240 ? next.message : 'Trace 本机内容服务暂时不可用，请重试。',
  }
  sendSetupProgress({
    kind: 'runtime',
    status: bundledRuntimeStatus.connected ? 'completed' : bundledRuntimeStatus.state === 'starting' ? 'running' : 'failed',
    phase: bundledRuntimeStatus.state === 'starting' ? 'starting' : bundledRuntimeStatus.connected ? 'ready' : 'failed',
    message: bundledRuntimeStatus.message,
  })
}

function publicBundledRuntimeStatus() {
  return { ...bundledRuntimeStatus }
}

function withIpcTimeout(value, timeoutMs, message) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([Promise.resolve(value), timeout]).finally(() => clearTimeout(timer))
}

function installDiscussionProtocol() {
  const discussionRoot = resolve(root, 'discussion')
  const prefix = `${discussionRoot}${sep}`
  protocol.handle(discussionScheme, (request) => {
    let url
    try { url = new URL(request.url) } catch { return new Response('Not found', { status: 404 }) }
    if (url.hostname !== 'desktop') return new Response('Not found', { status: 404 })
    let relative
    try { relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html' } catch { return new Response('Not found', { status: 404 }) }
    const target = resolve(discussionRoot, relative)
    if (target !== discussionRoot && !target.startsWith(prefix)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(target).href)
  })
}

function settingsFile() { return join(app.getPath('userData'), 'desktop-settings.json') }
function readDesktopSettings() {
  try {
    const value = JSON.parse(readFileSync(settingsFile(), 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}
function writeDesktopSettings(value) {
  const file = settingsFile()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function finite(value) { return typeof value === 'number' && Number.isFinite(value) }
function displayId(display) { return String(display?.id ?? 'primary') }
function displayResolution(display) { return `${Math.round(display.workArea.width)}x${Math.round(display.workArea.height)}` }
function displayByStoredId(value) {
  const id = value === undefined || value === null ? '' : String(value)
  return screen.getAllDisplays().find((display) => displayId(display) === id)
}
function overlayDisplay() {
  const settings = readDesktopSettings()
  return displayByStoredId(settings.placement?.displayId)
    || (overlayWindow && !overlayWindow.isDestroyed() ? screen.getDisplayMatching(overlayWindow.getBounds()) : null)
    || screen.getPrimaryDisplay()
}
function workAreaRecord(display) {
  const area = display.workArea
  return { x: area.x, y: area.y, width: area.width, height: area.height }
}
function clampLocalPosition(value, area, size = { width: 92, height: 116 }) {
  const maxX = Math.max(8, area.width - size.width - 8)
  const maxY = Math.max(8, area.height - size.height - 6)
  return {
    x: Math.min(Math.max(8, Number(value.x)), maxX),
    y: Math.min(Math.max(8, Number(value.y)), maxY),
  }
}
function placementRecordFor(display) {
  const settings = readDesktopSettings()
  const state = settings.placement && typeof settings.placement === 'object' ? settings.placement : {}
  const id = displayId(display)
  const resolution = displayResolution(display)
  const candidates = [state.byDisplayId?.[id], state.byResolution?.[resolution], state.placement]
  return candidates.find((value) => value && finite(value.x) && finite(value.y))
}
function currentPlacement() {
  const display = overlayDisplay()
  const area = workAreaRecord(display)
  const record = placementRecordFor(display)
  const source = record?.displayBounds && finite(record.displayBounds.width) && finite(record.displayBounds.height) ? record.displayBounds : area
  const sourceX = record ? record.x - source.x : 0
  const sourceY = record ? record.y - source.y : 0
  const local = record ? clampLocalPosition({
    // The renderer is as large as one display work area, so it consumes
    // viewport-local coordinates. Persisted records are screen coordinates;
    // translating by the destination display origin here would offset the
    // pet twice on secondary displays (especially displays left of primary).
    x: source.width === area.width && source.height === area.height ? sourceX : (sourceX / Math.max(1, source.width)) * area.width,
    y: source.width === area.width && source.height === area.height ? sourceY : (sourceY / Math.max(1, source.height)) * area.height,
  }, area) : null
  return {
    ...(local || {}),
    displayId: displayId(display),
    displayBounds: area,
    placement: record?.placement || 'bottom-end',
    isFreelyPositioned: record?.isFreelyPositioned === true,
  }
}
function saveCurrentPlacement(payload) {
  if (!payload || !finite(payload.x) || !finite(payload.y) || Math.abs(payload.x) > 100_000 || Math.abs(payload.y) > 100_000) throw new Error('桌宠位置不完整')
  const display = overlayDisplay()
  const area = workAreaRecord(display)
  const local = clampLocalPosition(payload, area)
  const id = displayId(display)
  const resolution = displayResolution(display)
  const now = Date.now()
  const record = {
    displayId: id,
    displayBounds: area,
    x: area.x + local.x,
    y: area.y + local.y,
    placement: 'free',
    isFreelyPositioned: payload.isFreelyPositioned !== false,
    updatedAt: now,
  }
  const current = readDesktopSettings()
  const previous = current.placement && typeof current.placement === 'object' ? current.placement : {}
  writeDesktopSettings({
    ...current,
    placement: {
      version: 1,
      displayId: id,
      displayBounds: area,
      byDisplayId: { ...(previous.byDisplayId || {}), [id]: record },
      byResolution: { ...(previous.byResolution || {}), [resolution]: record },
      placement: record,
      isFreelyPositioned: record.isFreelyPositioned,
    },
  })
  return { ...local, displayId: id, displayBounds: area, placement: record.placement, isFreelyPositioned: record.isFreelyPositioned }
}
async function runtimeReady() {
  if (!backendOrigin) return false
  try {
    // Product Workspace is the content authority. Agent is an optional
    // capability: a broken/legacy agent ledger must not make the saved Trace
    // workspace look disconnected or trigger a second listener.
    const response = await fetch(new URL('/api/product/workspace', backendOrigin), { signal: AbortSignal.timeout(1200), headers: { accept: 'application/json' } })
    return response.ok && (response.headers.get('content-type') || '').includes('application/json')
  } catch { return false }
}

function isAgentStartupFailure(error) {
  const code = String(error?.code || '').toUpperCase()
  return code === 'PRODUCT_IDENTITY_UNVERIFIED' || code.startsWith('AGENT_') || code === 'INVALID_WORKSPACE' || code === 'INVALID_INSTALLATION'
}

async function startBundledRuntime({ agentEnabled, cacheBust = false } = {}) {
  const runtimeRoot = join(process.resourcesPath, 'trace-runtime')
  const server = join(runtimeRoot, 'apps', 'desktop', 'server.mjs')
  const specifier = `${pathToFileURL(server).href}${cacheBust ? `?attempt=${++bundledRuntimeAttempt}` : ''}`
  process.env.TRACE_AGENT_ENABLED = agentEnabled ? '1' : '0'
  let loaded
  try {
    loaded = await withIpcTimeout(import(specifier), RUNTIME_START_TIMEOUT_MS, 'Trace 本机内容服务启动超时')
    const binding = await withIpcTimeout(loaded.ready, RUNTIME_START_TIMEOUT_MS, 'Trace 本机内容服务启动超时')
    if (!bundledRuntime) bundledRuntime = loaded
    if (!binding || !Number.isInteger(Number(binding.port)) || Number(binding.port) < 1 || Number(binding.port) > 65_535) throw new Error('Trace 本机内容服务没有返回有效连接')
    if (!configuredBackendOrigin) backendOrigin = `http://127.0.0.1:${Number(binding.port)}`
    return binding
  } catch (error) {
    try { await loaded?.close?.() } catch { /* startup cleanup is best effort */ }
    if (bundledRuntime === loaded) bundledRuntime = undefined
    throw error
  }
}

async function doEnsureBundledRuntime({ retry = false } = {}) {
  if (await runtimeReady()) {
    if (bundledRuntimeStatus.state !== 'degraded') setBundledRuntimeStatus({ connected: true, bundled: app.isPackaged, state: 'connected', message: 'Trace 本机内容服务已连接。' })
    return
  }
  if (!app.isPackaged) {
    setBundledRuntimeStatus({ connected: Boolean(backendOrigin), bundled: false, state: 'external', message: '正在连接 Trace 本机内容服务…' })
    return
  }
  const target = new URL(backendOrigin || DEFAULT_RUNTIME_ORIGIN)
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
    setBundledRuntimeStatus({ connected: false, bundled: true, state: 'failed', message: 'Trace 本机内容服务地址不可用，请重新启动 Trace。' })
    return
  }
  const runtimeRoot = join(process.resourcesPath, 'trace-runtime')
  const server = join(runtimeRoot, 'apps', 'desktop', 'server.mjs')
  if (!existsSync(server)) {
    setBundledRuntimeStatus({ connected: false, bundled: true, state: 'failed', message: '当前安装缺少 Trace 本机内容服务，请重新安装后重试。' })
    throw new Error('Trace bundled runtime entrypoint is missing')
  }
  const stateRoot = join(app.getPath('userData'), 'state')
  mkdirSync(stateRoot, { recursive: true })
  const settings = readDesktopSettings()
  const persistedIdentity = ensureRuntimeIdentity(settings, () => randomBytes(24).toString('hex'))
  if (persistedIdentity.changed) writeDesktopSettings(persistedIdentity.settings)
  process.env.TRACE_RUNTIME_ROOT = runtimeRoot
  process.env.TRACE_BUNDLED_RUNTIME = '1'
  process.env.TRACE_DESKTOP_PORT = configuredBackendOrigin ? target.port || '80' : '0'
  process.env.TRACE_WEB_STATE_FILE = join(stateRoot, 'web.sqlite')
  process.env.TRACE_AGENT_STATE_FILE = join(stateRoot, 'agent.sqlite')
  process.env.TRACE_AGENT_RUNTIME_ROOT = join(stateRoot, 'agent-runs')
  // The packaged runtime must never silently accept a legacy/null identity.
  // Bind this app-owned database to stable IDs and let the runtime perform its
  // explicit, transactional legacy upgrade before serving any state.
  process.env.TRACE_INSTALLATION_ID = persistedIdentity.identity.installationId
  process.env.TRACE_WORKSPACE_ID = persistedIdentity.identity.workspaceId
  process.env.TRACE_UPGRADE_LEGACY_IDENTITY = '1'
  delete process.env.TRACE_ALLOW_LEGACY_IDENTITY
  process.env.TRACE_AGENT_ENABLED ??= '1'
  process.env.TRACE_DESKTOP_SNAPSHOT_TOKEN ??= randomBytes(32).toString('base64url')
  const codexExecutable = resolveCodexExecutable()
  if (codexExecutable) process.env.TRACE_CODEX_BIN = codexExecutable
  setBundledRuntimeStatus({ connected: false, bundled: true, state: 'starting', message: '正在启动 Trace 本机内容服务…' })
  const requestedAgent = process.env.TRACE_AGENT_ENABLED !== '0'
  try {
    await startBundledRuntime({ agentEnabled: requestedAgent, cacheBust: retry })
    setBundledRuntimeStatus({ connected: true, bundled: true, state: 'connected', message: 'Trace 本机内容服务已连接。' })
  } catch (error) {
    // Agent is optional for reading and editing the Product Workspace. If an
    // old agent ledger cannot be opened, retry the same packaged server with
    // Agent disabled rather than leaving the product window without a local
    // listener. Product state remains authoritative and readable.
    if (requestedAgent && isAgentStartupFailure(error)) {
      try {
        await startBundledRuntime({ agentEnabled: false, cacheBust: true })
        setBundledRuntimeStatus({ connected: true, bundled: true, state: 'degraded', message: 'Trace 内容已连接；本机 Agent 暂时不可用，可稍后重试。' })
        return
      } catch (fallbackError) {
        error = fallbackError
      }
    }
    setBundledRuntimeStatus({ connected: false, bundled: true, state: 'failed', message: 'Trace 本机内容服务没有启动，请重试。' })
    throw error
  }
}

function ensureBundledRuntime(options = {}) {
  if (bundledRuntimeStartPromise) return bundledRuntimeStartPromise
  let settled
  const task = doEnsureBundledRuntime(options)
  settled = task.finally(() => {
    if (bundledRuntimeStartPromise === settled) bundledRuntimeStartPromise = null
  })
  bundledRuntimeStartPromise = settled
  return settled
}

function positionOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  const { x, y, width, height } = overlayDisplay().workArea
  overlayWindow.setBounds({ x, y, width, height })
}

function showOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  positionOverlay()
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })
  overlayWindow.showInactive()
}

function toggleOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (overlayWindow.isVisible()) overlayWindow.hide()
  else showOverlay()
}

function parseDiscussionQuery(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return undefined
  }
  if (url.origin !== discussionOrigin) return undefined

  const query = {}
  for (const [key, value] of url.searchParams) {
    if (allowedDiscussionKeys.has(key)) query[key] = value
  }
  // The native window hosts the current Trace product shell. Explicitly pin
  // its route so legacy observation query keys do not send file:// builds to
  // the removed /legacy.html absolute path.
  query.view = 'home'
  query.from = 'trace-native'
  return query
}

function openDiscussion(rawUrl) {
  const query = parseDiscussionQuery(rawUrl)
  if (!query) return

  const workArea = screen.getPrimaryDisplay().workArea
  const discussionWindow = new BrowserWindow({
    width: Math.min(1440, workArea.width),
    height: Math.min(900, workArea.height),
    minWidth: 880,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f3f0e7',
    title: 'Trace · 深度讨论',
    icon: appIconPath,
    webPreferences: {
      preload: join(root, 'discussion-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  discussionWindows.add(discussionWindow)
  discussionWindow.once('ready-to-show', () => discussionWindow.show())
  discussionWindow.on('closed', () => discussionWindows.delete(discussionWindow))
  discussionWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const target = new URL(`${discussionScheme}://desktop/index.html`)
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value)
  void discussionWindow.loadURL(target.href)
}

function createOverlayWindow() {
  const workArea = screen.getPrimaryDisplay().workArea
  overlayWindow = new BrowserWindow({
    ...workArea,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    title: 'Trace 桌面插件',
    webPreferences: {
      preload: join(root, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  overlayWindow.setAlwaysOnTop(true, 'floating')
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })
  overlayWindow.on('hide', () => {
    if (!overlayWindow.isDestroyed()) overlayWindow.setIgnoreMouseEvents(true, { forward: false })
  })
  overlayWindow.webContents.on('did-start-loading', () => { overlayReady = false })
  overlayWindow.webContents.on('did-finish-load', () => {
    overlayReady = true
    while (pendingCodexEvents.length) sendCodexEvent(pendingCodexEvents.shift())
  })
  overlayWindow.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    overlayWindow.hide()
  })
  overlayWindow.once('ready-to-show', showOverlay)
  overlayWindow.webContents.setWindowOpenHandler(({ url }) => {
    let target
    try { target = new URL(url) } catch { target = null }
    if (target?.origin === discussionOrigin) openDiscussion(url)
    else if (target && ['https:', 'http:'].includes(target.protocol)) void shell.openExternal(target.href)
    return { action: 'deny' }
  })
  void overlayWindow.loadFile(join(root, 'index.html'))
}

function createTray() {
  const icon = nativeImage.createFromPath(trayIconPath)
  tray = new Tray(icon)
  tray.setToolTip('Trace 桌面插件')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 Trace', click: showOverlay },
    { label: '隐藏 Trace', click: () => overlayWindow?.hide() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true
        app.quit()
      },
    },
  ]))
  tray.on('click', toggleOverlay)
}

/**
 * Event transport only. The overlay never starts a second Agent: the native
 * process asks the existing Trace Runtime/Codex adapter for its latest safe
 * event projection and forwards it over a narrow renderer IPC channel.
 */
function startCodexEventPolling() {
  if (codexEventPollTimer || !capabilityClient) return
  const poll = async () => {
    if (codexEventPollInFlight || !overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.webContents) return
    codexEventPollInFlight = true
    try {
      const result = await capabilityClient.request({ operation: 'codex.events' })
      if (Array.isArray(result?.events)) {
        for (const event of result.events.slice(0, 128)) sendCodexEvent(event)
      }
    } catch {
      // Runtime startup/disconnect is normal. The pet stays at its last
      // projection and does not invent a local task to fill the gap.
    } finally {
      codexEventPollInFlight = false
    }
  }
  void poll()
  codexEventPollTimer = setInterval(() => void poll(), 1500)
  codexEventPollTimer.unref?.()
}
function stopCodexEventPolling() {
  if (!codexEventPollTimer) return
  clearInterval(codexEventPollTimer)
  codexEventPollTimer = undefined
}

function openZhihuAuthorization(loginUrl, parentWindow) {
  let target
  try { target = new URL(loginUrl) } catch { throw new Error('知乎授权地址不正确') }
  if (target.protocol !== 'https:' || target.hostname !== 'openapi.zhihu.com') throw new Error('知乎授权地址不受信任')
  if (zhihuAuthWindow && !zhihuAuthWindow.isDestroyed()) zhihuAuthWindow.close()
  zhihuAuthWindow = new BrowserWindow({
    width: 760,
    height: 760,
    minWidth: 620,
    minHeight: 640,
    parent: parentWindow,
    modal: true,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4f2eb',
    title: '连接知乎 · Trace',
    icon: appIconPath,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      if (zhihuAuthWindow && !zhihuAuthWindow.isDestroyed()) zhihuAuthWindow.close()
      zhihuAuthWindow = undefined
      error ? reject(error) : resolve()
    }
    const inspect = (rawUrl) => {
      let url
      try { url = new URL(rawUrl) } catch { return }
      if (!traceAuthCompletionOrigins.has(url.origin) || url.pathname !== '/app') return
      if (url.searchParams.get('zhihu') === 'connected') finish()
      else if (url.searchParams.get('zhihu') === 'error') finish(new Error('知乎没有完成授权，请重新连接'))
    }
    zhihuAuthWindow.once('ready-to-show', () => zhihuAuthWindow?.show())
    zhihuAuthWindow.webContents.on('will-redirect', (_event, url) => inspect(url))
    zhihuAuthWindow.webContents.on('did-navigate', (_event, url) => inspect(url))
    zhihuAuthWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })
    zhihuAuthWindow.once('closed', () => {
      zhihuAuthWindow = undefined
      if (!settled) { settled = true; reject(new Error('已取消知乎授权')) }
    })
    void zhihuAuthWindow.loadURL(target.href).catch(() => finish(new Error('无法打开知乎授权页面')))
  })
}

const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) {
  app.quit()
} else {
  app.on('second-instance', showOverlay)
  app.whenReady().then(() => {
    void (async () => {
      installDiscussionProtocol()
      try { await ensureBundledRuntime() }
      catch (error) { console.error(`Trace bundled runtime did not start: ${error instanceof Error ? error.message : String(error)}`) }
      const settings = readDesktopSettings()
      capabilityClient = createRuntimeCapabilityClient({
        origin: backendOrigin || DEFAULT_RUNTIME_ORIGIN,
        cloudOrigin: traceCloudOrigin,
        projectDir: process.env.TRACE_PROJECT_DIR || settings.projectDir,
        desktopSnapshotToken: process.env.TRACE_DESKTOP_SNAPSHOT_TOKEN,
        cloudFetchImpl: session.defaultSession.fetch.bind(session.defaultSession),
        onCodexEvent: (event) => sendCodexEvent(event),
        onSetupProgress: (event) => sendSetupProgress(event),
        getRuntimeStatus: () => publicBundledRuntimeStatus(),
        retryRuntime: async () => {
          try {
            await ensureBundledRuntime({ retry: true })
          } catch {
            // The public status is deliberately stable and does not include
            // server paths, ports or loader details.
          }
          return publicBundledRuntimeStatus()
        },
        getCodexThreadId: (workId) => readDesktopSettings().codexThreads?.[workId],
        setCodexThreadId: (workId, threadId) => {
          const current = readDesktopSettings()
          const entries = current.codexThreads && typeof current.codexThreads === 'object' && !Array.isArray(current.codexThreads)
            ? { ...current.codexThreads }
            : {}
          entries[workId] = threadId
          const keys = Object.keys(entries)
          while (keys.length > 128) delete entries[keys.shift()]
          writeDesktopSettings({ ...current, codexThreads: entries })
        },
      })
      app.setAppUserModelId('store.neutrom.trace.desktop')
      Menu.setApplicationMenu(null)
      createOverlayWindow()
      createTray()
      startCodexEventPolling()
      if (openProductOnStart) openDiscussion(`${discussionOrigin}/?view=home`)

      screen.on('display-metrics-changed', positionOverlay)
      screen.on('display-added', positionOverlay)
      screen.on('display-removed', positionOverlay)
    })()
  })
}

ipcMain.on('trace-native:runtime-status', (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (!senderWindow || senderWindow !== overlayWindow && !discussionWindows.has(senderWindow)) {
    event.returnValue = { connected: false, bundled: app.isPackaged, state: 'failed', message: 'Trace 本机内容服务暂时不可用，请重试。' }
    return
  }
  event.returnValue = publicBundledRuntimeStatus()
})

ipcMain.on('trace-native:set-ignore-mouse-events', (event, ignore) => {
  if (!overlayWindow || event.sender !== overlayWindow.webContents || typeof ignore !== 'boolean') return
  overlayWindow.setIgnoreMouseEvents(ignore, { forward: ignore })
})

ipcMain.on('trace-native:interactive-bounds', (event, payload) => {
  if (!overlayWindow || event.sender !== overlayWindow.webContents || !Array.isArray(payload)) return
  interactiveBounds = payload.slice(0, 64).flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const x = Number(value.x), y = Number(value.y), width = Number(value.width), height = Number(value.height)
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || width > 20_000 || height > 20_000) return []
    return [{ x, y, width, height }]
  })
})

ipcMain.on('trace-native:open-discussion', (event, url) => {
  if (!overlayWindow || event.sender !== overlayWindow.webContents || typeof url !== 'string') return
  openDiscussion(url)
})

ipcMain.on('trace-native:discussion-candidate', (event, payload) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (!senderWindow || !discussionWindows.has(senderWindow)) return
  if (!payload || payload.type !== 'trace.desktop.candidate') return
  if (typeof payload.observationId !== 'string' || !['候选中', '待确认'].includes(payload.status)) return
  overlayWindow?.webContents.send('trace-native:candidate', payload)
})

ipcMain.handle('trace-native:capability', async (event, request) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (!senderWindow || senderWindow !== overlayWindow && !discussionWindows.has(senderWindow)) throw new Error('Capability caller is not a Trace window')
  if (!capabilityClient) throw new Error('Trace 本机能力仍在启动，请稍后再试')
  if (request?.operation === 'work.project.select') {
    const result = await dialog.showOpenDialog(senderWindow, { title: '选择要与 Codex 一起工作的项目', properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return withIpcTimeout(capabilityClient.request({ operation: 'work.environment' }), IPC_TIMEOUT_MS, 'Trace 本机能力响应超时，请重试。')
    const selected = capabilityClient.setProjectDir(result.filePaths[0])
    writeDesktopSettings({ ...readDesktopSettings(), projectDir: result.filePaths[0] })
    return selected
  }
  const timeoutMs = request?.operation === 'work.run' ? 210_000 : request?.operation === 'agent.run' ? 200_000 : IPC_TIMEOUT_MS
  const result = await withIpcTimeout(capabilityClient.request(request), timeoutMs, 'Trace 本机能力响应超时，请重试。')
  if (request?.operation === 'zhihu.oauth.start') await openZhihuAuthorization(result.login_url, senderWindow)
  return result
})

ipcMain.handle('trace-native:placement:get', (event) => {
  if (!overlayWindow || event.sender !== overlayWindow.webContents) throw new Error('桌宠位置请求不是来自 Trace 桌面窗口')
  return currentPlacement()
})

ipcMain.handle('trace-native:placement:save', (event, payload) => {
  if (!overlayWindow || event.sender !== overlayWindow.webContents) throw new Error('桌宠位置请求不是来自 Trace 桌面窗口')
  return saveCurrentPlacement(payload)
})

ipcMain.handle('trace-native:workspace', async (event, payload) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (!senderWindow || !discussionWindows.has(senderWindow)) throw new Error('工作区请求不是来自 Trace 桌面窗口')
  if (!capabilityClient) throw new Error('Trace 本机内容仍在启动，请稍后再试')
  const pathname = payload?.pathname
  const method = payload?.options?.method || 'GET'
  const body = payload?.options?.body
  return withIpcTimeout(
    capabilityClient.request({ operation: 'workspace.request', pathname, method, ...(body === undefined ? {} : { body }) }),
    WORKSPACE_IPC_TIMEOUT_MS,
    'Trace 本机内容读取超时，请重试。',
  )
})

app.on('window-all-closed', () => {})
app.on('before-quit', () => {
  quitting = true
  stopCodexEventPolling()
  capabilityClient?.close?.()
  void bundledRuntime?.close?.()
})

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, screen, session, shell, Tray } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DEFAULT_CLOUD_ORIGIN, DEFAULT_RUNTIME_ORIGIN, createRuntimeCapabilityClient, resolveCodexExecutable } from './runtime-client.mjs'

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
async function runtimeReady() {
  if (!backendOrigin) return false
  try {
    const responses = await Promise.all(['/api/product/workspace', '/api/agent/capabilities'].map((pathname) => (
      fetch(new URL(pathname, backendOrigin), { signal: AbortSignal.timeout(1200), headers: { accept: 'application/json' } })
    )))
    return responses.every((response) => response.ok && (response.headers.get('content-type') || '').includes('application/json'))
  } catch { return false }
}
async function ensureBundledRuntime() {
  if (await runtimeReady() || !app.isPackaged) return
  const dynamicBinding = !configuredBackendOrigin
  const target = new URL(backendOrigin || DEFAULT_RUNTIME_ORIGIN)
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) return
  const runtimeRoot = join(process.resourcesPath, 'trace-runtime')
  const server = join(runtimeRoot, 'apps', 'desktop', 'server.mjs')
  if (!existsSync(server)) return
  const stateRoot = join(app.getPath('userData'), 'state')
  mkdirSync(stateRoot, { recursive: true })
  process.env.TRACE_RUNTIME_ROOT = runtimeRoot
  process.env.TRACE_BUNDLED_RUNTIME = '1'
  process.env.TRACE_DESKTOP_PORT = dynamicBinding ? '0' : target.port || '80'
  process.env.TRACE_WEB_STATE_FILE = join(stateRoot, 'web.sqlite')
  process.env.TRACE_AGENT_STATE_FILE = join(stateRoot, 'agent.sqlite')
  process.env.TRACE_AGENT_RUNTIME_ROOT = join(stateRoot, 'agent-runs')
  process.env.TRACE_AGENT_ENABLED ??= '1'
  process.env.TRACE_DESKTOP_SNAPSHOT_TOKEN ??= randomBytes(32).toString('base64url')
  const codexExecutable = resolveCodexExecutable()
  if (codexExecutable) process.env.TRACE_CODEX_BIN = codexExecutable
  bundledRuntime = await import(pathToFileURL(server).href)
  const binding = await bundledRuntime.ready
  if (dynamicBinding) {
    const port = Number(binding?.port)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Trace bundled runtime did not report a valid loopback port')
    backendOrigin = `http://127.0.0.1:${port}`
  }
}

function positionOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea
  overlayWindow.setBounds({ x, y, width, height })
}

function showOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  positionOverlay()
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
      })
      app.setAppUserModelId('store.neutrom.trace.desktop')
      Menu.setApplicationMenu(null)
      createOverlayWindow()
      createTray()
      if (openProductOnStart) openDiscussion(`${discussionOrigin}/?view=home`)

      screen.on('display-metrics-changed', positionOverlay)
      screen.on('display-added', positionOverlay)
      screen.on('display-removed', positionOverlay)
    })()
  })
}

ipcMain.on('trace-native:set-ignore-mouse-events', (event, ignore) => {
  if (!overlayWindow || event.sender !== overlayWindow.webContents || typeof ignore !== 'boolean') return
  overlayWindow.setIgnoreMouseEvents(ignore, { forward: true })
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
    if (result.canceled || !result.filePaths[0]) return capabilityClient.request({ operation: 'work.environment' })
    const selected = capabilityClient.setProjectDir(result.filePaths[0])
    writeDesktopSettings({ ...readDesktopSettings(), projectDir: result.filePaths[0] })
    return selected
  }
  const result = await capabilityClient.request(request)
  if (request?.operation === 'zhihu.oauth.start') await openZhihuAuthorization(result.login_url, senderWindow)
  return result
})

ipcMain.handle('trace-native:workspace', async (event, payload) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (!senderWindow || !discussionWindows.has(senderWindow)) throw new Error('工作区请求不是来自 Trace 桌面窗口')
  if (!capabilityClient) throw new Error('Trace 本机内容仍在启动，请稍后再试')
  const pathname = payload?.pathname
  const method = payload?.options?.method || 'GET'
  const body = payload?.options?.body
  return capabilityClient.request({ operation: 'workspace.request', pathname, method, ...(body === undefined ? {} : { body }) })
})

app.on('window-all-closed', () => {})
app.on('before-quit', () => {
  quitting = true
  void bundledRuntime?.close?.()
})

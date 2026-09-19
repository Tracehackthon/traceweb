import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const output = await mkdtemp(join(tmpdir(), 'trace-desktop-pet-tests-'))
await build({
  absWorkingDir: root,
  entryPoints: ['src/client/codex-events.ts', 'src/client/placement.ts'],
  outdir: output,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outExtension: { '.js': '.mjs' },
})
const codex = await import(pathToFileURL(join(output, 'codex-events.mjs')).href)
const placement = await import(pathToFileURL(join(output, 'placement.mjs')).href)
const runtimeClient = await import(pathToFileURL(resolve(root, 'src/desktop/runtime-client.mjs')).href)
const installationIdentity = await import(pathToFileURL(resolve(root, 'src/desktop/runtime-installation-identity.mjs')).href)
const runtimeIntegrations = await import(pathToFileURL(resolve(root, 'src/desktop/runtime-integrations.mjs')).href)
const projectBinding = await import(pathToFileURL(resolve(root, 'src/desktop/runtime-project-binding.mjs')).href)
const desktopLifecycle = await import(pathToFileURL(resolve(root, 'src/desktop/lifecycle.mjs')).href)
const storageLifecycle = await import(pathToFileURL(resolve(root, 'src/desktop/storage-lifecycle.mjs')).href)

test('desktop upgrades discard version-bound caches while preserving user state and authorization data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-storage-upgrade-'))
  for (const name of storageLifecycle.TRANSIENT_STORAGE_NAMES) {
    await mkdir(join(directory, name), { recursive: true })
    await writeFile(join(directory, name, 'stale.bin'), 'old-version', 'utf8')
  }
  for (const name of ['state', 'IndexedDB', 'Local Storage', 'Network']) {
    await mkdir(join(directory, name), { recursive: true })
    await writeFile(join(directory, name, 'keep.bin'), 'user-data', 'utf8')
  }
  await writeFile(join(directory, 'desktop-settings.json'), '{}', 'utf8')

  const result = storageLifecycle.clearVersionBoundStorage({ userData: directory, previousVersion: '0.2.2', currentVersion: '0.2.3' })
  assert.equal(result.changed, true)
  for (const name of storageLifecycle.TRANSIENT_STORAGE_NAMES) await assert.rejects(access(join(directory, name)))
  for (const name of ['state', 'IndexedDB', 'Local Storage', 'Network', 'desktop-settings.json']) await access(join(directory, name))

  const stable = storageLifecycle.clearVersionBoundStorage({ userData: directory, previousVersion: '0.2.3', currentVersion: '0.2.3' })
  assert.deepEqual(stable, { changed: false, removed: [], failed: [] })
})

test('desktop shutdown is single-flight, bypasses renderer unload vetoes and waits for local state cleanup', async () => {
  const calls = []
  const windows = [
    { isDestroyed: () => false, hide: () => calls.push('hide-a'), destroy: () => calls.push('destroy-a') },
    { isDestroyed: () => true, hide: () => calls.push('hide-dead'), destroy: () => calls.push('destroy-dead') },
    { isDestroyed: () => false, hide: () => calls.push('hide-b'), destroy: () => calls.push('destroy-b') },
  ]
  const app = { exit: (code) => calls.push(`exit-${code}`) }
  const controller = desktopLifecycle.createDesktopShutdownController({
    app,
    listWindows: () => windows,
    destroyTray: () => calls.push('tray'),
    stopPolling: () => calls.push('polling'),
    closeCapability: () => calls.push('capability'),
    closeRuntime: async () => { calls.push('runtime-start'); await new Promise((resolve) => setTimeout(resolve, 5)); calls.push('runtime-end') },
    onStart: (reason) => calls.push(`start-${reason}`),
    timeoutMs: 100,
  })
  const quitEvent = { prevented: false, preventDefault() { this.prevented = true } }
  controller.handleBeforeQuit(quitEvent)
  assert.equal(quitEvent.prevented, true)
  await Promise.all([controller.requestShutdown('duplicate'), controller.done])
  assert.deepEqual(calls, [
    'start-before-quit', 'polling', 'capability', 'hide-a', 'destroy-a', 'hide-b', 'destroy-b', 'tray',
    'runtime-start', 'runtime-end', 'exit-0',
  ])
  assert.equal(controller.isShuttingDown(), true)
})

test('desktop update-shutdown launch intent is explicit and bounded cleanup cannot keep the process alive', async () => {
  assert.equal(desktopLifecycle.launchIntent(['Trace.exe']).action, 'activate')
  assert.equal(desktopLifecycle.launchIntent(['Trace.exe', desktopLifecycle.UPDATE_SHUTDOWN_ARGUMENT]).action, 'shutdown-for-update')
  const calls = []
  const controller = desktopLifecycle.createDesktopShutdownController({
    app: { exit: (code) => calls.push(`exit-${code}`) },
    listWindows: () => [],
    closeRuntime: () => new Promise(() => {}),
    timeoutMs: 10,
  })
  await controller.requestShutdown('installer')
  assert.deepEqual(calls, ['exit-0'])
})

test('installer asks the registered app to stop, then force-closes only the registered executable before overwrite', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const installer = await readFile(resolve(root, 'build/installer.nsh'), 'utf8')
  const installSection = await readFile(resolve(root, 'node_modules/app-builder-lib/templates/nsis/installSection.nsh'), 'utf8')
  const installUtil = await readFile(resolve(root, 'node_modules/app-builder-lib/templates/nsis/include/installUtil.nsh'), 'utf8')
  const uninstaller = await readFile(resolve(root, 'node_modules/app-builder-lib/templates/nsis/uninstaller.nsh'), 'utf8')
  assert.equal(manifest.build.nsis.include, 'build/installer.nsh')
  assert.equal(manifest.build.nsis.deleteAppDataOnUninstall, false)
  assert.match(installer, /--trace-shutdown-for-update/)
  assert.match(installer, /InstallLocation/)
  assert.match(installer, /ExecutablePath/)
  assert.match(installer, /Stop-Process/)
  assert.match(installer, /AddSeconds\(5\)/)
  assert.match(installer, /Start-Sleep/)
  assert.match(installer, /traceStopAppAtPath "\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}"/)
  assert.match(installer, /customCheckAppRunning/)
  assert.match(installer, /tracePurgeRegisteredInstall HKCU/)
  assert.match(installer, /tracePurgeRegisteredInstall HKLM/)
  assert.match(installer, /TRACE_INSTALL_DIR/)
  assert.match(installer, /\$\{APP_EXECUTABLE_FILENAME\}/)
  assert.match(installer, /Remove-Item -LiteralPath/)
  assert.match(installer, /\$\$attempt -lt 20/)
  assert.match(installer, /\$R0 == 2/)
  assert.match(installer, /旧安装位置无法通过产品身份校验/)
  assert.match(installer, /旧程序文件仍在使用中/)
  assert.match(installer, /DeleteRegKey \$\{ROOT\} "\$\{INSTALL_REGISTRY_KEY\}"/)
  assert.match(installer, /Get-ChildItem -LiteralPath/)
  assert.match(installer, /!macro customRemoveFiles/)
  assert.match(installer, /RMDir \/r "\$INSTDIR"/)
  assert.ok(installSection.indexOf('uninstallOldVersion') < installSection.indexOf('installApplicationFiles'))
  assert.match(installUtil, /\/S \/KEEP_APP_DATA/)
  assert.match(uninstaller, /RMDir \/r \$INSTDIR/)
})

test('desktop runtime integrations load backend-only Zhihu config without overriding explicit environment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-runtime-integrations-'))
  const file = join(directory, 'runtime-integrations.json')
  await writeFile(file, JSON.stringify({ zhihu: {
    enabled: true,
    accessSecret: 'file-secret',
    oauthAppId: '669',
    oauthAppKey: 'file-app-key',
    oauthRedirectUri: 'https://trace.neutrom.store/callback',
  } }), 'utf8')
  const env = { ZHIHU_ACCESS_SECRET: 'environment-wins' }
  const result = runtimeIntegrations.applyRuntimeIntegrationConfig({ file, env })
  assert.equal(result.zhihuEnabled, true)
  assert.equal(env.TRACE_ZHIHU_ENABLED, '1')
  assert.equal(env.ZHIHU_ACCESS_SECRET, 'environment-wins')
  assert.equal(env.ZHIHU_OAUTH_APP_ID, '669')
  assert.equal(env.ZHIHU_OAUTH_APP_KEY, 'file-app-key')
  assert.equal(env.ZHIHU_OAUTH_REDIRECT_URI, 'https://trace.neutrom.store/callback')
  assert.equal(JSON.stringify(result).includes('file-secret'), false)
  assert.equal(JSON.stringify(result).includes('file-app-key'), false)
})

test('desktop runtime integrations stay disabled when config is absent or explicitly disabled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-runtime-integrations-off-'))
  const missing = runtimeIntegrations.applyRuntimeIntegrationConfig({ file: join(directory, 'missing.json'), env: {} })
  assert.equal(missing.found, false)
  assert.equal(missing.zhihuEnabled, false)
  const file = join(directory, 'runtime-integrations.json')
  await writeFile(file, JSON.stringify({ zhihu: { enabled: false } }), 'utf8')
  const env = {}
  runtimeIntegrations.applyRuntimeIntegrationConfig({ file, env })
  assert.equal(env.TRACE_ZHIHU_ENABLED, '0')
})

test('desktop runtime integrations reject unsafe callback and relative config paths', async () => {
  assert.throws(() => runtimeIntegrations.readRuntimeIntegrationConfig('relative.json'), /absolute/)
  const directory = await mkdtemp(join(tmpdir(), 'trace-runtime-integrations-bad-'))
  const file = join(directory, 'runtime-integrations.json')
  await writeFile(file, JSON.stringify({ zhihu: { enabled: true, oauthRedirectUri: 'http://example.test/callback?code=x' } }), 'utf8')
  assert.throws(() => runtimeIntegrations.readRuntimeIntegrationConfig(file), /HTTPS OAuth redirect/)
})

const event = (overrides = {}) => ({
  threadId: 'thread-a',
  turnId: 'turn-1',
  itemId: 'item-1',
  kind: 'item.updated',
  itemType: 'reasoning',
  status: 'in_progress',
  at: 1_700_000_000_000,
  ...overrides,
})

test('Codex reducer maps item phases and deduplicates replayed identity', () => {
  let state = codex.createInitialTraceCodexState()
  state = codex.reduceTraceCodexEvent(state, event({ kind: 'turn.started', itemId: null }))
  assert.equal(codex.projectTraceCodexState(state).status, 'thinking')
  state = codex.reduceTraceCodexEvent(state, event({ itemType: 'command_execution', title: 'run tests' }))
  assert.equal(codex.projectTraceCodexState(state).status, 'running-command')
  state = codex.reduceTraceCodexEvent(state, event({ itemType: 'file_change', title: 'update file' }))
  assert.equal(codex.projectTraceCodexState(state).status, 'editing')
  state = codex.reduceTraceCodexEvent(state, event({ itemType: 'web_search', title: 'search docs' }))
  assert.equal(codex.projectTraceCodexState(state).status, 'searching')
  state = codex.reduceTraceCodexEvent(state, event({ itemType: 'approval', status: 'waiting', requiresUserInput: true }))
  assert.equal(codex.projectTraceCodexState(state).status, 'waiting')
  const beforeReplay = state.revision
  state = codex.reduceTraceCodexEvent(state, event({ itemType: 'approval', status: 'waiting', requiresUserInput: true }))
  assert.equal(state.revision, beforeReplay)
})

test('terminal state survives coalescing and projects review/failed', () => {
  const emitted = []
  const coalescer = codex.createTraceCodexEventCoalescer((value) => emitted.push(value), 60_000)
  coalescer.enqueue(event({ kind: 'item.updated', itemId: 'item-2', itemType: 'reasoning' }))
  coalescer.enqueue(event({ kind: 'turn.completed', itemId: null, status: 'completed' }))
  assert.equal(emitted.at(-1).kind, 'turn.completed')
  coalescer.flush()
  assert.equal(emitted.length, 1)
  coalescer.dispose()

  let state = codex.createInitialTraceCodexState()
  state = codex.reduceTraceCodexEvent(state, event({ kind: 'turn.completed', itemId: null, status: 'completed' }))
  assert.equal(codex.projectTraceCodexState(state).status, 'review')
  state = codex.reduceTraceCodexEvent(state, event({ kind: 'item.updated', itemType: 'command_execution' }))
  assert.equal(codex.projectTraceCodexState(state).status, 'review')
  state = codex.reduceTraceCodexEvent(state, event({ kind: 'turn.failed', itemId: null, status: 'failed', turnId: 'turn-2' }))
  assert.equal(codex.projectTraceCodexState(state).status, 'failed')

  state = codex.createInitialTraceCodexState()
  state = codex.reduceTraceCodexEvent(state, event({ kind: 'run.running', runId: 'run-1', threadId: 'thread-run', turnId: null, itemId: null, eventId: 'run-1:1' }))
  state = codex.reduceTraceCodexEvent(state, event({ kind: 'run.succeeded', runId: 'run-1', threadId: 'thread-run', turnId: null, itemId: null, status: 'completed', eventId: 'run-1:2' }))
  assert.equal(codex.projectTraceCodexState(state).status, 'review')
  state = codex.reduceTraceCodexEvent(state, event({ kind: 'runtime.item', runId: 'run-1', threadId: 'thread-run', turnId: null, itemId: null, eventId: 'run-1:3' }))
  assert.equal(codex.projectTraceCodexState(state).status, 'review')

  state = codex.createInitialTraceCodexState()
  state = codex.reduceTraceCodexEvent(state, { runId: 'run-migrate', sequence: 1, type: 'run.queued', data: { status: 'queued' } })
  state = codex.reduceTraceCodexEvent(state, {
    runId: 'run-migrate', sequence: 2, type: 'runtime.approval.required',
    data: { threadId: 'native-thread', interaction: { interactionId: 'interaction-migrate', revision: 2 } },
  })
  assert.equal(Object.keys(state.sessions).length, 1)
  assert.equal(state.sessions['native-thread']?.pendingInteraction?.interactionId, 'interaction-migrate')
  state = codex.reduceTraceCodexEvent(state, { runId: 'run-migrate', sequence: 3, type: 'run.succeeded', data: { status: 'succeeded' } })
  assert.equal(Object.keys(state.sessions).length, 1)
  assert.equal(codex.projectTraceCodexState(state).status, 'review')

  // A terminal run can race the persisted interaction.resolved frame.  The
  // terminal latch must not retain an approval panel forever, and the late
  // resolution must remain processable rather than reopening the session.
  state = codex.createInitialTraceCodexState()
  state = codex.reduceTraceCodexEvent(state, {
    runId: 'run-race', sequence: 1, type: 'runtime.approval.required',
    data: { threadId: 'thread-race', interaction: { interactionId: 'interaction-race', revision: 1 } },
  })
  state = codex.reduceTraceCodexEvent(state, {
    runId: 'run-race', sequence: 2, type: 'run.cancelled',
    data: { status: 'cancelled' },
  })
  assert.equal(codex.projectTraceCodexState(state).pendingInteraction, null)
  const beforeResolved = state.revision
  state = codex.reduceTraceCodexEvent(state, {
    runId: 'run-race', sequence: 3, type: 'runtime.interaction.resolved',
    data: { interactionId: 'interaction-race', status: 'cancelled' },
  })
  assert.ok(state.revision > beforeResolved)
  assert.equal(codex.projectTraceCodexState(state).pendingInteraction, null)
  assert.equal(codex.projectTraceCodexState(state).status, 'failed')
})

test('Codex event normalizer accepts app-server separators and redacts display text', () => {
  const normalized = codex.normalizeTraceCodexEvent({
    type: 'item/started',
    thread_id: 'thread-b',
    turn_id: 'turn-b',
    item_id: 'item-b',
    item_type: 'command_execution',
    title: 'C:\\Users\\person\\repo\\run',
    detail: 'Bearer sk-test-secret-12345678',
  })
  assert.equal(normalized.kind, 'item.started')
  assert.equal(normalized.itemType, 'command_execution')
  assert.match(normalized.title, /<path>/)
  assert.match(normalized.detail, /<secret>/)
})

test('runtime approval contract normalizes pendingInteraction revision and ISO expiry', () => {
  const required = codex.normalizeTraceCodexEvent({
    runId: 'run-a',
    sequence: 12,
    requestId: 'request-a',
    type: 'runtime.approval.required',
    data: {
      threadId: 'thread-a',
      turnId: 'turn-a',
      itemId: 'item-a',
      runtime: {
        pendingInteraction: {
          interactionId: 'interaction-a',
          kind: 'approval',
          revision: 7,
          expiresAt: '2099-09-18T12:00:00.000Z',
          title: '允许执行这个操作',
          command: 'node C:\\Users\\person\\repo\\script.js',
          recoverable: true,
        },
      },
    },
  })
  assert.equal(required.kind, 'runtime.approval.required')
  assert.equal(required.runId, 'run-a')
  assert.equal(required.requestId, 'request-a')
  assert.equal(required.interaction.interactionId, 'interaction-a')
  assert.equal(required.interaction.requestId, 'request-a')
  assert.equal(required.interaction.expectedRevision, 7)
  assert.equal(required.interaction.expiresAt, Date.parse('2099-09-18T12:00:00.000Z'))
  assert.match(required.interaction.impact, /<项目路径>/)
  assert.doesNotMatch(required.interaction.impact, /C:\\Users\\person/)

  const input = codex.normalizeTraceCodexEvent({
    runId: 'run-input', sequence: 14, type: 'runtime.input.required',
    data: {
      threadId: 'thread-input',
      interaction: {
        interactionId: 'interaction-input', revision: 3, expiresAt: '2099-09-18T12:00:00.000Z',
        method: 'item/tool/requestUserInput',
        questions: [{ id: 'q-1', header: '确认值', question: '请输入一个值', isSecret: true, optionCount: 2 }],
      },
    },
  })
  assert.equal(input.interaction.kind, 'input')
  assert.equal(input.interaction.questions?.[0].id, 'q-1')
  assert.equal(input.interaction.questions?.[0].isSecret, true)
  assert.equal(input.interaction.questions?.[0].optionCount, 2)

  let state = codex.createInitialTraceCodexState()
  state = codex.reduceTraceCodexEvent(state, required)
  assert.equal(codex.projectTraceCodexState(state).status, 'waiting')
  assert.equal(codex.projectTraceCodexState(state).pendingInteraction.interactionId, 'interaction-a')
  const resolved = codex.normalizeTraceCodexEvent({
    runId: 'run-a', sequence: 13, type: 'runtime.interaction.resolved',
    data: { threadId: 'thread-a', status: 'cancelled', interaction: { interactionId: 'interaction-a' } },
  })
  state = codex.reduceTraceCodexEvent(state, resolved)
  assert.equal(codex.projectTraceCodexState(state).pendingInteraction, null)
  assert.equal(codex.projectTraceCodexState(state).status, 'failed')
})

test('runtime approval and input requests use the exact bounded HTTP contract', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options })
    return { ok: true, status: 200, text: async () => JSON.stringify({ accepted: true }) }
  }
  const client = runtimeClient.createRuntimeCapabilityClient({
    origin: 'http://127.0.0.1:42731',
    fetchImpl,
    cloudFetchImpl: fetchImpl,
  })
  await client.request({
    operation: 'agent.run.approval', runId: 'run-a', interactionId: 'interaction-a',
    expectedRevision: 7, idempotencyKey: 'key-a', decision: 'decline',
  })
  await client.request({
    operation: 'agent.run.input', runId: 'run-a', interactionId: 'interaction-b',
    expectedRevision: 8, idempotencyKey: 'key-b', answers: { question: { answers: ['yes'] } },
  })
  assert.equal(calls.length, 2)
  assert.equal(new URL(calls[0].url).pathname, '/api/agent/runs/run-a/approval')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    interactionId: 'interaction-a', expectedRevision: 7, idempotencyKey: 'key-a', decision: 'decline',
  })
  assert.equal(new URL(calls[1].url).pathname, '/api/agent/runs/run-a/input')
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    interactionId: 'interaction-b', expectedRevision: 8, idempotencyKey: 'key-b',
    answers: { question: { answers: ['yes'] } },
  })
})

test('agent SSE subscription forwards persisted events and stops only at a terminal run event', async () => {
  const calls = []
  const frames = [
    { sequence: 4, runId: 'run-sse', type: 'runtime.approval.required', data: { status: 'waiting', interaction: { interactionId: 'i-sse', revision: 2 } } },
    { sequence: 5, runId: 'run-sse', type: 'run.completed', data: { status: 'completed' } },
  ]
  const body = `${frames.map((frame) => `id: ${frame.sequence}\nevent: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join('')}`
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options })
    let read = false
    return {
      ok: true,
      status: 200,
      body: { getReader: () => ({ read: async () => {
        if (read) return { done: true, value: undefined }
        read = true
        return { done: false, value: new TextEncoder().encode(body) }
      } }) },
    }
  }
  const received = []
  const client = runtimeClient.createRuntimeCapabilityClient({
    origin: 'http://127.0.0.1:42731', fetchImpl, cloudFetchImpl: fetchImpl,
  })
  const result = await client.subscribeAgentRun('run-sse', (event) => received.push(event))
  assert.equal(received.length, 2)
  assert.equal(received[0].sequence, 4)
  assert.equal(received[0].eventId, 'run-sse:4')
  assert.equal(received[1].type, 'run.completed')
  assert.equal(result.after, 5)
  assert.equal(result.terminal, true)
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /\/api\/agent\/runs\/run-sse\/events\?after=0$/)
  assert.equal(calls[0].options.headers['last-event-id'], undefined)
})

test('placement records restore by display then resolution and clamp to work area', () => {
  const display = { x: 1920, y: 0, width: 2560, height: 1440 }
  let state = placement.createPlacementState('display-2', display)
  state = placement.recordPlacement(state, {
    displayId: 'display-2', displayBounds: display, x: 4600, y: 1500,
    placement: 'free', isFreelyPositioned: true, updatedAt: 10,
  })
  const restored = placement.restorePlacement(state, 'display-2', display, { width: 92, height: 116 })
  assert.equal(restored.x, 1920 + 2560 - 92)
  assert.equal(restored.y, 1324)
  const fallback = placement.restorePlacement(state, 'other-display', display, { width: 92, height: 116 })
  assert.equal(fallback.displayId, 'other-display')
  const migrated = placement.migratePlacement({ x: 20, y: 30 }, 'display-2', display)
  assert.equal(migrated.version, 1)
  assert.ok(migrated.byDisplayId['display-2'])
})

test('native bridge exposes explicit event, bounds and placement channels', async () => {
  const preload = await readFile(resolve(root, 'src/desktop/preload.cjs'), 'utf8')
  const discussionPreload = await readFile(resolve(root, 'src/desktop/discussion-preload.cjs'), 'utf8')
  const main = await readFile(resolve(root, 'src/desktop/main.mjs'), 'utf8')
  const renderer = await readFile(resolve(root, 'src/desktop/renderer.tsx'), 'utf8')
  const overlay = await readFile(resolve(root, 'src/client/TraceOverlay.tsx'), 'utf8')
  for (const channel of ['trace-native:codex-event', 'trace-native:placement:get', 'trace-native:placement:save', 'trace-native:interactive-bounds']) {
    assert.match(preload + main, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(discussionPreload + main, /trace-native:setup-progress/)
  assert.match(discussionPreload + main, /trace-native:runtime-status/)
  assert.match(main, /WORKSPACE_IPC_TIMEOUT_MS/)
  assert.match(main, /RUNTIME_START_TIMEOUT_MS/)
  assert.match(main, /withIpcTimeout/)
  assert.match(main, /bindNativeAgentProject\(process\.env\.TRACE_PROJECT_DIR \|\| settings\.projectDir\)/)
  assert.match(main, /bindNativeAgentProject\(result\.filePaths\[0\]\)/)
  assert.match(renderer, /data-trace-interactive-region/)
  assert.match(overlay, /reduceTraceCodexEvent/)
  assert.match(overlay, /nativeCodexEventsEnabled/)
})

test('desktop project binding configures native Agent only for an existing absolute directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-native-project-binding-'))
  const env = { TRACE_AGENT_NATIVE_PROJECT_CWD: 'stale-value' }
  assert.deepEqual(projectBinding.bindNativeAgentProject(directory, { env }), { configured: true })
  assert.equal(env.TRACE_AGENT_NATIVE_PROJECT_CWD, resolve(directory))
  assert.deepEqual(projectBinding.bindNativeAgentProject('relative-project', { env }), { configured: false })
  assert.equal('TRACE_AGENT_NATIVE_PROJECT_CWD' in env, false)
})

test('packaged runtime identity is stable and repairs only missing desktop settings', () => {
  const values = ['a'.repeat(48), 'b'.repeat(48)]
  const random = () => values.shift()
  const first = installationIdentity.ensureRuntimeIdentity({}, random)
  assert.equal(first.changed, true)
  assert.match(first.identity.installationId, /^installation-[a-f0-9]{48}$/)
  assert.match(first.identity.workspaceId, /^workspace-[a-f0-9]{48}$/)
  const second = installationIdentity.ensureRuntimeIdentity(first.settings, () => { throw new Error('must not rotate stable IDs') })
  assert.equal(second.changed, false)
  assert.deepEqual(second.identity, first.identity)
  const repaired = installationIdentity.ensureRuntimeIdentity({ ...first.settings, runtimeIdentity: { installationId: 'bad', workspaceId: first.identity.workspaceId } }, () => 'c'.repeat(48))
  assert.equal(repaired.changed, true)
  assert.equal(repaired.identity.workspaceId, first.identity.workspaceId)
  assert.equal(repaired.identity.installationId, `installation-${'c'.repeat(48)}`)
})

test('rendering contract keeps the pet as a visual projection', async () => {
  const overlay = await readFile(resolve(root, 'src/client/TraceOverlay.tsx'), 'utf8')
  const reducer = await readFile(resolve(root, 'src/client/codex-events.ts'), 'utf8')
  for (const status of ['idle', 'thinking', 'running-command', 'editing', 'searching', 'waiting', 'review', 'failed']) {
    assert.match(reducer, new RegExp(`['"]?${status.replace('-', '[-]')}['"]?`))
  }
  assert.match(overlay, /trace-pet-button-status-\$\{codexProjection\.status\}/)
  assert.match(overlay, /data-trace-interactive-region="pet"/)
  assert.match(overlay, /agent\.run\.input/)
  assert.match(overlay, /onCodexInput=\{submitCodexInput\}/)
  assert.doesNotMatch(overlay, /agent\.run\.start/)
})

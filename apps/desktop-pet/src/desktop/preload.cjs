const { contextBridge, ipcRenderer } = require('electron')
const invokePublic = async (channel, payload) => {
  try { return await ipcRenderer.invoke(channel, payload) }
  catch (error) {
    const raw = error && typeof error.message === 'string' ? error.message : String(error || '')
    const message = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').replace(/^Error:\s*/i, '').trim()
    throw new Error(message && message.length <= 500 ? message : 'Trace 没有完成这次操作，请稍后重试')
  }
}

// React subscribes from an effect, while the native window can deliver the
// first runtime snapshot immediately after did-finish-load. Keep a tiny
// bounded hand-off queue in preload so an early terminal event cannot vanish
// between IPC and component mount.
const codexEventListeners = new Set()
const pendingCodexEvents = []
ipcRenderer.on('trace-native:codex-event', (_event, payload) => {
  if (codexEventListeners.size === 0) {
    pendingCodexEvents.push(payload)
    while (pendingCodexEvents.length > 256) pendingCodexEvents.shift()
    return
  }
  for (const listener of codexEventListeners) listener(payload)
})

contextBridge.exposeInMainWorld('traceNative', {
  setIgnoreMouseEvents(ignore) {
    ipcRenderer.send('trace-native:set-ignore-mouse-events', ignore === true)
  },
  reportInteractiveBounds(bounds) {
    if (Array.isArray(bounds)) ipcRenderer.send('trace-native:interactive-bounds', bounds)
  },
  getPlacement() {
    return invokePublic('trace-native:placement:get')
  },
  savePlacement(placement) {
    return invokePublic('trace-native:placement:save', placement)
  },
  openDiscussion(url) {
    if (typeof url === 'string') ipcRenderer.send('trace-native:open-discussion', url)
  },
  requestCapability(request) {
    return invokePublic('trace-native:capability', request)
  },
  onCandidate(listener) {
    if (typeof listener !== 'function') return undefined
    const wrapped = (_event, payload) => listener(payload)
    ipcRenderer.on('trace-native:candidate', wrapped)
    return () => ipcRenderer.removeListener('trace-native:candidate', wrapped)
  },
  onCodexEvent(listener) {
    if (typeof listener !== 'function') return undefined
    codexEventListeners.add(listener)
    while (pendingCodexEvents.length) listener(pendingCodexEvents.shift())
    return () => codexEventListeners.delete(listener)
  },
})

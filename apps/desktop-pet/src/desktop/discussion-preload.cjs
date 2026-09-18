const { contextBridge, ipcRenderer } = require('electron')
const invokePublic = async (channel, payload) => {
  try { return await ipcRenderer.invoke(channel, payload) }
  catch (error) {
    const raw = error && typeof error.message === 'string' ? error.message : String(error || '')
    const message = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').replace(/^Error:\s*/i, '').trim()
    throw new Error(message && message.length <= 500 ? message : 'Trace 没有完成这次操作，请稍后重试')
  }
}

const setupProgressListeners = new Set()
const pendingSetupProgress = []
ipcRenderer.on('trace-native:setup-progress', (_event, payload) => {
  if (setupProgressListeners.size === 0) {
    pendingSetupProgress.push(payload)
    while (pendingSetupProgress.length > 32) pendingSetupProgress.shift()
    return
  }
  for (const listener of setupProgressListeners) listener(payload)
})

contextBridge.exposeInMainWorld('traceNative', {
  getRuntimeStatus() {
    try { return ipcRenderer.sendSync('trace-native:runtime-status') }
    catch { return null }
  },
  requestCapability(request) {
    return invokePublic('trace-native:capability', request)
  },
  requestWorkspace(pathname, options) {
    return invokePublic('trace-native:workspace', { pathname, options })
  },
  reportCandidate(payload) {
    ipcRenderer.send('trace-native:discussion-candidate', payload)
  },
  onSetupProgress(listener) {
    if (typeof listener !== 'function') return undefined
    setupProgressListeners.add(listener)
    while (pendingSetupProgress.length) listener(pendingSetupProgress.shift())
    return () => setupProgressListeners.delete(listener)
  },
})

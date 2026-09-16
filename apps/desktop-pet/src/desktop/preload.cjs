const { contextBridge, ipcRenderer } = require('electron')
const invokePublic = async (channel, payload) => {
  try { return await ipcRenderer.invoke(channel, payload) }
  catch (error) {
    const raw = error && typeof error.message === 'string' ? error.message : String(error || '')
    const message = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').replace(/^Error:\s*/i, '').trim()
    throw new Error(message && message.length <= 500 ? message : 'Trace 没有完成这次操作，请稍后重试')
  }
}

contextBridge.exposeInMainWorld('traceNative', {
  setIgnoreMouseEvents(ignore) {
    ipcRenderer.send('trace-native:set-ignore-mouse-events', ignore === true)
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
})

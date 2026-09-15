const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('traceNative', {
  requestCapability(request) {
    return ipcRenderer.invoke('trace-native:capability', request)
  },
  reportCandidate(payload) {
    ipcRenderer.send('trace-native:discussion-candidate', payload)
  },
})

export const UPDATE_SHUTDOWN_ARGUMENT = '--trace-shutdown-for-update'

export function launchIntent(argv = []) {
  return {
    action: Array.isArray(argv) && argv.includes(UPDATE_SHUTDOWN_ARGUMENT)
      ? 'shutdown-for-update'
      : 'activate',
  }
}

function callSafely(callback) {
  try { return callback?.() } catch { return undefined }
}

function waitForCleanup(value, timeoutMs) {
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, timeoutMs)
  })
  return Promise.race([
    Promise.resolve(value).catch(() => undefined),
    timeout,
  ]).finally(() => clearTimeout(timer))
}

/**
 * Owns the complete desktop process shutdown. BrowserWindow.close()/app.quit()
 * are intentionally not used here: a renderer with an unsaved draft may veto
 * beforeunload and leave the tray process alive. We destroy product surfaces,
 * give the embedded runtime a bounded chance to flush SQLite, then exit.
 */
export function createDesktopShutdownController({
  app,
  listWindows = () => [],
  destroyTray,
  stopPolling,
  closeCapability,
  closeRuntime,
  onStart,
  timeoutMs = 5_000,
} = {}) {
  if (!app || typeof app.exit !== 'function') throw new TypeError('A desktop app exit function is required')
  let shutdownPromise

  function requestShutdown(reason = 'requested') {
    if (shutdownPromise) return shutdownPromise
    shutdownPromise = (async () => {
      callSafely(() => onStart?.(reason))
      callSafely(stopPolling)
      callSafely(closeCapability)

      const windows = callSafely(listWindows) || []
      for (const window of windows) {
        if (!window || callSafely(() => window.isDestroyed?.()) === true) continue
        callSafely(() => window.hide?.())
        callSafely(() => window.destroy?.())
      }
      callSafely(destroyTray)

      await waitForCleanup(callSafely(closeRuntime), timeoutMs)
      app.exit(0)
    })()
    return shutdownPromise
  }

  function handleBeforeQuit(event) {
    if (shutdownPromise) {
      event?.preventDefault?.()
      return
    }
    event?.preventDefault?.()
    void requestShutdown('before-quit')
  }

  return {
    requestShutdown,
    handleBeforeQuit,
    isShuttingDown: () => Boolean(shutdownPromise),
    get done() { return shutdownPromise || Promise.resolve() },
  }
}

import net from 'node:net'

/**
 * The packaged desktop runtime is deliberately loopback-only.  A configured
 * origin is useful when the user wants a stable port, but it must not turn a
 * local collision into a permanent startup failure (or, worse, make us bind
 * an unrelated interface).  This module keeps the probe/selection policy
 * separate from Electron so it can be exercised without opening a window.
 */

export function isLoopbackHostname(hostname) {
  const value = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  return value === '127.0.0.1' || value === 'localhost' || value === '::1'
}

export function isLoopbackHttpOrigin(value) {
  try {
    const origin = new URL(value)
    return origin.protocol === 'http:'
      && isLoopbackHostname(origin.hostname)
      && !origin.username
      && !origin.password
      && origin.pathname === '/'
      && !origin.search
      && !origin.hash
  } catch {
    return false
  }
}

export function isAddressInUse(error) {
  return error?.code === 'EADDRINUSE' || /EADDRINUSE|address already in use/i.test(String(error?.message || ''))
}

function canListen(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer()
    let settled = false
    const finish = (available) => {
      if (settled) return
      settled = true
      probe.removeAllListeners()
      try { probe.close() } catch { /* A failed listen is already closed. */ }
      resolve(available)
    }
    probe.once('error', () => finish(false))
    probe.listen(port, host, () => finish(true))
  })
}

/**
 * Return the requested port when it is free, otherwise 0 so the OS chooses an
 * ephemeral loopback port.  The caller must still handle EADDRINUSE because a
 * probe and the real listener cannot be made atomic.
 */
export async function selectLoopbackPort(preferredPort, { host = '127.0.0.1' } = {}) {
  const port = Number(preferredPort)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) return 0
  if (port === 0) return 0
  if (!isLoopbackHostname(host)) throw new Error('Trace 本机内容服务只能绑定回环地址')
  return await canListen(port, host) ? port : 0
}


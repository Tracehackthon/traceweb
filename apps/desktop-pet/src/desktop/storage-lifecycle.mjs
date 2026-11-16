import { existsSync, rmSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

// These directories contain Chromium/Electron render caches only. They are
// intentionally separate from Trace's authoritative state/, settings,
// integrations, browser storage and cookie/auth stores.
export const TRANSIENT_STORAGE_NAMES = Object.freeze([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Shared Dictionary',
])

function childPath(root, name) {
  const target = resolve(root, name)
  const segment = relative(root, target)
  if (!segment || segment.startsWith('..') || isAbsolute(segment)) throw new Error('Transient storage path escaped userData')
  return target
}

export function clearVersionBoundStorage({ userData, previousVersion, currentVersion, remove = rmSync } = {}) {
  if (typeof userData !== 'string' || !isAbsolute(userData)) throw new TypeError('userData must be an absolute path')
  if (typeof currentVersion !== 'string' || !currentVersion.trim()) throw new TypeError('currentVersion is required')
  if (previousVersion === currentVersion) return { changed: false, removed: [], failed: [] }

  const root = resolve(userData)
  const removed = []
  const failed = []
  for (const name of TRANSIENT_STORAGE_NAMES) {
    const target = childPath(root, name)
    if (!existsSync(target)) continue
    try {
      remove(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 80 })
      removed.push(name)
    } catch {
      // Cache cleanup must never make user data or the product unavailable.
      failed.push(name)
    }
  }
  return { changed: true, removed, failed }
}

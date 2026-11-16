import { statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

const ENV_KEY = 'TRACE_AGENT_NATIVE_PROJECT_CWD'

/**
 * Bind the Agent registry to the exact folder the user selected.  The
 * registry reloads its environment-backed profile for every describe/bind,
 * so changing this value also changes the profile revision and safely makes
 * any run from the previous project stale.
 */
export function bindNativeAgentProject(projectDir, { env = process.env } = {}) {
  const selected = typeof projectDir === 'string' ? projectDir.trim() : ''
  try {
    if (!selected || !isAbsolute(selected) || !statSync(selected).isDirectory()) throw new Error('unavailable project')
    env[ENV_KEY] = resolve(selected)
    return { configured: true }
  } catch {
    delete env[ENV_KEY]
    return { configured: false }
  }
}


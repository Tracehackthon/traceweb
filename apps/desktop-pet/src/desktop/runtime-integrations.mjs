import { isAbsolute } from 'node:path'
import { readFileSync } from 'node:fs'

const ENV_KEYS = Object.freeze({
  accessSecret: 'ZHIHU_ACCESS_SECRET',
  oauthAppId: 'ZHIHU_OAUTH_APP_ID',
  oauthAppKey: 'ZHIHU_OAUTH_APP_KEY',
  oauthRedirectUri: 'ZHIHU_OAUTH_REDIRECT_URI',
})

function boundedString(value, name, max = 4096) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\r\n\0]/.test(value)) {
    throw new Error(`Trace integration config has an invalid ${name}`)
  }
  return value
}

export function readRuntimeIntegrationConfig(file) {
  if (!isAbsolute(file)) throw new Error('Trace integration config path must be absolute')
  let parsed
  try { parsed = JSON.parse(readFileSync(file, 'utf8')) } catch (error) {
    if (error?.code === 'ENOENT') return { found: false, file, env: {} }
    throw new Error('Trace integration config could not be read')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Trace integration config must be an object')
  const zhihu = parsed.zhihu
  if (zhihu === undefined) return { found: true, file, env: {} }
  if (!zhihu || typeof zhihu !== 'object' || Array.isArray(zhihu)) throw new Error('Trace integration config has an invalid zhihu section')
  if (zhihu.enabled !== true) return { found: true, file, env: { TRACE_ZHIHU_ENABLED: '0' } }
  const env = { TRACE_ZHIHU_ENABLED: '1' }
  for (const [field, key] of Object.entries(ENV_KEYS)) {
    const value = boundedString(zhihu[field], `zhihu.${field}`)
    if (value !== undefined) env[key] = value
  }
  if (env.ZHIHU_OAUTH_REDIRECT_URI !== undefined) {
    let redirect
    try { redirect = new URL(env.ZHIHU_OAUTH_REDIRECT_URI) } catch { throw new Error('Trace integration config has an invalid zhihu.oauthRedirectUri') }
    if (redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.search || redirect.hash) {
      throw new Error('Trace integration config requires an HTTPS OAuth redirect without credentials, query or fragment')
    }
  }
  if (zhihu.oauthLoopbackForward === true) env.TRACE_ZHIHU_OAUTH_LOOPBACK_FORWARD = '1'
  else if (zhihu.oauthLoopbackForward !== undefined && zhihu.oauthLoopbackForward !== false) {
    throw new Error('Trace integration config has an invalid zhihu.oauthLoopbackForward')
  }
  return { found: true, file, env }
}

export function applyRuntimeIntegrationConfig({ file, env = process.env } = {}) {
  const loaded = readRuntimeIntegrationConfig(file)
  for (const [key, value] of Object.entries(loaded.env)) if (env[key] === undefined) env[key] = value
  return { found: loaded.found, file: loaded.file, zhihuEnabled: env.TRACE_ZHIHU_ENABLED === '1' }
}

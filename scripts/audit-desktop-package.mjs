import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktop = path.join(root, 'apps', 'desktop-pet', 'lib', 'desktop')
const discussion = path.join(desktop, 'discussion')
const runtime = path.join(root, 'apps', 'desktop-pet', 'runtime-dist')
const forbidden = [
  'video/trace-demo.mp4',
  'product/fonts/TraceSans.ttf',
  'product/fonts/TraceSerif.woff2',
  'marketing/trace-social-poster-v1.png',
  'showcase/trace-result-detail.png',
]

function bytes(directory) {
  let total = 0
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    total += entry.isDirectory() ? bytes(absolute) : fs.statSync(absolute).size
  }
  return total
}

function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (error) {
    throw new Error(`${label} is missing or invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const requiredApiSurface = {
  runtime: ['/api/runtime/identity'],
  product: ['/api/product/workspace', '/api/product/commands', '/api/product/codex/receive', '/api/product/codex/return'],
  agent: ['/api/agent/capabilities', '/api/agent/check', '/api/agent/runs', '/api/agent/runs/:id', '/api/agent/runs/:id/events', '/api/agent/runs/:id/cancel', '/api/agent/runs/:id/adoption', '/api/agent/sensemaking/health', '/api/agent/sensemaking/drain'],
  zhihu: ['/api/search/capabilities', '/api/search/zhihu', '/api/search/global', '/api/zhihu/status', '/api/zhihu/oauth/start', '/api/zhihu/oauth/check', '/api/zhihu/oauth/disconnect', '/api/zhihu/oauth/connect', '/api/zhihu/oauth/result', '/api/zhihu/search', '/api/zhihu/user/read'],
  host: ['/api/product/host/sessions', '/api/product/host/turns', '/api/product/host/findings', '/api/product/host/session/attach', '/api/product/host/session/pause', '/api/product/host/session/detach', '/api/product/host/event', '/api/product/host/finding', '/api/product/host/sensemaking/jobs', '/api/product/host/sensemaking/results', '/api/product/host/sensemaking/privacy', '/api/product/host/routing/proposals', '/api/product/host/routing/propose', '/api/product/host/routing/decide', '/api/product/host/activation/history', '/api/product/host/activation/mark', '/api/product/host/repository/preflight', '/api/product/host/repository/apply', '/api/product/host/repository/recovery/preview', '/api/product/host/repository/recovery/reconcile', '/api/product/host/repository/recovery/status', '/api/product/host/publication-policies', '/api/product/host/publication-policy/preview', '/api/product/host/publication-policy/adopt', '/api/product/host/publication-policy/revoke', '/api/product/host/capability/orchestrations', '/api/product/host/capability/trials', '/api/product/host/capability/trial/create', '/api/product/host/capability/trial/complete', '/api/product/host/capability/stage', '/api/product/host/capability/validate', '/api/product/host/capability/publish', '/api/product/host/capability/rollback'],
}

function auditRuntimeIdentity() {
  if (!fs.existsSync(runtime)) throw new Error('Bundled Trace Runtime is missing; run npm run runtime:stage first')
  const runtimeInfo = readJson(path.join(runtime, 'runtime.json'), 'runtime.json')
  const manifest = readJson(path.join(runtime, 'release-manifest.json'), 'release-manifest.json')
  const sidecar = readJson(path.join(runtime, 'desktop-runtime-source.json'), 'desktop-runtime-source.json')
  if (!runtimeInfo.source_identity?.content_sha256 || !manifest.source_identity?.content_sha256) throw new Error('Runtime package has no content identity')
  for (const key of ['runtime_version', 'distribution_eligibility']) {
    if (runtimeInfo[key] !== manifest[key]) throw new Error(`Runtime identity mismatch at ${key}`)
  }
  for (const key of ['git_commit', 'git_tree', 'content_sha256', 'worktree_state', 'clean']) {
    if (runtimeInfo.source_identity[key] !== manifest.source_identity[key] || runtimeInfo.source_identity[key] !== sidecar.source_identity[key]) {
      throw new Error(`Runtime source identity mismatch at ${key}`)
    }
  }
  if (!['release-ready', 'development-dirty'].includes(runtimeInfo.distribution_eligibility)) {
    throw new Error(`Unsupported runtime distribution eligibility: ${runtimeInfo.distribution_eligibility}`)
  }
  if (runtimeInfo.distribution_eligibility === 'release-ready' && runtimeInfo.source_identity.clean !== true) {
    throw new Error('A release-ready runtime must come from a clean source checkout')
  }
  if (sidecar.schema_version !== 'trace.desktop-runtime-source@0.2.0') throw new Error('Unsupported desktop-runtime-source schema')
  if (sidecar.runtime_version !== runtimeInfo.runtime_version) throw new Error('desktop-runtime-source runtime version mismatch')
  for (const [category, required] of Object.entries(requiredApiSurface)) {
    const actual = runtimeInfo.api_surface?.[category]
    if (!Array.isArray(actual)) throw new Error(`Runtime API surface is missing category: ${category}`)
    for (const endpoint of required) if (!actual.includes(endpoint)) throw new Error(`Runtime API surface is missing ${endpoint}`)
  }
  if (runtimeInfo.host_compatibility?.codex_plugin?.id !== 'codex-plugin-marketplace-v1') {
    throw new Error('Runtime package does not declare the supported Codex plugin compatibility profile')
  }
  const files = manifest.files
  if (!Array.isArray(files) || files.length === 0) throw new Error('Runtime release manifest has no files')
  if (sidecar.release_manifest?.file_count !== files.length) throw new Error('desktop-runtime-source manifest file count is stale')
  const seen = new Set()
  for (const entry of files) {
    if (!entry || typeof entry.path !== 'string' || seen.has(entry.path)) throw new Error(`Runtime manifest has a duplicate or invalid path: ${entry?.path ?? 'unknown'}`)
    seen.add(entry.path)
    const absolute = path.join(runtime, entry.path)
    if (!absolute.startsWith(`${runtime}${path.sep}`) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`Runtime manifest file is missing: ${entry.path}`)
    const content = fs.readFileSync(absolute)
    const actualHash = createHash('sha256').update(content).digest('hex')
    if (actualHash !== entry.sha256 || content.length !== entry.bytes) throw new Error(`Runtime manifest checksum mismatch: ${entry.path}`)
  }
  return { version: runtimeInfo.runtime_version, eligibility: runtimeInfo.distribution_eligibility, files: files.length }
}

if (!fs.existsSync(path.join(desktop, 'main.mjs')) || !fs.existsSync(path.join(discussion, 'index.html'))) {
  throw new Error('Desktop build is incomplete')
}
const runtimeAudit = auditRuntimeIdentity()
for (const relative of forbidden) {
  if (fs.existsSync(path.join(discussion, relative))) throw new Error(`Desktop build contains Web-only asset: ${relative}`)
}
if (fs.existsSync(path.join(desktop, 'renderer.js.map'))) throw new Error('Desktop build contains a renderer source map')

const discussionBytes = bytes(discussion)
const desktopBytes = bytes(desktop)
if (discussionBytes > 8 * 1024 * 1024) throw new Error(`Desktop discussion assets exceed 8 MiB: ${discussionBytes}`)
if (desktopBytes > 14 * 1024 * 1024) throw new Error(`Desktop application exceeds 14 MiB before packaging: ${desktopBytes}`)

console.log(JSON.stringify({
  status: 'desktop-package-audited',
  runtime: runtimeAudit,
  desktopMiB: Number((desktopBytes / 1024 / 1024).toFixed(2)),
  discussionMiB: Number((discussionBytes / 1024 / 1024).toFixed(2)),
}))

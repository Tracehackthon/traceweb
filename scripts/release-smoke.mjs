import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// electron-builder keeps `@electron/asar` in the desktop package's isolated
// dependency tree; resolve from that package rather than assuming a root
// workspace install.
const require = createRequire(path.join(root, 'apps', 'desktop-pet', 'package.json'))
const { listPackage, extractFile } = require('@electron/asar')
const args = process.argv.slice(2)
function value(flag, fallback) {
  const index = args.indexOf(flag)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const unpacked = path.resolve(root, value('--unpacked', 'apps/desktop-pet/release/win-unpacked'))
const expectedVersion = value('--expected-version', '0.2.0')
const allowDevelopment = args.includes('--allow-development')
const requireFile = relative => {
  const absolute = path.join(unpacked, relative)
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`Release smoke is missing ${relative}`)
  return absolute
}
const readJson = relative => JSON.parse(fs.readFileSync(requireFile(relative), 'utf8'))
const runtime = readJson('resources/trace-runtime/runtime.json')
const runtimeManifest = readJson('resources/trace-runtime/release-manifest.json')
const source = readJson('resources/trace-runtime/desktop-runtime-source.json')
const appAsar = requireFile('resources/app.asar')
const asarPaths = new Set(listPackage(appAsar).map(value => value.replaceAll('\\', '/').replace(/^\//, '')))
for (const required of ['lib/desktop/main.mjs', 'lib/desktop/preload.cjs', 'lib/desktop/discussion/index.html']) {
  if (!asarPaths.has(required)) throw new Error(`app.asar is missing ${required}`)
}
const packageInfo = JSON.parse(extractFile(appAsar, 'package.json').toString('utf8'))
if (packageInfo.version !== expectedVersion) throw new Error(`Desktop package version is ${packageInfo.version}, expected ${expectedVersion}`)
if (runtime.runtime_version !== source.runtime_version || runtime.runtime_version !== runtimeManifest.runtime_version) throw new Error('Runtime version identity mismatch')
if (runtime.distribution_eligibility !== source.distribution_eligibility || runtime.distribution_eligibility !== runtimeManifest.distribution_eligibility) throw new Error('Runtime distribution identity mismatch')
if (!allowDevelopment && runtime.distribution_eligibility !== 'release-ready') throw new Error(`Release smoke refuses non-release runtime: ${runtime.distribution_eligibility}`)
for (const key of ['git_commit', 'git_tree', 'content_sha256', 'worktree_state', 'clean']) {
  if (runtime.source_identity?.[key] !== source.source_identity?.[key] || runtime.source_identity?.[key] !== runtimeManifest.source_identity?.[key]) throw new Error(`Runtime source identity mismatch at ${key}`)
}
if (!Array.isArray(runtimeManifest.files) || runtimeManifest.files.length === 0) throw new Error('Runtime release manifest has no files')
for (const entry of runtimeManifest.files) {
  const absolute = path.join(unpacked, 'resources', 'trace-runtime', entry.path)
  if (!absolute.startsWith(`${path.join(unpacked, 'resources', 'trace-runtime')}${path.sep}`) || !fs.existsSync(absolute)) throw new Error(`Runtime manifest entry is missing: ${entry.path}`)
  const content = fs.readFileSync(absolute)
  if (createHash('sha256').update(content).digest('hex') !== entry.sha256 || content.length !== entry.bytes) throw new Error(`Runtime checksum mismatch: ${entry.path}`)
}
process.stdout.write(`${JSON.stringify({ status: 'desktop-release-smoke-passed', unpacked: path.relative(root, unpacked).replaceAll(path.sep, '/'), desktop_version: packageInfo.version, runtime_version: runtime.runtime_version, distribution_eligibility: runtime.distribution_eligibility, runtime_files: runtimeManifest.files.length }, null, 2)}\n`)

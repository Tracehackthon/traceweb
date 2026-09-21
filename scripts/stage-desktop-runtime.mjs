import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = path.resolve(process.env.TRACE_RUNTIME_SOURCE || path.join(webRoot, '..', 'trace-runtime'))
const output = path.join(webRoot, 'apps', 'desktop-pet', 'runtime-dist')
const packageScript = path.join(runtimeRoot, 'scripts', 'package.mjs')
const contractPath = path.join(webRoot, 'apps', 'desktop-pet', 'runtime-contract.json')
const explicitDevelopment = process.env.TRACE_DESKTOP_RUNTIME_MODE === 'development'
  || process.env.TRACE_RUNTIME_ALLOW_DIRTY === '1'

if (!fs.existsSync(packageScript)) throw new Error(`Trace Runtime source was not found at ${runtimeRoot}`)
if (!fs.existsSync(contractPath)) throw new Error(`Desktop Runtime contract is missing: ${contractPath}`)

function readJsonFile(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (error) {
    throw new Error(`${label} is missing or invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const contract = readJsonFile(contractPath, 'Desktop Runtime contract')
if (contract.schema_version !== 'trace.desktop-runtime-contract@0.1.0') {
  throw new Error(`Unsupported Desktop Runtime contract: ${contract.schema_version ?? 'unknown'}`)
}
if (typeof contract.runtime_version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(contract.runtime_version)) {
  throw new Error('Desktop Runtime contract has no valid runtime_version')
}
if (typeof contract.source?.git_commit !== 'string' || !/^[0-9a-f]{40}$/.test(contract.source.git_commit)) {
  throw new Error('Desktop Runtime contract has no immutable source commit')
}
if (!Array.isArray(contract.required_source_files) || contract.required_source_files.length === 0) {
  throw new Error('Desktop Runtime contract has no required source files')
}
if (!Array.isArray(contract.required_materialized_files) || contract.required_materialized_files.length === 0) {
  throw new Error('Desktop Runtime contract has no required materialized dependency files')
}

function gitHead(directory) {
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: directory, encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(`Trace Runtime source is not a Git checkout: ${directory}`)
  return result.stdout.trim()
}

const actualCommit = gitHead(runtimeRoot)
if (actualCommit !== contract.source.git_commit) {
  throw new Error(`Trace Runtime source commit ${actualCommit} does not match desktop contract ${contract.source.git_commit} (${contract.source.ref ?? 'pinned source'})`)
}
for (const relative of contract.required_source_files) {
  const source = path.resolve(runtimeRoot, relative)
  if (!source.startsWith(`${runtimeRoot}${path.sep}`) || !fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`Trace Runtime source is missing contracted capability: ${relative}`)
  }
}
fs.rmSync(output, { recursive: true, force: true })
fs.mkdirSync(output, { recursive: true })

function run(command, args, shell = false) {
  const result = spawnSync(command, args, { cwd: runtimeRoot, stdio: 'inherit', shell, env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
}

const workspaceDependencyMarkers = [
  path.join(runtimeRoot, 'apps', 'mcp', 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'),
  path.join(runtimeRoot, 'apps', 'mcp', 'node_modules', 'zod', 'package.json'),
]
if (!workspaceDependencyMarkers.every(file => fs.existsSync(file))) {
  console.log(JSON.stringify({ status: 'runtime-dependencies-missing', action: 'install', runtimeRoot }))
  run(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', ['pnpm', 'install', '--frozen-lockfile'], process.platform === 'win32')
}

run(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', ['pnpm', 'build'], process.platform === 'win32')
for (const relative of contract.required_materialized_files) {
  const absolute = path.resolve(runtimeRoot, relative)
  if (!absolute.startsWith(`${runtimeRoot}${path.sep}`) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error(`Trace Runtime build did not materialize contracted dependency: ${relative}`)
  }
}
run(process.execPath, [packageScript, '--out', output, ...(explicitDevelopment ? [] : ['--require-clean'])])

function readJson(relative) {
  const file = path.join(output, relative)
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (error) {
    throw new Error(`Trace Runtime package is missing or invalid ${relative}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const runtime = readJson('runtime.json')
const releaseManifest = readJson('release-manifest.json')
if (runtime.runtime_version !== contract.runtime_version) {
  throw new Error(`Trace Runtime version ${runtime.runtime_version ?? 'unknown'} does not match desktop contract ${contract.runtime_version}`)
}
const sourceIdentity = runtime.source_identity
if (!sourceIdentity || typeof sourceIdentity !== 'object') throw new Error('Trace Runtime package has no source_identity')
if (!releaseManifest.source_identity || typeof releaseManifest.source_identity !== 'object') {
  throw new Error('Trace Runtime release manifest has no source_identity')
}
if (runtime.runtime_version !== releaseManifest.runtime_version) throw new Error('runtime.json and release-manifest.json disagree on runtime_version')
for (const key of ['git_commit', 'git_tree', 'content_sha256', 'worktree_state', 'clean']) {
  if (sourceIdentity[key] !== releaseManifest.source_identity[key]) throw new Error(`Runtime source identity mismatch at ${key}`)
}
if (!Array.isArray(runtime.api_surface?.agent) || !Array.isArray(runtime.api_surface?.host)) {
  throw new Error('Trace Runtime package does not expose the latest API surface')
}

if (!explicitDevelopment) {
  if (runtime.distribution_eligibility !== 'release-ready' || releaseManifest.distribution_eligibility !== 'release-ready') {
    throw new Error(`Release staging requires a release-ready runtime, got ${runtime.distribution_eligibility ?? 'unknown'}`)
  }
  if (sourceIdentity.clean !== true || sourceIdentity.worktree_state !== 'clean') {
    throw new Error('Release staging requires a clean Trace Runtime source checkout')
  }
} else {
  // A deliberate development stage may use a clean checkout, but it must never
  // look like a publishable runtime to the desktop app or release tooling.
  if (runtime.distribution_eligibility === 'release-ready' || releaseManifest.distribution_eligibility === 'release-ready') {
    runtime.distribution_eligibility = 'development-dirty'
    releaseManifest.distribution_eligibility = 'development-dirty'
    fs.writeFileSync(path.join(output, 'runtime.json'), `${JSON.stringify(runtime, null, 2)}\n`, 'utf8')
    const runtimeEntry = releaseManifest.files?.find(file => file.path === 'runtime.json')
    if (runtimeEntry) {
      const content = fs.readFileSync(path.join(output, 'runtime.json'))
      runtimeEntry.sha256 = createHash('sha256').update(content).digest('hex')
      runtimeEntry.bytes = content.length
    }
    fs.writeFileSync(path.join(output, 'release-manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8')
  }
}

const source = {
  schema_version: 'trace.desktop-runtime-source@0.2.0',
  repository: 'Tracehackthon/trace_backend',
  runtime_version: runtime.runtime_version,
  distribution_eligibility: runtime.distribution_eligibility,
  source_identity: {
    git_commit: sourceIdentity.git_commit,
    git_tree: sourceIdentity.git_tree,
    worktree_state: sourceIdentity.worktree_state,
    clean: sourceIdentity.clean === true,
    content_sha256: sourceIdentity.content_sha256,
    source_file_count: sourceIdentity.source_file_count,
    dirty_path_count: sourceIdentity.dirty_path_count,
  },
  api_surface: runtime.api_surface,
  host_compatibility: runtime.host_compatibility ?? releaseManifest.host_compatibility ?? null,
  release_manifest: {
    manifest_version: releaseManifest.manifest_version,
    file_count: (Array.isArray(releaseManifest.files) ? releaseManifest.files.length : 0) + 1,
  },
}
fs.writeFileSync(path.join(output, 'desktop-runtime-source.json'), `${JSON.stringify(source, null, 2)}\n`, 'utf8')

// Keep the runtime's checksum manifest authoritative after adding the desktop
// provenance sidecar. The manifest intentionally excludes itself from its file
// list, so adding this entry does not create a self-referential hash.
const sidecar = fs.readFileSync(path.join(output, 'desktop-runtime-source.json'))
releaseManifest.files ??= []
releaseManifest.files = releaseManifest.files.filter(file => file.path !== 'desktop-runtime-source.json')
releaseManifest.files.push({
  path: 'desktop-runtime-source.json',
  sha256: createHash('sha256').update(sidecar).digest('hex'),
  bytes: sidecar.length,
})
releaseManifest.files.sort((left, right) => left.path.localeCompare(right.path))
releaseManifest.created_at = new Date().toISOString()
fs.writeFileSync(path.join(output, 'release-manifest.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8')

console.log(JSON.stringify({
  status: 'runtime-staged',
  runtime_version: source.runtime_version,
  distribution_eligibility: source.distribution_eligibility,
  git_commit: source.source_identity.git_commit,
  content_sha256: source.source_identity.content_sha256,
  development_mode: explicitDevelopment,
  output,
}))

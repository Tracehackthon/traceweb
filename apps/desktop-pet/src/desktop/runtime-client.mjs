import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Safe fallback for standalone client construction. The packaged desktop
// host asks the OS for a free loopback port and passes that resolved origin
// explicitly, so it does not depend on this fixed port.
export const DEFAULT_RUNTIME_ORIGIN = 'http://127.0.0.1:42731'
export const RUNTIME_IDENTITY_PROTOCOL = 'trace.runtime.identity@1'
export const RUNTIME_IDENTITY_PROTOCOL_VERSION = 1
export const TRACE_PRODUCT_SERVICE_ID = 'trace-product-service'
// OAuth start, callback, status and user-data reads must use one cookie
// origin. The registered Zhihu callback is on the public Trace domain, so
// native cloud requests deliberately stay on that same origin instead of
// using the deployment alias.
export const DEFAULT_CLOUD_ORIGIN = 'https://trace.neutrom.store'
const TERMINAL_AGENT_STATES = new Set(['succeeded', 'failed', 'cancelled', 'stale', 'timed_out', 'interrupted'])
const NO_NOT_FOUND_FALLBACK = Symbol('no-not-found-fallback')
const DESKTOP_HOST = 'codex'
const DESKTOP_HOST_SESSION = 'trace-desktop'
const TRACE_PROJECT_DESCRIPTOR = path.join('.trace', 'project.json')
const TRACE_PROJECT_PROTOCOL = 'trace.project-instance'
const TRACE_PROJECT_PROTOCOL_VERSIONS = new Set(['0.1.0', '0.2.0'])

// These are the versions exercised by the bundled Trace Agent runtime.  This
// is intentionally an allow-list rather than a semver range: an apparently
// newer Codex app-server may change the wire contract and must be requalified
// before the desktop bridge can use it.
export const CODEX_APP_SERVER_COMPATIBLE_VERSIONS = Object.freeze(['0.153.4', '0.154.0-alpha.6.2'])

export const PROJECT_BINDING_STATES = Object.freeze({
  UNBOUND: 'unbound',
  CANDIDATE: 'candidate',
  CONFIRMED: 'confirmed',
  CONFLICT_OR_DRIFT: 'conflict-or-drift',
})

const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const SAFE_IDENTITY = /^[^\x00-\x1f\x7f]{1,256}$/

/**
 * Verify the service behind a discovery origin before any Product or Agent
 * request. A loopback port is only a location hint; these opaque IDs are the
 * durable installation/workspace boundary used to detect port reuse.
 */
export function validateRuntimeServiceIdentity(value, expected = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Trace 本机能力身份响应无效')
  if (value.protocol !== RUNTIME_IDENTITY_PROTOCOL || value.protocol_version !== RUNTIME_IDENTITY_PROTOCOL_VERSION) throw new Error('Trace 本机能力协议不兼容')
  if (value.product_id !== 'trace' || value.service_id !== TRACE_PRODUCT_SERVICE_ID || value.service_role !== 'product') throw new Error('该端口不是 Trace Product 服务')
  if (value.database_role !== 'product-web' || value.identity_state !== 'verified') throw new Error('Trace Product 工作区身份尚未验证，请先完成本机数据升级')
  if (typeof value.runtime_version !== 'string' || !SEMVER.test(value.runtime_version)) throw new Error('Trace Runtime 版本身份无效')
  for (const field of ['installation_id', 'workspace_id']) {
    if (typeof value[field] !== 'string' || !SAFE_IDENTITY.test(value[field]) || value[field].trim() !== value[field]) throw new Error(`Trace ${field} 身份无效`)
    if (expected[field] !== undefined && value[field] !== expected[field]) throw new Error('Trace 本机端口已切换到另一个安装或工作区，已停止操作')
  }
  return {
    protocol: value.protocol,
    protocolVersion: value.protocol_version,
    serviceId: value.service_id,
    runtimeVersion: value.runtime_version,
    installationId: value.installation_id,
    workspaceId: value.workspace_id,
  }
}

const PROJECT_SOURCE_LABELS = Object.freeze({
  'explicit-env': 'TRACE_PROJECT_DIR',
  'saved-setting': '上次选择的项目',
  'startup-cwd': '启动目录候选',
  'user-selection': '用户明确选择',
})

const sha256 = value => createHash('sha256').update(value).digest('hex')
const normalizePathKey = (value, platform = process.platform) => {
  const resolved = path.resolve(value)
  return platform === 'win32' ? resolved.toLowerCase() : resolved
}
const canonicalPathKey = value => {
  let canonical = path.resolve(value)
  try { canonical = fs.realpathSync.native(canonical) } catch { /* a stale stored path still gets case-normalized below */ }
  return normalizePathKey(canonical)
}

function publicDiagnostic(code, message, action = 'choose-project') {
  return { code, message, action }
}

function sourceLabel(source) {
  return PROJECT_SOURCE_LABELS[source] || '本机项目候选'
}

function hasGitEntry(projectDir) {
  try {
    const stat = fs.statSync(path.join(projectDir, '.git'))
    return stat.isDirectory() || stat.isFile()
  } catch {
    return false
  }
}

function readTraceDescriptor(projectDir) {
  const descriptorFile = path.join(projectDir, TRACE_PROJECT_DESCRIPTOR)
  let raw
  try {
    const stat = fs.statSync(descriptorFile)
    if (!stat.isFile() || stat.size > 64 * 1024) return { error: 'descriptor-too-large' }
    raw = fs.readFileSync(descriptorFile)
  } catch {
    return { error: 'descriptor-missing' }
  }
  let value
  try { value = JSON.parse(raw.toString('utf8')) } catch { return { error: 'descriptor-invalid-json' } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'descriptor-invalid' }
  if (value.protocol_id !== TRACE_PROJECT_PROTOCOL || !TRACE_PROJECT_PROTOCOL_VERSIONS.has(value.protocol_version)) return { error: 'descriptor-protocol' }
  const allowedFields = new Set(['protocol_id', 'protocol_version', 'project_id', 'instance_id', 'template_id', 'template_version', 'source_mode', 'source_scope', 'state_file', 'source_root', 'created_at'])
  if (Object.keys(value).some(field => !allowedFields.has(field))) return { error: 'descriptor-fields' }
  const text = (field, max) => typeof value[field] === 'string' && value[field].trim().length > 0 && value[field].length <= max && !/[\0\r\n]/.test(value[field])
  if (!text('project_id', 80) || !text('instance_id', 200) || !text('template_id', 240) || !text('template_version', 64) || !text('source_root', 4000) || !text('created_at', 80)) return { error: 'descriptor-fields' }
  if (!['local', 'external', 'team', 'empty'].includes(value.source_mode) || !['personal', 'project', 'team', 'domain'].includes(value.source_scope)) return { error: 'descriptor-source' }
  if (value.state_file !== '.trace/state/trace.sqlite' || !value.source_root.startsWith('.trace/')) return { error: 'descriptor-paths' }
  return { descriptor: value, descriptorHash: sha256(raw) }
}

function gitIdentity(projectDir) {
  // The descriptor identifies the Trace project root; its Git repository may
  // be an ancestor (for example a monorepo project directory).  Search for a
  // repository only as corroborating evidence, never as the project selector.
  let repositoryDir = projectDir
  let gitEntry
  while (true) {
    const candidate = path.join(repositoryDir, '.git')
    try {
      const candidateStat = fs.statSync(candidate)
      if (candidateStat.isDirectory() || candidateStat.isFile()) {
        gitEntry = candidate
        break
      }
    } catch { /* continue toward the filesystem root */ }
    const parent = path.dirname(repositoryDir)
    if (parent === repositoryDir) return null
    repositoryDir = parent
  }
  let stat
  try { stat = fs.statSync(gitEntry) } catch { return null }
  if (!stat.isDirectory() && !stat.isFile()) return null
  let gitDir = gitEntry
  let pointer = ''
  if (stat.isFile()) {
    try { pointer = fs.readFileSync(gitEntry, 'utf8').trim() } catch { return null }
    const match = pointer.match(/^gitdir:\s*(.+)$/i)
    if (!match) return null
    gitDir = path.resolve(repositoryDir, match[1].trim())
  }
  try { gitDir = fs.realpathSync.native(gitDir) } catch { gitDir = path.resolve(gitDir) }
  try {
    if (!fs.statSync(gitDir).isDirectory()) return null
  } catch { return null }
  // A .git marker is not enough evidence: a deleted or hand-written marker
  // must not turn a Trace descriptor into an executable project binding.
  let headContent
  try {
    const headFile = path.join(gitDir, 'HEAD')
    const headStat = fs.statSync(headFile)
    if (!headStat.isFile() || headStat.size > 8 * 1024) return null
    headContent = fs.readFileSync(headFile, 'utf8').trim()
    if (!/^(?:ref:\s*refs\/[A-Za-z0-9._/-]+|[0-9a-f]{4,64})$/i.test(headContent)) return null
  } catch { return null }
  let gitEntryIdentity = ''
  let gitDirIdentity = ''
  try {
    const entryStat = fs.statSync(gitEntry)
    gitEntryIdentity = `${entryStat.dev ?? ''}:${entryStat.ino ?? ''}`
    const dirStat = fs.statSync(gitDir)
    gitDirIdentity = `${dirStat.dev ?? ''}:${dirStat.ino ?? ''}`
  } catch { /* paths and contents below still provide a useful identity */ }
  let commonDir = gitDir
  try {
    const common = fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim()
    if (common) commonDir = path.resolve(gitDir, common)
  } catch { /* a normal repository has no commondir file */ }
  try { commonDir = fs.realpathSync.native(commonDir) } catch { commonDir = path.resolve(commonDir) }
  // HEAD syntax alone is not a repository proof: a copied descriptor beside
  // a hand-written `.git/HEAD` must stay a candidate.  A real Git repository
  // (including a linked worktree) has its config and object database in the
  // common git directory.  Requiring those durable markers also prevents a
  // deleted repository from remaining executable after its HEAD file survives.
  try {
    const configStat = fs.statSync(path.join(commonDir, 'config'))
    const objectsStat = fs.statSync(path.join(commonDir, 'objects'))
    if (!configStat.isFile() || !objectsStat.isDirectory()) return null
  } catch { return null }
  // Named branch selection is part of a confirmed worktree binding, but its
  // moving commit is not. A detached checkout has no moving branch name, so
  // retain its commit identity and stop when the detached checkout changes.
  const branchRef = headContent.match(/^ref:\s*(refs\/[A-Za-z0-9._/-]+)$/)?.[1]
    || `detached:${headContent.toLowerCase()}`
  return { gitKind: stat.isFile() ? 'worktree' : 'repository', gitDir, commonDir, pointer, branchRef, gitEntryIdentity, gitDirIdentity }
}

function projectIdentity(projectDir, descriptorInfo, git) {
  const canonicalPath = (() => {
    try { return fs.realpathSync.native(projectDir) } catch { return path.resolve(projectDir) }
  })()
  const pathKey = normalizePathKey(canonicalPath)
  const repositoryFingerprint = sha256(JSON.stringify({ path: pathKey, gitDir: normalizePathKey(git.gitDir), commonDir: normalizePathKey(git.commonDir), pointer: git.pointer, branchRef: git.branchRef, gitEntryIdentity: git.gitEntryIdentity, gitDirIdentity: git.gitDirIdentity }))
  const fingerprint = sha256(JSON.stringify({ path: pathKey, projectId: descriptorInfo.descriptor.project_id, instanceId: descriptorInfo.descriptor.instance_id, descriptorHash: descriptorInfo.descriptorHash, repositoryFingerprint }))
  return {
    projectId: descriptorInfo.descriptor.project_id,
    instanceId: descriptorInfo.descriptor.instance_id,
    descriptorHash: descriptorInfo.descriptorHash,
    repositoryFingerprint,
    fingerprint,
    canonicalPath,
  }
}

function inspectProjectCandidate(start, source = 'startup-cwd') {
  if (typeof start !== 'string' || !start.trim() || /[\0]/.test(start) || !path.isAbsolute(start)) return {
    status: PROJECT_BINDING_STATES.UNBOUND,
    source,
    projectName: '',
    projectId: null,
    diagnostic: publicDiagnostic('project-path-invalid', '项目候选位置不可用，请选择一个本机目录。'),
  }
  let current
  try { current = path.resolve(start) } catch {
    return { status: PROJECT_BINDING_STATES.UNBOUND, source, projectName: '', projectId: null, diagnostic: publicDiagnostic('project-path-invalid', '项目候选位置不可用，请选择一个本机目录。') }
  }
  try {
    if (!fs.statSync(current).isDirectory()) throw new Error('not-directory')
  } catch {
    return { status: PROJECT_BINDING_STATES.UNBOUND, source, projectName: '', projectId: null, diagnostic: publicDiagnostic('project-path-invalid', '项目候选位置不可用，请选择一个本机目录。') }
  }

  const startGit = gitIdentity(current)
  let sawRepository = false
  while (true) {
    const repository = hasGitEntry(current)
    if (repository) sawRepository = true
    const descriptorFile = path.join(current, TRACE_PROJECT_DESCRIPTOR)
    const descriptorExists = fs.existsSync(descriptorFile)
    // A Git marker alone is only evidence that this path may be a repository;
    // it must never terminate the descriptor walk or become a project choice.
    // This also lets a monorepo descriptor be found when startup cwd happens
    // to be inside a nested Git worktree/submodule.
    if (descriptorExists) {
      const descriptorInfo = readTraceDescriptor(current)
      if (!descriptorInfo.descriptor) {
        const code = descriptorInfo.error === 'descriptor-missing' ? 'trace-descriptor-missing' : 'trace-descriptor-invalid'
        return {
          status: PROJECT_BINDING_STATES.CANDIDATE,
          source,
          projectName: path.basename(current).normalize('NFKC').trim(),
          projectId: null,
          diagnostic: publicDiagnostic(code, descriptorInfo.error === 'descriptor-missing'
            ? '已找到 Git 仓库，但没有 Trace 项目描述；请先完成 Trace 初始化。'
            : 'Trace 项目描述无法验证；请修复该项目的 .trace/project.json 后重新选择。'),
          internalPath: current,
        }
      }
      const git = gitIdentity(current)
      if (!git) return {
        status: PROJECT_BINDING_STATES.CANDIDATE,
        source,
        projectName: path.basename(current).normalize('NFKC').trim(),
        projectId: descriptorInfo.descriptor.project_id,
        diagnostic: publicDiagnostic('repository-missing', 'Trace 描述存在，但没有可验证的 Git 仓库；请选择仓库根目录。'),
        internalPath: current,
      }
      if (startGit && (normalizePathKey(startGit.gitDir) !== normalizePathKey(git.gitDir)
        || normalizePathKey(startGit.commonDir) !== normalizePathKey(git.commonDir))) return {
        status: PROJECT_BINDING_STATES.CANDIDATE,
        source,
        projectName: path.basename(current).normalize('NFKC').trim(),
        projectId: descriptorInfo.descriptor.project_id,
        diagnostic: publicDiagnostic('repository-mismatch', '当前目录属于另一个 Git 仓库或 worktree；请从 Trace 项目所属仓库中选择目录。'),
        internalPath: current,
      }
      const identity = projectIdentity(current, descriptorInfo, git)
      return {
        status: PROJECT_BINDING_STATES.CANDIDATE,
        source,
        projectName: path.basename(current).normalize('NFKC').trim() || identity.projectId,
        projectId: identity.projectId,
        identity,
        internalPath: current,
      }
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return {
    status: PROJECT_BINDING_STATES.UNBOUND,
    source,
    projectName: '',
    projectId: null,
    diagnostic: publicDiagnostic(sawRepository ? 'trace-descriptor-missing' : 'repository-missing', sawRepository
      ? '已找到 Git 仓库，但没有 Trace 项目描述；请先完成 Trace 初始化。'
      : '没有找到可验证的 Git 仓库；请从目标仓库目录选择项目。'),
  }
}

export function inspectDesktopProject({ projectDir, source = 'startup-cwd' } = {}) {
  const candidate = inspectProjectCandidate(projectDir, source)
  return publicProjectBinding(candidate)
}

function sameProjectIdentity(left, right) {
  return Boolean(left && right && left.projectId === right.projectId && left.fingerprint === right.fingerprint
    && canonicalPathKey(left.canonicalPath) === canonicalPathKey(right.canonicalPath))
}

function publicProjectBinding(binding) {
  const identity = binding?.identity
  return {
    status: binding?.status || PROJECT_BINDING_STATES.UNBOUND,
    source: binding?.source || 'startup-cwd',
    sourceLabel: sourceLabel(binding?.source),
    projectName: binding?.projectName || '',
    projectId: binding?.projectId || identity?.projectId || null,
    // A short identity hint lets the UI distinguish two repositories with the
    // same basename without revealing an absolute path or descriptor hash.
    identityHint: identity?.fingerprint ? identity.fingerprint.slice(0, 12) : null,
    repositoryVerified: Boolean(identity),
    diagnostic: binding?.diagnostic || null,
  }
}

function codexCandidatePaths({ env = process.env, platform = process.platform } = {}) {
  const names = platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex.bat'] : ['codex']
  const candidates = []
  const delimiter = platform === 'win32' ? ';' : path.delimiter
  for (const directory of String(env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const name of names) candidates.push(path.join(directory, name))
  }
  if (platform === 'win32') {
    const localBin = env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin')
    if (localBin && fs.existsSync(localBin)) {
      for (const name of names) candidates.push(path.join(localBin, name))
      try {
        for (const entry of fs.readdirSync(localBin, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          for (const name of names) candidates.push(path.join(localBin, entry.name, name))
        }
      } catch { /* A missing/inaccessible optional install location is not fatal. */ }
    }
    if (env.APPDATA) for (const name of names) candidates.push(path.join(env.APPDATA, 'npm', name))
  }
  const existing = candidates.filter((candidate) => {
    try { return fs.statSync(candidate).isFile() } catch { return false }
  })
  const unique = [...new Map(existing.map(candidate => [normalizePathKey(candidate, platform), candidate])).values()]
  // Never use mtime as an authority.  It changes after an update, an
  // installer repair, or a copied worktree and made selection nondeterministic.
  unique.sort((left, right) => normalizePathKey(left, platform).localeCompare(normalizePathKey(right, platform), 'en-US'))
  return unique
}

function codexVersionFromOutput(value) {
  const match = String(value || '').match(/(?:^|\s)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=\s|$)/)
  return match?.[1] || null
}

function runCodexProbe(candidate, args, { spawnProcess = spawn, timeoutMs = 6_000, platform = process.platform } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      // Keep shell=false even for Windows .cmd/.bat candidates.  The runtime
      // accepts an executable path from local configuration, never a command
      // line; shell interpretation would turn that boundary into injection.
      child = spawnProcess(candidate, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      resolve({ code: null, output: '' })
      return
    }
    let output = ''
    let settled = false
    let timer
    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, output: output.slice(0, 32 * 1024) })
    }
    const capture = (chunk) => {
      if (output.length < 32 * 1024) output += String(chunk).slice(0, 32 * 1024 - output.length)
    }
    timer = setTimeout(() => {
      try { child.kill?.() } catch { /* best effort */ }
      finish('timeout')
    }, timeoutMs)
    timer.unref?.()
    child.stdout?.on?.('data', capture)
    child.stderr?.on?.('data', capture)
    child.once?.('error', () => finish(null))
    child.once?.('close', code => finish(code))
  })
}

export async function probeCodexExecutable(candidate, {
  spawnProcess = spawn,
  timeoutMs = 6_000,
  platform = process.platform,
  compatibleVersions = CODEX_APP_SERVER_COMPATIBLE_VERSIONS,
} = {}) {
  const versionProbe = await runCodexProbe(candidate, ['--version'], { spawnProcess, timeoutMs, platform })
  const version = codexVersionFromOutput(versionProbe.output)
  const appServerProbe = await runCodexProbe(candidate, ['app-server', '--help'], { spawnProcess, timeoutMs, platform })
  const appServerOutput = appServerProbe.output
  const appServerCapable = appServerProbe.code === 0 && /(?:app-server|--stdio)/i.test(appServerOutput)
  const versionCompatible = Boolean(version && compatibleVersions.includes(version))
  const compatible = versionProbe.code === 0 && versionCompatible && appServerCapable
  return {
    candidate,
    version,
    versionOutput: versionProbe.output.slice(0, 200),
    appServerCapable,
    versionCompatible,
    compatible,
    reason: compatible ? 'verified' : !version ? 'version-unreadable' : !versionCompatible ? 'version-unverified' : !appServerCapable ? 'app-server-unavailable' : 'probe-failed',
  }
}

export async function inspectCodexExecutables({
  env = process.env,
  platform = process.platform,
  probe = probeCodexExecutable,
  compatibleVersions = CODEX_APP_SERVER_COMPATIBLE_VERSIONS,
} = {}) {
  const explicit = typeof env.TRACE_CODEX_BIN === 'string' ? env.TRACE_CODEX_BIN.trim() : ''
  // An explicit binary is authoritative.  Do not silently fall back to a
  // different installation when the requested one fails verification.
  const candidates = explicit ? [explicit] : codexCandidatePaths({ env, platform })
  const results = []
  for (const candidate of candidates) {
    let result
    try { result = await probe(candidate, { platform, compatibleVersions }) }
    catch { result = { candidate, compatible: false, reason: 'probe-failed' } }
    results.push({ ...result, candidate })
  }
  const selected = results.find(item => item.compatible === true)?.candidate
  return { explicit: Boolean(explicit), candidates, results, selected: selected || null }
}

/**
 * Resolve a deterministic Codex path for legacy synchronous callers.  Pass
 * `verify: true` to receive a Promise that probes version and app-server
 * capability and rejects when no compatible candidate exists.
 */
export function resolveCodexExecutable({ env = process.env, platform = process.platform, verify = false, ...options } = {}) {
  const explicit = typeof env.TRACE_CODEX_BIN === 'string' ? env.TRACE_CODEX_BIN.trim() : ''
  if (verify) {
    return inspectCodexExecutables({ env, platform, ...options }).then((details) => {
      if (!details.selected) {
        const reason = details.explicit ? 'TRACE_CODEX_BIN 指向的 Codex 未通过版本或 app-server 能力检查' : '没有找到通过版本与 app-server 能力检查的 Codex'
        throw new Error(`${reason}；已安全停止，不会回退到未经验证的可执行文件`)
      }
      return details.selected
    })
  }
  if (explicit) return explicit
  return codexCandidatePaths({ env, platform })[0]
}

/**
 * Select a Codex profile without treating array order as configuration.  A
 * request may name one explicitly; otherwise a persisted selection or the
 * server-declared default wins.  More than one enabled Codex profile without
 * one of those choices is deliberately unresolved.
 */
export function resolveCodexProfile(capabilities, { requestedProfileId, selectedProfileId } = {}) {
  const profiles = Array.isArray(capabilities?.profiles) ? capabilities.profiles.filter(profile => profile && profile.enabled !== false) : []
  const codex = profiles.filter(profile => profile.kind === 'codex')
  const byId = id => profiles.find(profile => profile.profileId === id)
  if (requestedProfileId !== undefined && (typeof requestedProfileId !== 'string' || !requestedProfileId.trim())) {
    return { profile: null, status: 'unresolved', reason: 'requested-profile-invalid', candidates: codex }
  }
  const explicit = typeof requestedProfileId === 'string' && requestedProfileId.trim() ? requestedProfileId.trim() : ''
  if (explicit) {
    const selected = byId(explicit)
    if (!selected) return { profile: null, status: 'unresolved', reason: 'requested-profile-not-found', candidates: codex }
    if (selected.kind !== 'codex') return { profile: null, status: 'unresolved', reason: 'requested-profile-not-codex', candidates: codex }
    return { profile: selected, status: 'resolved', reason: 'request', candidates: codex }
  }
  for (const [id, reason] of [[selectedProfileId, 'persisted-selection'], [capabilities?.defaultProfileId, 'server-default']]) {
    if (typeof id !== 'string' || !id.trim()) continue
    const selected = byId(id)
    if (selected?.kind === 'codex') return { profile: selected, status: 'resolved', reason, candidates: codex }
  }
  if (codex.length === 1) return { profile: codex[0], status: 'resolved', reason: 'unique-candidate', candidates: codex }
  if (codex.length === 0) return { profile: null, status: 'unresolved', reason: 'no-codex-profile', candidates: codex }
  return { profile: null, status: 'unresolved', reason: 'multiple-codex-profiles-no-default', candidates: codex }
}

/**
 * Resolve a profile for the generic Agent surface.  The desktop bridge still
 * supports model and external-agent profiles, so the Codex-only resolver is
 * not appropriate here.  The same rule applies to every kind: explicit
 * request, persisted selection, server default, then one unique enabled
 * profile; an ambiguous set is never resolved by array order.
 */
export function resolveAgentProfile(capabilities, { requestedProfileId, selectedProfileId } = {}) {
  const profiles = Array.isArray(capabilities?.profiles)
    ? capabilities.profiles.filter(profile => profile && profile.enabled !== false)
    : []
  const byId = id => profiles.find(profile => profile.profileId === id)
  if (requestedProfileId !== undefined && (typeof requestedProfileId !== 'string' || !requestedProfileId.trim())) {
    return { profile: null, status: 'unresolved', reason: 'requested-profile-invalid', candidates: profiles }
  }
  const explicit = typeof requestedProfileId === 'string' && requestedProfileId.trim() ? requestedProfileId.trim() : ''
  if (explicit) {
    const selected = byId(explicit)
    return selected
      ? { profile: selected, status: 'resolved', reason: 'request', candidates: profiles }
      : { profile: null, status: 'unresolved', reason: 'requested-profile-not-found', candidates: profiles }
  }
  for (const [id, reason] of [[selectedProfileId, 'persisted-selection'], [capabilities?.defaultProfileId, 'server-default']]) {
    if (typeof id !== 'string' || !id.trim()) continue
    const selected = byId(id)
    if (selected) return { profile: selected, status: 'resolved', reason, candidates: profiles }
  }
  if (profiles.length === 1) return { profile: profiles[0], status: 'resolved', reason: 'unique-candidate', candidates: profiles }
  if (profiles.length === 0) return { profile: null, status: 'unresolved', reason: 'no-agent-profile', candidates: profiles }
  return { profile: null, status: 'unresolved', reason: 'multiple-agent-profiles-no-default', candidates: profiles }
}

function boundedText(value, name, max = 16_000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\0]/.test(value)) throw new Error(`${name}不完整或过长`)
  return value.trim()
}

function publicRuntimeError(value, status) {
  const fallback = `Trace 没有完成这次请求（${status}）`
  const message = typeof value?.error?.message === 'string' ? value.error.message.trim() : ''
  if (!message) return fallback
  if (message.length > 500 || /(?:[A-Za-z]:[\\/]|\/(?:Users|home|var|tmp|private|opt|srv)\/|\b(?:projectDir|contextHash|deliveryId|endpoint|cwd|profileId)\b)/i.test(message)) return fallback
  return message
}

function safeProjectDisplayName(value) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (!text || text.length > 200 || /[\0\r\n]/.test(text) || path.isAbsolute(text) || path.win32.isAbsolute(text) || /^[A-Za-z]:/.test(text)) return ''
  return text
}

function safeWorkResult(workspace, workId) {
  const work = workspace?.host?.worksite?.works?.[workId]
  const session = workspace?.host?.worksite?.sessions?.[workId]
  if (!work || !session) return null
  const returned = session.codexReturns?.at(-1)
  return {
    workId,
    connected: work.connected === true,
    status: work.connection?.status || (returned ? 'returned_for_review' : 'prepared'),
    projectName: safeProjectDisplayName(work.project) || '当前项目',
    agentLabel: safePanelText(work.agent, 120) || 'Codex',
    result: returned?.result ? {
      fact: returned.result.fact,
      interpretation: returned.result.interpretation || '',
      unconfirmed: returned.result.unconfirmed || '',
      proposedUnderstanding: returned.result.proposedUnderstanding || '',
    } : session.result?.externalReturnId ? {
      fact: session.result.fact || '',
      interpretation: session.result.interpretation || '',
      unconfirmed: session.result.unconfirmed || '',
      proposedUnderstanding: session.result.proposedUnderstanding || '',
    } : null,
  }
}

function safeExecutionIdentity({ workId, adapterExecutionId, hostSessionId, codexThreadId, source = 'desktop-bridge', ...legacy } = {}) {
  workId = typeof workId === 'string' ? workId : legacy.trace_work_id
  adapterExecutionId = typeof adapterExecutionId === 'string' ? adapterExecutionId : legacy.adapter_execution_id
  hostSessionId = typeof hostSessionId === 'string' ? hostSessionId : legacy.host_session_id
  codexThreadId = typeof codexThreadId === 'string' ? codexThreadId : legacy.codex_thread_id
  const safeId = value => {
    const text = safePanelText(value, 512)
    return text && /^[a-zA-Z0-9._:-]+$/.test(text) ? text : null
  }
  const safeWorkId = safeId(workId)
  const safeAdapterId = safeId(adapterExecutionId)
  const safeHostSession = safeId(hostSessionId)
  const safeCodexThread = safeId(codexThreadId)
  const nativeThread = Boolean(safeCodexThread)
  return {
    trace_work_id: safeWorkId,
    adapter_execution_id: safeAdapterId,
    host_session_id: safeHostSession,
    codex_thread_id: safeCodexThread,
    execution_kind: safePanelText(source, 80) || 'desktop-bridge',
    synthetic_host_session: true,
    native_codex_thread: nativeThread,
  }
}

function safePanelText(value, limit = 240) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  // Product Workspace deliberately omits private turn bodies from its list
  // projections. Keep this second boundary in the desktop bridge as well:
  // operational panels must never turn an absolute path, prompt or token into
  // product copy by accident.
  if (!text || text.length > limit || /(?:[A-Za-z]:[\\/]|\/(?:Users|home|var|tmp|private|opt|srv)\/|(?:token|secret|access[_ -]?key|authorization)\s*[:=])/i.test(text)) return ''
  return text
}

function safePanelItem(item, fields = []) {
  const result = {}
  for (const field of fields) {
    const value = item?.[field]
    if (typeof value === 'string') result[field] = safePanelText(value)
    else if (typeof value === 'number' && Number.isFinite(value)) result[field] = value
    else if (typeof value === 'boolean') result[field] = value
  }
  return result
}

function safePanelReceipt(value, { fallbackStatus = 'accepted', fields = [] } = {}) {
  const result = {
    protocolVersion: 1,
    status: safePanelText(value?.status, 40) || fallbackStatus,
  }
  for (const field of fields) {
    const text = safePanelText(value?.[field], 240)
    if (text) result[field] = text
    else if (Number.isSafeInteger(value?.[field])) result[field] = value[field]
  }
  return result
}

export function validateRuntimeOrigin(value = DEFAULT_RUNTIME_ORIGIN) {
  const url = new URL(value)
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
  if (url.protocol !== 'http:' || !loopback || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('TRACE_BACKEND_ORIGIN must be a loopback HTTP origin')
  }
  return url.origin
}

export function createRuntimeCapabilityClient({
  origin = process.env.TRACE_BACKEND_ORIGIN || DEFAULT_RUNTIME_ORIGIN,
  cloudOrigin = process.env.TRACE_CLOUD_ORIGIN || DEFAULT_CLOUD_ORIGIN,
  projectDir: configuredProjectDir,
  projectSource,
  startupCwd = process.cwd(),
  savedProjectDir,
  profileId: configuredProfileId,
  onProfileSelected,
  workBindings: configuredWorkBindings,
  executionBindings: configuredExecutionBindings,
  onWorkBinding,
  onExecutionBinding,
  fetchImpl = globalThis.fetch,
  identityFetchImpl = fetchImpl,
  cloudFetchImpl = fetchImpl,
  randomId = randomUUID,
  desktopSnapshotToken = process.env.TRACE_DESKTOP_SNAPSHOT_TOKEN,
  now = Date.now,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const backendOrigin = validateRuntimeOrigin(origin)
  const cloudBase = new URL(cloudOrigin)
  if (cloudBase.protocol !== 'https:' || cloudBase.username || cloudBase.password || cloudBase.pathname !== '/' || cloudBase.search || cloudBase.hash) throw new Error('TRACE_CLOUD_ORIGIN must be an HTTPS origin')
  let projectContext
  const initialProjectDir = configuredProjectDir || savedProjectDir || startupCwd
  const initialProjectSource = projectSource || (configuredProjectDir ? 'explicit-env' : savedProjectDir ? 'saved-setting' : 'startup-cwd')
  let selectedProjectDir = initialProjectDir
  let selectedProjectSource = initialProjectSource
  // TRACE_PROJECT_DIR is an explicit user configuration, so a descriptor and
  // repository that pass validation may be trusted without an extra picker
  // click.  Saved settings and startup cwd remain candidates until the user
  // confirms them in this process.
  let userConfirmedProject = initialProjectSource === 'explicit-env'
  let confirmedIdentity
  let projectBinding
  let selectedProfileId = configuredProfileId
  const workBindings = new Map(Object.entries(configuredWorkBindings && typeof configuredWorkBindings === 'object' ? configuredWorkBindings : {}).filter(([key, value]) => typeof key === 'string' && value && typeof value === 'object'))
  const executionBindings = new Map(Object.entries(configuredExecutionBindings && typeof configuredExecutionBindings === 'object' ? configuredExecutionBindings : {}).filter(([key, value]) => typeof key === 'string' && value && typeof value === 'object'))
  const repositoryPreflights = new Map()
  const recoveryPreviews = new Map()
  const publicationPreviews = new Map()
  let lastPanelRows = null
  let pinnedRuntimeIdentity
  let runtimeHandshakePromise
  const remember = (map, key, value) => {
    map.set(key, {...value, createdAt: now()})
    while (map.size > 16) map.delete(map.keys().next().value)
    return key
  }
  const confirmationRequired = (request, message) => {
    if (request.confirmation !== 'user-confirmed') throw new Error(message)
  }

  async function ensureRuntimeIdentity() {
    if (!runtimeHandshakePromise) {
      const pending = (async () => {
        const url = new URL('/api/runtime/identity', backendOrigin)
        let response
        try {
          response = await identityFetchImpl(url, {
            method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5_000),
            headers: { origin: backendOrigin, accept: 'application/json', 'x-trace-runtime-protocol': String(RUNTIME_IDENTITY_PROTOCOL_VERSION) },
          })
        } catch {
          throw new Error('Trace 本机能力身份握手失败，请重新打开 Trace 后再试')
        }
        let text
        try { text = await response.text() } catch { throw new Error('Trace 本机能力身份响应不可读') }
        if (!response.ok || text.length > 64 * 1024) throw new Error('Trace 本机能力身份握手失败，请重新打开 Trace 后再试')
        let value
        try { value = JSON.parse(text) } catch { throw new Error('Trace 本机能力身份响应无效') }
        const identity = validateRuntimeServiceIdentity(value, pinnedRuntimeIdentity ? {
          installation_id: pinnedRuntimeIdentity.installationId,
          workspace_id: pinnedRuntimeIdentity.workspaceId,
        } : {})
        pinnedRuntimeIdentity ||= identity
        return identity
      })()
      let settled
      settled = pending.finally(() => { if (runtimeHandshakePromise === settled) runtimeHandshakePromise = undefined })
      runtimeHandshakePromise = settled
    }
    return runtimeHandshakePromise
  }
  function refreshProjectBinding() {
    const observed = inspectProjectCandidate(selectedProjectDir, selectedProjectSource)
    if (confirmedIdentity) {
      if (observed.identity && sameProjectIdentity(observed.identity, confirmedIdentity)) {
        observed.status = PROJECT_BINDING_STATES.CONFIRMED
        projectContext = { projectDir: observed.identity.canonicalPath, projectName: observed.projectName, identity: observed.identity }
        projectBinding = observed
      } else {
        // Keep the old identity for comparison but expose the new observation
        // as a conflict.  No caller may continue to use the old path after a
        // switch, descriptor edit, repository replacement, or worktree drift.
        projectContext = undefined
        projectBinding = {
          ...observed,
          status: PROJECT_BINDING_STATES.CONFLICT_OR_DRIFT,
          previousIdentity: confirmedIdentity,
          diagnostic: publicDiagnostic('project-binding-drift', '当前项目或仓库 worktree 已变化，已停止向旧项目执行、发布和 guard；请重新选择并确认项目。'),
        }
      }
    } else {
      projectContext = observed.identity ? { projectDir: observed.identity.canonicalPath, projectName: observed.projectName, identity: observed.identity } : undefined
      if (userConfirmedProject && observed.identity) observed.status = PROJECT_BINDING_STATES.CONFIRMED
      projectBinding = observed
      if (observed.status === PROJECT_BINDING_STATES.CONFIRMED) confirmedIdentity = observed.identity
    }
    return projectBinding
  }

  function projectBindingPublic() {
    return publicProjectBinding(projectBinding || refreshProjectBinding())
  }

  function projectBindingError(binding, requireConfirmed = true) {
    const status = binding?.status || PROJECT_BINDING_STATES.UNBOUND
    if (status === PROJECT_BINDING_STATES.CONFLICT_OR_DRIFT) return new Error(binding.diagnostic?.message || '当前项目或仓库 worktree 已变化，请重新选择并确认项目。')
    if (status === PROJECT_BINDING_STATES.CANDIDATE && requireConfirmed) return new Error('当前项目只是候选，执行前请在 Codex 设置中明确确认项目绑定。')
    return new Error(binding?.diagnostic?.message || '当前项目不可用，请先选择并确认一个 Trace 项目。')
  }

  function currentProject({ requireConfirmed = false, expectedIdentity } = {}) {
    const binding = refreshProjectBinding()
    if (requireConfirmed && binding.status !== PROJECT_BINDING_STATES.CONFIRMED) throw projectBindingError(binding, true)
    if (!binding.identity || !projectContext) throw projectBindingError(binding, requireConfirmed)
    if (expectedIdentity && !sameProjectIdentity(binding.identity, expectedIdentity)) {
      projectBinding = {
        ...binding,
        status: PROJECT_BINDING_STATES.CONFLICT_OR_DRIFT,
        previousIdentity: expectedIdentity,
        diagnostic: publicDiagnostic('project-binding-drift', '当前项目或仓库 worktree 已变化，已停止这次旧项目操作；请重新选择并确认项目。'),
      }
      projectContext = undefined
      throw projectBindingError(projectBinding, true)
    }
    return projectContext
  }

  function requireConfirmedProject(expectedIdentity) {
    return currentProject({ requireConfirmed: true, expectedIdentity })
  }

  function setProjectDir(projectDir) {
    if (typeof projectDir !== 'string' || !projectDir.trim() || /[\0]/.test(projectDir)) throw new Error('项目选择位置不可用，请重新选择一个目录')
    selectedProjectDir = projectDir
    selectedProjectSource = 'user-selection'
    projectContext = undefined
    confirmedIdentity = undefined
    // A failed selection must stay a candidate/unbound state.  Do not leave a
    // latent confirmation behind that could become trusted if a descriptor is
    // created in the directory later without another user action.
    userConfirmedProject = false
    const binding = refreshProjectBinding()
    if (!binding.identity) throw projectBindingError(binding, true)
    userConfirmedProject = true
    confirmedIdentity = binding.identity
    binding.status = PROJECT_BINDING_STATES.CONFIRMED
    projectBinding = binding
    projectContext = { projectDir: binding.identity.canonicalPath, projectName: binding.projectName, identity: binding.identity }
    return { ...publicProjectBinding(binding), connected: true, projectName: binding.projectName, agentLabel: 'Codex', locationLabel: '已确认项目' }
  }

  function confirmProjectBinding() {
    const binding = refreshProjectBinding()
    // An existing confirmed identity that no longer matches the observation
    // is a drift state, not a fresh candidate.  Re-confirming this object
    // would silently bless a descriptor/repository replacement without the
    // explicit project-picker step required for a new binding.
    if (binding.status === PROJECT_BINDING_STATES.CONFLICT_OR_DRIFT) throw projectBindingError(binding, true)
    if (!binding.identity) throw projectBindingError(binding, true)
    userConfirmedProject = true
    confirmedIdentity = binding.identity
    binding.status = PROJECT_BINDING_STATES.CONFIRMED
    projectBinding = binding
    projectContext = { projectDir: binding.identity.canonicalPath, projectName: binding.projectName, identity: binding.identity }
    return { ...publicProjectBinding(binding), connected: true, projectName: binding.projectName, agentLabel: 'Codex', locationLabel: '已确认项目' }
  }

  function ensureBindingUnchanged(expectedIdentity) {
    const current = refreshProjectBinding()
    if (current.status !== PROJECT_BINDING_STATES.CONFIRMED || !current.identity || !sameProjectIdentity(current.identity, expectedIdentity)) {
      throw projectBindingError({ ...current, status: PROJECT_BINDING_STATES.CONFLICT_OR_DRIFT, diagnostic: publicDiagnostic('project-binding-drift', '当前项目或仓库 worktree 已变化，已停止这次旧项目操作；请重新选择并确认项目。') }, true)
    }
    return projectContext
  }

  async function stopRunOnBindingDrift(runId) {
    if (typeof runId !== 'string' || !runId) return
    // The binding check remains authoritative; cancellation is only a best
    // effort cleanup so a stale adapter cannot continue doing work after the
    // desktop has detected a project switch or repository/worktree drift.
    try { await runtimeRequest(`/api/agent/runs/${encodeURIComponent(runId)}/cancel`, {}) } catch { /* preserve the actionable drift error */ }
  }

  function rememberWorkBinding(workId, identity) {
    if (!identity || typeof workId !== 'string') return
    const value = { projectId: identity.projectId, fingerprint: identity.fingerprint, canonicalPath: identity.canonicalPath }
    workBindings.set(workId, value)
    while (workBindings.size > 256) workBindings.delete(workBindings.keys().next().value)
    try { onWorkBinding?.(workId, value) } catch { /* persistence is best effort; execution still has in-memory identity */ }
  }

  function rememberedWorkBinding(workId) {
    const value = workBindings.get(workId)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const projectId = value.projectId ?? value.project_id
    const fingerprint = value.fingerprint ?? value.projectFingerprint ?? value.project_fingerprint
    const canonicalPath = value.canonicalPath ?? value.canonical_path
    if (typeof projectId !== 'string' || !projectId.trim() || typeof fingerprint !== 'string' || !fingerprint.trim()) return null
    if (canonicalPath !== undefined && canonicalPath !== null && (typeof canonicalPath !== 'string' || !path.isAbsolute(canonicalPath))) return null
    return { projectId, fingerprint, ...(canonicalPath ? { canonicalPath } : {}) }
  }

  function projectIdentityMatchesEvidence(evidence, expectedIdentity) {
    if (!evidence || typeof evidence !== 'object' || !expectedIdentity) return false
    const projectId = evidence.projectId ?? evidence.project_id
    const fingerprint = evidence.fingerprint ?? evidence.projectFingerprint ?? evidence.project_fingerprint
    const canonicalPath = evidence.canonicalPath ?? evidence.canonical_path
    if (typeof projectId !== 'string' || projectId !== expectedIdentity.projectId) return false
    if (fingerprint !== undefined && fingerprint !== null && (typeof fingerprint !== 'string' || fingerprint !== expectedIdentity.fingerprint)) return false
    if (canonicalPath !== undefined && canonicalPath !== null && (typeof canonicalPath !== 'string' || !path.isAbsolute(canonicalPath) || canonicalPathKey(canonicalPath) !== canonicalPathKey(expectedIdentity.canonicalPath))) return false
    return typeof fingerprint === 'string' || typeof canonicalPath === 'string'
  }

  function verifyStoredProjectIdentity(record, expectedIdentity, label) {
    if (!record || typeof record !== 'object' || !expectedIdentity) return
    const nested = record.projectIdentity || record.project_identity || record.binding
    const value = nested && typeof nested === 'object' && !Array.isArray(nested) ? nested : record
    const projectId = value.projectId ?? value.project_id
    const fingerprint = value.fingerprint ?? value.projectFingerprint ?? value.project_fingerprint
    const canonicalPath = value.canonicalPath ?? value.canonical_path
    if (projectId !== undefined && projectId !== null && typeof projectId !== 'string') throw new Error(`${label}返回了不可验证的项目身份，已停止旧项目操作`)
    if (fingerprint !== undefined && fingerprint !== null && typeof fingerprint !== 'string') throw new Error(`${label}返回了不可验证的项目身份，已停止旧项目操作`)
    if (canonicalPath !== undefined && canonicalPath !== null && typeof canonicalPath !== 'string') throw new Error(`${label}返回了不可验证的项目身份，已停止旧项目操作`)
    if (typeof projectId === 'string' && projectId !== expectedIdentity.projectId) throw new Error(`${label}属于另一个 Trace 项目，已停止旧项目操作`)
    if (typeof fingerprint === 'string' && fingerprint !== expectedIdentity.fingerprint) throw new Error(`${label}属于另一个仓库或 worktree，已停止旧项目操作`)
    if (typeof canonicalPath === 'string' && (!path.isAbsolute(canonicalPath) || canonicalPathKey(canonicalPath) !== canonicalPathKey(expectedIdentity.canonicalPath))) throw new Error(`${label}属于另一个仓库或 worktree，已停止旧项目操作`)
  }

  function rememberExecution(workId, value) {
    if (typeof workId !== 'string' || !value || typeof value !== 'object') return
    executionBindings.set(workId, { ...value })
    try { onExecutionBinding?.(workId, { ...value }) } catch { /* best effort only */ }
  }

  async function runtimeRequest(pathname, body, timeoutMs = 35_000, notFoundFallback = NO_NOT_FOUND_FALLBACK) {
    await ensureRuntimeIdentity()
    const url = new URL(pathname, backendOrigin)
    if (url.origin !== backendOrigin || !url.pathname.startsWith('/api/')) throw new Error('Unsupported Trace Runtime path')
    let response
    try {
      response = await fetchImpl(url, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          origin: backendOrigin,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      throw new Error('Trace 本机能力没有启动，请重新打开 Trace 后再试')
    }
    const text = await response.text()
    if (text.length > 1_048_576) throw new Error('Trace Runtime response exceeded 1 MiB')
    if (response.status === 404 && notFoundFallback !== NO_NOT_FOUND_FALLBACK) return notFoundFallback
    let value
    try { value = JSON.parse(text) } catch { throw new Error('Trace 本机能力没有正确响应，请重新打开 Trace 后再试') }
    if (!response.ok) throw new Error(publicRuntimeError(value, response.status))
    return value
  }

  async function runtimeEventStream(runId, after = 0) {
    const encoded = encodeURIComponent(requireId(runId, 'Agent 运行'))
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('Agent 事件游标不正确')
    // SSE is a long-lived capability call too.  Do not let a stale stream
    // keep talking to a port that has been reused by another service.
    await ensureRuntimeIdentity()
    const url = new URL(`/api/agent/runs/${encoded}/events?after=${after}`, backendOrigin)
    let response
    try {
      response = await fetchImpl(url, { method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(190_000), headers: { origin: backendOrigin, accept: 'text/event-stream' } })
    } catch { throw new Error('Agent 实时进度连接没有建立，运行仍会在本机继续') }
    if (!response.ok) throw new Error(`Agent 实时进度暂时不可用（${response.status}）`)
    const reader = response.body?.getReader?.()
    if (!reader) throw new Error('Agent 实时进度返回为空')
    const decoder = new TextDecoder()
    let buffer = '', events = []
    const parse = (block) => {
      const lines = block.split(/\r?\n/); let type = 'message', id = '', data = ''
      for (const line of lines) {
        if (line.startsWith('event:')) type = line.slice(6).trim().slice(0, 80)
        else if (line.startsWith('id:')) id = line.slice(3).trim().slice(0, 40)
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (!data || events.length >= 256) return
      try { events.push({ type, id, data: JSON.parse(data) }) } catch { /* ignore malformed progress frame */ }
    }
    while (true) {
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done })
      let boundary
      while ((boundary = buffer.indexOf('\n\n')) >= 0) { parse(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2) }
      if (chunk.done) break
    }
    return { runId, after, events }
  }

  async function cloudRequest(pathname, body, timeoutMs = 35_000) {
    const url = new URL(pathname, cloudBase.origin)
    if (url.origin !== cloudBase.origin || !url.pathname.startsWith('/api/')) throw new Error('Unsupported Trace Cloud path')
    let response
    try {
      response = await cloudFetchImpl(url, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        // The public domain previously served a permanent redirect. Chromium
        // can retain that 308 across desktop upgrades, so every live capability
        // request must bypass the persistent HTTP cache while still refusing
        // an actual redirect response.
        cache: 'no-store',
        credentials: 'include',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          origin: cloudBase.origin,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      throw new Error('知乎与联网能力暂时不可用，请稍后重试')
    }
    const text = await response.text()
    if (text.length > 1_048_576) throw new Error('Trace Cloud response exceeded 1 MiB')
    let value
    try { value = JSON.parse(text) } catch { throw new Error('Trace 云端能力暂时不可用，请稍后重试') }
    if (!response.ok) throw new Error(publicRuntimeError(value, response.status))
    return value
  }

  function hostSessionId(request) {
    const value = request?.sessionId
    if (value === undefined) return DESKTOP_HOST_SESSION
    if (typeof value !== 'string' || !/^[a-zA-Z0-9._:-]{1,200}$/.test(value)) throw new Error('工作现场身份不完整')
    return value
  }

  function hostCommandId(kind, request) {
    return `desktop-${kind}-${randomId()}`
  }

  function listQuery(pathname, query = {}) {
    const url = new URL(pathname, backendOrigin)
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
    return `${url.pathname}${url.search}`
  }

  function safePanelSession(item, binding) {
    const projectRef = typeof item?.project_ref === 'string' ? item.project_ref : ''
    let project = '个人空间（未绑定项目）'
    const hasProjectRef = item?.project_ref !== undefined && item?.project_ref !== null && item?.project_ref !== ''
    if (hasProjectRef) {
      let current = false
      try {
        current = binding?.status === PROJECT_BINDING_STATES.CONFIRMED
          && typeof projectContext?.projectDir === 'string'
          && path.isAbsolute(projectRef)
          && canonicalPathKey(projectRef) === canonicalPathKey(projectContext.projectDir)
      } catch { /* an untrusted row must never break the whole panel */ }
      project = current ? '已绑定当前项目' : '已绑定指定项目（当前身份另行核对）'
    }
    return {
      host: safePanelText(item?.host, 40) || DESKTOP_HOST,
      sessionId: safePanelText(item?.session_id || item?.sessionId, 200),
      status: safePanelText(item?.status, 40) || 'unknown',
      // The list endpoint only gives us a project path.  It does not prove
      // that the row belongs to the currently selected/confirmed binding, so
      // only a canonical match against a confirmed binding gets the current
      // project label.
      project,
      updatedAt: safePanelText(item?.last_event_at || item?.updated_at, 80),
    }
  }

  function safePanelFinding(item) {
    return {
      kind: safePanelText(item?.finding_kind || item?.origin || 'captured', 80),
      status: safePanelText(item?.status, 40),
      turn: safePanelText(item?.turn_id, 160),
      summary: safePanelText(item?.observation || item?.desired_behavior, 260) || '已记录一条工作发现',
    }
  }

  function safePanelProposal(item) {
    return {
      id: safePanelText(item?.proposal_id, 200),
      status: safePanelText(item?.status, 40),
      target: safePanelText(item?.target_kind, 80) || '待判断',
      scope: safePanelText(item?.scope, 120) || '未知范围',
      rationale: safePanelText(item?.rationale, 260),
      revision: Number.isSafeInteger(item?.revision) ? item.revision : 0,
    }
  }

  function safePanelActivation(item) {
    return {
      id: safePanelText(item?.receipt_id, 200),
      status: safePanelText(item?.status, 40),
      count: Number.isFinite(item?.item_count) ? item.item_count : 0,
      createdAt: safePanelText(item?.created_at, 80),
    }
  }

  /**
   * A deliberately small projection for the desktop "本机能力" surface.
   * The renderer does not receive raw Product Workspace rows, private turn
   * bodies, repository paths, hashes or provider credentials.
   */
  async function readRuntimePanel() {
    // Resolve this once before the parallel reads so session labels can only
    // claim the current project when the local binding is confirmed.
    const binding = projectBindingPublic()
    const optional = (pathname) => runtimeRequest(pathname, undefined, 12_000, { items: [] }).catch(() => ({ items: [] }))
    const [workspace, sessions, turns, findings, jobs, proposals, activations, worker, guard, policies, orchestrations, trials] = await Promise.all([
      runtimeRequest('/api/product/workspace'),
      runtimeRequest(listQuery('/api/product/host/sessions', { host: DESKTOP_HOST })),
      runtimeRequest(listQuery('/api/product/host/turns', { host: DESKTOP_HOST, session_id: DESKTOP_HOST_SESSION })),
      runtimeRequest(listQuery('/api/product/host/findings', { host: DESKTOP_HOST, session_id: DESKTOP_HOST_SESSION })),
      runtimeRequest(listQuery('/api/product/host/sensemaking/jobs', { host: DESKTOP_HOST, session_id: DESKTOP_HOST_SESSION })),
      runtimeRequest(listQuery('/api/product/host/routing/proposals', { host: DESKTOP_HOST, session_id: DESKTOP_HOST_SESSION })),
      runtimeRequest(listQuery('/api/product/host/activation/history', { host: DESKTOP_HOST, session_id: DESKTOP_HOST_SESSION })),
      runtimeRequest('/api/agent/sensemaking/health', undefined, 12_000, { status: 'unavailable', queue_depth: 0, failed_count: 0 }),
      optional('/api/product/host/repository/recovery/status'),
      optional('/api/product/host/publication-policies'),
      optional(listQuery('/api/product/host/capability/orchestrations', { host: DESKTOP_HOST, session_id: DESKTOP_HOST_SESSION })),
      optional('/api/product/host/capability/trials'),
    ])
    const array = (value) => Array.isArray(value?.items) ? value.items : []
    const orchestrationRows = array(orchestrations)
    const trialRows = array(trials)
    const policyRows = array(policies)
    lastPanelRows = { orchestrations: orchestrationRows, trials: trialRows, policies: policyRows }
    return {
      connected: true,
      host: DESKTOP_HOST,
      sessionId: DESKTOP_HOST_SESSION,
      sessionKind: 'synthetic-bridge',
      projectBinding: binding,
      revision: Number.isSafeInteger(workspace?.revision) ? workspace.revision : 0,
      sessions: array(sessions).slice(0, 24).map((item) => safePanelSession(item, binding)),
      turnCount: array(turns).length,
      findings: array(findings).slice(0, 24).map(safePanelFinding),
      jobs: array(jobs).slice(0, 24).map((item) => safePanelItem(item, ['status', 'execution_mode', 'error_code'])),
      proposals: array(proposals).slice(0, 24).map(safePanelProposal),
      activations: array(activations).slice(0, 24).map(safePanelActivation),
      worker: {
        status: safePanelText(worker?.status, 40) || 'unavailable',
        mode: safePanelText(worker?.mode, 40),
        queueDepth: Number.isFinite(worker?.queue_depth) ? worker.queue_depth : 0,
        failedCount: Number.isFinite(worker?.failed_count) ? worker.failed_count : 0,
      },
      recovery: array(guard).slice(0, 24).map((item) => ({
        state: safePanelText(item?.state, 40),
        id: safePanelText(item?.journal_id, 200),
        expectedBranch: item?.expected_branch ? '已记录目标分支' : '',
      })),
      policies: policyRows.slice(0, 12).map((item) => ({ status: safePanelText(item?.status, 40), scope: safePanelText(item?.scope, 80), id: safePanelText(item?.policy_id, 200), revision: Number.isSafeInteger(item?.revision) ? item.revision : 0 })),
      orchestrations: orchestrationRows.slice(0, 12).map((item) => ({ status: safePanelText(item?.status, 40), id: safePanelText(item?.orchestration_id, 200), revision: Number.isSafeInteger(item?.revision) ? item.revision : 0, hasCandidate: Boolean(item?.candidate_dir), hasManifest: Boolean(item?.manifest_sha256), producerStatus: safePanelText(item?.candidate?.producer_status, 40) })),
      trials: trialRows.slice(0, 12).map((item) => ({ status: safePanelText(item?.status, 40), id: safePanelText(item?.trial_id, 200), orchestrationId: safePanelText(item?.orchestration_id, 200), revision: Number.isSafeInteger(item?.revision) ? item.revision : 0, outcome: safePanelText(item?.outcome, 80) })),
    }
  }

  function requireId(value, name = '身份') {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9._:-]{1,512}$/.test(value)) throw new Error(`${name}不完整`)
    return value
  }

  async function runtimePanelAction(request) {
    if (!request || typeof request !== 'object') throw new Error('本机能力动作不完整')
    const action = request.action
    const sessionId = hostSessionId(request)
    const host = DESKTOP_HOST
    const base = { protocolVersion: 1, commandId: hostCommandId(action, request), host, sessionId }
    const targetBoundActions = new Set([
      'session.attach', 'repository.preflight', 'repository.apply', 'repository.recovery.preview',
      'repository.recovery.reconcile', 'publication.policy.preview', 'publication.policy.adopt',
      'publication.policy.revoke', 'capability.trial.create', 'capability.trial.complete',
      'capability.stage', 'capability.validate', 'capability.publish', 'capability.rollback',
    ])
    const boundProject = targetBoundActions.has(action) && action !== 'repository.apply' && action !== 'repository.recovery.reconcile'
      && action !== 'publication.policy.adopt' ? requireConfirmedProject() : null
    if (action === 'session.attach' || action === 'session.pause' || action === 'session.detach') {
      if (action === 'session.attach') {
        const result = await runtimeRequest('/api/product/host/session/attach', { ...base, projectRef: boundProject.projectDir })
        return { ...safePanelReceipt(result, { fallbackStatus: 'attached' }), sessionKind: 'synthetic-bridge', projectBinding: projectBindingPublic() }
      }
      const result = await runtimeRequest(`/api/product/host/session/${action.slice('session.'.length)}`, base)
      return safePanelReceipt(result)
    }
    if (action === 'sensemaking.drain') {
      const limit = request.limit === undefined ? 16 : request.limit
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('排空数量需要在 1—100 之间')
      return runtimeRequest('/api/agent/sensemaking/drain', { protocolVersion: 1, limit })
    }
    if (action === 'routing.decide') {
      return runtimeRequest('/api/product/host/routing/decide', { ...base, proposalId: requireId(request.proposalId, '路由提案'), action: ['trial', 'adopt', 'reject'].includes(request.decision) ? request.decision : 'reject', expectedRevision: Number.isSafeInteger(request.expectedRevision) ? request.expectedRevision : 0 })
    }
    if (action === 'activation.mark') {
      const status = ['used', 'affected', 'dismissed', 'snoozed', 'released'].includes(request.status) ? request.status : 'dismissed'
      return runtimeRequest('/api/product/host/activation/mark', { ...base, receiptId: requireId(request.receiptId, '回带记录'), status, expectedRevision: Number.isSafeInteger(request.expectedRevision) ? request.expectedRevision : 0 })
    }
    if (action === 'repository.preflight') {
      ensureBindingUnchanged(boundProject.identity)
      const proposalId = request.proposalId ? requireId(request.proposalId, '路由提案') : undefined
      const result = await runtimeRequest('/api/product/host/repository/preflight', { ...base, repoRoot: boundProject.projectDir, executionMode: 'local', taskIntent: typeof request.taskIntent === 'string' ? request.taskIntent.slice(0, 500) : '', ...(proposalId ? { proposalId } : {}) })
      if (!result?.preflight_id || typeof result.state_hash !== 'string') throw new Error('仓库预检没有返回可验证回执')
      const token = `preflight:${randomId()}`
      remember(repositoryPreflights, token, { preflightId: result.preflight_id, proposalId: proposalId || null, expectedStateHash: result.state_hash, action: result.action, identity: boundProject.identity })
      return { protocolVersion: 1, status: 'preview', preflightId: token, canApply: Boolean(proposalId && result.action === 'create-branch'), action: safePanelText(result.action, 80), boundProposal: Boolean(proposalId) }
    }
    if (action === 'repository.apply') {
      confirmationRequired(request, '执行仓库保护前需要确认这次预检回执')
      const token = requireId(request.preflightId, '仓库预检回执')
      const cached = repositoryPreflights.get(token)
      if (!cached || now() - cached.createdAt > 10 * 60_000) throw new Error('仓库预检已过期，请重新做只读预检')
      if (!cached.proposalId || cached.action !== 'create-branch') throw new Error('这条预检没有绑定可采用的 runtime-guard 提案')
      ensureBindingUnchanged(cached.identity)
      const result = await runtimeRequest('/api/product/host/repository/apply', { ...base, preflightId: cached.preflightId, proposalId: cached.proposalId, expectedStateHash: cached.expectedStateHash, approval: `adopt:${cached.proposalId}` })
      repositoryPreflights.delete(token)
      return { protocolVersion: 1, status: safePanelText(result?.status, 40) || 'applied', applied: true }
    }
    if (action === 'repository.recovery.preview') {
      const value = request.journalId || request.targetCommandId
      if (!value) throw new Error('先选择一条待恢复记录')
      const journalId = request.journalId ? requireId(request.journalId, '恢复记录') : undefined
      ensureBindingUnchanged(boundProject.identity)
      const result = await runtimeRequest('/api/product/host/repository/recovery/preview', { ...base, ...(journalId ? { journalId } : { targetCommandId: requireId(request.targetCommandId, '命令记录') }) })
      if (journalId) remember(recoveryPreviews, journalId, { action: result?.action, identity: boundProject.identity })
      return { protocolVersion: 1, action: safePanelText(result?.action, 80), previewed: true }
    }
    if (action === 'repository.recovery.reconcile') {
      confirmationRequired(request, '完成恢复回执前需要确认预览结果')
      const journalId = requireId(request.journalId, '恢复记录')
      const cached = recoveryPreviews.get(journalId)
      if (!cached) throw new Error('请先预览这条恢复记录')
      ensureBindingUnchanged(cached.identity)
      const result = await runtimeRequest('/api/product/host/repository/recovery/reconcile', { ...base, journalId })
      return safePanelReceipt(result, { fields: ['journal_id'] })
    }
    if (action === 'publication.policy.preview') {
      ensureBindingUnchanged(boundProject.identity)
      const body = { ...base, scope: ['personal', 'project', 'cross-project'].includes(request.scope) ? request.scope : 'project', targetRoot: boundProject.projectDir, ...(Array.isArray(request.allowedCapabilityKinds) ? { allowedCapabilityKinds: request.allowedCapabilityKinds.slice(0, 16) } : {}), ...(request.validationRequirements && typeof request.validationRequirements === 'object' ? { validationRequirements: request.validationRequirements } : {}) }
      const result = await runtimeRequest('/api/product/host/publication-policy/preview', body)
      if (!result?.policy_id) throw new Error('发布策略预览没有返回可确认回执')
      if (result.scope !== body.scope) throw new Error('发布策略预览返回了不同的发布范围，已停止旧项目操作')
      if (typeof result.target_root !== 'string' || !path.isAbsolute(result.target_root) || canonicalPathKey(result.target_root) !== canonicalPathKey(boundProject.projectDir)) throw new Error('发布策略预览返回了另一个仓库或 worktree，已停止旧项目操作')
      const token = `policy-preview:${randomId()}`
      remember(publicationPreviews, token, { body, identity: boundProject.identity, policyId: result.policy_id, scope: result.scope, targetRoot: result.target_root, allowedCapabilityKinds: result.allowed_capability_kinds, validationRequirements: result.validation_requirements, expiresAt: result.expires_at })
      return { protocolVersion: 1, status: 'preview', previewId: token, scope: safePanelText(result.scope, 80), requiresConfirmation: true }
    }
    if (action === 'publication.policy.adopt') {
      confirmationRequired(request, '采用发布策略前需要确认预览内容')
      const previewId = requireId(request.previewId, '策略预览')
      const cached = publicationPreviews.get(previewId)
      if (!cached || now() - cached.createdAt > 10 * 60_000) throw new Error('策略预览已过期，请重新预览')
      ensureBindingUnchanged(cached.identity)
      const result = await runtimeRequest('/api/product/host/publication-policy/adopt', { ...base, scope: cached.scope, targetRoot: cached.targetRoot, allowedCapabilityKinds: cached.allowedCapabilityKinds, validationRequirements: cached.validationRequirements, ...(cached.expiresAt ? { expiresAt: cached.expiresAt } : {}), approval: `adopt:${cached.policyId}` })
      publicationPreviews.delete(previewId)
      return { protocolVersion: 1, status: safePanelText(result?.status, 40) || 'active', adopted: true }
    }
    if (action === 'publication.policy.revoke') {
      confirmationRequired(request, '撤回发布策略需要再次确认')
      const policyId = requireId(request.policyId, '发布策略')
      const policy = lastPanelRows?.policies?.find((item) => item.policy_id === policyId && item.status === 'active')
      if (!policy) throw new Error('这条发布策略已不存在或不是 active 状态，请刷新现场')
      ensureBindingUnchanged(boundProject.identity)
      const result = await runtimeRequest('/api/product/host/publication-policy/revoke', { ...base, policyId, expectedRevision: Number.isSafeInteger(request.expectedRevision) ? request.expectedRevision : policy.revision, reason: typeof request.reason === 'string' ? request.reason.slice(0, 500) : '用户从 Trace 工作现场撤回' })
      return safePanelReceipt(result, { fields: ['policy_id'] })
    }
    if (action === 'capability.trial.create') {
      ensureBindingUnchanged(boundProject.identity)
      const orchestrationId = requireId(request.orchestrationId, '能力编排')
      const orchestration = lastPanelRows?.orchestrations?.find((item) => item.orchestration_id === orchestrationId)
      if (!orchestration || !['candidate', 'producer_required', 'staged', 'validated'].includes(orchestration.status)) throw new Error('当前能力候选还不能创建试用')
      const hash = typeof request.capabilityHash === 'string' ? request.capabilityHash : orchestration.manifest_sha256
      if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) throw new Error('请先让 CapabilityPublisher 生成并暂存候选清单')
      const result = await runtimeRequest('/api/product/host/capability/trial/create', { ...base, orchestrationId, expectedRevision: Number.isSafeInteger(request.expectedRevision) ? request.expectedRevision : orchestration.revision, capabilityVersion: typeof request.capabilityVersion === 'string' ? request.capabilityVersion.slice(0, 120) : 'candidate', capabilityHash: hash, scenario: typeof request.scenario === 'string' && request.scenario.trim() ? request.scenario.slice(0, 500) : '验证这条能力在当前项目中的边界', task: typeof request.task === 'string' ? request.task.slice(0, 500) : '验证当前能力', expected: typeof request.expected === 'string' ? request.expected.slice(0, 500) : '按试用回执判断结果' })
      return safePanelReceipt(result, { fields: ['trial_id', 'orchestration_id'] })
    }
    if (action === 'capability.trial.complete') {
      ensureBindingUnchanged(boundProject.identity)
      const trialId = requireId(request.trialId, '试用记录')
      const trial = lastPanelRows?.trials?.find((item) => item.trial_id === trialId)
      if (!trial || !['queued', 'running'].includes(trial.status)) throw new Error('当前试用记录还不能收尾')
      const result = await runtimeRequest('/api/product/host/capability/trial/complete', { ...base, trialId, expectedRevision: Number.isSafeInteger(request.expectedRevision) ? request.expectedRevision : trial.revision, outcome: ['support', 'limit', 'challenge', 'inconclusive'].includes(request.outcome) ? request.outcome : 'inconclusive', observed: typeof request.observed === 'string' ? request.observed.slice(0, 1000) : '已完成一次显式试用' })
      return safePanelReceipt(result, { fields: ['trial_id', 'orchestration_id'] })
    }
    if (['capability.stage', 'capability.validate', 'capability.publish', 'capability.rollback'].includes(action)) {
      ensureBindingUnchanged(boundProject.identity)
      const orchestrationId = requireId(request.orchestrationId, '能力编排')
      const orchestration = lastPanelRows?.orchestrations?.find((item) => item.orchestration_id === orchestrationId)
      if (!orchestration) throw new Error('请先刷新工作现场并选择能力候选')
      const body = { ...base, orchestrationId, expectedRevision: Number.isSafeInteger(request.expectedRevision) ? request.expectedRevision : orchestration.revision }
      if (action === 'capability.stage') {
        if (!orchestration.candidate_dir || !orchestration.manifest_sha256) throw new Error('候选内容尚未由 CapabilityPublisher 暂存')
        Object.assign(body, { producerStatus: 'staged', candidateDir: orchestration.candidate_dir, manifestSha256: orchestration.manifest_sha256 })
      }
      if (action === 'capability.validate') {
        confirmationRequired(request, '标记能力通过验证前需要确认验证证据')
        if (!['staged', 'trial_queued'].includes(orchestration.status)) throw new Error('只有已暂存候选可以验证')
        Object.assign(body, { validation: request.validation && typeof request.validation === 'object' ? request.validation : { schema: 'passed', replay: 'passed', behavior: 'passed', rollback: 'passed', source_hashes: 'passed' } })
      }
      if (action === 'capability.publish') {
        confirmationRequired(request, '发布能力前需要确认 publisher 回执')
        if (orchestration.status !== 'validated') throw new Error('只有全部验证通过的候选可以发布')
        if (request.producerStatus !== 'published' || !request.publicationReceipt || typeof request.publicationReceipt !== 'object' || typeof request.rollbackReceipt !== 'string' || !request.rollbackReceipt.trim()) throw new Error('发布需要现有 CapabilityPublisher 的发布与回滚回执')
        Object.assign(body, { producerStatus: 'published', approval: typeof request.policyId === 'string' ? 'user-confirmed-from-trace' : `publish:${orchestrationId}`, ...(request.policyId ? { policyId: requireId(request.policyId, '发布策略') } : {}), publicationReceipt: request.publicationReceipt, rollbackReceipt: request.rollbackReceipt.slice(0, 4000) })
      }
      if (action === 'capability.rollback') {
        confirmationRequired(request, '回滚能力前需要再次确认')
        if (orchestration.status !== 'published') throw new Error('只有已发布能力可以回滚')
        if (typeof request.rollbackReceipt !== 'string' || !request.rollbackReceipt.trim()) throw new Error('回滚需要 publisher 提供回滚回执')
        Object.assign(body, { producerStatus: 'rolled_back', rollbackReceipt: request.rollbackReceipt.slice(0, 4000) })
      }
      const endpoint = action.split('.').at(-1)
      const result = await runtimeRequest(`/api/product/host/capability/${endpoint}`, body)
      return safePanelReceipt(result, { fields: ['orchestration_id', 'trial_id', 'policy_id'] })
    }
    throw new Error('暂不支持这个本机能力动作')
  }

  async function nativeWorkspaceRequest(pathname, method = 'GET', body) {
    if (!['/api/web/workspace', '/api/web/export'].includes(pathname)
      || !['GET', 'PUT'].includes(method)
      || method === 'PUT' && pathname !== '/api/web/workspace'
      || method === 'PUT' && typeof body !== 'string') throw new Error('不支持这个桌面工作区操作')
    // The workspace bridge intentionally bypasses runtimeRequest because it
    // returns a raw response to the renderer, but it must still perform the
    // same product-service identity handshake as JSON capability calls.
    await ensureRuntimeIdentity()
    const url = new URL(pathname, backendOrigin)
    let response
    try {
      response = await fetchImpl(url, {
        method,
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(35_000),
        headers: {
          origin: backendOrigin,
          accept: 'application/json',
          ...(method === 'PUT' ? {
            'content-type': 'application/json',
            ...(desktopSnapshotToken ? { 'x-trace-desktop-token': desktopSnapshotToken } : {}),
          } : {}),
        },
        ...(method === 'PUT' ? { body } : {}),
      })
    } catch {
      throw new Error('Trace 本机内容暂时无法访问，请重新打开 Trace 后再试')
    }
    let text = await response.text()
    if (text.length > 8 * 1024 * 1024) throw new Error('Trace 本机内容响应过大')
    // The renderer needs the workspace contents, not implementation details such as
    // the absolute SQLite path on the host. Keep those details inside the main
    // process so they cannot accidentally surface in product copy or diagnostics.
    if (pathname === '/api/web/workspace') {
      try {
        const value = JSON.parse(text)
        if (value && typeof value === 'object' && value.storage && typeof value.storage === 'object') {
          value.storage = { kind: value.storage.kind || 'sqlite', label: 'Trace 桌面端本机空间' }
        }
        text = JSON.stringify(value)
      } catch {
        // Preserve non-JSON error responses so the renderer can show the public
        // message returned by the runtime without exposing a parser exception.
      }
    }
    return {
      status: response.status,
      body: text,
      contentType: response.headers.get('content-type') || 'application/json; charset=utf-8',
      contentDisposition: response.headers.get('content-disposition') || '',
    }
  }

  const observationFromMatter = (matter, host) => {
    const session = host?.chain?.sessions?.[matter.id]
    const workNeedsReview = Object.values(host?.worksite?.sessions || {}).some((value) => value?.result?.matterId === matter.id && value?.result?.decision === 'pending')
    return {
      id: matter.id,
      text: matter.originalText || matter.whyCare || matter.title || '未命名事项',
      status: matter.understandingVersion > 0 ? '已采用' : session?.suggestion ? '候选中' : workNeedsReview ? '需回顾' : '待确认',
      source: 'Trace 本机工作区',
      createdAt: '',
    }
  }

  async function readObservationSummary() {
    const workspace = await runtimeRequest('/api/product/workspace')
    return {
      revision: workspace.revision,
      observations: [...(workspace.host?.chain?.matters || [])].reverse().slice(0, 20).map((matter) => observationFromMatter(matter, workspace.host)),
    }
  }

  async function captureObservation(text, source) {
    const workspace = await runtimeRequest('/api/product/workspace')
    const matterId = `pet-${randomId()}`
    const saved = await runtimeRequest('/api/product/commands', {
      protocolVersion: 1,
      commandId: `pet-capture-${randomId()}`,
      expectedRevision: workspace.revision,
      operations: [{ type: 'capture.create', matterId, text: boundedText(text, '原话') }],
    })
    const matter = saved.host?.chain?.matters?.find((item) => item.id === matterId)
    if (!matter) throw new Error('这条内容还没有进入 Trace，请重试')
    return { revision: saved.revision, observation: { ...observationFromMatter(matter, saved.host), ...(source ? { source: boundedText(source, '来源', 200) } : {}) } }
  }

  async function remoteSourceContext(source, query) {
    if (source === 'none') return null
    const result = await cloudRequest(source === 'global' ? '/api/search/global' : '/api/search/zhihu', { query: query.trim().slice(0, 500), count: 3 })
    const items = Array.isArray(result.items) ? result.items.slice(0, 3) : []
    if (!items.length) return { source, items: [], prompt: '本次联网检索没有返回可用来源。' }
    const prompt = items.map((item, index) => {
      const title = String(item.title || '未命名来源').slice(0, 300)
      const author = item.author ? ` · ${String(item.author).slice(0, 120)}` : ''
      const url = item.url ? `\n原文：${String(item.url).slice(0, 1000)}` : ''
      const excerpt = String(item.excerpt || '').slice(0, 2200)
      return `[${index + 1}] ${title}${author}${url}\n摘要：${excerpt}`
    }).join('\n\n')
    return { source, items, prompt: `以下是 Trace 刚刚取得的公开来源摘要，只作为本次判断的材料；请区分原文摘要、你的推断和仍不确定之处。\n\n${prompt}` }
  }

  async function capabilityRequest(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.operation !== 'string') throw new Error('Invalid capability request')
    if (request.operation === 'capabilities') {
      const [searchResult, agentResult] = await Promise.allSettled([
        cloudRequest('/api/search/capabilities'),
        runtimeRequest('/api/agent/capabilities'),
      ])
      const connected = searchResult.status === 'fulfilled' || agentResult.status === 'fulfilled'
      const agent = agentResult.status === 'fulfilled' ? agentResult.value : { enabled: false, profiles: [], error: { message: agentResult.reason?.message || 'Agent capability unavailable' } }
      return {
        connected,
        search: searchResult.status === 'fulfilled' ? searchResult.value : { enabled: false, error: { message: searchResult.reason?.message || 'Search capability unavailable' } },
        agent: { ...agent, codexProfile: resolveCodexProfile(agent, { selectedProfileId }) },
        project: projectBindingPublic(),
        ...(connected ? {} : { error: { message: 'Trace Runtime is not reachable' } }),
      }
    }
    if (request.operation === 'workspace.request') return nativeWorkspaceRequest(request.pathname, request.method || 'GET', request.body)
    if (request.operation === 'product.command') {
      if (request.protocolVersion !== 1 || !Array.isArray(request.operations) || request.operations.length < 1 || request.operations.length > 256) throw new Error('产品命令不完整')
      const commandId = requireId(request.commandId, '产品命令')
      if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) throw new Error('产品命令需要当前工作区版本')
      // Keep the desktop bridge as a thin, authenticated transport. Product
      // Workspace remains the authority for operation schemas, CAS and
      // idempotency; the renderer never sends a whole host snapshot here.
      return runtimeRequest('/api/product/commands', {
        protocolVersion: 1,
        commandId,
        expectedRevision: request.expectedRevision,
        operations: request.operations,
      })
    }
    if (request.operation === 'workspace.summary') return readObservationSummary()
    if (request.operation === 'workspace.capture') return captureObservation(request.text, request.source)
    if (request.operation === 'host.panel.read') return readRuntimePanel()
    if (request.operation === 'host.panel.action') return runtimePanelAction(request)
    if (request.operation === 'setup.status') {
      const capabilities = await runtimeRequest('/api/agent/capabilities')
      const codexResolution = resolveCodexProfile(capabilities, { selectedProfileId })
      const binding = refreshProjectBinding()
      return {
        runtime: { connected: true, bundled: process.env.TRACE_BUNDLED_RUNTIME === '1' },
        project: { ...publicProjectBinding(binding), connected: binding.status === PROJECT_BINDING_STATES.CONFIRMED, name: binding.projectName || '当前项目', error: binding.diagnostic || null },
        codex: { available: codexResolution.candidates.length > 0, checked: false, profileId: codexResolution.profile?.profileId || null, label: codexResolution.profile?.label || 'Codex', profileStatus: codexResolution.status, profileReason: codexResolution.reason, candidates: codexResolution.candidates.map(profile => ({ profileId: profile.profileId, label: profile.label || profile.profileId })) },
      }
    }
    if (request.operation === 'setup.codex.profile.select') {
      const capabilities = await runtimeRequest('/api/agent/capabilities')
      const requestedProfileId = requireId(request.profileId, 'Codex profile')
      const resolution = resolveCodexProfile(capabilities, { requestedProfileId })
      if (!resolution.profile) throw new Error(resolution.reason === 'multiple-codex-profiles-no-default' ? '本机有多个 Codex profile，请先明确选择一个执行器' : '所选 Codex profile 不可用')
      selectedProfileId = resolution.profile.profileId
      try { onProfileSelected?.(selectedProfileId) } catch { /* persistence is best effort */ }
      return { selected: true, profileId: selectedProfileId, label: resolution.profile.label || selectedProfileId, profileStatus: 'resolved', reason: 'persisted-selection' }
    }
    if (request.operation === 'work.project.confirm') return confirmProjectBinding()
    if (request.operation === 'setup.codex.check') {
      const capabilities = await runtimeRequest('/api/agent/capabilities')
      const requestedProfileId = request.profileId === undefined ? undefined : requireId(request.profileId, 'Codex profile')
      const resolution = resolveCodexProfile(capabilities, { requestedProfileId, selectedProfileId })
      if (!resolution.profile) throw new Error(resolution.reason === 'multiple-codex-profiles-no-default' ? '本机有多个 Codex profile，请先在设置中明确选择一个执行器' : '这台设备还没有可用的 Codex 执行器')
      selectedProfileId = resolution.profile.profileId
      try { onProfileSelected?.(selectedProfileId) } catch { /* persistence is best effort */ }
      const checked = await runtimeRequest('/api/agent/check', { profileId: resolution.profile.profileId }, 45_000)
      return { ready: checked.authenticated === true, authenticated: checked.authenticated === true, version: checked.version || null, label: resolution.profile.label || 'Codex', profileId: resolution.profile.profileId, profileStatus: 'resolved', resolutionReason: resolution.reason }
    }
    if (request.operation === 'setup.codex.connect') {
      // Installing the Codex bridge mutates the host configuration and is a
      // capability entrypoint even though it does not use runtimeRequest.
      // Refuse to modify Codex while the loopback port is unverified or has
      // been reused by another Trace installation.
      await ensureRuntimeIdentity()
      const runtimeRoot = process.env.TRACE_RUNTIME_ROOT
      const installer = runtimeRoot && path.join(runtimeRoot, 'native', 'install-codex-plugin.mjs')
      if (!installer || !path.isAbsolute(installer) || !fs.existsSync(installer)) throw new Error('当前安装没有找到 Codex 连接组件')
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [installer, '--confirm', 'true', '--replace'], {
          windowsHide: true,
          shell: false,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let bytes = 0
        const drain = chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) child.kill() }
        child.stdout.on('data', drain); child.stderr.on('data', drain)
        const timer = setTimeout(() => child.kill(), 90_000)
        child.once('error', () => { clearTimeout(timer); reject(new Error('无法启动 Codex 连接程序')) })
        child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Codex 插件连接没有完成；请先确认 Codex 已安装并登录')) })
      })
      return { connected: true, message: 'Trace 已连接到 Codex；请新开一个 Codex 任务加载插件。' }
    }
    if (request.operation === 'search') {
      if (!['zhihu', 'global'].includes(request.source) || typeof request.query !== 'string' || !request.query.trim() || request.query.length > 500 || !Number.isInteger(request.count) || request.count < 1 || request.count > 5) throw new Error('Invalid bounded search request')
      return cloudRequest(request.source === 'global' ? '/api/search/global' : '/api/search/zhihu', { query: request.query.trim(), count: request.count })
    }
    if (request.operation === 'zhihu.status') return cloudRequest('/api/zhihu/status')
    if (request.operation === 'zhihu.oauth.start') return cloudRequest('/api/zhihu/oauth/start', {})
    if (request.operation === 'zhihu.oauth.check') return cloudRequest('/api/zhihu/oauth/check', {})
    if (request.operation === 'zhihu.oauth.disconnect') return cloudRequest('/api/zhihu/oauth/disconnect', {})
    if (request.operation === 'zhihu.user.read') {
      if (!['contents', 'favorites', 'favorite_lists', 'favorite_items', 'followees'].includes(request.kind)) throw new Error('Invalid bounded Zhihu user request')
      const limit = request.limit === undefined ? 3 : request.limit
      const offset = request.offset === undefined ? '0' : request.offset
      if (!Number.isInteger(limit) || limit < 1 || limit > 10 || typeof offset !== 'string' || !/^\d{1,18}$/.test(offset)) throw new Error('Invalid bounded Zhihu user request')
      const body = { kind: request.kind, limit, offset }
      if (request.kind === 'favorite_items') {
        if (typeof request.favorite_id !== 'string' || !/^[a-zA-Z0-9._:-]{1,200}$/.test(request.favorite_id)) throw new Error('请先选择一个知乎收藏夹')
        body.favorite_id = request.favorite_id
      }
      return cloudRequest('/api/zhihu/user/read', body)
    }
    if (request.operation === 'agent.run.start') {
      if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 16_000 || !['none', 'zhihu', 'global'].includes(request.source)) throw new Error('Invalid bounded Agent request')
      const capabilities = await runtimeRequest('/api/agent/capabilities')
      if (!capabilities.enabled) throw new Error('Trace Agent Runtime is not enabled')
      const requested = request.profileId === undefined ? undefined : requireId(request.profileId, 'Agent profile')
      const selected = resolveAgentProfile(capabilities, { requestedProfileId: requested, selectedProfileId })
      const profileId = selected.profile?.profileId || null
      if (!profileId) throw new Error(selected.reason === 'multiple-agent-profiles-no-default' ? '本机有多个 Agent profile，请先明确选择一个执行器' : '所选 Agent profile 不可用')
      const current = await runtimeRequest('/api/product/workspace')
      const matterId = `pet-${randomId()}`
      const created = await runtimeRequest('/api/product/commands', { protocolVersion: 1, commandId: `pet-command-${randomId()}`, expectedRevision: current.revision, operations: [{ type: 'capture.create', matterId, text: request.text.trim() }] })
      const session = created.host?.chain?.sessions?.[matterId]
      if (!session) throw new Error('Trace Runtime did not return the captured matter')
      const sources = await remoteSourceContext(request.source, request.text)
      const submitted = await runtimeRequest('/api/agent/runs', { protocolVersion: 1, requestId: `pet-run-${randomId()}`, expectedRevision: created.revision, matterId, contextMode: session.contextMode, contextEpoch: session.contextEpoch, purpose: 'discuss', input: `请帮助我分清这段原话里的条件、证据与仍不确定之处。结果只作为候选。${sources ? `\n\n${sources.prompt}` : ''}`, ...(profileId ? { profileId } : {}) })
      const adapterExecutionId = submitted.run?.runId ? requireId(submitted.run.runId, 'Agent 运行') : ''
      if (!adapterExecutionId) throw new Error('Trace Runtime did not return a valid run identity')
      const execution = safeExecutionIdentity({ adapterExecutionId, hostSessionId: hostSessionId(request), codexThreadId: selected.profile.kind === 'codex' ? submitted.run.runtime?.threadId || submitted.run.threadId : undefined, source: 'desktop-agent-adapter' })
      return { ...submitted.run, execution, ...(sources ? { sources: { source: sources.source, items: sources.items } } : {}) }
    }
    if (request.operation === 'agent.run.read') {
      const runId = requireId(request.runId, 'Agent 运行')
      return runtimeRequest(`/api/agent/runs/${encodeURIComponent(runId)}`, undefined, 10_000)
    }
    if (request.operation === 'agent.run.events') return runtimeEventStream(request.runId, request.after === undefined ? 0 : request.after)
    if (request.operation === 'agent.run.cancel') {
      const runId = requireId(request.runId, 'Agent 运行')
      return runtimeRequest(`/api/agent/runs/${encodeURIComponent(runId)}/cancel`, {})
    }
    if (request.operation === 'agent.run.adoption') {
      const runId = requireId(request.runId, 'Agent 运行')
      const action = ['accept', 'dismiss', 'undo'].includes(request.action) ? request.action : null
      if (!action) throw new Error('Agent 结果动作不正确')
      if (action === 'dismiss') return runtimeRequest(`/api/agent/runs/${encodeURIComponent(runId)}/adoption`, { action })
      if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) throw new Error('Agent 结果需要当前工作区版本')
      return runtimeRequest(`/api/agent/runs/${encodeURIComponent(runId)}/adoption`, { action, commandId: `desktop-agent-${action}-${randomId()}`, expectedRevision: request.expectedRevision })
    }
    if (request.operation === 'agent.run') {
      if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 16_000 || !['none', 'zhihu', 'global'].includes(request.source)) throw new Error('Invalid bounded Agent request')
      const capabilities = await runtimeRequest('/api/agent/capabilities')
      if (!capabilities.enabled) throw new Error('Trace Agent Runtime is not enabled')
      const requested = request.profileId === undefined ? undefined : requireId(request.profileId, 'Agent profile')
      const selected = resolveAgentProfile(capabilities, { requestedProfileId: requested, selectedProfileId })
      const profileId = selected.profile?.profileId || null
      if (!profileId) throw new Error(selected.reason === 'multiple-agent-profiles-no-default' ? '本机有多个 Agent profile，请先明确选择一个执行器' : '所选 Agent profile 不可用')
      const current = await runtimeRequest('/api/product/workspace')
      const matterId = `pet-${randomId()}`
      const created = await runtimeRequest('/api/product/commands', {
        protocolVersion: 1,
        commandId: `pet-command-${randomId()}`,
        expectedRevision: current.revision,
        operations: [{ type: 'capture.create', matterId, text: request.text.trim() }],
      })
      const session = created.host?.chain?.sessions?.[matterId]
      if (!session) throw new Error('Trace Runtime did not return the captured matter')
      const sources = await remoteSourceContext(request.source, request.text)
      const submitted = await runtimeRequest('/api/agent/runs', {
        protocolVersion: 1,
        requestId: `pet-run-${randomId()}`,
        expectedRevision: created.revision,
        matterId,
        contextMode: session.contextMode,
        contextEpoch: session.contextEpoch,
        purpose: 'discuss',
        input: `请帮助我分清这段原话里的条件、证据与仍不确定之处。结果只作为候选。${sources ? `\n\n${sources.prompt}` : ''}`,
        ...(profileId ? { profileId } : {}),
      })
      const runId = submitted.run?.runId ? requireId(submitted.run.runId, 'Agent 运行') : ''
      if (!runId) throw new Error('Trace Runtime did not return a valid run identity')
      const deadline = now() + 190_000
      let run = submitted.run
      while (!TERMINAL_AGENT_STATES.has(run.status)) {
        if (now() >= deadline) throw new Error('Timed out while waiting for the Trace Agent run')
        await wait(500)
        run = await runtimeRequest(`/api/agent/runs/${encodeURIComponent(runId)}`, undefined, 10_000)
      }
      const execution = safeExecutionIdentity({ adapterExecutionId: runId, hostSessionId: hostSessionId(request), codexThreadId: selected.profile.kind === 'codex' ? run.runtime?.threadId || run.threadId : undefined, source: 'desktop-agent-adapter' })
      return { ...run, execution, ...(sources ? { sources: { source: sources.source, items: sources.items } } : {}) }
    }
    if (request.operation === 'work.environment') {
      const binding = refreshProjectBinding()
      return {
        connected: binding.status === PROJECT_BINDING_STATES.CONFIRMED,
        projectName: binding.projectName || '当前项目',
        agentLabel: 'Codex',
        locationLabel: binding.status === PROJECT_BINDING_STATES.CONFIRMED ? '已确认项目' : binding.status === PROJECT_BINDING_STATES.CONFLICT_OR_DRIFT ? '项目发生漂移' : binding.status === PROJECT_BINDING_STATES.CANDIDATE ? '候选项目，等待确认' : '等待识别',
        projectBinding: publicProjectBinding(binding),
        ...(binding.diagnostic ? { error: binding.diagnostic } : {}),
      }
    }
    if (request.operation === 'work.read') {
      const workId = boundedText(request.workId, '工作', 512)
      // Reading a native work can feed its result back into the browser
      // workspace (see returnToNativeWork), so it is project-bound even though
      // it does not itself execute Codex.  Do not import a result while the
      // selected project is only a candidate or has drifted.
      const project = requireConfirmedProject()
      const workspace = await runtimeRequest('/api/product/workspace')
      const existingWork = workspace.host?.worksite?.works?.[workId]
      const existingSession = workspace.host?.worksite?.sessions?.[workId]
      if (existingWork && existingSession) {
        if (typeof existingWork.agent !== 'string' || existingWork.agent.trim().toLocaleLowerCase() !== 'codex') throw new Error('这项工作不是 Codex 工作，未读取外部结果')
        const expectedIdentity = project.identity
        verifyStoredProjectIdentity(existingWork.connection, expectedIdentity, '这项工作')
        verifyStoredProjectIdentity(existingSession.codexDelivery, expectedIdentity, 'Codex 带入回执')
        const storedPath = existingWork.connection?.projectDir ?? existingWork.connection?.project_dir
          ?? existingSession.codexDelivery?.projectDir ?? existingSession.codexDelivery?.project_dir
        if (storedPath !== undefined && storedPath !== null && typeof storedPath !== 'string') throw new Error('这项工作返回了不可验证的项目身份，已停止旧项目操作')
        if (storedPath && (!path.isAbsolute(storedPath) || canonicalPathKey(storedPath) !== canonicalPathKey(project.projectDir))) throw new Error('这项工作已经绑定另一个仓库或 worktree，已停止旧项目操作')
        const remembered = rememberedWorkBinding(workId)
        if (remembered && !projectIdentityMatchesEvidence(remembered, expectedIdentity)) throw new Error('这项工作已经绑定另一个项目，已停止旧项目操作')
        if (!remembered && !storedPath && typeof existingWork.agent === 'string' && existingWork.agent.trim().toLocaleLowerCase() === 'codex') throw new Error('这项历史工作没有可验证的项目身份，未使用 basename 猜测')
      }
      ensureBindingUnchanged(project.identity)
      const visible = safeWorkResult(workspace, workId)
      const execution = executionBindings.get(workId) || { workId, hostSessionId: `${DESKTOP_HOST_SESSION}:${workId}` }
      return visible ? { ...visible, projectBinding: projectBindingPublic(), execution: safeExecutionIdentity(execution) } : null
    }
    if (request.operation === 'work.run') {
      const workId = boundedText(request.workId, '工作', 512)
      const matterId = boundedText(request.matterId, '事项', 512)
      const title = boundedText(request.title, '任务', 1_000)
      const text = boundedText(request.text, '带入内容')
      const note = typeof request.note === 'string' && request.note.length <= 16_000 ? request.note.trim() : ''
      const role = ['reference', 'trial'].includes(request.role) ? request.role : 'reference'
      const source = ['none', 'zhihu', 'global'].includes(request.source) ? request.source : 'none'
      const sessionId = `trace-desktop:${workId}`
      const project = requireConfirmedProject()
      const projectIdentityAtStart = project.identity
      const { projectDir, projectName } = project
      const adapterRequestId = `desktop-work-run:${workId}`

      let workspace = await runtimeRequest('/api/product/workspace')
      ensureBindingUnchanged(projectIdentityAtStart)
      const existingWork = workspace.host?.worksite?.works?.[workId]
      const existingMatter = workspace.host?.chain?.matters?.find((item) => item.id === matterId)
      if (existingMatter && existingMatter.originalText !== text) throw new Error('同一事项已经保存了不同的原话，未覆盖')
      if (!existingWork) {
        const operations = []
        if (!existingMatter) operations.push({ type: 'capture.create', matterId, text })
        operations.push({
          type: 'handoff.create', matterId, workId,
          destination: { agent: 'Codex', project: projectName, task: title },
          role, note, selectedText: text,
        })
        workspace = await runtimeRequest('/api/product/commands', {
          protocolVersion: 1,
          commandId: `desktop-work-create:${workId}`,
          expectedRevision: workspace.revision,
          operations,
        })
        rememberWorkBinding(workId, projectIdentityAtStart)
      } else if (existingWork.agent !== 'Codex') {
        throw new Error('这项工作不是 Codex 工作，未重新绑定')
      } else {
        const remembered = rememberedWorkBinding(workId)
        const storedPath = existingWork.connection?.projectDir ?? existingWork.connection?.project_dir
          ?? workspace.host?.worksite?.sessions?.[workId]?.codexDelivery?.projectDir
          ?? workspace.host?.worksite?.sessions?.[workId]?.codexDelivery?.project_dir
        verifyStoredProjectIdentity(existingWork.connection, projectIdentityAtStart, '这项工作')
        verifyStoredProjectIdentity(workspace.host?.worksite?.sessions?.[workId]?.codexDelivery, projectIdentityAtStart, 'Codex 带入回执')
        if (remembered && !projectIdentityMatchesEvidence(remembered, projectIdentityAtStart)) throw new Error('这项工作已经绑定另一个项目，已停止旧项目操作；请重新创建工作')
        if (storedPath !== undefined && storedPath !== null && typeof storedPath !== 'string') throw new Error('这项工作返回了不可验证的项目身份，已停止旧项目操作')
        if (storedPath && (!path.isAbsolute(storedPath) || canonicalPathKey(storedPath) !== canonicalPathKey(projectDir))) throw new Error('这项工作已经绑定另一个仓库或 worktree，已停止旧项目操作；请重新选择项目')
        if (!remembered && !storedPath) throw new Error('这项历史工作没有可验证的项目身份，未使用 basename 猜测；请在当前项目重新创建工作')
        if (!remembered) rememberWorkBinding(workId, projectIdentityAtStart)
      }

      let visible = safeWorkResult(workspace, workId)
      if (visible?.status === 'returned_for_review' && visible.result) {
        ensureBindingUnchanged(projectIdentityAtStart)
        const execution = executionBindings.get(workId) || { workId, hostSessionId: sessionId }
        return { ...visible, projectBinding: projectBindingPublic(), execution: safeExecutionIdentity(execution) }
      }

      let delivery = workspace.host?.worksite?.sessions?.[workId]?.codexDelivery
      if (delivery !== undefined && delivery !== null && (typeof delivery !== 'object' || Array.isArray(delivery))) throw new Error('Codex 带入回执无法验证，已停止旧项目操作')
      if (!delivery) {
        ensureBindingUnchanged(projectIdentityAtStart)
        const received = await runtimeRequest('/api/product/codex/receive', {
          protocolVersion: 1,
          commandId: `desktop-work-receive:${workId}`,
          workId,
          sessionId,
          projectDir,
        })
        delivery = { ...received.receipt, snapshot: received.context }
      }
      if (!delivery || typeof delivery.deliveryId !== 'string' || !delivery.deliveryId.trim() || typeof delivery.contextHash !== 'string' || !/^[a-f0-9]{64}$/i.test(delivery.contextHash)) throw new Error('Codex 带入回执缺少可验证身份，已停止旧项目操作')
      const deliveryProjectDir = delivery.projectDir ?? delivery.project_dir
      verifyStoredProjectIdentity(delivery, projectIdentityAtStart, 'Codex 带入回执')
      if (deliveryProjectDir !== undefined && deliveryProjectDir !== null && typeof deliveryProjectDir !== 'string') throw new Error('Codex 带入回执返回了不可验证的项目身份，已停止旧项目操作')
      if (deliveryProjectDir && (!path.isAbsolute(deliveryProjectDir) || canonicalPathKey(deliveryProjectDir) !== canonicalPathKey(projectDir))) throw new Error('Codex 带入回执属于另一个仓库或 worktree，已停止旧项目操作')

      workspace = await runtimeRequest('/api/product/workspace')
      ensureBindingUnchanged(projectIdentityAtStart)
      const matterSession = workspace.host?.chain?.sessions?.[matterId]
      if (!matterSession) throw new Error('本次事项没有可交给 Codex 的上下文')
      const capabilities = await runtimeRequest('/api/agent/capabilities')
      if (!capabilities.enabled) throw new Error('本机 Agent 尚未启用')
      const requestedProfileId = request.profileId === undefined ? undefined : requireId(request.profileId, 'Codex profile')
      const profileResolution = resolveCodexProfile(capabilities, { requestedProfileId, selectedProfileId })
      const profile = profileResolution.profile
      if (!profile) throw new Error(profileResolution.reason === 'multiple-codex-profiles-no-default' ? '本机有多个 Codex profile，请先明确选择一个执行器' : '本机没有可用的 Codex 执行器')

      const sources = await remoteSourceContext(source, `${title} ${text}`)
      ensureBindingUnchanged(projectIdentityAtStart)
      const submitted = await runtimeRequest('/api/agent/runs', {
        protocolVersion: 1,
        requestId: adapterRequestId,
        expectedRevision: workspace.revision,
        matterId,
        contextMode: matterSession.contextMode,
        contextEpoch: matterSession.contextEpoch,
        purpose: 'discuss',
        profileId: profile.profileId,
        input: `完成这次工作：${title}\n\n请只返回实际得到的结果、你的解释与仍需确认的条件；不要自动修改用户的理解。${sources ? `\n\n${sources.prompt}` : ''}`,
      })
      const runId = submitted.run?.runId ? requireId(submitted.run.runId, 'Agent 运行') : ''
      if (!runId) throw new Error('Codex 没有返回有效的本次运行身份')
      const deadline = now() + 190_000
      let run = submitted.run
      while (!TERMINAL_AGENT_STATES.has(run.status)) {
        if (now() >= deadline) throw new Error('等待 Codex 返回结果超时；可以稍后重新接回')
        await wait(500)
        try { ensureBindingUnchanged(projectIdentityAtStart) } catch (error) {
          await stopRunOnBindingDrift(runId)
          throw error
        }
        run = await runtimeRequest(`/api/agent/runs/${encodeURIComponent(runId)}`, undefined, 10_000)
      }
      if (run.status !== 'succeeded' || !run.result?.answer) throw new Error(run.error?.message || `Codex 本次工作未完成（${run.status}）`)

      ensureBindingUnchanged(projectIdentityAtStart)
      const returned = await runtimeRequest('/api/product/codex/return', {
        protocolVersion: 1,
        commandId: `desktop-work-return:${workId}`,
        workId,
        sessionId,
        projectDir,
        deliveryId: delivery.deliveryId,
        contextHash: delivery.contextHash,
        result: {
          matterId,
          summary: run.result.answer.slice(0, 1_000),
          fact: run.result.answer,
          interpretation: `由 ${run.profile?.label || 'Codex'} 根据本次明确带入的内容完成。`,
          unconfirmed: Array.isArray(run.result.uncertainties) ? run.result.uncertainties.join('\n') : '',
          proposedUnderstanding: '',
          artifacts: [],
        },
      })
      workspace = await runtimeRequest('/api/product/workspace')
      ensureBindingUnchanged(projectIdentityAtStart)
      visible = safeWorkResult(workspace, workId)
      if (!visible?.result || returned.receipt?.status !== 'returned_for_review') throw new Error('Codex 结果尚未进入 Trace 复核区')
      const execution = {
        adapterExecutionId: runId,
        hostSessionId: sessionId,
        codexThreadId: profile.kind === 'codex' ? run.runtime?.threadId || run.threadId || null : null,
        workId,
      }
      rememberExecution(workId, execution)
      return { ...visible, projectBinding: projectBindingPublic(), execution: safeExecutionIdentity(execution) }
    }
    throw new Error('Unsupported capability operation')
  }

  return {
    origin: backendOrigin,
    request: capabilityRequest,
    setProjectDir,
    confirmProjectBinding,
    getProjectBinding: projectBindingPublic,
  }
}

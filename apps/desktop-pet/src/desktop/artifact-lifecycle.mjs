import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'

const MAX_ENTRIES = 10_000
const MAX_QUARANTINE_BYTES = 128 * 1024 * 1024
const QUARANTINE_DIR = '.trace-lifecycle-quarantine'
const EVALUATION_PREFIX = /^trace-project-workflow-fidelity-\d{8}(?:-|\.json$)/

function requireDirectoryRoot(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new TypeError(`${label} must be an absolute path`)
  const resolved = path.resolve(value)
  const stat = fs.lstatSync(resolved)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new TypeError(`${label} must be a real directory, not a symlink`)
  return resolved
}

function slash(value) { return value.split(path.sep).join('/') }
function idFor(scope, relativePath) { return createHash('sha256').update(`${scope}\0${relativePath}`).digest('hex').slice(0, 24) }
function isWithin(root, target) {
  const relative = path.relative(root, target)
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function databaseFamily(relativePath) {
  const normalized = slash(relativePath)
  const name = path.posix.basename(normalized)
  const base = name.replace(/\.owner$/i, '').replace(/-(?:shm|wal)$/i, '')
  if (/\.(?:sqlite|db)$/i.test(base)) return `database:${path.posix.dirname(normalized)}/${base}`
  return undefined
}

function classifyProjectEntry(relativePath, type) {
  const normalized = slash(relativePath)
  const name = path.posix.basename(normalized)
  if (type === 'symlink') return { lifecycle: 'review', category: 'symlink', reason: '符号链接不跟随；先核验目标与所有者。' }
  if (normalized === QUARANTINE_DIR || normalized.startsWith(`${QUARANTINE_DIR}/`)) {
    return { lifecycle: 'retained', category: 'lifecycle-quarantine', reason: 'Trace 可恢复隔离区；请从隔离区单独恢复或清除。' }
  }
  if (normalized === 'project.json') return { lifecycle: 'active', category: 'project-descriptor', reason: 'Trace 项目实例身份文件；保护。' }
  if (normalized === 'state' && type === 'directory') return { lifecycle: 'retained', category: 'database-state-container', reason: '项目本地状态容器；其中数据库及伴随文件不可作为普通文件清理。' }
  const groupId = databaseFamily(normalized)
  if (groupId && (type === 'file' || type === 'other')) return { lifecycle: 'retained', category: 'database-state', reason: '数据库及其 WAL/SHM/owner 属于同一受保护状态家族。', groupId }
  if (normalized === 'project-adoptions' || normalized.startsWith('project-adoptions/')) {
    return { lifecycle: 'retained', category: 'adoption-history', reason: '项目能力采用历史；保留以支持来源核验与回滚。' }
  }
  if (normalized.includes('trace-project-workflow-fidelity-') && normalized.includes('candidate-eval-project')) {
    return { lifecycle: 'review', category: 'evaluation-fixture', reason: '评估项目夹具；可能存在内部引用，先核验再处置。' }
  }
  if (EVALUATION_PREFIX.test(name)) return { lifecycle: 'review', category: 'evaluation-evidence', reason: '已识别为工作流评估证据；可能被任务引用，默认保留。' }
  return { lifecycle: 'review', category: 'unknown', reason: '用途或引用未被受管清单证明；默认保留。' }
}

function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new TypeError('A relative .trace path is required')
  const parts = value.replaceAll('\\', '/').split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new TypeError('Unsafe relative .trace path')
  const normalized = path.join(...parts)
  if (path.isAbsolute(normalized) || normalized === QUARANTINE_DIR || normalized.startsWith(`${QUARANTINE_DIR}${path.sep}`)) {
    throw new TypeError('The requested path is outside the managed .trace entries')
  }
  return normalized
}

function checkedPath(root, relativePath, { allowMissing = false, createParents = false } = {}) {
  const traceRoot = path.join(root, '.trace')
  const target = path.resolve(traceRoot, relativePath)
  if (!isWithin(traceRoot, target)) throw new Error('Path escaped the selected .trace directory')
  const parts = relativePath.split(path.sep)
  let cursor = traceRoot
  for (const [index, part] of parts.entries()) {
    cursor = path.join(cursor, part)
    try {
      const stat = fs.lstatSync(cursor)
      if (stat.isSymbolicLink()) throw new Error('符号链接不执行、不跟随；对象已保留。')
      if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('路径中的父级不是普通目录。')
    } catch (error) {
      if (error?.code !== 'ENOENT' || !allowMissing) throw error
      if (index < parts.length - 1 && createParents) fs.mkdirSync(cursor)
      else if (index < parts.length - 1) throw new Error('恢复目标的父目录不存在。')
    }
  }
  return target
}

function fileHash(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function quarantineRootFor(projectRoot, { create = false } = {}) {
  const traceRoot = path.join(projectRoot, '.trace')
  const traceStat = fs.lstatSync(traceRoot)
  if (traceStat.isSymbolicLink() || !traceStat.isDirectory()) throw new Error('.trace 不是普通目录；未执行操作。')
  const quarantineRoot = path.join(traceRoot, QUARANTINE_DIR)
  try {
    const stat = fs.lstatSync(quarantineRoot)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('隔离区路径不是普通目录；未执行操作。')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    if (!create) throw error
    fs.mkdirSync(quarantineRoot)
  }
  return quarantineRoot
}

function readManifest(itemDirectory) {
  const directoryStat = fs.lstatSync(itemDirectory)
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error('隔离记录目录无效。')
  const manifestPath = path.join(itemDirectory, 'manifest.json')
  const manifestStat = fs.lstatSync(manifestPath)
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) throw new Error('隔离记录清单无效。')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (manifest?.schema !== 'trace.artifact-quarantine@1' || typeof manifest.id !== 'string' || typeof manifest.originalPath !== 'string') {
    throw new Error('隔离记录格式不受支持。')
  }
  manifest.originalPath = safeRelative(manifest.originalPath)
  return manifest
}

function writeManifest(itemDirectory, manifest) {
  const temporary = path.join(itemDirectory, '.manifest.tmp')
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', encoding: 'utf8' })
  fs.renameSync(temporary, path.join(itemDirectory, 'manifest.json'))
}

/** Read-only inventory of one explicitly selected project's .trace tree. */
export function inspectProjectTrace(projectRoot, { projectId = 'project', maxEntries = MAX_ENTRIES, allowQuarantine = false } = {}) {
  const root = requireDirectoryRoot(projectRoot, 'projectRoot')
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_ENTRIES) throw new TypeError(`maxEntries must be an integer from 1 to ${MAX_ENTRIES}`)
  const traceRoot = path.join(root, '.trace')
  let traceStat
  try { traceStat = fs.lstatSync(traceRoot) } catch (error) {
    if (error?.code === 'ENOENT') return { scope: 'project-trace', projectState: 'missing', complete: true, entries: [], warnings: [] }
    throw error
  }
  if (traceStat.isSymbolicLink() || !traceStat.isDirectory()) return { scope: 'project-trace', projectState: 'blocked', complete: false, entries: [], warnings: ['.trace 不是普通目录；未跟随或扫描。'] }

  let projectState = 'legacy-or-uninitialized'
  try {
    const descriptor = fs.lstatSync(path.join(traceRoot, 'project.json'))
    projectState = descriptor.isFile() && !descriptor.isSymbolicLink() ? 'initialized' : 'blocked'
  } catch (error) { if (error?.code !== 'ENOENT') projectState = 'blocked' }

  const entries = []
  const warnings = []
  let complete = projectState !== 'blocked'
  const pending = [{ absolute: traceRoot, relative: '' }]
  while (pending.length) {
    const current = pending.pop()
    let children
    try { children = fs.readdirSync(current.absolute, { withFileTypes: true }) } catch (error) {
      complete = false; warnings.push(`无法读取目录 ${slash(current.relative || '.trace')}（${error.code || 'IO_ERROR'}）`); continue
    }
    children.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const child of children) {
      const relative = current.relative ? path.join(current.relative, child.name) : child.name
      if (relative === QUARANTINE_DIR || relative.startsWith(`${QUARANTINE_DIR}${path.sep}`)) continue
      if (entries.length >= maxEntries) {
        complete = false; warnings.push(`超过条目上限 ${maxEntries}；未扫描剩余路径。`); pending.length = 0; break
      }
      const absolute = path.join(current.absolute, child.name)
      let stat
      try { stat = fs.lstatSync(absolute) } catch (error) {
        complete = false; warnings.push(`无法读取条目 ${slash(relative)}（${error.code || 'IO_ERROR'}）`); continue
      }
      const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other'
      const classification = classifyProjectEntry(relative, type)
      const allowedActions = ['inspect']
      if (allowQuarantine && complete && type === 'file' && classification.lifecycle === 'review') allowedActions.push('quarantine')
      entries.push({
        id: idFor(`${projectId}:project-trace`, slash(relative)), scope: 'project-trace', path: slash(relative), type,
        bytes: stat.isFile() ? stat.size : null, lifecycle: classification.lifecycle, category: classification.category,
        reason: classification.reason, ...(classification.groupId ? { groupId: classification.groupId } : {}), allowedActions,
      })
      if (type === 'directory') pending.push({ absolute, relative })
    }
  }
  entries.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  return { scope: 'project-trace', projectState, complete, entries, warnings }
}

/** A packaged Desktop owns only the embedded Runtime, not arbitrary checkouts or user caches. */
export function inspectManagedRuntime(runtimeRoot) {
  if (typeof runtimeRoot !== 'string' || !path.isAbsolute(runtimeRoot)) throw new TypeError('runtimeRoot must be an absolute path')
  let root
  try { root = requireDirectoryRoot(runtimeRoot, 'runtimeRoot') } catch (error) {
    if (error?.code === 'ENOENT') return { scope: 'managed-runtime', state: 'unavailable', complete: true, entries: [], warnings: ['当前桌面构建没有可盘点的内置 Runtime。'] }
    throw error
  }
  let version = 'unknown'
  try {
    const manifestPath = path.join(root, 'runtime.json')
    const stat = fs.lstatSync(manifestPath)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Runtime identity is not a regular file')
    const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (typeof value.runtime_version === 'string') version = value.runtime_version
  } catch { return { scope: 'managed-runtime', state: 'unverified', complete: false, entries: [], warnings: ['Runtime 身份清单不可验证；不提供清理动作。'] } }
  return {
    scope: 'managed-runtime', state: 'embedded', activeRuntimeName: 'trace-runtime', complete: true,
    entries: [{ id: 'embedded-runtime-current', scope: 'managed-runtime', path: `Trace Runtime ${version}`, type: 'directory', bytes: null,
      lifecycle: 'active', category: 'active-runtime', reason: '当前安装正在使用的内置 Runtime；桌面更新/卸载流程拥有它，项目清理器不移动或删除。', allowedActions: ['inspect'] }],
    warnings: ['此安装只包含当前内置 Runtime，没有由 Trace Runtime 管理器登记的多版本目录；不会扫描开发 checkout、插件缓存或其他用户目录。'],
  }
}

export async function quarantineProjectEntry(projectRoot, { projectId = 'project', entryId } = {}) {
  if (typeof entryId !== 'string' || !entryId) throw new TypeError('entryId is required')
  const root = requireDirectoryRoot(projectRoot, 'projectRoot')
  const inventory = inspectProjectTrace(root, { projectId, allowQuarantine: true })
  if (!inventory.complete) throw new Error('盘点不完整；先修复或重新盘点，不执行隔离。')
  const entry = inventory.entries.find((item) => item.id === entryId)
  if (!entry || !entry.allowedActions.includes('quarantine')) throw new Error('此条目受保护或不符合隔离条件。')
  const originalPath = safeRelative(entry.path)
  const source = checkedPath(root, originalPath)
  const sourceStat = fs.lstatSync(source)
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('只有普通文件可进入隔离区。')
  if (sourceStat.size > MAX_QUARANTINE_BYTES) throw new Error(`文件超过 ${MAX_QUARANTINE_BYTES} 字节上限；未隔离。`)
  const sha256 = await fileHash(source)
  const quarantineRoot = quarantineRootFor(root, { create: true })
  const id = randomUUID()
  const itemDirectory = path.join(quarantineRoot, id)
  fs.mkdirSync(itemDirectory)
  const manifest = { schema: 'trace.artifact-quarantine@1', id, projectId, originalPath: slash(originalPath), name: path.basename(originalPath), bytes: sourceStat.size, sha256, createdAt: new Date().toISOString(), state: 'prepared' }
  writeManifest(itemDirectory, manifest)
  const payload = path.join(itemDirectory, 'payload')
  try {
    fs.renameSync(source, payload)
    if (await fileHash(payload) !== sha256) throw new Error('隔离后校验失败；尝试恢复原文件。')
    writeManifest(itemDirectory, { ...manifest, state: 'quarantined' })
  } catch (error) {
    if (fs.existsSync(payload) && !fs.existsSync(source)) fs.renameSync(payload, source)
    fs.rmSync(itemDirectory, { recursive: true, force: true })
    throw error
  }
  return { id, name: manifest.name, originalPath: manifest.originalPath, bytes: manifest.bytes, sha256, state: 'quarantined' }
}

export function listQuarantinedArtifacts(projectRoot, { projectId } = {}) {
  const root = requireDirectoryRoot(projectRoot, 'projectRoot')
  const traceRoot = path.join(root, '.trace')
  try {
    const stat = fs.lstatSync(traceRoot)
    if (stat.isSymbolicLink() || !stat.isDirectory()) return { entries: [], warnings: ['.trace 不是普通目录；未读取隔离区。'] }
  } catch (error) { if (error?.code === 'ENOENT') return { entries: [], warnings: [] }; throw error }
  const quarantineRoot = path.join(traceRoot, QUARANTINE_DIR)
  try {
    const stat = fs.lstatSync(quarantineRoot)
    if (stat.isSymbolicLink() || !stat.isDirectory()) return { entries: [], warnings: ['隔离区不是普通目录；未读取。'] }
  } catch (error) { if (error?.code === 'ENOENT') return { entries: [], warnings: [] }; throw error }
  const entries = []
  const warnings = []
  for (const child of fs.readdirSync(quarantineRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const itemDirectory = path.join(quarantineRoot, child.name)
    try {
      if (!child.isDirectory() || child.isSymbolicLink()) throw new Error('隔离记录不是普通目录')
      const manifest = readManifest(itemDirectory)
      if (projectId && manifest.projectId !== projectId) continue
      if (!['quarantined', 'prepared'].includes(manifest.state)) throw new Error('隔离记录状态无效')
      const payload = path.join(itemDirectory, 'payload')
      let available = false
      try { const stat = fs.lstatSync(payload); available = stat.isFile() && !stat.isSymbolicLink() } catch {}
      entries.push({ id: manifest.id, name: manifest.name, originalPath: slash(manifest.originalPath), bytes: manifest.bytes, createdAt: manifest.createdAt, state: manifest.state, available })
    } catch (error) { warnings.push(`${child.name}: ${error.code || '隔离记录无效'}`) }
  }
  return { entries, warnings }
}

function resolveQuarantineItem(projectRoot, id) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new TypeError('Invalid quarantine id')
  const root = requireDirectoryRoot(projectRoot, 'projectRoot')
  const quarantineRoot = quarantineRootFor(root)
  const itemDirectory = path.join(quarantineRoot, id)
  if (!isWithin(quarantineRoot, itemDirectory)) throw new Error('Invalid quarantine path')
  const manifest = readManifest(itemDirectory)
  if (manifest.id !== id || manifest.state !== 'quarantined') throw new Error('隔离记录尚未完成或身份不匹配。')
  const payload = path.join(itemDirectory, 'payload')
  const payloadStat = fs.lstatSync(payload)
  if (!payloadStat.isFile() || payloadStat.isSymbolicLink()) throw new Error('隔离内容不可用。')
  return { root, itemDirectory, payload, manifest }
}

export async function restoreQuarantinedArtifact(projectRoot, id) {
  const item = resolveQuarantineItem(projectRoot, id)
  if (await fileHash(item.payload) !== item.manifest.sha256) throw new Error('隔离内容校验失败；未恢复。')
  const destination = checkedPath(item.root, item.manifest.originalPath, { allowMissing: true, createParents: true })
  if (fs.existsSync(destination)) throw new Error('原位置已有文件；为避免覆盖，未恢复。')
  fs.renameSync(item.payload, destination)
  fs.rmSync(item.itemDirectory, { recursive: true, force: false })
  return { id, restored: true, path: slash(item.manifest.originalPath) }
}

export async function purgeQuarantinedArtifact(projectRoot, id) {
  const item = resolveQuarantineItem(projectRoot, id)
  if (await fileHash(item.payload) !== item.manifest.sha256) throw new Error('隔离内容校验失败；拒绝永久清除。')
  fs.unlinkSync(item.payload)
  fs.unlinkSync(path.join(item.itemDirectory, 'manifest.json'))
  fs.rmdirSync(item.itemDirectory)
  return { id, purged: true }
}

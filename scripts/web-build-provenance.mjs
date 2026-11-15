import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

async function filesUnder(root, relative = '') {
  const absolute = path.join(root, relative)
  const entries = await fs.readdir(absolute, { withFileTypes: true })
  const result = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const next = relative ? path.join(relative, entry.name) : entry.name
    if (entry.isDirectory()) result.push(...await filesUnder(root, next))
    else if (entry.isFile()) result.push(next)
  }
  return result
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

export async function fingerprintWebSource(webRoot) {
  const inputs = []
  for (const entry of ['index.html', 'vite.config.ts', 'src', 'public']) {
    const absolute = path.join(webRoot, entry)
    try {
      const stat = await fs.stat(absolute)
      inputs.push(...(stat.isDirectory() ? await filesUnder(webRoot, entry) : [entry]))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  if (!inputs.includes('index.html') || !inputs.some((item) => item.replaceAll(path.sep, '/').startsWith('src/'))) throw new Error('Web build source inputs are incomplete')
  const hash = createHash('sha256')
  const files = []
  for (const relative of inputs.sort((a, b) => a.localeCompare(b, 'en'))) {
    const bytes = await fs.readFile(path.join(webRoot, relative))
    hash.update(relative.replaceAll(path.sep, '/')).update('\0').update(String(bytes.byteLength)).update('\0').update(bytes).update('\0')
    files.push({ path: relative.replaceAll(path.sep, '/'), bytes: bytes.byteLength, sha256: sha256(bytes) })
  }
  return { sha256: hash.digest('hex'), files }
}

export async function createWebBuildProvenance({ webRoot, outputDir, sourceCommit = null }) {
  const source = await fingerprintWebSource(webRoot)
  const artifacts = []
  for (const relative of await filesUnder(outputDir)) {
    if (relative === 'web-build-provenance.json') continue
    const bytes = await fs.readFile(path.join(outputDir, relative))
    artifacts.push({ path: relative.replaceAll(path.sep, '/'), bytes: bytes.byteLength, sha256: sha256(bytes) })
  }
  if (!artifacts.some((item) => item.path === 'index.html')) throw new Error('Web build has no index.html')
  const provenance = {
    schema: 'trace.web-build-provenance@1',
    buildId: randomUUID(),
    builtAt: new Date().toISOString(),
    sourceCommit,
    sourceSha256: source.sha256,
    sourceFiles: source.files.length,
    artifacts,
  }
  await fs.writeFile(path.join(outputDir, 'web-build-provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`, 'utf8')
  return provenance
}

export async function verifyWebBuildDirectory({ webRoot, outputDir }) {
  const provenancePath = path.join(outputDir, 'web-build-provenance.json')
  const provenance = JSON.parse(await fs.readFile(provenancePath, 'utf8'))
  if (provenance.schema !== 'trace.web-build-provenance@1' || typeof provenance.buildId !== 'string') throw new Error('Web build provenance is invalid')
  const source = await fingerprintWebSource(webRoot)
  if (provenance.sourceSha256 !== source.sha256 || provenance.sourceFiles !== source.files.length) throw new Error('Packaged Web build was not produced from the current local Web source')
  if (!Array.isArray(provenance.artifacts) || !provenance.artifacts.some((item) => item.path === 'index.html')) throw new Error('Web build provenance has no asset inventory')
  for (const item of provenance.artifacts) {
    if (!item || typeof item.path !== 'string' || path.isAbsolute(item.path) || item.path.split(/[\\/]/).includes('..')) throw new Error('Web build provenance contains an unsafe asset path')
    const bytes = await fs.readFile(path.join(outputDir, item.path))
    if (bytes.byteLength !== item.bytes || sha256(bytes) !== item.sha256) throw new Error(`Web build artifact mismatch: ${item.path}`)
  }
  return provenance
}

export function verifyWebBuildAssets(provenance, readAsset) {
  if (typeof readAsset !== 'function' || provenance?.schema !== 'trace.web-build-provenance@1' || !Array.isArray(provenance.artifacts)) {
    throw new TypeError('Packaged Web asset verification requires a valid provenance manifest and reader')
  }
  if (!provenance.artifacts.some((item) => item.path === 'index.html')) throw new Error('Packaged Web provenance has no index.html')
  const seen = new Set()
  for (const item of provenance.artifacts) {
    if (!item || typeof item.path !== 'string' || path.isAbsolute(item.path) || item.path.split(/[\\/]/).some((part) => part === '..') || seen.has(item.path)) {
      throw new Error('Packaged Web provenance contains an unsafe or duplicate asset path')
    }
    seen.add(item.path)
    const bytes = readAsset(item.path)
    if (!bytes || bytes.byteLength !== item.bytes || sha256(bytes) !== item.sha256) throw new Error(`Packaged Web asset mismatch: ${item.path}`)
  }
  return { files: seen.size, buildId: provenance.buildId, sourceSha256: provenance.sourceSha256 }
}

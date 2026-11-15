import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// These are the native entry files that must remain available inside
// resources/app.asar.  The import graph check below follows their relative
// imports instead of relying on a hand-maintained copy list.
export const DESKTOP_RUNTIME_ENTRY_FILES = [
  'lib/desktop/main.mjs',
  'lib/desktop/preload.cjs',
  'lib/desktop/discussion-preload.cjs',
]

function normalizeVirtualPath(value) {
  const normalized = path.posix.normalize(String(value).replaceAll('\\', '/')).replace(/^\.\//, '')
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../') || normalized.startsWith('/')) {
    throw new Error(`Desktop runtime import escapes app.asar: ${value}`)
  }
  return normalized
}

function candidateImportPaths(base, specifier) {
  const normalized = normalizeVirtualPath(path.posix.join(path.posix.dirname(base), specifier))
  if (path.posix.extname(normalized)) return [normalized]
  return [
    normalized,
    `${normalized}.mjs`,
    `${normalized}.js`,
    `${normalized}.cjs`,
    `${normalized}.json`,
    `${normalized}/index.mjs`,
    `${normalized}/index.js`,
    `${normalized}/index.cjs`,
  ]
}

function relativeImports(source) {
  // The desktop main/preload files are small native modules. Removing comments
  // keeps documentation examples from becoming false import edges while the
  // literal-only matcher deliberately ignores computed dynamic imports.
  const uncommented = String(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
  const imports = []
  const matcher = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)(['"])(\.{1,2}\/[^'"\r\n]+)\1/g
  for (const match of uncommented.matchAll(matcher)) imports.push(match[2])
  return [...new Set(imports)]
}

/**
 * Verify a relative import graph against a virtual file set.
 *
 * `hasFile` and `readFile` make this usable both for the build directory and
 * for an already-created app.asar without extracting or mutating the package.
 */
export function verifyRuntimeImportGraph({ entries = DESKTOP_RUNTIME_ENTRY_FILES, hasFile, readFile }) {
  if (typeof hasFile !== 'function' || typeof readFile !== 'function') throw new TypeError('Runtime import verification requires file accessors')
  const queue = entries.map(normalizeVirtualPath)
  const visited = new Set()
  const edges = []
  while (queue.length > 0) {
    const current = queue.shift()
    if (visited.has(current)) continue
    if (!hasFile(current)) throw new Error(`Desktop runtime package is missing ${current}`)
    visited.add(current)
    const source = readFile(current)
    for (const specifier of relativeImports(source)) {
      const candidates = candidateImportPaths(current, specifier)
      const resolved = candidates.find(candidate => hasFile(candidate))
      if (!resolved) throw new Error(`${current} imports missing ${specifier}; checked ${candidates.join(', ')}`)
      edges.push({ from: current, specifier, to: resolved })
      if (!visited.has(resolved)) queue.push(resolved)
    }
  }
  return { files: [...visited], edges }
}

export function verifyRuntimeBuildDirectory(directory, entries = DESKTOP_RUNTIME_ENTRY_FILES) {
  const root = path.resolve(directory)
  const absolute = relative => path.join(root, ...normalizeVirtualPath(relative).split('/'))
  return verifyRuntimeImportGraph({
    entries,
    hasFile: relative => fs.existsSync(absolute(relative)) && fs.statSync(absolute(relative)).isFile(),
    readFile: relative => fs.readFileSync(absolute(relative), 'utf8'),
  })
}

export function verifyRuntimeAsar(appAsar, asarPaths, extractFile, entries = DESKTOP_RUNTIME_ENTRY_FILES) {
  const files = new Set([...asarPaths].map(normalizeVirtualPath))
  return verifyRuntimeImportGraph({
    entries,
    hasFile: relative => files.has(normalizeVirtualPath(relative)),
    // @electron/asar uses the host separator while traversing its header on
    // Windows, even though listPackage is normalized to slash-separated paths
    // by the caller.
    readFile: relative => extractFile(appAsar, normalizeVirtualPath(relative).replaceAll('/', path.sep)).toString('utf8'),
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2)
  const directoryFlag = args.indexOf('--directory')
  if (directoryFlag < 0 || !args[directoryFlag + 1]) throw new Error('Usage: node verify-desktop-runtime-imports.mjs --directory <desktop package root>')
  const result = verifyRuntimeBuildDirectory(args[directoryFlag + 1])
  process.stdout.write(`${JSON.stringify({ status: 'desktop-runtime-imports-verified', ...result }, null, 2)}\n`)
}

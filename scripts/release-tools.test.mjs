import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'

const require = createRequire(path.join(path.resolve(import.meta.dirname, '..'), 'apps', 'desktop-pet', 'package.json'))
const { createPackage } = require('@electron/asar')

const root = path.resolve(import.meta.dirname, '..')
const checksum = path.join(root, 'scripts', 'checksum-release.mjs')
const smoke = path.join(root, 'scripts', 'release-smoke.mjs')

test('release checksum is deterministic for a directory', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-release-checksum-'))
  try {
    fs.mkdirSync(path.join(directory, 'nested'))
    fs.writeFileSync(path.join(directory, 'z.txt'), 'z\n')
    fs.writeFileSync(path.join(directory, 'nested', 'a.txt'), 'a\n')
    const first = spawnSync(process.execPath, [checksum, '--artifact', directory], { encoding: 'utf8' })
    const second = spawnSync(process.execPath, [checksum, '--artifact', directory], { encoding: 'utf8' })
    assert.equal(first.status, 0, first.stderr)
    assert.equal(second.status, 0, second.stderr)
    const a = JSON.parse(first.stdout)
    const b = JSON.parse(second.stdout)
    assert.equal(a.sha256, b.sha256)
    assert.equal(a.file_count, 2)
    assert.deepEqual(a.files.map(file => file.path), ['nested/a.txt', 'z.txt'])
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('release smoke rejects a development identity before publishing', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-release-smoke-'))
  try {
    const traceRuntime = path.join(directory, 'resources', 'trace-runtime')
    fs.mkdirSync(traceRuntime, { recursive: true })
    fs.mkdirSync(path.join(directory, 'resources'), { recursive: true })
    fs.writeFileSync(path.join(directory, 'Trace.exe'), 'fake')
    const appSource = path.join(directory, 'app-source')
    fs.mkdirSync(path.join(appSource, 'lib', 'desktop', 'discussion'), { recursive: true })
    fs.writeFileSync(path.join(appSource, 'lib', 'desktop', 'main.mjs'), 'main')
    fs.writeFileSync(path.join(appSource, 'lib', 'desktop', 'preload.cjs'), 'preload')
    fs.writeFileSync(path.join(appSource, 'lib', 'desktop', 'discussion', 'index.html'), 'html')
    fs.writeFileSync(path.join(appSource, 'package.json'), JSON.stringify({ version: '0.2.0' }))
    await createPackage(appSource, path.join(directory, 'resources', 'app.asar'))
    const identity = { git_commit: 'a'.repeat(40), git_tree: 'b'.repeat(40), content_sha256: 'c'.repeat(64), worktree_state: 'clean', clean: true }
    const api = { runtime: ['/api/runtime/identity'], product: [], agent: [], zhihu: [], host: [] }
    const runtime = { runtime_version: '0.7.1', distribution_eligibility: 'development-dirty', source_identity: identity, api_surface: api }
    const source = { schema_version: 'trace.desktop-runtime-source@0.2.0', runtime_version: '0.7.1', distribution_eligibility: 'development-dirty', source_identity: identity }
    const runtimeText = JSON.stringify(runtime)
    const sourceText = JSON.stringify(source)
    fs.writeFileSync(path.join(traceRuntime, 'runtime.json'), runtimeText)
    fs.writeFileSync(path.join(traceRuntime, 'desktop-runtime-source.json'), sourceText)
    const entry = (name, text) => ({ path: name, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') })
    const manifest = { runtime_version: '0.7.1', distribution_eligibility: 'development-dirty', source_identity: identity, files: [entry('runtime.json', runtimeText), entry('desktop-runtime-source.json', sourceText)] }
    fs.writeFileSync(path.join(traceRuntime, 'release-manifest.json'), JSON.stringify(manifest))
    const result = spawnSync(process.execPath, [smoke, '--unpacked', directory, '--expected-version', '0.2.0'], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /asar|non-release runtime|invalid/i)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

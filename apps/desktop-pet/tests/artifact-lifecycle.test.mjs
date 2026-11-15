import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  inspectManagedRuntime,
  inspectProjectTrace,
  listQuarantinedArtifacts,
  purgeQuarantinedArtifact,
  quarantineProjectEntry,
  restoreQuarantinedArtifact,
} from '../src/desktop/artifact-lifecycle.mjs'

async function projectFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-artifact-lifecycle-'))
  fs.mkdirSync(path.join(root, '.trace'), { recursive: true })
  return root
}

test('project inventory protects the descriptor, SQLite families and adoption history while unknown JSON stays review-only', async () => {
  const root = await projectFixture()
  const trace = path.join(root, '.trace')
  fs.writeFileSync(path.join(trace, 'project.json'), '{"id":"fixture"}')
  fs.mkdirSync(path.join(trace, 'state'))
  for (const name of ['agent.sqlite', 'agent.sqlite-shm', 'agent.sqlite-wal', 'agent.sqlite.owner', 'web.sqlite']) fs.writeFileSync(path.join(trace, 'state', name), 'opaque')
  fs.mkdirSync(path.join(trace, 'project-adoptions'))
  fs.writeFileSync(path.join(trace, 'project-adoptions', 'receipt.json'), '{}')
  fs.writeFileSync(path.join(trace, 'misc.json'), '{"secret":"not read"}')

  const result = inspectProjectTrace(root, { projectId: 'test-project', allowQuarantine: true })
  const byPath = new Map(result.entries.map((entry) => [entry.path, entry]))
  assert.equal(result.projectState, 'initialized')
  assert.equal(byPath.get('project.json').lifecycle, 'active')
  assert.equal(byPath.get('state').lifecycle, 'retained')
  for (const name of ['agent.sqlite', 'agent.sqlite-shm', 'agent.sqlite-wal', 'agent.sqlite.owner', 'web.sqlite']) {
    const entry = byPath.get(`state/${name}`)
    assert.equal(entry.lifecycle, 'retained')
    assert.match(entry.groupId, /^database:/)
    assert.deepEqual(entry.allowedActions, ['inspect'])
  }
  assert.equal(byPath.get('project-adoptions/receipt.json').category, 'adoption-history')
  assert.equal(byPath.get('misc.json').lifecycle, 'review')
  assert.equal(byPath.get('misc.json').allowedActions.includes('quarantine'), true)
  assert.equal(JSON.stringify(result).includes('not read'), false)
})

test('explicit quarantine and restore is reversible, checksum-verified, and inventory hides the quarantine internals', async () => {
  const root = await projectFixture()
  const original = path.join(root, '.trace', 'old-review.json')
  fs.writeFileSync(original, '{"keep":"until user confirms purge"}\n')
  const projectId = 'project-1234567890'
  const inventory = inspectProjectTrace(root, { projectId, allowQuarantine: true })
  const entry = inventory.entries.find((item) => item.path === 'old-review.json')
  assert.ok(entry.allowedActions.includes('quarantine'))

  const quarantined = await quarantineProjectEntry(root, { projectId, entryId: entry.id })
  assert.equal(quarantined.state, 'quarantined')
  assert.equal(fs.existsSync(original), false)
  assert.match(quarantined.sha256, /^[a-f0-9]{64}$/)
  const listed = listQuarantinedArtifacts(root, { projectId })
  assert.equal(listed.entries.length, 1)
  assert.equal(listed.entries[0].originalPath, 'old-review.json')
  assert.equal(inspectProjectTrace(root).entries.some((item) => item.path.includes('lifecycle-quarantine')), false)

  const restored = await restoreQuarantinedArtifact(root, quarantined.id)
  assert.equal(restored.restored, true)
  assert.equal(fs.readFileSync(original, 'utf8'), '{"keep":"until user confirms purge"}\n')
  assert.equal(listQuarantinedArtifacts(root).entries.length, 0)
})

test('quarantine refuses protected entries, incomplete scans, directories, and conflicting restore destinations', async () => {
  const root = await projectFixture()
  const trace = path.join(root, '.trace')
  fs.writeFileSync(path.join(trace, 'project.json'), '{}')
  fs.writeFileSync(path.join(trace, 'unknown.json'), '{}')
  fs.mkdirSync(path.join(trace, 'folder'))
  const inventory = inspectProjectTrace(root, { projectId: 'project-1234567890', allowQuarantine: true })
  await assert.rejects(quarantineProjectEntry(root, { projectId: 'project-1234567890', entryId: inventory.entries.find((item) => item.path === 'project.json').id }), /protected|条件/)
  await assert.rejects(quarantineProjectEntry(root, { projectId: 'project-1234567890', entryId: inventory.entries.find((item) => item.path === 'folder').id }), /protected|条件/)

  const bounded = inspectProjectTrace(root, { projectId: 'project-1234567890', maxEntries: 1, allowQuarantine: true })
  assert.equal(bounded.complete, false)
  assert.ok(bounded.entries.every((entry) => !entry.allowedActions.includes('quarantine')))

  const file = inventory.entries.find((item) => item.path === 'unknown.json')
  const quarantined = await quarantineProjectEntry(root, { projectId: 'project-1234567890', entryId: file.id })
  fs.writeFileSync(path.join(trace, 'unknown.json'), 'new-content')
  await assert.rejects(restoreQuarantinedArtifact(root, quarantined.id), /已有文件/)
  assert.equal(fs.readFileSync(path.join(trace, 'unknown.json'), 'utf8'), 'new-content')
  assert.equal(listQuarantinedArtifacts(root).entries.length, 1)
})

test('permanent purge rechecks the quarantine checksum before irreversibly removing the file', async () => {
  const root = await projectFixture()
  fs.writeFileSync(path.join(root, '.trace', 'candidate.json'), 'one')
  const projectId = 'project-1234567890'
  const entry = inspectProjectTrace(root, { projectId, allowQuarantine: true }).entries.find((item) => item.path === 'candidate.json')
  const quarantined = await quarantineProjectEntry(root, { projectId, entryId: entry.id })
  const payload = path.join(root, '.trace', '.trace-lifecycle-quarantine', quarantined.id, 'payload')
  fs.writeFileSync(payload, 'tampered')
  await assert.rejects(purgeQuarantinedArtifact(root, quarantined.id), /校验失败/)
  fs.writeFileSync(payload, 'one')
  assert.deepEqual(await purgeQuarantinedArtifact(root, quarantined.id), { id: quarantined.id, purged: true })
  assert.equal(listQuarantinedArtifacts(root).entries.length, 0)
})

test('runtime inventory marks only the authoritative embedded Runtime as active and does not infer old versions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-runtime-inventory-'))
  fs.writeFileSync(path.join(root, 'runtime.json'), JSON.stringify({ runtime_version: '0.8.0' }))
  const result = inspectManagedRuntime(root)
  assert.equal(result.state, 'embedded')
  assert.equal(result.activeRuntimeName, 'trace-runtime')
  assert.equal(result.entries.length, 1)
  assert.equal(result.entries[0].lifecycle, 'active')
  assert.deepEqual(result.entries[0].allowedActions, ['inspect'])
  assert.match(result.warnings[0], /没有由 Trace Runtime 管理器登记的多版本目录/)
})

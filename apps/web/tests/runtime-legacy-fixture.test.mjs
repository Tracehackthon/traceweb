import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// This is an opt-in cross-package fixture because the runtime is staged from a
// clean sibling worktree during desktop release validation. It never writes to
// that worktree; all SQLite files are temporary copies.
const runtimeRoot = process.env.TRACE_RUNTIME_ROOT

test('legacy Product/Agent fixture upgrades transactionally without changing revision or host hash', { skip: !runtimeRoot }, async (t) => {
  const root = path.resolve(runtimeRoot)
  const workspaceModule = await import(pathToFileURL(path.join(root, 'packages/product/workspace/src/workspace.mjs')).href)
  const bridge = await import(pathToFileURL(path.join(root, 'packages/product/workspace/src/bridge.mjs')).href)
  const agentModule = await import(pathToFileURL(path.join(root, 'apps/agent/store.mjs')).href)
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'trace-legacy-runtime-fixture-'))
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }))

  const workspaceFile = path.join(fixtureRoot, 'web.sqlite')
  const agentFile = path.join(fixtureRoot, 'agent.sqlite')
  const workspaceId = 'workspace-legacy-fixture'
  const installationId = 'installation-legacy-fixture'
  let product = workspaceModule.createProductWorkspace({ file: workspaceFile, workspaceId, installationId, runtimeVersion: '0.8.0' })
  const saved = product.execute({
    protocolVersion: 1,
    commandId: 'legacy-fixture-seed',
    expectedRevision: 0,
    operations: [{ type: 'capture.create', matterId: 'legacy-matter', text: '保留这条旧空间内容' }],
  })
  const savedHash = JSON.stringify(saved.host)
  const savedRevision = saved.revision
  product.close()

  // Remove only the identity marker, matching a pre-identity v1 Product DB;
  // entities, snapshots, command ledger and revision remain byte-for-byte
  // owned by the fixture.
  const legacyDb = new DatabaseSync(workspaceFile)
  for (const table of [...workspaceModule.HOST_WORKFLOW_TABLES].reverse()) legacyDb.exec(`DROP TABLE IF EXISTS "${table}"`)
  legacyDb.exec('DROP TABLE trace_runtime_identity')
  const legacyTables = legacyDb.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
  assert.equal(legacyTables.length, 9, 'fixture must match the installed pre-identity nine-table Product database')
  legacyDb.close()

  product = workspaceModule.createProductWorkspace({ file: workspaceFile, runtimeVersion: '0.8.0' })
  assert.equal(product.identity.verification_state, 'legacy')
  assert.equal(product.read().revision, savedRevision)
  assert.equal(JSON.stringify(product.read().host), savedHash)
  product.close()

  // A packaged start supplies the stable desktop IDs and explicitly upgrades
  // legacy identity. The transaction must not rewrite the saved host.
  product = workspaceModule.createProductWorkspace({ file: workspaceFile, workspaceId, installationId, runtimeVersion: '0.8.0', upgradeLegacyIdentity: true })
  assert.equal(product.identity.verification_state, 'verified')
  assert.equal(product.identity.workspace_id, workspaceId)
  assert.equal(product.identity.installation_id, installationId)
  const upgraded = product.read()
  assert.equal(upgraded.revision, savedRevision)
  assert.equal(JSON.stringify(upgraded.host), savedHash)

  let agent = agentModule.createAgentStore({ file: agentFile, workspaceIdentity: product.identity, runtimeVersion: '0.8.0' })
  agent.close()
  const agentLegacyDb = new DatabaseSync(agentFile)
  agentLegacyDb.exec('DROP TABLE trace_runtime_identity')
  agentLegacyDb.close()
  agent = agentModule.createAgentStore({ file: agentFile, workspaceIdentity: product.identity, runtimeVersion: '0.8.0', upgradeLegacyIdentity: true })
  assert.equal(agent.identity.verification_state, 'verified')
  assert.equal(agent.identity.workspace_id, workspaceId)
  assert.equal(agent.identity.installation_id, installationId)
  agent.close()

  product.close()
  assert.throws(
    () => workspaceModule.createProductWorkspace({ file: workspaceFile, workspaceId: 'workspace-other', installationId, runtimeVersion: '0.8.0' }),
    (error) => error?.code === 'DATABASE_IDENTITY_MISMATCH',
  )
})

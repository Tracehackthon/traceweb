import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyWorkspaceLoadFailure,
  publicWorkspaceLoadMessage,
  WORKSPACE_LOAD_STATES,
  workspaceDataState,
  withWorkspaceTimeout,
} from '../src/react/workspace-load.mjs'

test('workspace reads have a bounded timeout and a stable public error code', async () => {
  await assert.rejects(
    withWorkspaceTimeout(new Promise(() => {}), { timeoutMs: 10 }),
    (error) => error?.code === 'WORKSPACE_READ_TIMEOUT',
  )
})

test('workspace payloads distinguish empty, ready, and inconsistent state', () => {
  assert.equal(workspaceDataState({ revision: 0, host: null }), WORKSPACE_LOAD_STATES.empty)
  assert.equal(workspaceDataState({ revision: 4, host: { chain: {} } }), WORKSPACE_LOAD_STATES.ready)
  assert.throws(
    () => workspaceDataState({ revision: 4, host: null }),
    (error) => error?.code === 'STORAGE_CORRUPT',
  )
})

test('load failures are classified without exposing runtime internals', () => {
  const timeout = { code: 'WORKSPACE_READ_TIMEOUT' }
  const corrupt = { code: 'STORAGE_CORRUPT' }
  assert.equal(classifyWorkspaceLoadFailure(timeout), WORKSPACE_LOAD_STATES.recoverableError)
  assert.equal(classifyWorkspaceLoadFailure(corrupt), WORKSPACE_LOAD_STATES.unrecoverableError)
  assert.match(publicWorkspaceLoadMessage(WORKSPACE_LOAD_STATES.recoverableError), /重新读取/)
  assert.doesNotMatch(publicWorkspaceLoadMessage(WORKSPACE_LOAD_STATES.unrecoverableError), /schema|fingerprint|recordPath|pnpm/i)
})

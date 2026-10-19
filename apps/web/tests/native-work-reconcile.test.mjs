import test from 'node:test'
import assert from 'node:assert/strict'
import { matchesAuthoritativeWorkReturn } from '../src/react/native-work-reconcile.mjs'

const fixture = () => ({
  revision: 8,
  host: { worksite: {
    works: { 'work-1': { connected: true, connection: { status: 'returned_for_review' } } },
    sessions: { 'work-1': {
      result: { matterId: 'matter-1', fact: '实际返回', externalReturnId: 'return-1' },
      codexReturns: [{ returnId: 'return-1', result: { fact: '实际返回' } }],
    } },
  } },
})

test('native work reconciliation accepts the Product owner’s exact returned result', () => {
  assert.equal(matchesAuthoritativeWorkReturn(fixture(), 'work-1', 'matter-1', { result: { fact: '实际返回' } }), true)
})

test('native work reconciliation rejects stale, unrelated, or merely agent-side success', () => {
  const expected = { result: { fact: '实际返回' } }
  assert.equal(matchesAuthoritativeWorkReturn(fixture(), 'other-work', 'matter-1', expected), false)
  assert.equal(matchesAuthoritativeWorkReturn(fixture(), 'work-1', 'other-matter', expected), false)
  assert.equal(matchesAuthoritativeWorkReturn(fixture(), 'work-1', 'matter-1', { result: { fact: 'other result' } }), false)
  const missingReceipt = fixture()
  missingReceipt.host.worksite.sessions['work-1'].result.externalReturnId = null
  assert.equal(matchesAuthoritativeWorkReturn(missingReceipt, 'work-1', 'matter-1', expected), false)
  const notConnected = fixture()
  notConnected.host.worksite.works['work-1'].connected = false
  assert.equal(matchesAuthoritativeWorkReturn(notConnected, 'work-1', 'matter-1', expected), false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { canNavigateWhileSavePending } from '../src/react/save-navigation.mjs'

test('pending saves still allow read-only navigation over previously saved content', () => {
  for (const view of ['home', 'matters', 'works', 'search', 'all']) {
    assert.equal(canNavigateWhileSavePending({ view }), true, view)
  }
})

test('pending saves still protect routes that depend on the unconfirmed mutation', () => {
  for (const view of ['chain', 'compare', 'worksite', 'discussion']) {
    assert.equal(canNavigateWhileSavePending({ view }), false, view)
  }
})

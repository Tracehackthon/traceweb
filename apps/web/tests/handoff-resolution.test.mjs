import test from 'node:test'
import assert from 'node:assert/strict'
import { existingMatterForHandoff } from '../src/react/handoff-resolution.mjs'

test('Trace desktop handoff reuses the matter already saved by the pet', () => {
  const saved = { id: 'pet-1', originalText: '我想知道第二大脑究竟是什么' }
  const duplicate = { id: 'matter-copy', originalText: saved.originalText }
  const result = existingMatterForHandoff([duplicate, saved], {
    origin: 'trace-native', observationId: 'pet-1', text: saved.originalText, source: 'Trace 本机工作区', status: '待确认',
  })
  assert.equal(result, saved)
})

test('external Harness handoffs still use their explicit provenance marker', () => {
  const saved = { id: 'matter-1', externalHandoff: { origin: 'deepseek-harness', observationId: 'external-1' } }
  assert.equal(existingMatterForHandoff([saved], {
    origin: 'deepseek-harness', observationId: 'external-1', text: '原话', source: null, status: null,
  }), saved)
})

test('unknown desktop observation does not attach to a same-text matter', () => {
  const unrelated = { id: 'matter-1', originalText: '相同文字' }
  assert.equal(existingMatterForHandoff([unrelated], {
    origin: 'trace-native', observationId: 'pet-missing', text: '相同文字', source: null, status: null,
  }), null)
})

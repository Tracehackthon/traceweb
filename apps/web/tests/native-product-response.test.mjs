import test from 'node:test'
import assert from 'node:assert/strict'
import { NATIVE_PRODUCT_RESPONSE_KIND, responseFromNativeProductCommand } from '../src/react/native-product-response.mjs'

test('native Product conflict remains an HTTP 409 for the Web save state machine', async () => {
  const response = responseFromNativeProductCommand({
    kind: NATIVE_PRODUCT_RESPONSE_KIND,
    ok: false,
    status: 409,
    error: { code: 'REVISION_CONFLICT', message: '工作区已有更新；动作尚未执行，草稿应保留。' },
  })
  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), {
    error: { code: 'REVISION_CONFLICT', message: '工作区已有更新；动作尚未执行，草稿应保留。' },
  })
})

test('successful native Product command keeps the existing response contract', async () => {
  const response = responseFromNativeProductCommand({ revision: 3, host: { schemaVersion: 1 } })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { revision: 3, host: { schemaVersion: 1 } })
})

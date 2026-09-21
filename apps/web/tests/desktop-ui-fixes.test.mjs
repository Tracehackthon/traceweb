import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const read = (file) => readFile(resolve(import.meta.dirname, '../src', file), 'utf8')

test('agent handoff has one dispatch CTA instead of an overlapping capability modal', async () => {
  const runtime = await read('react/runtime.ts')
  const chain = await read('product/chain-screen.mjs')
  assert.match(runtime, /source !== 'none' && agent === 'none'/)
  assert.match(runtime, /Agent selection already routed the user to the handoff screen/)
  assert.match(chain, /data-handoff-cta="primary"/)
  assert.match(chain, /aria-describedby="handoff-cta-note"/)
  assert.match(chain, /点击一次即可确认并交给本机 Codex/)
  assert.match(chain, /data-handoff-cta="cancel"/)
})

test('answer results never expose the revision adoption action', async () => {
  const source = await read('react-main.tsx')
  assert.match(source, /agentResult\.result\.kind === 'revision_candidate' && adoptionReady && agentResult\.result\.adoption === 'not_applied'/)
  assert.match(source, /agentResult\.result\.kind === 'answer' && agentResult\.result\.adoption === 'not_applied'/)
  assert.match(source, /const adoptionReady = agentResult\?\.status === 'succeeded' && !adoptionBlocked/)
  assert.match(source, /setAdoptionBlocked\(true\)/)
  assert.match(source, /继续讨论/)
  assert.match(source, /带回 Trace/)
})

test('stale saves expose both load-saved and keep-draft recovery actions', async () => {
  const runtime = await read('react/runtime.ts')
  const shell = await read('react-main.tsx')
  assert.match(runtime, /response\.status === 409.*this\.recoveryDraft/s)
  assert.match(shell, /canLoadSaved/)
  assert.match(shell, /载入已保存版本/)
  assert.match(shell, /保留草稿并导出/)
  assert.match(shell, /recovery \? '保留草稿并导出'/)
})

test('a ready Codex identity takes precedence over stale qualification progress', async () => {
  const source = await read('react-main.tsx')
  assert.match(source, /const codexAlreadyReady = setup\?\.codex\?\.ready === true/)
  assert.match(source, /if \(codexAlreadyReady\) \{[\s\S]*status: 'completed'/)
  assert.match(source, /const qualificationRunning = !codexReady && qualification\?\.status === 'running'/)
})

test('compact pet panel is bounded and scrollable at a small viewport', async () => {
  const css = await read('../../desktop-pet/src/client/style.css')
  assert.match(css, /\.trace-panel\s*\{[\s\S]*box-sizing:\s*border-box/)
  assert.match(css, /\.trace-panel-compact\s*\{[\s\S]*max-height:\s*min\(344px, calc\(100vh - 32px\)\)[\s\S]*overflow-y:\s*auto/)
})

import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'

const webRoot = resolve(import.meta.dirname, '..')

function contentType(file) {
  if (file.endsWith('.mjs') || file.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (file.endsWith('.css')) return 'text/css; charset=utf-8'
  return 'text/html; charset=utf-8'
}

test('headless handoff click reaches one dispatch action without a competing modal', async () => {
  const harness = `<!doctype html><html><head><link rel="stylesheet" href="/src/product/chain.css"><style>html,body,#root{margin:0;width:100%;height:100%;min-height:100%;}body{overflow:auto;}</style></head><body><main id="root"></main><script type="module">
    import { mountChainScreen } from '/src/product/chain-screen.mjs';
    const actions = [];
    window.handoffActions = actions;
    mountChainScreen({
      root: document.querySelector('#root'),
      view: {
        screen: 'handoff', selectedId: 'matter-1', nativeConnected: true,
        matter: { id: 'matter-1', title: '核对一次接续', understanding: '先保留可复核的依据。', understandingDraft: '先保留可复核的依据。', stop: '还没有分清条件。' },
        incoming: { text: '' }, composer: { text: '' }, focus: null,
        handoff: { destination: { agent: 'Codex', project: 'fixture', task: '核对条件并给出结果' }, selectedText: '先保留可复核的依据。', role: 'reference', note: '' },
        current: {}, availableSources: [], isDemo: false,
      },
      onAction: action => actions.push(action),
      assets: {}, services: {},
    });
  </script></body></html>`
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
    if (pathname === '/handoff.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(harness)
      return
    }
    const relative = pathname.replace(/^\/+/, '')
    const file = resolve(webRoot, relative)
    if (file !== webRoot && !file.startsWith(webRoot + '\\') && !file.startsWith(`${webRoot}/`)) {
      response.writeHead(404); response.end(); return
    }
    try {
      const body = await readFile(file)
      response.writeHead(200, { 'content-type': contentType(file) })
      response.end(body)
    } catch {
      response.writeHead(404); response.end()
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
    await page.goto(`http://127.0.0.1:${port}/handoff.html`)
    const primary = page.locator('[data-handoff-cta="primary"]')
    assert.equal(await primary.count(), 1)
    assert.equal(await primary.innerText(), '交给 Codex')
    assert.equal(await page.locator('[data-handoff-cta="cancel"]').count(), 1)
    assert.equal(await page.locator('.chain-modal-backdrop').count(), 0)
    await primary.click()
    await page.waitForFunction(() => window.handoffActions?.some(action => action.type === 'CONFIRM_HANDOFF'))
    assert.deepEqual(await page.evaluate(() => window.handoffActions), [{ type: 'CONFIRM_HANDOFF' }])
  } finally {
    await browser?.close()
    await new Promise(resolveClose => server.close(resolveClose))
  }
})

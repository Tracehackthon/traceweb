import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'
import { routeDocumentTitle } from '../src/react/presentation-copy.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(path.join(root, 'src/product/project-lifecycle.mjs'), 'utf8')
const browserInventory = source.slice(source.indexOf('async function inventoryBrowserProject'), source.indexOf('const lifecycleLabels'))
const browserAdd = source.slice(source.indexOf('async function browserAddProject'), source.indexOf('async function browserSetActive'))

test('project lifecycle route has a product title', () => {
  assert.equal(routeDocumentTitle('projects'), 'Trace · 项目与文件生命周期')
})

test('browser project lifecycle only requests read permission and cannot mutate project files', () => {
  assert.match(browserAdd, /showDirectoryPicker\(\{ mode: 'read' \}\)/)
  assert.match(browserAdd, /queryPermission\(\{ mode: 'read' \}\)/)
  assert.match(browserAdd, /requestPermission\(\{ mode: 'read' \}\)/)
  assert.doesNotMatch(browserAdd, /mode:\s*'readwrite'|createWritable|removeEntry|\.move\(/)
  assert.match(browserInventory, /allowedActions: \['inspect'\]/)
  assert.doesNotMatch(browserInventory, /createWritable|removeEntry|\.move\(/)
  assert.match(source, /entry\.allowedActions\?\.includes\('quarantine'\).*&& native\(\)/)
  assert.match(source, /if \(!invoke\) throw new Error\('当前环境不支持桌面文件操作。'\)/)
})

test('project lifecycle is connected to the shared Web route and profile entry', async () => {
  const reactMain = await readFile(path.join(root, 'src/react-main.tsx'), 'utf8')
  const runtime = await readFile(path.join(root, 'src/react/runtime.ts'), 'utf8')
  const types = await readFile(path.join(root, 'src/react/types.ts'), 'utf8')
  assert.match(reactMain, /view === 'projects' \? import\('\.\/product\/project-lifecycle\.mjs'\)/)
  assert.match(reactMain, /view: 'projects'/)
  assert.match(runtime, /'projects'/)
  assert.match(types, /'projects'/)
})

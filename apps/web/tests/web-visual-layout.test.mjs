import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = name => fs.readFileSync(path.resolve(here, '../src', name), 'utf8')

test('matters mobile uses a readable flow instead of scaling the desktop scene', () => {
  const screen = read('matters/matters-screen.mjs')
  const css = read('matters/matters.css')
  assert.match(screen, /shell\.dataset\.narrow\s*=\s*narrow\s*\?\s*'true'/)
  assert.match(screen, /stage\.style\.transform\s*=\s*narrow\s*\?\s*'none'/)
  assert.match(css, /\.matters-shell\[data-narrow="true"\] \.matters-overview\{position:relative/)
  assert.match(css, /\.matters-shell\[data-narrow="true"\] \.matters-bubble\{position:relative!important/)
  assert.match(css, /\.matters-shell\[data-narrow="true"\] \.matters-reentry\{position:relative!important/)
  assert.match(css, /\.matters-shell\[data-narrow="true"\] \.matters-bubble-title.*-webkit-line-clamp:unset/)
})

test('compact home keeps the river draggable and discoverable', () => {
  const home = read('home.js')
  assert.match(home, /scene\.dataset\.viewport === 'compact'[\s\S]*?viewportWidth[\s\S]*?worldWidth/)
  assert.match(home, /const bubbleFloor = compact \? \.42 : \.16/)
  assert.match(home, /const nodeFloor = compact \? \.50 : \.2/)
  assert.match(home, /拖动画布，看更多事项/)
})

test('core product routes consume the shared Trace mark asset', () => {
  const chain = read('product/chain-screen.mjs')
  const compare = read('product/comparison-screen.mjs')
  const worksite = read('product/worksite-screen.mjs')
  const chainHelpers = read('product/chain-helpers.mjs')
  const worksiteIcons = read('product/worksite-icons.mjs')
  for (const source of [chain, compare, worksite]) assert.match(source, /import \{mark\} from ['"]\.\.\/home-icons\.js['"];/)
  assert.doesNotMatch(compare, /const mark\s*=\s*['"]<svg/)
  assert.doesNotMatch(chainHelpers, /export const mark\s*=/)
  assert.doesNotMatch(worksiteIcons, /export const mark\s*=/)
})

test('chain matter headings keep the full semantic title available', () => {
  const css = read('product/chain.css')
  assert.match(css, /\.chain-heading h1\{[^}]*white-space:normal[^}]*overflow:visible[^}]*text-overflow:clip/)
  assert.match(css, /\.chain-breadcrumb>span:last-child\{[^}]*white-space:normal[^}]*overflow:visible[^}]*text-overflow:clip/)
})

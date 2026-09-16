import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktop = path.join(root, 'apps', 'desktop-pet', 'lib', 'desktop')
const discussion = path.join(desktop, 'discussion')
const forbidden = [
  'video/trace-demo.mp4',
  'product/fonts/TraceSans.ttf',
  'product/fonts/TraceSerif.woff2',
  'marketing/trace-social-poster-v1.png',
  'showcase/trace-result-detail.png',
]

function bytes(directory) {
  let total = 0
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    total += entry.isDirectory() ? bytes(absolute) : fs.statSync(absolute).size
  }
  return total
}

if (!fs.existsSync(path.join(desktop, 'main.mjs')) || !fs.existsSync(path.join(discussion, 'index.html'))) {
  throw new Error('Desktop build is incomplete')
}
for (const relative of forbidden) {
  if (fs.existsSync(path.join(discussion, relative))) throw new Error(`Desktop build contains Web-only asset: ${relative}`)
}
if (fs.existsSync(path.join(desktop, 'renderer.js.map'))) throw new Error('Desktop build contains a renderer source map')

const discussionBytes = bytes(discussion)
const desktopBytes = bytes(desktop)
if (discussionBytes > 8 * 1024 * 1024) throw new Error(`Desktop discussion assets exceed 8 MiB: ${discussionBytes}`)
if (desktopBytes > 14 * 1024 * 1024) throw new Error(`Desktop application exceeds 14 MiB before packaging: ${desktopBytes}`)

console.log(JSON.stringify({
  status: 'desktop-package-audited',
  desktopMiB: Number((desktopBytes / 1024 / 1024).toFixed(2)),
  discussionMiB: Number((discussionBytes / 1024 / 1024).toFixed(2)),
}))

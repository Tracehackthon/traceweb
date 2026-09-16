import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWebStore } from './web-store.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const workspace = path.resolve(root, '../..')
const webStore = createWebStore({ file: path.resolve(process.env.TRACE_WEB_STATE_FILE || path.join(workspace, '.trace/state/web.sqlite')) })
const requestedPort = Number(process.env.TRACE_DESKTOP_PORT ?? '4173')
const port = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 4173
const distRoot = path.resolve(process.env.TRACE_WEB_DIST_DIR || path.join(root, 'dist'))

// `node server.mjs` remains a useful direct entrypoint for isolated browser
// checks. Build once when the production bundle is absent; the dev orchestrator
// opts out and uses Vite for the UI while this process only handles `/api`.
if (!process.env.TRACE_API_ONLY && !fs.existsSync(path.join(distRoot, 'index.html'))) {
  const viteBin = path.join(workspace, 'node_modules', 'vite', 'bin', 'vite.js')
  const result = spawnSync(process.execPath, [viteBin, 'build'], { cwd: root, stdio: 'inherit', env: process.env })
  if (result.status !== 0) throw new Error('Trace Web production build failed before server start')
}
const staticRoot = fs.existsSync(path.join(distRoot, 'index.html')) ? distRoot : root
const preview = process.env.TRACE_WEB_PREVIEW === '1'
const entryFile = path.join(staticRoot, 'index.html')
const manifestFile = path.join(staticRoot, '.vite', 'manifest.json')
const buildIdentity = {
  id: createHash('sha256').update(fs.readFileSync(entryFile)).update(fs.existsSync(manifestFile) ? fs.readFileSync(manifestFile) : '').digest('hex').slice(0, 10),
  builtAt: fs.statSync(entryFile).mtime.toISOString(),
}
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.mp4', 'video/mp4'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ttf', 'font/ttf'],
  ['.json', 'application/json; charset=utf-8'],
])

function resolveAsset(url = '/') {
  const pathname = decodeURIComponent(new URL(url, 'http://127.0.0.1').pathname)
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const absolute = path.resolve(staticRoot, relative)
  return absolute === staticRoot || absolute.startsWith(`${staticRoot}${path.sep}`) ? absolute : null
}

function staticHeaders(asset) {
  const stat = fs.statSync(asset)
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
  const relative = path.relative(staticRoot, asset)
  // Only Vite's content-addressed assets can safely be cached forever.  A
  // fixed URL (including `/home/*`, `/matters/*`, and `/product/*`) must be
  // revalidated: those files are intentionally replaceable without a URL
  // change during local development and evidence capture.
  const normalized = relative.split(path.sep).join('/')
  const contentHashed = /^assets\/.+[-_][A-Za-z0-9_-]{8,}\.[^/]+$/i.test(normalized)
  const immutable = staticRoot === distRoot && contentHashed
  return {
    'content-type': mimeTypes.get(path.extname(asset).toLowerCase()) ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
    etag,
    'x-content-type-options': 'nosniff',
  }
}

const server = http.createServer(async (request, response) => {
  try {
  if (preview && new URL(request.url || '/', 'http://127.0.0.1').pathname === '/api/web/build') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify(buildIdentity))
    return
  }
  if (await webStore.handle(request, response)) return
  let asset = resolveAsset(request.url)
  // Vite's history fallback is only needed for path-based deep links. Query
  // URLs already resolve to `/`; keeping this fallback also makes `/chain`
  // recoverable without adding a second HTML shell.
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
  // A public asset directory can share its name with a client route (for
  // example `/video` and `/video/trace-demo.mp4`). Directory requests still
  // belong to the SPA; only concrete files should bypass the history fallback.
  if (asset && staticRoot === distRoot && !path.extname(pathname) && (!fs.existsSync(asset) || fs.statSync(asset).isDirectory())) asset = path.join(staticRoot, 'index.html')
  const allowedAsset = asset && (staticRoot === distRoot
    ? (asset === path.join(staticRoot, 'index.html') || asset === path.join(staticRoot, 'legacy.html') || ['assets', 'public', 'home', 'matters', 'product', 'decor', 'showcase', 'brand', 'scene', 'real', 'fonts', 'video'].some((directory) => asset.startsWith(path.join(staticRoot, directory) + path.sep)))
    : (['index.html','legacy.html'].includes(path.basename(asset)) && path.dirname(asset) === root || asset.startsWith(path.join(root,'src') + path.sep) || asset.startsWith(path.join(root,'public') + path.sep)))
  if (!allowedAsset || !fs.existsSync(asset) || !fs.statSync(asset).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(request.method === 'HEAD' ? undefined : 'Not found')
    return
  }
  const headers = staticHeaders(asset)
  if (preview && asset === entryFile) {
    const badge = `<a href="/api/web/build" target="_blank" rel="noopener" aria-label="查看当前预览构建版本" style="position:fixed;left:50%;bottom:9px;transform:translateX(-50%);z-index:9999;padding:4px 10px;border:1px solid #ffffffba;border-radius:14px;background:#f5faefeb;color:#426455;font:11px/1.5 system-ui,sans-serif;text-decoration:none;box-shadow:0 2px 10px #173a2410">修复预览 · ${buildIdentity.id}</a>`
    response.writeHead(200, { ...headers, 'cache-control': 'no-store' })
    response.end(fs.readFileSync(asset, 'utf8').replace('</body>', `${badge}</body>`))
    return
  }
  if (request.headers['if-none-match'] === headers.etag) { response.writeHead(304, headers); response.end(); return }
  response.writeHead(200, headers)
  if (request.method === 'HEAD') { response.end(); return }
  fs.createReadStream(asset).pipe(response)
  } catch (error) {
    console.error(error)
    if (!response.headersSent) response.writeHead(500, {'content-type':'text/plain; charset=utf-8'})
    response.end('Unable to serve this request')
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Trace Web: http://127.0.0.1:${port}/`)
  console.log(`Local Web data: ${webStore.file}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => { webStore.close(); process.exit(0) }))
}

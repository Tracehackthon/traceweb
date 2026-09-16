import { build } from 'esbuild'
import { build as viteBuild } from 'vite'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(root, 'lib')
const desktopOutDir = resolve(outDir, 'desktop')
const discussionSourceDir = resolve(root, '../web')
const discussionPublicDir = resolve(discussionSourceDir, 'public')
const packageId = 'dsh-trace'
const desktopPublicAssets = [
  'favicon.ico',
  'site.webmanifest',
  'brand/trace-app-icon-16.png',
  'brand/trace-app-icon-32.png',
  'brand/trace-app-icon-64.png',
  'brand/trace-app-icon-192.png',
  'brand/trace-app-icon-512.png',
  'home/bird-perched.png',
  'home/bird-takeoff.png',
  'home/fonts/TraceHomeSans-fixed.woff2',
  'home/fonts/TraceHomeSerif-fixed.woff2',
  'home/licenses/OFL-noto-sans-sc.txt',
  'home/licenses/OFL-source-han-serif-cn.txt',
  'matters/fonts/TraceMattersSans-fixed.woff2',
  'matters/fonts/TraceMattersSerif-fixed.woff2',
  'matters/licenses/OFL-noto-sans-sc.txt',
  'matters/licenses/OFL-source-han-serif-cn.txt',
  'decor/trace-orbit.svg',
  'decor/trace-pebbles.svg',
  'decor/trace-sprig.svg',
]

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  outfile: resolve(outDir, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  legalComments: 'none',
})

const clientResult = await build({
  absWorkingDir: root,
  entryPoints: ['src/client/apply.tsx'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  external: ['react', 'react/*', '@deepseek-ai/*'],
  loader: { '.css': 'text', '.png': 'dataurl' },
  sourcemap: 'inline',
  write: false,
  legalComments: 'none',
})

const compiled = clientResult.outputFiles.find((file) => file.text.includes('module.exports')) ?? clientResult.outputFiles[0]
if (!compiled) throw new Error('client build did not produce JavaScript output')

const indent = compiled.text
  .split('\n')
  .map((line) => `\t\t${line}`)
  .join('\n')

const clientBundle = `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(packageId)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n${indent}\n\t\treturn module.exports;\n\t}\n});\n`

await writeFile(resolve(outDir, 'client.js'), clientBundle, 'utf8')

await mkdir(desktopOutDir, { recursive: true })
await build({
  absWorkingDir: root,
  entryPoints: ['src/desktop/renderer.tsx'],
  outfile: resolve(desktopOutDir, 'renderer.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome140',
  loader: { '.css': 'text', '.png': 'dataurl' },
  minify: true,
  sourcemap: false,
  legalComments: 'none',
})

await Promise.all([
  copyFile(resolve(root, 'src/desktop/index.html'), resolve(desktopOutDir, 'index.html')),
  copyFile(resolve(root, 'src/desktop/main.mjs'), resolve(desktopOutDir, 'main.mjs')),
  copyFile(resolve(root, 'src/desktop/runtime-client.mjs'), resolve(desktopOutDir, 'runtime-client.mjs')),
  copyFile(resolve(root, 'src/desktop/preload.cjs'), resolve(desktopOutDir, 'preload.cjs')),
  copyFile(resolve(root, 'src/desktop/discussion-preload.cjs'), resolve(desktopOutDir, 'discussion-preload.cjs')),
  copyFile(resolve(root, 'src/client/assets/liukanshan.png'), resolve(desktopOutDir, 'liukanshan.png')),
  copyFile(resolve(discussionSourceDir, 'public/brand/trace-app-icon-20.png'), resolve(desktopOutDir, 'trace-app-icon-20.png')),
  copyFile(resolve(discussionSourceDir, 'public/brand/trace-app-icon-32.png'), resolve(desktopOutDir, 'trace-app-icon-32.png')),
  copyFile(resolve(discussionSourceDir, 'public/brand/trace-app-icon-256.png'), resolve(desktopOutDir, 'trace-app-icon-256.png')),
])

const discussionOutDir = resolve(desktopOutDir, 'discussion')
await viteBuild({
  root: discussionSourceDir,
  configFile: resolve(discussionSourceDir, 'vite.config.ts'),
  publicDir: false,
  base: './',
  define: { 'import.meta.env.VITE_TRACE_STORAGE': JSON.stringify('native') },
  build: {
    outDir: discussionOutDir,
    emptyOutDir: true,
    manifest: false,
    rollupOptions: { input: resolve(discussionSourceDir, 'index.html') },
  },
})

await Promise.all(desktopPublicAssets.map(async (relative) => {
  const destination = resolve(discussionOutDir, relative)
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(resolve(discussionPublicDir, relative), destination)
}))

const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
console.log(`Built ${manifest.name}@${manifest.version}`)
console.log(`- ${resolve(outDir, 'index.js')}`)
console.log(`- ${resolve(outDir, 'client.js')}`)
console.log(`- ${resolve(desktopOutDir, 'main.mjs')}`)
console.log(`- ${resolve(desktopOutDir, 'renderer.js')}`)
console.log(`- ${resolve(discussionOutDir, 'index.html')}`)

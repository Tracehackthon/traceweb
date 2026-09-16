import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = path.resolve(process.env.TRACE_RUNTIME_SOURCE || path.join(webRoot, '..', 'trace-runtime'))
const output = path.join(webRoot, 'apps', 'desktop-pet', 'runtime-dist')
const packageScript = path.join(runtimeRoot, 'scripts', 'package.mjs')

if (!fs.existsSync(packageScript)) throw new Error(`Trace Runtime source was not found at ${runtimeRoot}`)
fs.rmSync(output, { recursive: true, force: true })
fs.mkdirSync(output, { recursive: true })

function run(command, args, shell = false) {
  const result = spawnSync(command, args, { cwd: runtimeRoot, stdio: 'inherit', shell, env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
}

run(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', ['pnpm', 'build'], process.platform === 'win32')
run(process.execPath, [packageScript, '--out', output])

const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: runtimeRoot, encoding: 'utf8', shell: false })
const source = { repository: 'Tracehackthon/trace_backend', revision: revision.status === 0 ? revision.stdout.trim() : 'unknown' }
fs.writeFileSync(path.join(output, 'desktop-runtime-source.json'), `${JSON.stringify(source, null, 2)}\n`, 'utf8')
console.log(`Staged Trace Runtime ${source.revision} for the desktop installer.`)

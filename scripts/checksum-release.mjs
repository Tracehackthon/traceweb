import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
function value(flag, fallback) {
  const index = args.indexOf(flag)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const artifact = path.resolve(root, value('--artifact', args.find(argument => !argument.startsWith('--')) ?? 'apps/desktop-pet/release'))
const output = value('--out')

if (!fs.existsSync(artifact)) throw new Error(`Release artifact does not exist: ${artifact}`)
const hash = content => createHash('sha256').update(content).digest('hex')

function filesIn(directory) {
  const entries = []
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Release artifact contains an unsupported symlink: ${absolute}`)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile()) entries.push(absolute)
    }
  }
  walk(directory)
  return entries
}

let manifest
if (fs.statSync(artifact).isFile()) {
  const content = fs.readFileSync(artifact)
  manifest = { kind: 'file', name: path.basename(artifact), bytes: content.length, sha256: hash(content) }
} else {
  const entries = filesIn(artifact).map(absolute => {
    const content = fs.readFileSync(absolute)
    return { path: path.relative(artifact, absolute).replaceAll(path.sep, '/'), bytes: content.length, sha256: hash(content) }
  })
  const aggregate = createHash('sha256')
  for (const entry of entries) {
    aggregate.update(entry.path)
    aggregate.update('\0')
    aggregate.update(entry.sha256)
    aggregate.update('\0')
    aggregate.update(String(entry.bytes))
    aggregate.update('\0')
  }
  manifest = { kind: 'directory', name: path.basename(artifact), file_count: entries.length, sha256: aggregate.digest('hex'), files: entries }
}
const result = { schema_version: 'trace.desktop-release-checksum@0.1.0', artifact: path.relative(root, artifact).replaceAll(path.sep, '/'), ...manifest }
const text = `${JSON.stringify(result, null, 2)}\n`
if (output) fs.writeFileSync(path.resolve(root, output), text, 'utf8')
process.stdout.write(text)

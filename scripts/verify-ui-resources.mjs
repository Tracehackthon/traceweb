// Specific provenance/notice gate for the adopted Trace UI sources.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const commit='7c106d4a195f9ce566ffbbc672fc48bed68d30bd';
const upstream=path.resolve(root,`../artifacts/trace-frontend-replacement/upstream/easyui-${commit}`);
const source=JSON.parse(fs.readFileSync(path.join(root,'vendor/ui-source-record.json'),'utf8'));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
assert.equal(source.commit,commit);
if(process.argv.includes('--research'))for(const file of source.files) assert.equal(hash(fs.readFileSync(path.join(upstream,file.path))),file.sha256,file.path);
const publicRoot=path.join(root,'apps/web/public/licenses');
assert.equal(hash(fs.readFileSync(path.join(publicRoot,'easyui-MIT.txt'))),source.licenseSha256);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
assert.equal(manifest.dependencies['radix-ui'],'1.8.1');
assert.equal(manifest.dependencies['lucide-react'],'1.65.0');
const seen=new Set(), notices=[];
const supplements=source.licenseSupplements;
function locate(name,from) {
  for(let dir=from;dir.startsWith(root);dir=path.dirname(dir)) {
    const candidate=path.join(dir,'node_modules',name);
    if(fs.existsSync(path.join(candidate,'package.json')))return candidate;
  }
  throw Error(`Missing UI dependency ${name} from ${from}`);
}
function visit(name,from=root) {
  const dir=locate(name,from);if(seen.has(dir))return;seen.add(dir);
  const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  const relative=path.relative(root,dir).replaceAll('\\','/');
  assert.equal(lock.packages[relative]?.version,pkg.version,`Locked UI identity: ${name}`);
  let license=['LICENSE','LICENSE.md','LICENSE.txt','license','license.md','License','License.txt'].map(f=>path.join(dir,f)).find(f=>fs.existsSync(f));
  if(!license) {
    const supplement=supplements.find(s=>s.package===pkg.name&&s.version===pkg.version);
    assert.ok(supplement,`No verified license supplement for ${pkg.name}`);
    license=path.join(publicRoot,`${pkg.name}-${pkg.version}.LICENSE`);
    assert.equal(hash(fs.readFileSync(license)),supplement.sha256);
  }
  assert.ok(license,`No license text found for ${pkg.name}`);
  notices.push({name:pkg.name,version:pkg.version,text:fs.readFileSync(license,'utf8').trim()});
  for(const dep of Object.keys(pkg.dependencies||{}))visit(dep,dir);
}
visit('radix-ui');visit('lucide-react');
notices.sort((a,b)=>a.name.localeCompare(b.name,'en'));
const text='Trace UI dependency notices\nGenerated from the installed, lock-verified Radix/Lucide dependency graph.\nUnused exports are not all shipped by the bundler.\n\n'+notices.map(n=>`${n.name}@${n.version}\n${'='.repeat(64)}\n${n.text}\n`).join('\n');
const target=path.join(publicRoot,'trace-ui-third-party.txt');
if(process.argv.includes('--write'))fs.writeFileSync(target,text,'utf8');
else assert.equal(fs.readFileSync(target,'utf8'),text,'UI notices stale; inspect dependency changes, then explicitly regenerate');
for(const p of ['apps/web/src/react/library-workspace.tsx','apps/web/src/react/ui/controls.tsx','apps/web/src/react/ui/evolution-panel.tsx'])assert.ok(fs.readFileSync(path.join(root,p),'utf8').includes(commit),`Missing source identity: ${p}`);
console.log(`UI provenance verified: fixed EasyUI identity and MIT notice; ${notices.length} installed dependency notices; Radix/Lucide exact versions${process.argv.includes('--research') ? `; ${source.files.length} research originals hash-matched` : ''}.`);

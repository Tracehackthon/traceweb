// Build the crash fix over the accepted 028 crash-fix snapshot, never the UI WIP tree.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.resolve(process.argv[2]||'')
if(!out.startsWith(path.join(root,'.test-results')+path.sep))throw Error('Use a new project-local output')
const baseline=path.join(root,'.test-results/desktop-companion-rebuild/crash-fix/source-01'),hash=x=>createHash('sha256').update(x).digest('hex')
const bytes=await fs.readFile(path.join(baseline,'source-receipt.json'))
if(hash(bytes)!=='de03a8a9eddefa0b6bd4c54ac29ab6d5f95d511487e56717300784df8bff71cc')throw Error('Accepted baseline identity changed')
const receipt=JSON.parse(bytes),dest=path.join(out,'traceweb');await fs.mkdir(out,{recursive:false});await fs.mkdir(dest)
for(const item of receipt.files){const source=await fs.readFile(path.join(baseline,'traceweb',item.path));if(hash(source)!==item.sha256)throw Error('Baseline input changed: '+item.path);await fs.mkdir(path.dirname(path.join(dest,item.path)),{recursive:true});await fs.writeFile(path.join(dest,item.path),source)}
const mainPath='apps/desktop-pet/src/desktop/main.mjs'
let main=(await fs.readFile(path.join(root,mainPath),'utf8')).replaceAll('\r\n','\n')
// Explicitly exclude the earlier unaccepted draft-flush WIP from this hotfix.
const flush="  flushStorage: () => {\n    for (const active of new Set(BrowserWindow.getAllWindows().filter(window => !window.isDestroyed()).map(window => window.webContents.session))) active.flushStorageData()\n  },\n"
if(main.split(flush).length!==2)throw Error('WIP exclusion no longer exact; review before freezing')
main=main.replace(flush,'');await fs.writeFile(path.join(dest,mainPath),main)
await fs.copyFile(path.join(root,'apps/desktop-pet/src/desktop/renderer.tsx'),path.join(dest,'apps/desktop-pet/src/desktop/renderer.tsx'))
for(const rel of ['apps/desktop-pet/package.json','apps/desktop-pet/package-lock.json']){const p=path.join(dest,rel),value=JSON.parse(await fs.readFile(p,'utf8'));value.version='0.2.29';if(value.packages?.[''])value.packages[''].version='0.2.29';await fs.writeFile(p,JSON.stringify(value,null,2)+'\n')}
await fs.copyFile(fileURLToPath(import.meta.url),path.join(dest,'scripts/freeze-pet-mouse-source.mjs'))
const files=[];async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else files.push({path:path.relative(dest,file).replaceAll(path.sep,'/'),sha256:hash(await fs.readFile(file))})}}await walk(dest)
await fs.writeFile(path.join(out,'source-receipt.json'),JSON.stringify({schema:'trace.desktop-source-snapshot@1',files},null,2))
await fs.writeFile(path.join(out,'baseline-overlay.json'),JSON.stringify({baseline,baselineReceiptSha256:hash(bytes),businessChanges:[mainPath,'apps/desktop-pet/src/desktop/renderer.tsx'],version:'0.2.29',excludes:['064f497 UI WIP','draft flush lifecycle WIP','new Radix/React alias','Product11/C5'],product:'0.3.0-frontend.10'},null,2))
for(const rel of ['node_modules','apps/desktop-pet/node_modules','apps/desktop-pet/runtime-dist'])await fs.symlink(path.join(baseline,'traceweb',rel),path.join(dest,rel),'junction')
console.log(JSON.stringify({source:dest,files:files.length,receiptSha256:hash(await fs.readFile(path.join(out,'source-receipt.json')))}))

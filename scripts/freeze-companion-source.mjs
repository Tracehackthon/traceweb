import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.resolve(process.argv[2]||'')
const baseline=path.resolve(process.env.TRACE_COMPANION_BASELINE||path.join(root,'.test-results/workbench-short-window-polish/source-09'))
if(!out.startsWith(path.join(root,'.test-results')+path.sep)||!baseline.startsWith(path.join(root,'.test-results')+path.sep))throw Error('Use project-local evidence paths')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),receiptBytes=await fs.readFile(path.join(baseline,'source-receipt.json')),receipt=JSON.parse(receiptBytes)
await fs.mkdir(out,{recursive:false});const dest=path.join(out,'traceweb');await fs.mkdir(dest)
for(const entry of receipt.files){const bytes=await fs.readFile(path.join(baseline,'traceweb',entry.path));if(hash(bytes)!==entry.sha256)throw Error('Baseline changed: '+entry.path);await fs.mkdir(path.dirname(path.join(dest,entry.path)),{recursive:true});await fs.writeFile(path.join(dest,entry.path),bytes)}
const overlays=['apps/desktop-pet/src/client/TraceOverlay.tsx','apps/desktop-pet/src/client/TracePanel.tsx','apps/desktop-pet/src/client/CompanionComposer.tsx','apps/desktop-pet/src/client/style.css','apps/desktop-pet/src/desktop/lifecycle.mjs','scripts/desktop-companion-e2e.cjs','scripts/freeze-companion-source.mjs']
for(const rel of overlays){await fs.mkdir(path.dirname(path.join(dest,rel)),{recursive:true});await fs.copyFile(path.join(root,rel),path.join(dest,rel))}
// Do not import another writer's in-flight main process or build inputs. Only
// the reviewed desktop flush/React identity edits are replayed over the baseline.
const mainFile=path.join(dest,'apps/desktop-pet/src/desktop/main.mjs');let main=await fs.readFile(mainFile,'utf8');main=main.replace('  listWindows: () => BrowserWindow.getAllWindows(),','  listWindows: () => BrowserWindow.getAllWindows(),\n  flushStorage: () => {\n    for (const active of new Set(BrowserWindow.getAllWindows().filter(window => !window.isDestroyed()).map(window => window.webContents.session))) active.flushStorageData()\n  },');await fs.writeFile(mainFile,main)
const buildFile=path.join(dest,'apps/desktop-pet/build.mjs');let build=await fs.readFile(buildFile,'utf8');build=build.replace("  entryPoints: ['src/desktop/renderer.tsx'],","  entryPoints: ['src/desktop/renderer.tsx'],\n  alias: { react: resolve(root, '../../node_modules/react'), 'react-dom': resolve(root, '../../node_modules/react-dom') },");await fs.writeFile(buildFile,build)
for(const rel of ['apps/desktop-pet/package.json','apps/desktop-pet/package-lock.json']){const file=path.join(dest,rel),value=JSON.parse(await fs.readFile(file,'utf8'));value.version='0.2.28';if(value.packages?.[''])value.packages[''].version='0.2.28';await fs.writeFile(file,JSON.stringify(value,null,2)+'\n')}
const files=[];async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else files.push({path:path.relative(dest,file).replaceAll(path.sep,'/'),sha256:hash(await fs.readFile(file))})}}await walk(dest)
await fs.writeFile(path.join(out,'source-receipt.json'),JSON.stringify({schema:'trace.desktop-source-snapshot@1',files},null,2))
await fs.writeFile(path.join(out,'baseline-overlay.json'),JSON.stringify({baseline,baselineReceiptSha256:hash(receiptBytes),overlays,explicitEdits:['native main DOMStorage flush','native React deduplication','desktop version 0.2.28'],policy:'No current Product11/C5 inputs; baseline is not automatically a release approval.'},null,2))
for(const rel of ['node_modules','apps/desktop-pet/node_modules','apps/desktop-pet/runtime-dist'])await fs.symlink(path.join(baseline,'traceweb',rel),path.join(dest,rel),'junction')
console.log(JSON.stringify({source:dest,files:files.length,sourceReceiptSha256:hash(await fs.readFile(path.join(out,'source-receipt.json')))}))

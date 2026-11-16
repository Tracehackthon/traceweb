// Freeze only enumerated build inputs; never copy personal profiles or secrets.
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const output=path.resolve(process.argv[2]||'')
if(!process.argv[2]||!output.startsWith(path.join(root,'.test-results')+path.sep))throw Error('Snapshot must be a new project-local evidence directory')
await fs.mkdir(output,{recursive:false})
const dest=path.join(output,'traceweb');await fs.mkdir(dest)
for(const rel of ['shared','scripts','vendor','apps/web/src','apps/web/public','apps/desktop-pet/src','apps/desktop-pet/build'])await fs.cp(path.join(root,rel),path.join(dest,rel),{recursive:true,errorOnExist:true,force:false})
for(const rel of ['package.json','package-lock.json','apps/web/package.json','apps/web/server.mjs','apps/web/web-store.mjs','apps/web/tsconfig.json','apps/web/index.html','apps/web/legacy.html','apps/web/vite.config.ts','apps/web/pdf-assets.mjs','apps/desktop-pet/package.json','apps/desktop-pet/package-lock.json','apps/desktop-pet/build.mjs','apps/desktop-pet/runtime-contract.json','apps/desktop-pet/README.md','apps/desktop-pet/cordis.patch.yml']){
  await fs.mkdir(path.dirname(path.join(dest,rel)),{recursive:true});await fs.copyFile(path.join(root,rel),path.join(dest,rel))
}
const files=[]
async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())await walk(p);else{const bytes=await fs.readFile(p);files.push({path:path.relative(dest,p).replaceAll(path.sep,'/'),sha256:createHash('sha256').update(bytes).digest('hex')})}}}
await walk(dest)
await fs.writeFile(path.join(output,'source-receipt.json'),JSON.stringify({schema:'trace.desktop-source-snapshot@1',files},null,2))
for(const rel of ['node_modules','apps/desktop-pet/node_modules','apps/desktop-pet/runtime-dist'])await fs.symlink(path.join(root,rel),path.join(dest,rel),process.platform==='win32'?'junction':'dir')
console.log(JSON.stringify({sourceRoot:dest,files:files.length,dependencyPolicy:'Installed dependencies shared; immutable Product archive/provenance and Runtime checks remain mandatory'}))

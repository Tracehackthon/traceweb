// Explicit search-context delta over a signed-off desktop baseline; never snapshot the live C5/companion tree.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),phase=path.join(root,'.test-results/workbench-search-context'),output=path.resolve(process.argv[2]||'');
if(!process.argv[2]||!output.startsWith(phase+path.sep))throw Error('Use a new output within the short-window project evidence folder.');
const baselineIdentity=path.resolve(process.argv[3]||'');
if(!baselineIdentity.startsWith(path.join(root,'.test-results')+path.sep))throw Error('Provide the explicit accepted baseline identity inside project evidence.');
const accepted=JSON.parse((await fs.readFile(baselineIdentity,'utf8')).replace(/^\uFEFF/,''));
if(!accepted.independentGate?.passed)throw Error('Baseline has not passed its independent gate.');
const version=accepted.version||accepted.desktopVersion;
if(!process.argv.includes('--development')&&Number(version?.split('.')[2])<29)throw Error('Formal release must inherit the signed-off029 mouse fix or later.');
const baseline=path.dirname(accepted.sourceReceipt),receiptFile=accepted.sourceReceipt,hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(hash(await fs.readFile(receiptFile))!==accepted.sourceReceiptSha256)throw Error('Accepted baseline receipt changed.');
if(hash(await fs.readFile(accepted.independentGate.report))!==accepted.independentGate.reportSha256)throw Error('Baseline independent gate changed.');
const receipt=JSON.parse(await fs.readFile(receiptFile,'utf8')),dest=path.join(output,'traceweb');await fs.mkdir(output,{recursive:false});await fs.mkdir(dest);
for(const entry of receipt.files){const source=path.join(baseline,'traceweb',entry.path),bytes=await fs.readFile(source);if(hash(bytes)!==entry.sha256)throw Error('Baseline file changed: '+entry.path);const file=path.join(dest,entry.path);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}
const overlays=['apps/desktop-pet/package.json','apps/desktop-pet/package-lock.json','scripts/helpers/workbench-short-window.cjs','apps/web/src/react/workbench/discussion-browser.tsx','apps/web/src/react/workbench/history-browser.css','scripts/search-context-browser-e2e.cjs','scripts/helpers/workbench-search-context.cjs','scripts/helpers/foreground-watch.cjs','scripts/helpers/hidden-native.cjs','scripts/search-context-native-e2e.cjs','scripts/freeze-search-context-source.mjs'];
const changes=[];for(const rel of overlays){let bytes;try{bytes=await fs.readFile(path.join(root,rel));}catch(e){if(e.code==='ENOENT'&&rel==='scripts/helpers/workbench-short-window.cjs')continue;throw e;}const prior=receipt.files.find(x=>x.path===rel);if(prior?.sha256===hash(bytes))continue;await fs.mkdir(path.dirname(path.join(dest,rel)),{recursive:true});await fs.writeFile(path.join(dest,rel),bytes);changes.push({path:rel,beforeSha256:prior?.sha256||null,afterSha256:hash(bytes)});}
const files=[];async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else files.push({path:path.relative(dest,file).replaceAll(path.sep,'/'),sha256:hash(await fs.readFile(file))});}}await walk(dest);
await fs.writeFile(path.join(output,'source-receipt.json'),JSON.stringify({schema:'trace.desktop-source-snapshot@1',files},null,2));
await fs.writeFile(path.join(output,'baseline-overlay.json'),JSON.stringify({baseline,baselineReceiptSha256:hash(await fs.readFile(receiptFile)),baselineVersion:version,developmentOnly:process.argv.includes('--development'),policy:'Only listed search-context UI and dedicated verification delta; inherited accepted baseline including native IPC/mouse repairs. Excludes live C5/Product11 and companion visual WIP.',changes},null,2));
// Share fixed framework tools, but isolate Product10 so another writer can consume11.
const modules=path.join(dest,'node_modules');await fs.mkdir(modules);
for(const entry of await fs.readdir(path.join(root,'node_modules'),{withFileTypes:true})){if(entry.name==='@trace')continue;const source=path.join(root,'node_modules',entry.name),target=path.join(modules,entry.name);const stat=await fs.stat(source);if(stat.isDirectory())await fs.symlink(source,target,'junction');else await fs.copyFile(source,target);}
const scope=path.join(modules,'@trace');await fs.mkdir(scope);const traceRoot=path.join(root,'node_modules/@trace');for(const entry of await fs.readdir(traceRoot,{withFileTypes:true})){if(entry.name==='product-workspace')continue;const source=path.join(traceRoot,entry.name),target=path.join(scope,entry.name);if((await fs.stat(source)).isDirectory())await fs.symlink(source,target,'junction');else await fs.copyFile(source,target);}
const manifest=JSON.parse(await fs.readFile(path.join(dest,'vendor/product-workspace-source.json'),'utf8'));if(manifest.version!=='0.3.0-frontend.10')throw Error('Unexpected Product contract; never silently consume live Product11.');const archive=path.join(dest,manifest.archive.path),product=path.join(scope,'product-workspace');if(hash(await fs.readFile(archive))!==manifest.archive.sha256)throw Error('Pinned Product archive changed.');await fs.mkdir(product);
const listing=spawnSync('tar',['-tf',archive],{encoding:'utf8',windowsHide:true});if(listing.status!==0)throw Error(listing.stderr);for(const item of listing.stdout.trim().split(/\r?\n/)){if(!item.startsWith('package/')||item.split(/[\\/]/).includes('..')||!path.resolve(product,item.slice(8)).startsWith(product+path.sep)&&item!=='package/')throw Error('Unsafe archive entry: '+item);}
const unpack=spawnSync('tar',['-xf',archive,'--strip-components=1','-C',product],{encoding:'utf8',windowsHide:true});if(unpack.status!==0)throw Error(unpack.stderr);if(JSON.parse(await fs.readFile(path.join(product,'package.json'),'utf8')).version!==manifest.version)throw Error('Isolated Product identity mismatch.');
for(const rel of ['apps/desktop-pet/node_modules','apps/desktop-pet/runtime-dist'])await fs.symlink(path.join(root,rel),path.join(dest,rel),'junction');
await fs.writeFile(path.join(output,'dependency-policy.json'),JSON.stringify({product:manifest.version,archiveSha256:manifest.archive.sha256,installedRoot:product,frameworkDependencies:'Existing fixed local packages shared by directory junction; no install or update of shared dependencies',runtime:'Existing separately verified Runtime0.8 staging; source06 contract mandatory'},null,2));
console.log(JSON.stringify({sourceRoot:dest,files:files.length,explicitChanges:changes.map(x=>x.path),product:manifest.version}));

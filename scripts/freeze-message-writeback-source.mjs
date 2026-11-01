// Development verification of the same formal application, not another UI.
// Keep historical snapshots untouched while a fixed Product12 is
// verified. A new output has its own Product package; no install or cleanup.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),phase=path.join(root,'.test-results/frontend-replacement/writeback'),output=path.resolve(process.argv[2]||'');
if(!process.argv[2]||!output.startsWith(phase+path.sep)||fs.existsSync(output))throw Error('Use a fresh source output inside writeback evidence.');
const hash=x=>createHash('sha256').update(x).digest('hex'),acceptedFile=path.join(root,'.test-results/workbench-search-context/accepted-identity.json'),accepted=JSON.parse(fs.readFileSync(acceptedFile,'utf8'));
if(accepted.version!=='0.2.30'||!accepted.independentGate?.passed||hash(fs.readFileSync(accepted.independentGate.report))!==accepted.independentGate.reportSha256)throw Error('Use the actually transferred signed-off030 baseline.');
const base=path.dirname(accepted.sourceReceipt),receipt=accepted.sourceReceipt;
if(hash(fs.readFileSync(receipt))!==accepted.sourceReceiptSha256||accepted.sourceReceiptSha256!=='019a7da8979b40027132c7084fce74a771c0bcd0853b2ea0ed52d8b72143b23c')throw Error('Transferred source identity changed.');
const dest=path.join(output,'traceweb'),files=JSON.parse(fs.readFileSync(receipt,'utf8')).files;fs.mkdirSync(dest,{recursive:true});
for(const entry of files){const bytes=fs.readFileSync(path.join(base,'traceweb',entry.path));if(hash(bytes)!==entry.sha256)throw Error('Transferred baseline bytes changed: '+entry.path);const file=path.join(dest,entry.path);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
const overlays=['apps/desktop-pet/src/desktop/runtime-client.mjs','apps/desktop-pet/src/desktop/workbench-store.mjs','apps/desktop-pet/src/desktop/workbench-agent.mjs','shared/workbench-result-items.mjs','apps/web/src/react/workbench/workbench-app.tsx','apps/web/src/react/workbench/client.ts','apps/web/src/react/workbench/pending-recovery.ts','apps/web/src/react/workbench/feedback.tsx','apps/web/src/react/workbench/feedback.css','apps/web/src/react/workbench/source-preview.tsx','apps/web/src/react/workbench/reference-scope.tsx','apps/web/src/react/workbench/reference-picker.tsx','apps/web/src/react/workbench/capability-feedback.tsx','apps/web/src/react/workbench/capability-sharing.tsx','apps/web/src/react/workbench/writeback-draft.ts','apps/web/src/react/workbench/result-adoption.tsx','apps/web/src/react/workbench/relation-review.tsx','apps/web/src/react/workbench/task-execution.tsx','apps/web/src/react/workbench/workspace-index.ts','apps/web/src/react/workbench/message-writeback.tsx','apps/web/src/react/workbench/message-writeback-record.ts','apps/web/src/product/workbench-browser.mjs','apps/web/src/product/browser-workspace.mjs','vendor/product-workspace-source.json','vendor/trace-product-workspace-0.3.0-frontend.12.tgz','scripts/workbench-e2e.cjs','scripts/helpers/workbench-message-writeback.cjs','scripts/helpers/workbench-collaboration-scope.cjs','scripts/helpers/workbench-feedback-source.cjs','scripts/helpers/workbench-feedback-lifecycle.cjs','scripts/helpers/workbench-reference-selection.cjs','scripts/helpers/workbench-search.cjs','scripts/helpers/workbench-sharing.cjs','scripts/helpers/workbench-pending-record.cjs','scripts/helpers/workbench-pending-recovery.cjs','scripts/helpers/workbench-read-write-race.cjs','scripts/helpers/workbench-writeback.cjs','scripts/helpers/workbench-writeback-retry.cjs','scripts/helpers/workbench-writeback-races.cjs','scripts/helpers/workbench-original-source.cjs','scripts/helpers/workbench-writeback-provenance.cjs','scripts/helpers/workbench-writeback-identity.cjs','scripts/freeze-message-writeback-source.mjs'];
for(const rel of overlays){const target=path.join(dest,rel);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,fs.readFileSync(path.join(root,rel)));}
// Pin only this owner's Product fields. The CLI-proven accidental desktop-pet
// file:.. prefix install is excluded; only the explicit SDK pin is inherited.
const manifest=JSON.parse(fs.readFileSync(path.join(dest,'vendor/product-workspace-source.json'),'utf8'));
for(const rel of ['package.json','package-lock.json']){
 const prior=JSON.parse(fs.readFileSync(path.join(base,'traceweb',rel),'utf8'));
 if(rel==='package.json')prior.dependencies['@trace/product-workspace']='file:'+manifest.archive.path;
 else{prior.packages[''].dependencies['@trace/product-workspace']='file:'+manifest.archive.path;prior.packages['node_modules/@trace/product-workspace']={version:manifest.version,resolved:'file:'+manifest.archive.path,integrity:manifest.archive.integrity,license:manifest.license};}
 fs.writeFileSync(path.join(dest,rel),JSON.stringify(prior,null,2)+'\n');
}
const modules=path.join(dest,'node_modules');fs.mkdirSync(modules);
for(const name of fs.readdirSync(path.join(root,'node_modules'))){if(name==='@trace')continue;const source=path.join(root,'node_modules',name),target=path.join(modules,name);if(fs.statSync(source).isDirectory())fs.symlinkSync(source,target,'junction');else fs.copyFileSync(source,target);}
const scope=path.join(modules,'@trace');fs.mkdirSync(scope);
for(const name of fs.readdirSync(path.join(root,'node_modules/@trace'))){if(name==='product-workspace')continue;const source=path.join(root,'node_modules/@trace',name),target=path.join(scope,name);if(fs.statSync(source).isDirectory())fs.symlinkSync(source,target,'junction');else fs.copyFileSync(source,target);}
const archive=path.join(dest,manifest.archive.path),product=path.join(scope,'product-workspace');if(manifest.version!=='0.3.0-frontend.12'||hash(fs.readFileSync(archive))!==manifest.archive.sha256)throw Error('Expected fixed Product12.');fs.mkdirSync(product);
const listing=spawnSync('tar',['-tf',archive],{encoding:'utf8',windowsHide:true});if(listing.status!==0)throw Error(listing.stderr);
for(const name of listing.stdout.trim().split(/\r?\n/))if(!name.startsWith('package/')||name.split(/[\\/]/).includes('..'))throw Error('Unsafe package path.');
const unpack=spawnSync('tar',['-xf',archive,'--strip-components=1','-C',product],{encoding:'utf8',windowsHide:true});if(unpack.status!==0)throw Error(unpack.stderr);
for(const entry of manifest.source.files)if(hash(fs.readFileSync(path.join(product,entry.path)))!==entry.sha256)throw Error('Product12 installed bytes changed.');
fs.symlinkSync(path.join(root,'apps/desktop-pet/node_modules'),path.join(dest,'apps/desktop-pet/node_modules'),'junction');
const receiptFiles=[];function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(entry.name==='node_modules')continue;const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else receiptFiles.push({path:path.relative(dest,file).replaceAll(path.sep,'/'),sha256:hash(fs.readFileSync(file))});}}walk(dest);
fs.writeFileSync(path.join(output,'source-receipt.json'),JSON.stringify({schema:'trace.writeback-source-snapshot@1',files:receiptFiles},null,2));
fs.writeFileSync(path.join(output,'composition.json'),JSON.stringify({base:accepted.source,baseAcceptedIdentity:acceptedFile,baseReceiptSha256:hash(fs.readFileSync(receipt)),inherited:'Actual030 transferred reading/modal/native repairs; their old gate does not approve new C5/Product12.',overlay:overlays,scopedDependencyFields:['@trace/product-workspace'],excluded:['CLI-proven accidental desktop-pet file:.. prefix dependency','live full-tree WIP'],developmentOnly:true},null,2));
fs.writeFileSync(path.join(output,'dependency-policy.json'),JSON.stringify({product:manifest.version,archiveSha256:manifest.archive.sha256,installedRoot:product,files:manifest.source.files.length,policy:'New isolated Product12 module directory; existing framework tools only linked. Root Product12 is not the snapshot package; old source17 junction untouched. No npm install or old-link removal/move.'},null,2));
console.log(JSON.stringify({sourceRoot:dest,files:receiptFiles.length,product:manifest.version,sourceReceiptSha256:hash(fs.readFileSync(path.join(output,'source-receipt.json')))}));

// Local build gate. --research additionally audits the retained upstream bytes;
// normal product builds do not depend on the parent research workspace.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const record=JSON.parse(fs.readFileSync(path.join(root,'vendor/infinite-canvas-source-record.json'),'utf8'));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
assert.equal(record.commit,'9cd3deacbcc598361807afc16c059a80dd18b6f9');
assert.equal(record.license,'MIT');
assert.equal(hash(fs.readFileSync(path.join(root,record.licensePath))),record.licenseSha256);
assert.ok(record.originals.some(source=>source.path==='LICENSE'&&source.sha256===record.licenseSha256));
for(const mapping of record.mappings){
  assert.ok(mapping.sources.length&&mapping.sources.every(source=>record.originals.some(row=>row.path===source)));
  const source=fs.readFileSync(path.join(root,mapping.target),'utf8');
  if(mapping.method!=='narrow-layout-only-projection')assert.ok(source.includes(record.commit)&&source.includes('MIT'),'Missing source identity: '+mapping.target);
  assert.ok(!/from\s+['"](?:zustand|antd|motion|react-router|@xyflow\/react|@plait\/[^'"]+)['"]/.test(source),'Unexpected second engine/store/UI dependency: '+mapping.target);
}
if(process.argv.includes('--research'))for(const source of record.originals)assert.equal(hash(fs.readFileSync(path.resolve(root,record.researchPath,source.path))),source.sha256,source.path);
console.log(`Infinite Canvas verified: ${record.commit}, MIT notice, ${record.mappings.length} actual migrated targets${process.argv.includes('--research')?', '+record.originals.length+' retained source identities':''}.`);

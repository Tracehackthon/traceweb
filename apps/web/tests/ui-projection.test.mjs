import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createBridge, captureInput, dispatchChain } from '../src/product/bridge.mjs';
import { evolutionEntries, recordSource, referenceItems, sourceLink } from '../src/react/ui/library-projection.mjs';
import { recordsOf } from '../src/product/library.mjs';

function fixture() {
  let h = captureInput(createBridge(), {matterId:'m1',text:'主动性是否等于自动执行？'});
  h = captureInput(h, {matterId:'m2',text:'另一项不在本次范围内的材料'});
  h = dispatchChain(h, {matterId:'m1',action:{type:'UNDERSTANDING_DRAFT',text:'先观察行为'}});
  return dispatchChain(h, {matterId:'m1',action:{type:'SAVE_UNDERSTANDING'}});
}
test('view projection never manufactures dates or missing direct-edit snapshots', () => {
  const h=fixture(), before=structuredClone(h), entries=evolutionEntries(h,{matterId:'m1'});
  assert.equal(entries.length,2); assert.equal(entries[1].afterVersion,1);
  assert.equal(entries[1].before,null); assert.ok(entries.every(e=>!('timestamp' in e)));
  assert.deepEqual(h,before);
});
test('recorded revisions distinguish historical, current and undone without enabling old content', () => {
  const h=fixture(), m=h.chain.matters[0];
  m.revisions=[{id:'r1',before:'旧1',after:'旧2',beforeVersion:1,afterVersion:2,undone:false},{id:'r2',before:'旧2',after:'先观察行为',beforeVersion:2,afterVersion:3,undone:false},{id:'r3',before:'先观察行为',after:'失效',afterVersion:4,undone:true}]; m.understandingVersion=3;
  const entries=evolutionEntries(h,{matterId:'m1'});
  assert.deepEqual(entries.map(e=>e.state),['original','historical','current','undone']);
  m.understanding='后来手动保存'; m.understandingVersion=5;
  const updated=evolutionEntries(h,{matterId:'m1'});
  assert.equal(updated.filter(e=>e.state==='current').length,1); assert.equal(updated.at(-1).after,'后来手动保存');
});
test('missing targets do not fall back to another matter history', () => {
  assert.deepEqual(evolutionEntries(fixture(),{matterId:'missing'}),[]);
  assert.deepEqual(referenceItems(fixture(),'missing'),[]);
});
test('actual Worksite version/baseVersion and undo receipts are projected without losing identity', () => {
  const h=fixture(),m=h.chain.matters[0];
  m.revisions=[{id:'r1',before:'v1',after:'v2',baseVersion:1,version:2,origin:'worksite'},{id:'r1',before:'v1',after:'v2',baseVersion:1,version:2,origin:'worksite'},{id:'u1',kind:'undo',revisionId:'r1',before:'v2',after:'先观察行为',version:3}];m.understandingVersion=3;
  const entries=evolutionEntries(h,{matterId:'m1'});
  assert.equal(entries.length,3);assert.equal(entries[1].state,'undone');assert.equal(entries[1].beforeVersion,1);assert.equal(entries[1].afterVersion,2);assert.equal(entries[2].state,'current');assert.equal(entries[2].action,'撤销修订');
});
test('comparison undoneBy and partial fragments do not masquerade as a current whole understanding', () => {
  const h=fixture(),m=h.chain.matters[0];m.revisions=[{id:'partial',before:'观察',after:'解释',beforeVersion:0,afterVersion:1,target:{start:1,end:3}},{id:'undone',before:'a',after:m.understanding,afterVersion:1,undoneBy:'undo-id'}];
  const entries=evolutionEntries(h,{matterId:'m1'});
  assert.equal(entries[1].action,'局部理解修订');assert.equal(entries[1].state,'historical');assert.equal(entries[2].state,'undone');assert.equal(entries.at(-1).id,'m1:understanding');
});
test('sources resolve by exact ID and shared references, never by matching title', () => {
  const h=fixture(); h.chain.sources=[{id:'shared',title:'同名',ownerMatterId:'m2',excerpt:'已明确关联',url:'https://example.test/item'},{id:'outside',title:'同名',ownerMatterId:'m2',excerpt:'不能夹带'}];
  h.chain.matters[0].links=[{sourceId:'shared',relationship:{type:'support'}}];
  assert.deepEqual(referenceItems(h,'m1').map(x=>x.id),['shared']);
  assert.equal(recordSource(h,{kind:'source',id:'shared'}).excerpt,'已明确关联');
  assert.equal(recordSource(h,{kind:'understanding',id:'shared'}),null);
});
test('original-source links reject scripts, local paths and embedded credentials', () => {
  for(const value of ['javascript:alert(1)','data:text/html,test','file:///D:/private','https://user:secret@example.test',null,'','/relative']) assert.equal(sourceLink(value),null);
  assert.equal(sourceLink('https://example.test/p#page=3'),'https://example.test/p#page=3');
});
test('legacy imperative library is removed; records remain one read-only canonical projection', () => {
  const s=fs.readFileSync(new URL('../src/product/library.mjs',import.meta.url),'utf8');
  assert.ok(!s.includes('export function mountLibrary(')); assert.ok(recordsOf(fixture()).length>0);
});
test('portable EasyUI source identity and shipped MIT notice retain provenance', () => {
  const manifest=JSON.parse(fs.readFileSync(new URL('../../../vendor/ui-source-record.json',import.meta.url),'utf8'));
  assert.equal(manifest.commit,'7c106d4a195f9ce566ffbbc672fc48bed68d30bd');
  assert.equal(manifest.files.length,8);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL('../public/licenses/easyui-MIT.txt',import.meta.url))).digest('hex'),manifest.licenseSha256);
});

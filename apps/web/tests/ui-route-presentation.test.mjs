import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProductOperations } from '@trace/product-workspace';
import { productReturnRoute, retainPresentationReturn } from '../src/react/route-presentation.mjs';
test('nested UI lookup fields never leak into the fixed Product comparison command',()=>{
  const anchor={field:'originalText',start:0,end:1,text:'原',baseVersion:0};
  const route={view:'chain',matterId:'m1',anchor,returnTarget:{view:'search',q:'原',selectedId:'m1:original',detailTab:'evolution',includeHistory:'false',returnTarget:{view:'all',selectedId:'m1:original'}}};
  const before=structuredClone(route), projected=productReturnRoute(route);
  assert.doesNotThrow(()=>validateProductOperations([{type:'comparison.open',sessionId:'s1',matterId:'m1',anchor,returnTarget:projected}]));
  assert.equal(projected.returnTarget.selectedId,undefined);assert.equal(projected.returnTarget.returnTarget.selectedId,undefined);assert.deepEqual(route,before);
});
test('return preserves view selection but never overwrites an authoritative stale anchor decision',()=>{
  const old={view:'chain',matterId:'m1',anchor:{text:'旧'},returnTarget:{view:'search',selectedId:'original',detailTab:'evolution'}};
  const next={view:'chain',matterId:'m1',anchor:null,anchorStatus:'stale',currentUnderstandingVersion:4};
  const merged=retainPresentationReturn(next,old);
  assert.equal(merged.anchor,null);assert.equal(merged.anchorStatus,'stale');assert.equal(merged.returnTarget.selectedId,'original');
  assert.deepEqual(retainPresentationReturn({...next,matterId:'other'},old),{...next,matterId:'other'});
});

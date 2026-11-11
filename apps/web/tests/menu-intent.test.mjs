import test from 'node:test';
import assert from 'node:assert/strict';
import { pointInTriangle, inMenuSafeZone, MENU_TIMING } from '../src/react/ui/menu-intent.mjs';
test('triangle includes boundaries, excludes outside and degenerate geometry', () => {
 const a={x:0,y:0}, b={x:10,y:0}, c={x:0,y:10};
 assert.equal(pointInTriangle({x:2,y:2},a,b,c),true);
 assert.equal(pointInTriangle({x:5,y:5},a,b,c),true);
 assert.equal(pointInTriangle({x:8,y:8},a,b,c),false);
 assert.equal(pointInTriangle(a,a,a,c),false);
});
test('safe strip, child entry and mirrored opening', () => {
 const p={left:0,right:220,width:220}, c={left:212,right:432,top:0,bottom:300};
 assert.equal(inMenuSafeZone({x:200,y:140},{x:160,y:100},p,c),true);
 assert.equal(inMenuSafeZone({x:100,y:140},{x:60,y:100},p,c),false);
 assert.equal(inMenuSafeZone({x:220,y:140},{x:160,y:100},p,c),false);
 assert.equal(inMenuSafeZone({x:20,y:140},{x:60,y:100},p,{left:-212,right:8,top:0,bottom:300},'left'),true);
 assert.equal(MENU_TIMING.safe,1200);
});

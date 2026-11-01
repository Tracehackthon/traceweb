// UI-only writes, real SQLite, and two declared transport-order gates. Reads
// and commands retain their actual bytes; no replacement Product snapshots.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async({page,state,saved,check,capture,out,desktop,holdRead,holdCommand})=>{
 assert(desktop,'Cross-canvas order uses the actual native Product path.');
 const b=name=>page.getByRole('button',{name,exact:true}),recent=()=>page.locator('.wb-recent [data-list-item]');
 const committed=async(predicate)=>{const until=Date.now()+10000;while(Date.now()<until){const value=await state();if(predicate(value))return value;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));}throw Error('Actual Product mutation did not commit.');};
 await b('写下第一点想法').click();await page.getByLabel('标题',{exact:true}).fill('跨画布保留的新位置');await page.getByRole('textbox',{name:'我的表达',exact:true}).fill('画布A的已有材料');await b('保存修改').click();await saved();await b('关闭线索详情').click();
 const initial=await state(),a=initial.canvases[0],node=a.nodes[0],card=()=>page.locator('[data-node-id="'+node.id+'"]');
 await b('新建画布').click();const two=await committed(value=>value.canvases.length===2&&value.canvases.every(canvas=>canvas.revision>0)),boardB=two.canvases.find(canvas=>canvas.id!==a.id);
 await page.waitForFunction(()=>document.querySelectorAll('.wb-recent [data-list-item]')[1]?.classList.contains('is-current'));
 const urlAfterNew=new URL(page.url()).searchParams.get('canvas');
 await recent().nth(0).click();await card().waitFor();
 const write=holdCommand('/api/product/canvases/'+a.id+'/commands');await card().focus();await page.keyboard.press('ArrowRight');await write.seen;
 // A is not yet committed. Switch to B, then begin a real old read of A.
 await recent().nth(1).click();await page.waitForFunction(()=>document.querySelectorAll('.wb-recent [data-list-item]')[1]?.classList.contains('is-current'));
 const read=holdRead('/api/product/canvases/'+a.id);await recent().nth(0).click();const captured=await read.seen;
 write.release();const moved=await committed(value=>value.canvases.find(canvas=>canvas.id===a.id).revision>a.revision),newNode=moved.canvases.find(canvas=>canvas.id===a.id).nodes.find(n=>n.id===node.id);
 await page.waitForFunction(()=>!document.querySelector('.wb-save-status')?.textContent.includes('正在保存'));
 assert(newNode.position.x>node.position.x);read.release();await saved();await card().waitFor();
 const visible=await card().evaluate(element=>({x:parseFloat(element.style.left),y:parseFloat(element.style.top)}));
 fs.writeFileSync(path.join(out,'cross-canvas-delivery.json'),JSON.stringify({initial,boardB,urlAfterNew,expectedCanvasAfterNew:boardB.id,actualOldRead:captured,moved,visible},null,2));await capture('cross-canvas-after-delayed-read');
 check('returning to A cannot discard its successful layout while another canvas was current',visible.x===newNode.position.x&&visible.y===newNode.position.y);
 check('creating a canvas writes the loaded canvas identity into its route, not the previous render',urlAfterNew===boardB.id);
};

// Actual UI writes and actual Product/SQLite read bodies. The driver only
// postpones a read's transport completion; it does not synthesize its content.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async({page,state,saved,check,capture,out,desktop,holdRead})=>{
 assert(desktop,'This delivery-order journey uses the real SQLite/HTTP native path.');
 const b=name=>page.getByRole('button',{name,exact:true});
 await b('写下第一点想法').click();await page.getByLabel('标题',{exact:true}).fill('读取与保存顺序');await page.getByRole('textbox',{name:'我的表达',exact:true}).fill('最早已保存的正文 A');await b('保存修改').click();await saved();
 const baseline=await state(),entry=Object.values(baseline.product.host.expressions)[0],node=baseline.canvases[0].nodes.find(node=>node.ref?.id===entry.id),card=()=>page.locator('[data-node-id="'+node.id+'"]');
 const committed=async(predicate)=>{const until=Date.now()+10000;while(Date.now()<until){const current=await state();if(predicate(current))return current;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));}throw Error('Actual SQLite mutation was not committed in the bounded journey');};
 const reread=async()=>{await b('工作台更多操作').click();await page.getByRole('menuitem',{name:'重新读取已保存内容',exact:true}).click();};
 if(process.env.TRACE_READ_RACE_CASE!=='layout'){
   await page.getByRole('textbox',{name:'我的表达',exact:true}).fill('刚刚成功保存的新正文 B，不能被旧读取替换。');
   const hold=holdRead('/api/product/workspace');await reread();const read=await hold.seen;
   await b('保存修改').click();const stored=await committed(value=>value.product.host.expressions[entry.id].version>baseline.product.host.expressions[entry.id].version);await page.waitForFunction(()=>!document.querySelector('.wb-save-status')?.textContent.includes('正在保存'));
   assert.equal(stored.product.host.expressions[entry.id].versions[stored.product.host.expressions[entry.id].version].text,'刚刚成功保存的新正文 B，不能被旧读取替换。');
   assert((await card().innerText()).includes('刚刚成功保存的新正文 B'));
   fs.writeFileSync(path.join(out,'content-before-delayed-read.json'),JSON.stringify({actualRead:read,baseline,stored},null,2));
   hold.release();await saved();const visible=await card().innerText();await capture('content-after-delayed-read');
   fs.writeFileSync(path.join(out,'content-after-delayed-read.json'),JSON.stringify({visible,authoritative:await state()},null,2));
   check('late real workspace read never replaces a newer successful content snapshot in the UI',visible.includes('刚刚成功保存的新正文 B'));
 }
 await b('关闭线索详情').click();
 const current=await state(),old=current.canvases.find(canvas=>canvas.id===baseline.canvases[0].id),hold=holdRead('/api/product/canvases/'+old.id);await reread();const read=await hold.seen;
 await card().focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(({id,x})=>parseFloat(document.querySelector('[data-node-id="'+id+'"]')?.style.left)>x,{id:node.id,x:old.nodes.find(n=>n.id===node.id).position.x});
 // Wait for a genuine committed layout, not only its optimistic preview.
 await page.waitForFunction(()=>!document.querySelector('.wb-save-status')?.textContent.includes('正在保存'));
 const moved=await committed(value=>value.canvases.find(canvas=>canvas.id===old.id).revision>old.revision),movedNode=moved.canvases.find(canvas=>canvas.id===old.id).nodes.find(n=>n.id===node.id);assert(movedNode.position.x>old.nodes.find(n=>n.id===node.id).position.x);
 fs.writeFileSync(path.join(out,'layout-before-delayed-read.json'),JSON.stringify({actualRead:read,old,moved},null,2));hold.release();await saved();
 const visible=await card().evaluate(element=>({x:parseFloat(element.style.left),y:parseFloat(element.style.top)}));await capture('layout-after-delayed-read');fs.writeFileSync(path.join(out,'layout-after-delayed-read.json'),JSON.stringify({visible,authoritative:await state()},null,2));
 check('late real canvas read never moves the UI back before the newer successful layout',visible.x===movedNode.position.x&&visible.y===movedNode.position.y);
};

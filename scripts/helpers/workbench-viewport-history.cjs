// User zoom -> saved per-board camera -> real browser history. No fabricated
// viewport, layout, host or server response; the selected card may be offscreen
// because that is the view the user deliberately chose.
const fs=require('node:fs'),path=require('node:path');
module.exports=async({page,state,saved,check,capture,out,injectReadFailure})=>{
 const b=name=>page.getByRole('button',{name,exact:true}),box=name=>page.getByRole('textbox',{name,exact:true});
 const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const camera=()=>page.locator('.wb-ic-world').evaluate(element=>element.style.transform);
 const raw=()=>page.evaluate(()=>localStorage.getItem('trace-workbench:personal:resume:viewport:canvas-main'));
 const save=async(title,text)=>{await page.getByLabel('标题',{exact:true}).fill(title);await box('我的表达').fill(text);await b('保存修改').click();await saved();};
 await b('写下第一点想法').click();await save('相机画布A','CAMERA_A_中文🧭');await page.locator('.wb-ic-viewport').hover({position:{x:40,y:40}});await page.mouse.wheel(0,-900);await page.waitForFunction(()=>JSON.parse(localStorage.getItem('trace-workbench:personal:resume:viewport:canvas-main')||'{}').k>2);await frame();
 const before={transform:await camera(),raw:await raw(),business:await state()};fs.writeFileSync(path.join(out,'camera-A-before.json'),JSON.stringify(before,null,2));
 await b('新建画布').click();await page.waitForFunction(()=>document.querySelectorAll('.wb-recent [data-list-item]')[1]?.classList.contains('is-current'));await b('写下第一点想法').click();await save('相机画布B','CAMERA_B_中文🧭');await frame();
 const afterB={transform:await camera(),rawA:await raw(),business:await state()};fs.writeFileSync(path.join(out,'camera-B-before-back.json'),JSON.stringify(afterB,null,2));check('creating and working on B does not rewrite A saved camera',afterB.rawA===before.raw);
 await page.goBack();await page.waitForURL(url=>url.searchParams.get('canvas')==='canvas-main');await saved();await frame();
 const after={transform:await camera(),raw:await raw(),cards:await page.locator('.wb-card-body').allInnerTexts(),business:await state()};fs.writeFileSync(path.join(out,'camera-A-after-back.json'),JSON.stringify(after,null,2));await capture('camera-after-browser-back');
 check('Back restores exact A content independently of the camera assertion',after.cards.includes('CAMERA_A_中文🧭'));
 check('Back preserves the exact user camera instead of fitting the selected card again',after.transform===before.transform&&after.raw===before.raw);
 await page.goForward();await saved();await frame();await injectReadFailure();await page.goBack();await b('重试进入原目标').waitFor();const failed={transform:await camera(),rawA:await raw(),url:page.url()};fs.writeFileSync(path.join(out,'camera-failed-back-before-retry.json'),JSON.stringify(failed,null,2));check('a failed Back has not rewritten the saved A camera before retry',failed.rawA===before.raw);await b('重试进入原目标').click();await page.waitForURL(url=>url.searchParams.get('canvas')==='canvas-main');await saved();await frame();const recovered={transform:await camera(),raw:await raw(),business:await state()};fs.writeFileSync(path.join(out,'camera-A-after-explicit-retry.json'),JSON.stringify(recovered,null,2));await capture('camera-after-failed-back-retry');check('explicit retry of a failed Back preserves the exact A camera, not a new fit',recovered.transform===before.transform&&recovered.raw===before.raw);
};

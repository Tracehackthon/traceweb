// Full formal UI, real Product/SQLite. Faults only hold actual request/response
// delivery or fail one read; no fabricated saved objects or success responses.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async({page,state,saved,check,capture,out,desktop,holdRead,holdCommand,injectReadFailure})=>{
 assert(desktop,'Delivery-order coverage uses the real native Product path.');page.setDefaultTimeout(12000);
 const b=name=>page.getByRole('button',{name,exact:true}),box=name=>page.getByRole('textbox',{name,exact:true}),recent=()=>page.locator('.wb-recent [data-list-item]');
 const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const committed=async(predicate)=>{const until=Date.now()+15000;while(Date.now()<until){const value=await state();if(predicate(value))return value;await frame();}throw Error('Expected real Product commit did not arrive.');};
 const bounded=async(p,label)=>{let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('No real '+label+' observed.')),15000))]);}finally{clearTimeout(timer);}};
 const saveCard=async(title,text)=>{await page.getByLabel('标题',{exact:true}).fill(title);await box('我的表达').fill(text);await b('保存修改').click();await saved();};
 const choose=async(index)=>{await recent().nth(index).click();await page.waitForFunction(index=>document.querySelectorAll('.wb-recent [data-list-item]')[index]?.classList.contains('is-current'),index);await frame();};
 const selectedTab=()=>page.locator('.wb-inspector [role=tab][aria-selected=true]').innerText();
 const snapshot=async()=>({url:page.url(),cards:await page.locator('.wb-card-body').allInnerTexts(),inspector:await page.locator('.wb-inspector').innerText(),tab:await selectedTab(),viewport:await page.locator('.wb-ic-world').evaluate(element=>element.style.transform),business:await state()});
 await b('写下第一点想法').click();await saveCard('导航画布A','BODY_NAV_A_中文🧭');const first=await state(),a=first.canvases[0];
 await b('新建画布').click();await committed(value=>value.canvases.length===2&&value.canvases.every(canvas=>canvas.revision>0));await page.waitForFunction(()=>document.querySelectorAll('.wb-recent [data-list-item]')[1]?.classList.contains('is-current'));
 await b('写下第一点想法').click();await saveCard('导航画布B','BODY_NAV_B_中文🧭');const two=await state(),boardB=two.canvases.find(canvas=>canvas.id!==a.id);await page.getByRole('tab',{name:'来源',exact:true}).click();
 if(process.env.TRACE_NAV_CASE!=='late-create'){
   await choose(0);await choose(1);const before=JSON.stringify((await state()).product);
   await page.goBack();await page.waitForURL(url=>url.searchParams.get('canvas')===a.id);await saved();await frame();let actual=await snapshot();fs.writeFileSync(path.join(out,'back-observation.json'),JSON.stringify(actual,null,2));await capture('navigation-back-current-render');
   check('browser Back restores the actual target canvas, not only its URL',actual.cards.includes('BODY_NAV_A_中文🧭')&&!actual.cards.includes('BODY_NAV_B_中文🧭')&&JSON.stringify(actual.business.product)===before);
   await page.goForward();await page.waitForURL(url=>url.searchParams.get('canvas')===boardB.id);await saved();await frame();actual=await snapshot();check('browser Forward restores B with its own exact object and source tab',actual.cards.includes('BODY_NAV_B_中文🧭')&&actual.inspector.includes('导航画布B')&&actual.tab==='来源');
 }
 // Real A create is in transport before Product. B changes its own panel;
 // the delayed A result must finish on A without revealing anything on B.
 await choose(0);await b('关闭线索详情').click();const prior=await state(),write=holdCommand('/api/product/commands');
 try{
   await b('文字 T').click();const click=await page.evaluate(()=>{const root=document.querySelector('.wb-ic-viewport'),r=root.getBoundingClientRect();for(const x of [.2,.5,.8])for(const y of [.45,.65,.8]){const px=r.left+r.width*x,py=r.top+r.height*y,e=document.elementFromPoint(px,py);if(e?.closest('.wb-ic-viewport')&&!e.closest('[data-node-id],button,input,textarea,a,[role=toolbar]'))return{x:px,y:py,target:e.tagName,className:e.className,viewport:{x:r.x,y:r.y,width:r.width,height:r.height}};}throw Error('No visible blank canvas point');});fs.writeFileSync(path.join(out,'late-create-click.json'),JSON.stringify(click,null,2));await page.mouse.click(click.x,click.y);await bounded(write.seen,'pending A create');await choose(1);await page.getByRole('tab',{name:'来源',exact:true}).click();const before=await snapshot();
   write.release();const stored=await committed(value=>value.canvases.find(canvas=>canvas.id===a.id).nodes.length>prior.canvases.find(canvas=>canvas.id===a.id).nodes.length);await saved();await frame();const after=await snapshot();
   fs.writeFileSync(path.join(out,'late-create-observation.json'),JSON.stringify({before,after,stored},null,2));await capture('navigation-late-create-current-render');
   check('late A create finishes on A without taking B source tab, selected object or viewport',after.tab==='来源'&&after.inspector.includes('导航画布B')&&after.cards.join('|')===before.cards.join('|')&&after.url===before.url&&after.viewport===before.viewport);
   await page.reload();await page.locator('[data-workbench-ready=true]').waitFor();await saved();check('B panel and exact object stay the same after refresh following the old A completion',(await selectedTab())==='来源'&&(await page.locator('.wb-inspector').innerText()).includes('导航画布B'));
 }finally{write.release();}
 if(process.env.TRACE_NAV_CASE==='late-create')return;
 // Failed history target must keep B and its later draft, align the URL to
 // the retained work surface and keep an explicit retry for the original A.
 await choose(0);await choose(1);await page.getByRole('tab',{name:'内容',exact:true}).click();await box('我的表达').fill('B的未保存草稿：失败返回也不能丢。');const beforeFailure=await state();await injectReadFailure();await page.goBack();await b('重试进入原目标').waitFor();await frame();
 let actual=await snapshot();fs.writeFileSync(path.join(out,'failed-back-observation.json'),JSON.stringify(actual,null,2));
 check('failed Back retains B, its unsaved draft and canonical content without claiming A is loaded',new URL(actual.url).searchParams.get('canvas')===boardB.id&&actual.cards.includes('BODY_NAV_B_中文🧭')&&await box('我的表达').inputValue()==='B的未保存草稿：失败返回也不能丢。'&&JSON.stringify(actual.business.product)===JSON.stringify(beforeFailure.product));
 await b('重试进入原目标').click();await saved();await page.waitForURL(url=>url.searchParams.get('canvas')===a.id);await frame();check('explicit retry returns to the original history target A without a new mutation',(await page.locator('.wb-card-body').allInnerTexts()).includes('BODY_NAV_A_中文🧭')&&JSON.stringify((await state()).product)===JSON.stringify(beforeFailure.product));
 await page.goForward();await page.waitForURL(url=>url.searchParams.get('canvas')===boardB.id);await saved();await box('我的表达').waitFor();check('Forward after failed-target recovery retains the later B draft',await box('我的表达').inputValue()==='B的未保存草稿：失败返回也不能丢。');
 // The older A read completes after a newer Forward intent already chose B.
 const read=holdRead('/api/product/canvases/'+a.id);
 try{await page.goBack();await bounded(read.seen,'history A read');await page.goForward();await page.waitForURL(url=>url.searchParams.get('canvas')===boardB.id);read.release();await saved();await frame();actual=await snapshot();fs.writeFileSync(path.join(out,'rapid-history-observation.json'),JSON.stringify(actual,null,2));check('a late Back read cannot override a newer Forward intent',actual.cards.includes('BODY_NAV_B_中文🧭')&&new URL(actual.url).searchParams.get('canvas')===boardB.id&&await box('我的表达').inputValue()==='B的未保存草稿：失败返回也不能丢。');}finally{read.release();}
 // Creating C finishes in the background after B was explicitly reselected.
 await b('放大画布').click();const beforeBoardCreate=await snapshot(),rename=holdCommand(/^\/api\/product\/canvases\/[a-zA-Z0-9_-]+\/commands$/);
 try{await b('新建画布').click();await bounded(rename.seen,'new canvas rename');await choose(1);rename.release();await committed(value=>value.canvases.length===3&&value.canvases.every(canvas=>canvas.revision>0));await saved();await frame();actual=await snapshot();fs.writeFileSync(path.join(out,'late-board-create-observation.json'),JSON.stringify({before:beforeBoardCreate,after:actual},null,2));check('late new-canvas creation keeps the explicitly reselected B, its zoom and unsaved draft',new URL(actual.url).searchParams.get('canvas')===boardB.id&&actual.cards.includes('BODY_NAV_B_中文🧭')&&actual.viewport===beforeBoardCreate.viewport&&await box('我的表达').inputValue()==='B的未保存草稿：失败返回也不能丢。');await choose(2);check('the background-created C remains independently accessible and empty',await page.locator('.wb-card').count()===0&&await b('写下第一点想法').count()===1);await choose(1);}
 finally{rename.release();}
 const saving=holdCommand('/api/product/commands');try{const before=await snapshot();await b('保存修改').click();await bounded(saving.seen,'bounded pending B save');check('a new canvas is temporarily unavailable during a real unconfirmed write, not an unimplemented control',await b('新建画布').isDisabled());saving.release();await saved();await frame();actual=await snapshot();check('confirmed save re-enables new-canvas creation without changing current B or its viewport',!await b('新建画布').isDisabled()&&new URL(actual.url).searchParams.get('canvas')===boardB.id&&actual.viewport===before.viewport);}finally{saving.release();}
 await capture('navigation-recovery-final-current-render');
};

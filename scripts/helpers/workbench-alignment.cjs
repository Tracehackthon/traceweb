// Geometry is measured in the running workbench, never a component fixture.
const {selectValue}=require('./select-control.cjs');
const fs=require('node:fs'),path=require('node:path');
module.exports=async({page,state,saved,check,capture,out,windowSize,baseline})=>{
 const measurements=[];
 const record=(name,value,expected=0)=>{measurements.push({name,value,expected,delta:Math.abs(value-expected)});if(!baseline)check(name,Math.abs(value-expected)<=0.5);};
 const button=name=>page.getByRole('button',{name,exact:true});
 await page.emulateMedia({reducedMotion:'reduce'});
 if(process.env.TRACE_ALIGNMENT_THEME==='dark'){await button('设置').click();await selectValue(page.getByRole('combobox',{name:'外观',exact:true}),'dark');await button('保存设置').click();await saved();}
 const revision=(await state()).product.revision;
 for(const width of [1440,1200,900,390]){
  await windowSize(width,940);
  const iconButtons=await page.locator('.wb-icon-button,.wb-dock>button,.wb-navigation nav button,.wb-navigation footer>button').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().width&&e.querySelector('svg')&&(e.classList.contains('wb-icon-button')||e.closest('.wb-dock')||parseFloat(getComputedStyle(e).fontSize)===0)).map(e=>{const b=e.getBoundingClientRect(),i=e.querySelector('svg').getBoundingClientRect();return{label:e.getAttribute('aria-label')||e.textContent,x:i.x+i.width/2-b.x-b.width/2,y:i.y+i.height/2-b.y-b.height/2};}));
  for(const b of iconButtons){record(width+' '+b.label+' icon horizontal center',b.x);record(width+' '+b.label+' icon vertical center',b.y);}
  await button('留下文字、网页或对话材料').click();
  const dialog=page.getByRole('dialog',{name:'留下材料',exact:true}),trigger=dialog.getByRole('combobox',{name:'材料类型'});
  const input=dialog.getByRole('textbox',{name:'材料标题'});
  await trigger.click();
  const popup=page.locator('.wb-select-content');await popup.waitFor();
  const geometry=await page.evaluate(()=>{
   const trigger=document.querySelector('[aria-label="材料类型"]'),popup=document.querySelector('.wb-select-content'),item=popup.querySelector('[data-state=checked]');
   const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2};};
   const value=rect(trigger.firstElementChild),arrow=rect(trigger.querySelector('svg')),text=rect(item.firstElementChild),check=rect(item.querySelector('svg'));
   return{optionTextRails:[...popup.querySelectorAll('.wb-select-option')].map(e=>rect(e.firstElementChild).x),trigger:rect(trigger),popup:rect(popup),value,arrow,text,check,item:rect(item),input:rect(document.querySelector('[aria-label="材料标题"]'))};
  });
  for(const [index,x] of geometry.optionTextRails.entries())record(width+' option '+index+' stable text rail',x-geometry.value.x);
  record(width+' menu/trigger left text rail',geometry.text.x-geometry.value.x);
  record(width+' menu/trigger trailing icon rail',geometry.check.cx-geometry.arrow.cx);
  record(width+' select arrow and text line vertical center',geometry.arrow.cy-geometry.value.cy);
  record(width+' menu check and text line vertical center',geometry.check.cy-geometry.text.cy);
  record(width+' input/select equal control height',geometry.input.height-geometry.trigger.height);
  record(width+' select line has symmetric vertical inset',geometry.value.cy-geometry.trigger.cy);
  record(width+' popup has no horizontal overflow',Math.max(0,geometry.popup.x+geometry.popup.width-width, -geometry.popup.x));
  await capture('material-menu-'+width);
  await page.keyboard.press('Escape');
  await input.fill('位置核验 '+width);await dialog.getByRole('textbox',{name:'完整原文'}).fill('真实保存的对齐检查，不代替原文。');
  if(width!==390){await button('关闭对话框').click();continue;}
  await button('保存材料并放到画布').click();await dialog.waitFor({state:'hidden'});await saved();
 }
 await windowSize(1440,940);await page.getByRole('tab',{name:'来源',exact:true}).click();
 const annotation=page.locator('.wb-halo-annotation-trigger');await annotation.waitFor();
 const a=await annotation.evaluate(e=>{const r=e.getBoundingClientRect(),icons=[...e.querySelectorAll('svg')].map(i=>{const b=i.getBoundingClientRect();return{cy:b.y+b.height/2,cx:b.x+b.width/2};}),s=e.querySelector('span').getBoundingClientRect();return{icons,cy:r.y+r.height/2,textCy:s.y+s.height/2};});
 record('annotation leading icon is centered to label',a.icons[0].cy-a.textCy);record('annotation trailing icon is centered to label',a.icons.at(-1).cy-a.textCy);
 await annotation.click();await page.getByRole('textbox',{name:'我的摘记',exact:true}).fill('几何修正不改变真实保存链路。');await button('保存摘记').click();await page.getByText('摘记已保存',{exact:true}).waitFor();
 check('alignment journey saves material and annotation through authoritative storage',(await state()).product.revision>revision&&Object.values((await state()).product.host.expressions).some(e=>e.versions[e.version].text==='几何修正不改变真实保存链路。'));
 await capture('source-alignment');
 await page.reload();await page.locator('[data-workbench-ready=true]').waitFor();
 check('real saved alignment annotation survives reload',Object.values((await state()).product.host.expressions).some(e=>e.versions[e.version].text==='几何修正不改变真实保存链路。'));
 await page.getByRole('navigation',{name:'三大工作区'}).getByRole('button',{name:'Agent 协作',exact:true}).click();await page.getByRole('radio',{name:'外部任务',exact:true}).click();await page.getByRole('textbox',{name:'外部任务目标'}).fill('核对箭头和文字的位置，不提交真实执行。');await button('保存任务准备').click();await page.locator('.wb-task-detail').waitFor();await saved();
 for(const width of [1440,390]){
  await windowSize(width,940);const summary=page.locator('.wb-existing-execution>summary');
  const measure=()=>summary.evaluate(e=>{const b=e.getBoundingClientRect(),label=e.firstElementChild.getBoundingClientRect(),icon=e.querySelector('svg').getBoundingClientRect();return{dy:icon.y+icon.height/2-label.y-label.height/2,rail:b.right-icon.x-icon.width/2,height:label.height};});
  let d=await measure();record(width+' disclosure text/arrow center',d.dy);record(width+' disclosure trailing icon inset',d.rail,12);
  await summary.press('Enter');await page.locator('.wb-existing-execution[open]').waitFor();d=await measure();record(width+' expanded disclosure text/arrow center',d.dy);
  await summary.scrollIntoViewIfNeeded();check(width+' keyboard disclosure does not leave positional motion',await summary.evaluate(e=>!e.getAnimations({subtree:true}).some(a=>a.playState==='running')));await capture('disclosure-'+width);await summary.press('Enter');
 }
 check('geometry checks never invent execution or task success',Object.values((await state()).product.host.tasks).every(t=>t.status==='prepared'&&t.results.length===0));
 fs.writeFileSync(path.join(out,'geometry.json'),JSON.stringify({baseline,toleranceCssPx:0.5,environment:await page.evaluate(()=>({dpr:devicePixelRatio,theme:document.documentElement.dataset.traceAppearance})),measurements},null,2));
};

// Read rendered text in complete workflows; no isolated typography fixtures.
const fs=require('node:fs'),path=require('node:path');
const {selectValue}=require('./select-control.cjs');
module.exports=async({page,state,saved,check,capture,out,windowSize,baseline=false})=>{
 const measurements=[];
 const button=name=>page.getByRole('button',{name,exact:true}),box=name=>page.getByRole('textbox',{name,exact:true});
 const nav=name=>page.getByRole('navigation',{name:'三大工作区'}).getByRole('button',{name,exact:true});
 const audit=async(name,locator,role,pseudo=null)=>{
  await locator.waitFor();const result=await locator.evaluate((e,{role,pseudo})=>{
   const root=getComputedStyle(document.documentElement),s=getComputedStyle(e,pseudo),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true});
   const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data);};
   const fg=rgba(s.color),primary=rgba(root.getPropertyValue('--trace-text-primary'));
   const luminance=c=>c.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((v,x,i)=>v+x*[.2126,.7152,.0722][i],0);
   let opacity=Number(s.opacity);for(let p=pseudo?e:e.parentElement;p;p=p.parentElement)opacity*=Number(getComputedStyle(p).opacity);
   const backgrounds=['--trace-surface-workbench','--trace-surface-panel','--trace-surface-muted'].map(token=>({token,color:rgba(root.getPropertyValue(token))}));
   const ratios=backgrounds.map(({token,color:bg})=>{const a=fg[3]/255*opacity,text=fg.map((v,i)=>i<3?v*a+bg[i]*(1-a):255),aL=luminance(text),bL=luminance(bg);return{token,ratio:(Math.max(aL,bL)+.05)/(Math.min(aL,bL)+.05)};});
   const fontRules=[];const walk=rules=>{for(const r of rules){if(r.cssRules)walk(r.cssRules);if(r.selectorText&&e.matches(r.selectorText)&&(r.style.font||r.style.fontWeight))fontRules.push({selector:r.selectorText,font:r.style.font,weight:r.style.fontWeight});}};for(const sheet of document.styleSheets)walk(sheet.cssRules);
   return{fontRules:pseudo&&s.fontWeight!=='400'?fontRules:undefined,elementFontWeight:getComputedStyle(e).fontWeight,role,text:pseudo?'placeholder':(e.textContent||e.value||'').trim().slice(0,90),color:fg,primary,opacity,fontSize:s.fontSize,fontWeight:s.fontWeight,minNeutralContrast:Math.min(...ratios.map(x=>x.ratio)),ratios};
  },{role,pseudo});
  measurements.push({name,...result});fs.writeFileSync(path.join(out,'typography.json'),JSON.stringify({baseline,contrastModel:'Computed foreground and cumulative opacity, conservatively tested against all three neutral surface tokens; not a pixel/gradient accessibility certification.',measurements},null,2));
  if(baseline)return;
  check(name+' readable contrast',result.minNeutralContrast>=(role==='support'?7:4.5));
  check(name+' no faded enabled text',result.opacity===1&&result.color[3]===255);
  if(role==='content')check(name+' uses content ink, not metadata gray',result.color.join()===result.primary.join());
  if(pseudo)check(name+' placeholder does not inherit a bold label weight',result.fontWeight==='400');
 };
 await windowSize(1440,940);await page.emulateMedia({reducedMotion:'reduce'});
 for(const theme of ['light','dark']){
  await button('设置').click();await selectValue(page.getByRole('combobox',{name:'外观',exact:true}),theme);await button('保存设置').click();await saved();
  await nav('思考画布').click();const close=button('关闭线索详情');if(await close.isVisible())await close.click();
  await audit(theme+' navigation label',nav('能力库'),'content');
  await button('留下文字、网页或对话材料').click();const dialog=page.getByRole('dialog',{name:'留下材料',exact:true});
  await audit(theme+' capture guidance',dialog.locator('.wb-muted').first(),'support');
  await audit(theme+' source placeholder',box('来源地址'),'metadata','::placeholder');
  await box('材料标题').fill('清晰文字核验 '+theme);await box('完整原文').fill('材料正文应该清晰可读，而不是退成灰色的注释。');
  await capture('capture-type-'+theme);await button('保存材料并放到画布').click();await dialog.waitFor({state:'hidden'});await saved();
  const node=page.locator('.wb-node').filter({hasText:'清晰文字核验 '+theme});await audit(theme+' material body',node.locator('.wb-card-body'),'content');
  await page.getByRole('tab',{name:'来源',exact:true}).click();await audit(theme+' source values',page.locator('.wb-source-metadata dd').first(),'content');await capture('source-type-'+theme);
  await nav('能力库').click();await button('新建能力').click();await page.waitForFunction(()=>document.querySelector('.wb-capability-detail h2')?.textContent==='新的方法');await box('名称').fill('清晰文字方法 '+theme);await box('解决什么需要').fill('保存真实描述，区分内容、说明和版本信息。');await button('保存草稿版本').click();await page.getByText('草稿已保存',{exact:true}).waitFor();await saved();
  const card=page.locator('.wb-capability-summary').filter({hasText:'清晰文字方法 '+theme});await audit(theme+' capability title',card.locator('strong'),'content');await audit(theme+' capability description',card.locator('.wb-capability-summary-description'),'support');await audit(theme+' capability version',card.locator('.wb-capability-version'),'metadata');
  if(theme==='dark')await audit('dark unselected capability title',page.locator('.wb-capability-summary').filter({hasText:'清晰文字方法 light'}).locator('strong'),'content');
  await capture('library-type-'+theme);
  await nav('Agent 协作').click();await page.getByRole('radio',{name:'外部任务',exact:true}).click();await box('外部任务目标').fill('清晰文字任务 '+theme+'，只准备，不执行。');await button('保存任务准备').click();await page.getByText('准备已保存，尚未执行。',{exact:true}).waitFor();await saved();
  await audit(theme+' task title',page.locator('.wb-list-row').filter({hasText:'清晰文字任务 '+theme}).locator('strong'),'content');await audit(theme+' task status',page.locator('.wb-list-row').filter({hasText:'清晰文字任务 '+theme}).locator('small'),'metadata');await audit(theme+' disclosure label',page.locator('.wb-existing-execution>summary'),'content');
  if(theme==='dark')await audit('dark unselected task title',page.locator('.wb-list-row').filter({hasText:'清晰文字任务 light'}).locator('strong'),'content');
  await windowSize(390,844);await capture('task-type-narrow-'+theme);check(theme+' typography does not introduce horizontal workspace overflow',await page.locator('.wb-thinking-pane').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await windowSize(1440,940);
 }
 await page.reload();await page.locator('[data-workbench-ready=true]').waitFor();const host=(await state()).product.host;
 check('typography flow persists exact material originals and capability descriptions',Object.values(host.materials).filter(e=>e.title.startsWith('清晰文字核验 ')).length===2&&Object.values(host.capabilities).filter(e=>e.title.startsWith('清晰文字方法 ')&&e.versions[e.version].purpose==='保存真实描述，区分内容、说明和版本信息。').length===2);
 check('typography flow retains preparation state without any fake execution success',Object.values(host.tasks).filter(t=>t.goal.startsWith('清晰文字任务 ')).every(t=>t.status==='prepared'&&t.results.length===0));
};

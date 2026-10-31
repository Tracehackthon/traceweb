const {selectValue,selectedValue}=require('./select-control.cjs');
// Continue real capability workflows in the complete app; no isolated controls.
module.exports=async({page,state,check,capture,windowSize,saved})=>{
 const button=name=>page.getByRole('button',{name,exact:true}),box=name=>page.getByRole('textbox',{name,exact:true});
 const nav=name=>page.getByRole('navigation',{name:'三大工作区'}).getByRole('button',{name,exact:true});
 const materialControl=el=>{const s=getComputedStyle(el),p=el.closest('.wb-halo-control');return !!p&&parseFloat(s.borderTopWidth)===0&&s.outlineStyle==='none'&&s.backgroundColor==='rgba(0, 0, 0, 0)'&&getComputedStyle(p).backgroundColor!=='rgba(0, 0, 0, 0)';};
 await page.emulateMedia({reducedMotion:'no-preference'});
 for(const theme of ['light','dark']){
  await button('设置').click();const appearance=page.getByRole('combobox',{name:'外观',exact:true});await selectValue(appearance,theme);const name=box('显示名称');
  check(theme+' settings input and select use the same unframed material',await name.evaluate(materialControl)&&await appearance.evaluate(materialControl));
  await name.fill('本轮控件真实保存 · '+theme);await appearance.focus();await page.mouse.move(10,10);await page.waitForFunction(()=>getComputedStyle(document.querySelector('.wb-dialog input[name=name]').closest('.wb-halo-control'),'::after').opacity==='0');await name.click();
  check(theme+' pointer focus has an opacity-only material transition',await name.evaluate(e=>e.closest('.wb-halo-control').getAnimations({subtree:true}).some(a=>a.transitionProperty==='opacity'&&a.effect.getTiming().duration===120)));
  await name.press('Tab');check(theme+' keyboard focus is immediate without lingering control motion',await page.evaluate(()=>document.documentElement.dataset.traceInput==='keyboard'&&![...document.querySelectorAll('.wb-halo-control')].some(e=>e.getAnimations().some(a=>a.playState==='running'))));
  await capture('settings-'+theme);await button('保存设置').click();await saved();check(theme+' wrapped native fields still serialize to the real Product owner',(await state()).product.host.preferences.displayName==='本轮控件真实保存 · '+theme);
  await nav('能力库').click();await page.locator('.wb-capability-summary').filter({hasText:'实际研究方法'}).click();
  const usage=page.getByRole('combobox',{name:'库中用途',exact:true}),method=box('名称');check(theme+' existing method editor keeps select values and unified input finish',await usage.evaluate(materialControl)&&await method.evaluate(materialControl)&&await selectedValue(usage)==='method');
  await capture('capability-'+theme);
 }
 await page.reload();await page.locator('[data-workbench-ready=true]').waitFor();check('field polish preserves persisted capability order after reload',Object.values((await state()).product.host.capabilities).some(e=>e.title==='实际研究方法'&&e.versions[e.version].stepItems[0].text==='输出对照'));
 await button('设置').click();const name=box('显示名称');await page.emulateMedia({forcedColors:'active'});await name.focus();check('forced colors restores a visible system focus cue',await name.evaluate(e=>getComputedStyle(e.closest('.wb-halo-control')).outlineStyle==='solid'));await page.emulateMedia({forcedColors:'none'});
 await page.emulateMedia({reducedMotion:'reduce'});await name.click();check('reduced motion removes control transition without hiding focus',await name.evaluate(e=>{const p=e.closest('.wb-halo-control');return p.getAnimations().length===0&&getComputedStyle(p,'::after').opacity==='1';}));await button('关闭对话框').click();
 await windowSize(390,844);await button('切换工作区').click();await page.getByRole('dialog',{name:'切换工作区',exact:true}).getByRole('button',{name:'能力库',exact:true}).click();await page.getByRole('button',{name:/^切换能力：/}).click();await page.locator('.wb-capability-summary').filter({hasText:'实际研究方法'}).click();
 check('390px controls remain bounded with long mixed text',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.wb-halo-control')].filter(e=>e.getBoundingClientRect().width>0).every(e=>e.getBoundingClientRect().right<=innerWidth+1)));
 await capture('controls-narrow-dark-reduced');await windowSize(1440,940);
};

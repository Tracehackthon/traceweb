const {selectValue}=require('./select-control.cjs');
// Full built product, real UI commands, isolated Browser/Electron storage.
const fs=require('node:fs'),path=require('node:path');
module.exports=async function({page,state,saved,check,capture,out,desktop,app,windowSize,base,restartDesktop,restartBrowser,themeOnly=false}){
  const nav=name=>page.getByRole('navigation',{name:'三大工作区'}).getByRole('button',{name,exact:true});
  const settings=async()=>{await page.getByRole('button',{name:'设置',exact:true}).click();return page.getByRole('combobox',{name:'外观',exact:true});};
  const theme=async(value)=>{const control=await settings();await selectValue(control,value);await page.getByRole('button',{name:'关闭对话框',exact:true}).click();};
  const appearance=()=>page.locator('html').getAttribute('data-trace-appearance');
  const reports=[];
  await windowSize(1440,940);await page.emulateMedia({reducedMotion:'no-preference',colorScheme:'light'});
  check('default appearance follows the system',await appearance()==='light');
  for(const mode of ['light','dark']){
    await theme(mode);await nav('思考画布').click();
    check(mode+' theme applies to the complete workbench',await appearance()===mode);
    await page.getByRole('button',{name:'工作台更多操作',exact:true}).click();
    const menu=page.getByRole('menu');await menu.waitFor();
    const portal=await menu.evaluate(e=>{const s=getComputedStyle(e),probe=document.createElement('div');probe.style.backgroundColor='var(--trace-surface-panel)';document.body.append(probe);const expected=getComputedStyle(probe).backgroundColor;probe.remove();return {background:s.backgroundColor,expected,animation:s.animationName,scheme:s.colorScheme};});console.log('Portal',portal);check(mode+' Portal follows the same surface and color scheme',portal.background===portal.expected&&portal.scheme===mode);
    await page.keyboard.press('Escape');
    await settings();
    const colors=await page.evaluate(()=>{
      const rgb=s=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');context.fillStyle=s;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data].slice(0,3);};
      const l=c=>c.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);
      const contrast=(a,b)=>{const x=l(rgb(a)),y=l(rgb(b));return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
      const focus=document.createElement('div');focus.style.color='var(--trace-focus)';document.body.append(focus);const focusColor=getComputedStyle(focus).color;focus.remove();
      const dialog=document.querySelector('.wb-dialog'),button=dialog.querySelector('.wb-primary'),input=dialog.querySelector('input'),d=getComputedStyle(dialog),b=getComputedStyle(button),i=getComputedStyle(input);
      const tones={};for(const tone of ['positive','pending','danger']){const probe=document.createElement('div');probe.style.color='var(--trace-'+tone+'-text)';probe.style.backgroundColor='var(--trace-'+tone+'-bg)';document.body.append(probe);const style=getComputedStyle(probe);tones[tone]=contrast(style.color,style.backgroundColor);probe.remove();}
      return {tones,body:contrast(d.color,d.backgroundColor),button:contrast(b.color,b.backgroundColor),inputText:contrast(i.color,i.backgroundColor),focus:contrast(focusColor,i.backgroundColor),border:i.borderTopWidth,dialogRadius:d.borderTopLeftRadius,scheme:d.colorScheme};
    });
    reports.push({mode,colors});console.log('Colors',colors);
    check(mode+' body and primary-action text reach 4.5:1',colors.body>=4.5&&colors.button>=4.5);check(mode+' semantic state text reaches 4.5:1',Object.values(colors.tones).every(ratio=>ratio>=4.5));
    const input=page.locator('.wb-dialog input').first();for(let i=0;i<5&&!await input.evaluate(e=>e.matches(':focus-visible'));i++)await page.keyboard.press('Tab');
    await page.waitForFunction(()=>{const input=document.querySelector('.wb-dialog input');return input?.matches(':focus-visible')&&getComputedStyle(input).boxShadow!=='none';});
    check(mode+' filled control retains readable text and real keyboard shadow focus without the retired hairline rule',colors.inputText>=4.5&&await input.evaluate(e=>e===document.activeElement&&getComputedStyle(e).backgroundColor!=='rgba(0, 0, 0, 0)'));
    await capture('ui-'+mode+'-settings');await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
    await page.reload();await page.locator('[data-workbench-ready=true]').waitFor();check(mode+' persists through reload',await appearance()===mode);
    await capture('ui-'+mode+'-canvas');
  }
  await theme('system');await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.traceAppearance==='dark');await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.traceAppearance==='light');check('system changes update the current workbench without reloading');
  // Capture the pre-module surface with slow modules, not just the settled render.
  await theme('dark');await page.route('**/assets/*.js',async route=>{await new Promise(r=>setTimeout(r,200));await route.continue();});
  await page.reload({waitUntil:'domcontentloaded'});check('dark appearance exists before slow modules finish',await appearance()==='dark');await page.locator('[data-workbench-ready=true]').waitFor();await page.unroute('**/assets/*.js');
  await theme('light');
  if(themeOnly){fs.writeFileSync(path.join(out,'ui-refinement.json'),JSON.stringify({reports,scope:'Actual built workbench appearance E2E, not the history/material suite'},null,2));return;}
  // Create a real overflowing capability list through the same commands as a user.
  await nav('能力库').click();
  for(let n=0;n<13;n++){await page.getByRole('button',{name:'新建能力',exact:true}).click();await page.locator('.wb-capability-detail').waitFor();await saved();}
  const capabilityList=page.getByLabel('能力列表',{exact:true}),rows=capabilityList.locator('[data-list-item]');
  await rows.first().focus();await rows.first().press('End');
  check('End focuses the last real capability without wrapping',await rows.last().evaluate(e=>e===document.activeElement));
  await rows.last().press('ArrowDown');check('Down at the last row does not wrap',await rows.last().evaluate(e=>e===document.activeElement));
  await rows.last().press('Home');for(let n=0;n<11;n++)await page.keyboard.press('ArrowDown');
  check('keyboard reveals the next row early in the overflowing capability list',await capabilityList.evaluate(e=>{const row=document.activeElement.getBoundingClientRect(),box=e.getBoundingClientRect();return e.scrollHeight>e.clientHeight&&e.scrollTop>0&&row.bottom<=box.bottom-12&&row.top>=box.top;}));
  await capture('ui-capability-list');
  await nav('Agent 协作').click();await page.getByRole('button',{name:'新建共同思考',exact:true}).click();
  const input=page.getByRole('textbox',{name:'继续共同思考',exact:true}),submit=page.getByRole('button',{name:'留下这段思考',exact:true});
  await input.fill('');await input.press('ArrowUp');check('new discussion never exposes another discussion history',await page.getByRole('listbox',{name:'历史输入'}).count()===0);
  const sessionId=Object.values((await state()).product.host.sessions).at(-1).id;
  for(let n=0;n<53;n++){await input.fill('历史输入 '+String(n).padStart(2,'0')+'：观察与解释分开。');await submit.click();await page.waitForFunction(()=>document.querySelector('.wb-thinking-composer textarea')?.value==='');}
  let snapshot=await state();const original=snapshot.product.host.sessions[sessionId].messages;
  await input.press('ArrowUp');const history=page.getByRole('listbox',{name:'历史输入'});
  check('history shows the newest 50 saved user messages in reverse order',await history.getByRole('option').count()===50&&await history.getByRole('option').first().innerText()===original.at(-1).text&&await history.getByRole('option').last().innerText()===original[3].text);
  await input.press('End');await input.press('ArrowDown');check('history End is bounded and keeps textarea focus',await history.getByRole('option').last().getAttribute('aria-selected')==='true'&&await input.evaluate(e=>e===document.activeElement));
  await input.press('Home');await input.press('ArrowDown');await input.press('Enter');
  check('Enter recalls the selected text without sending or mutating history',await input.inputValue()===original.at(-2).text&&(await state()).product.host.sessions[sessionId].messages.length===53);
  await input.fill('多行草稿\n第二行');await input.press('ArrowUp');check('nonempty multiline drafts retain native editing and do not open history',await history.count()===0&&await input.inputValue()==='多行草稿\n第二行');
  await input.fill('');await input.evaluate(e=>e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));await input.press('ArrowUp');check('IME composition cannot open history',await history.count()===0);await input.evaluate(e=>e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
  await input.press('ArrowUp');await input.press('Escape');check('Escape restores the pre-history draft, selection and focus',await input.inputValue()===''&&await history.count()===0&&await input.evaluate(e=>e===document.activeElement&&e.selectionStart===0&&e.selectionEnd===0));
  await input.press('ArrowUp');await history.getByRole('option').first().click();await input.fill((await input.inputValue())+' 已编辑');await submit.click();await page.waitForFunction(()=>document.querySelector('.wb-thinking-composer textarea')?.value==='');
  snapshot=await state();check('reusing history creates a new message and leaves originals unchanged',snapshot.product.host.sessions[sessionId].messages.length===54&&JSON.stringify(snapshot.product.host.sessions[sessionId].messages.slice(0,53))===JSON.stringify(original));
  await input.press('ArrowUp');check('history menu is visibly anchored above the composer',await history.evaluate(e=>{const box=e.getBoundingClientRect(),input=document.querySelector('.wb-thinking-composer textarea').getBoundingClientRect();return box.top>=0&&box.bottom<=input.top&&box.bottom<innerHeight;}));await capture('ui-input-history');await input.press('Escape');
  // Long text is real user content: its punctuation must not be sanitised away.
  const long='长中文内容用于验证换行和滚动。'.repeat(800)+'\n用户原文 · 保留原样';
  await input.fill(long);await submit.click();await page.waitForFunction(()=>document.querySelector('.wb-thinking-composer textarea')?.value==='');check('user punctuation and long content are preserved verbatim',(await state()).product.host.sessions[sessionId].messages.at(-1).text===long);
  await page.keyboard.press('Control+k');await page.getByRole('textbox',{name:'搜索当前内容',exact:true}).fill('');await page.getByRole('textbox',{name:'搜索当前内容',exact:true}).press('ArrowDown');
  check('search Down transfers focus into real results',await page.locator('.wb-find-results [data-list-item]').first().evaluate(e=>e===document.activeElement));await page.keyboard.press('Escape');
  // Check computed text sizes and viewport overflow, including true Electron zoom.
  for(const factor of [1,1.25,1.5]){
    if(desktop)await app.evaluate(({BrowserWindow},factor)=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor),factor);
    else {await windowSize(Math.round(1440/factor),Math.round(940/factor));}
    const geometry=await page.evaluate(()=>{const sizes=new Set;for(const e of document.querySelectorAll('.wb-shell *')){if(e.getClientRects().length&&[...e.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim())){const value=parseFloat(getComputedStyle(e).fontSize);if(value>0)sizes.add(value);}}return {sizes:[...sizes],overflow:document.documentElement.scrollWidth>innerWidth};});
    reports.push({factor,geometry,zoom:desktop?'Electron webContents zoom':'equivalent CSS viewport; physical browser zoom not claimed'});
    check((desktop?'Electron zoom ':'browser equivalent viewport ')+factor+' keeps three text sizes and no document overflow',!geometry.overflow&&geometry.sizes.every(s=>[12,14,20].includes(s)));
  }
  if(desktop)await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  await windowSize(390,844);await capture('ui-narrow-collaboration');check('narrow collaboration fits without document horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await windowSize(1440,940);await nav('思考画布').click();await theme('dark');
  // Shut down and relaunch the actual isolated browser/app using its on-disk profile.
  if(desktop&&restartDesktop){({page,app}=await restartDesktop());}
  else if(!desktop&&restartBrowser){({page}=await restartBrowser());}
  else {await page.goto('about:blank');}
  await page.goto(base+'/app?view=canvas');await page.locator('[data-workbench-ready=true]').waitFor();
  check('appearance survives process restart with the same on-disk profile',await appearance()==='dark');
  await page.goto(base+'/app/demo?view=canvas');await page.waitForFunction(()=>document.documentElement.dataset.traceAppearance==='light');check('demo appearance does not inherit personal appearance',await appearance()==='light');
  await page.goto(base+'/app?view=canvas');await page.locator('[data-workbench-ready=true]').waitFor();check('returning to personal restores its independent dark appearance',await appearance()==='dark');
  await theme('system');await page.emulateMedia({reducedMotion:'reduce'});check('reduced motion also disables Portal and skeleton animations',await page.evaluate(()=>document.getAnimations().length===0));
  fs.writeFileSync(path.join(out,'ui-refinement.json'),JSON.stringify({reports,limits:['Physical IME and mobile software keyboard not exercised','Browser zoom represented by equivalent CSS viewports; Electron uses real webContents zoom','Process restart uses an isolated harness, not the installed desktop launcher']},null,2));
};

const readSinglePending=require('./workbench-pending-record.cjs');
// Full formal UI and its actual IndexedDB/SQLite owner. All fixture content is
// authored here; no simulated model response or provider execution is accepted.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {selectValue} = require('./select-control.cjs');

module.exports = async ({page, state, saved, check, capture, out, windowSize, desktop, restartDesktop, injectContentFailure, expectInvalidReference}) => {
  page.setDefaultTimeout(desktop ? 30000 : 8000);
  const button = name => page.getByRole('button', {name, exact:true});
  const box = name => page.getByRole('textbox', {name, exact:true});
  const nav = name => page.getByRole('navigation', {name:'三大工作区'}).getByRole('button', {name, exact:true});
  const host = async () => (await state()).product.host;
  const picker = () => page.getByRole('dialog', {name:/^(添加|替换)准确引用$/});
  const feedback = () => page.getByRole('dialog', {name:'记录能力反馈', exact:true});
  const latest = () => page.locator('dialog[open]').last();
  const closeLatest = async () => {
    const label = await latest().getAttribute('aria-label');
    await latest().getByRole('button', {name:'关闭对话框', exact:true}).click();
    await page.getByRole('dialog', {name:label, exact:true}).waitFor({state:'detached'});
  };
  const storedDraft = async () => page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('trace-workbench:personal:feedback:{') && JSON.parse(localStorage.getItem(k)).value?.title === '准确引用的原始观察');
    return key ? {key, value:JSON.parse(localStorage.getItem(key))} : null;
  });
  const createText = async (title, original, selection) => {
    await button('留下文字、网页或对话材料').click();
    const dialog = page.getByRole('dialog', {name:'留下材料', exact:true});
    await dialog.getByRole('textbox', {name:'材料标题', exact:true}).fill(title);
    const input = dialog.getByRole('textbox', {name:'完整原文', exact:true});
    await input.fill(original);
    if (selection) {
      await input.evaluate((e, range) => {e.focus(); e.setSelectionRange(...range); e.dispatchEvent(new Event('select', {bubbles:true}));}, selection);
      await dialog.getByRole('button',{name:'使用原文中的选段',exact:true}).click();
    }
    await dialog.getByRole('button', {name:'保存材料并放到画布', exact:true}).click();
    await dialog.waitFor({state:'detached'});
    await saved();
  };
  await windowSize(1440,940);
  await button('写下第一点想法').click();
  await box('标题').fill('可修订的原表达');
  await box('我的表达').fill('表达旧版本😀：先保留不同解释。');
  await button('保存修改').click(); await saved();
  const expression = Object.values((await host()).expressions).find(e=>e.title==='可修订的原表达');
  await box('我的表达').fill('表达新版本：后来解释不能覆盖旧引用。');
  await button('保存修改').click(); await saved();

  const original = '开头语境｜甲😀乙：这段事实需要保留，不把解释当证据。｜结束语境';
  const savedText = '甲😀乙：这段事实需要保留，不把解释当证据。';
  const baseStart = original.indexOf(savedText);
  await createText('最早的准确引用中文😀材料', original, [baseStart,baseStart+savedText.length]);
  const first = Object.values((await host()).materials)[0];
  check('UI capture saves a nonzero original offset and an independent immutable excerpt', first.versions[1].text === savedText && first.versions[1].origin.locator.start === baseStart);
  // Repeated genuine UI creates, not a direct reducer/import fixture. This
  // deliberately puts the first record outside the old last-50 checkbox window.
  for (let i=0;i<52;i++) await createText('稍后留下的材料 '+String(i).padStart(2,'0'), '自写无关语境 '+i);
  check('more than fifty real saved materials exist without replacing the oldest', Object.values((await host()).materials).length === 53);

  await nav('能力库').click(); await button('新建能力').click();
  await box('名称').fill('用于引用核对的能力');
  await box('解决什么需要').fill('能力旧版本的用途，仅作来源核对。');
  await button('保存草稿版本').click(); await page.getByText('草稿已保存',{exact:true}).waitFor(); await saved();
  let capability = Object.values((await host()).capabilities)[0], oldCapVersion=capability.version;
  await box('解决什么需要').fill('能力新版本的用途，不代表旧观察也使用新版。');
  await button('保存草稿版本').click(); await page.getByText('草稿已保存',{exact:true}).waitFor(); await saved();
  capability=(await host()).capabilities[capability.id];

  // The same formal import and manual extraction create bounded media sources.
  const {pdf,wav,video}=require('./workbench-materials.cjs').fixturesFor(out);
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><path fill="#a5b8a4" d="M0 0h400v300H0z"/><path fill="#446a61" d="M200 0h200v150H200z"/></svg>');
  await nav('思考画布').click();
  const media=[];
  for(const [kind,bytes,mime] of [['image',svg,'image/svg+xml'],['audio',wav,'audio/wav'],['video',video,'video/webm'],['pdf',pdf,'application/pdf']]) {
    const name='准确引用原件.'+({image:'svg',audio:'wav',video:'webm',pdf:'pdf'}[kind]);
    await page.locator('.wb-file-input').setInputFiles({name,mimeType:mime,buffer:bytes});
    const clear=button('移除队列记录 '+name); await clear.waitFor(); await clear.click(); await clear.waitFor({state:'detached'}); await saved();
    await page.getByRole('tab',{name:'来源',exact:true}).click();
    await button('从原件摘取线索').click();
    const captureDialog=page.getByRole('dialog',{name:'从原件摘取线索',exact:true});
    await captureDialog.getByRole('textbox',{name:'材料标题',exact:true}).fill(kind+' 已保存局部来源');
    if(kind==='audio'||kind==='video') {
      await captureDialog.getByText('实际原件时长 4.000 秒',{exact:true}).waitFor();
      await captureDialog.getByRole('textbox',{name:'开始时间（秒）',exact:true}).fill('1.250');
      await captureDialog.getByRole('textbox',{name:'结束时间（秒）',exact:true}).fill('2.500');
    } else {
      if(kind==='pdf') {await captureDialog.locator('.wb-pdf-preview[data-pdf-status=ready]').waitFor();await captureDialog.getByRole('textbox',{name:'PDF 页码',exact:true}).fill('2');await captureDialog.locator('.wb-pdf-preview[data-pdf-page="2"][data-pdf-status=ready]').waitFor();}
      for(const [label,value] of [['区域左侧（%）','50'],['区域顶部（%）','0'],['区域宽度（%）','50'],['区域高度（%）','50']]) await captureDialog.getByRole('textbox',{name:label,exact:true}).fill(value);
    }
    await captureDialog.getByRole('button',{name:'保存材料并放到画布',exact:true}).click();await captureDialog.waitFor({state:'detached'});await saved();
    media.push(Object.values((await host()).materials).find(m=>m.title===kind+' 已保存局部来源'));
  }
  const baseline = await state();
  fs.writeFileSync(path.join(out,'ui-created-source-baseline.json'),JSON.stringify(baseline,null,2));
  await nav('能力库').click();await button('待核对反馈').click();await button('先记录一次人工观察').click();
  await box('反馈标题').fill('准确引用的原始观察');await box('实际观察').fill('这些引用是我明确挑选的依据，不表示Agent已使用。');
  await button('添加准确引用').click();
  check('opening picker makes no authoritative write or implicit first selection',(await state()).product.revision===baseline.product.revision&&await picker().getByText('从列表选择要引用的内容，再核对范围。不会默认选中第一项。',{exact:true}).count()===1);
  const query = () => picker().getByRole('textbox',{name:'搜索可引用内容',exact:true});
  const selectHit = async (queryText,version) => {
    await query().fill(queryText);
    const rows=picker().locator('.wb-reference-result');
    await (version?rows.filter({hasText:new RegExp('v'+version+'(?:\\s|$)')}).first():rows.first()).click();
  };
  await query().fill('不存在的准确引用 查询');await query().press('Enter');
  check('empty search and Enter neither submit feedback nor lose the parent draft',await picker().getByText('没有匹配引用',{exact:true}).count()===1&&Object.keys((await host()).feedbacks||{}).length===0&&await feedback().count()===1);
  await selectHit(first.title);
  check('search finds the oldest material beyond fifty with the exact saved excerpt',await picker().getByRole('textbox',{name:'保存版本文字（可选中局部）',exact:true}).inputValue()===savedText);
  await selectValue(picker().getByRole('combobox',{name:'本次引用范围',exact:true}),'text');
  await picker().getByRole('textbox',{name:'引用开始字符',exact:true}).fill('2');
  await picker().getByRole('textbox',{name:'引用结束字符',exact:true}).fill('4');
  check('split surrogate boundary cannot be attached or silently rounded',await picker().getByRole('button',{name:'添加这份准确引用',exact:true}).isDisabled()&&await picker().getByText('选段不能切断完整字符。',{exact:true}).count()===1);
  await picker().getByRole('textbox',{name:'引用开始字符',exact:true}).fill('1');
  await picker().getByRole('textbox',{name:'引用结束字符',exact:true}).fill('4');
  await picker().getByRole('button',{name:'查看所选原件与定位',exact:true}).click();
  const originalDialog=page.getByRole('dialog',{name:'原件与摘取位置',exact:true});
  await originalDialog.locator('.wb-original-text mark').waitFor();
  check('text anchor composes a proven nonzero source offset, not a guessed match',await originalDialog.locator('.wb-original-text mark').innerText()==='😀乙'&&await originalDialog.locator('.wb-original-text').innerText()===original);
  await originalDialog.getByRole('button',{name:'返回线索',exact:true}).click();await originalDialog.waitFor({state:'detached'});
  await picker().getByRole('button',{name:'添加这份准确引用',exact:true}).click();
  check('attaching text changes only the local draft and keeps the original material immutable',(await storedDraft()).value.value.refs[0].anchor.start===1&&(await host()).materials[first.id].versions[1].text===savedText&&(await state()).product.revision===baseline.product.revision);
  check('duplicate accurate selection cannot append another identical reference',await picker().getByRole('button',{name:'已附到本地草稿',exact:true}).isDisabled());
  // Escape must dismiss only the top native dialog and restore its actual trigger.
  await query().focus();await page.keyboard.press('Escape');await picker().waitFor({state:'detached'});
  check('Escape closes only picker and restores focus to its parent action',await feedback().isVisible()&&await button('添加准确引用').evaluate(e=>document.activeElement===e));
  await button('替换这份引用').click();
  await picker().getByRole('textbox',{name:'引用结束字符',exact:true}).fill('7');
  await closeLatest();
  check('cancelled replacement keeps the attached original anchor and retains incomplete editing state',(await storedDraft()).value.value.refs[0].anchor.end===4&&(await storedDraft()).value.picker.end==='7');
  await button('替换这份引用').click();await picker().getByRole('textbox',{name:'引用结束字符',exact:true}).fill('5');await picker().getByRole('button',{name:'明确替换这份引用',exact:true}).click();
  check('confirmed replacement changes only one local citation without an authoritative write',(await storedDraft()).value.value.refs.length===1&&(await storedDraft()).value.value.refs[0].anchor.end===5&&(await state()).product.revision===baseline.product.revision);
  await picker().getByRole('button',{name:'完成选择，返回反馈',exact:true}).click();await picker().waitFor({state:'detached'});
  await button('替换这份引用').click();await picker().getByRole('textbox',{name:'引用结束字符',exact:true}).fill('4');await picker().getByRole('button',{name:'明确替换这份引用',exact:true}).click();
  check('a second deliberate replacement restores the exact selected text rather than adding a copy',(await storedDraft()).value.value.refs.length===1&&(await storedDraft()).value.value.refs[0].anchor.end===4);
  await selectValue(picker().getByRole('combobox',{name:'引用查找范围',exact:true}),'expression');
  await picker().getByRole('checkbox',{name:'包括历史保存版本',exact:true}).check();
  await selectHit(expression.title,expression.version);
  await picker().getByRole('button',{name:'添加这份准确引用',exact:true}).click();
  check('historical expression is frozen to its selected version, not advanced to current',(await storedDraft()).value.value.refs.some(r=>r.kind==='expression'&&r.id===expression.id&&r.version===expression.version)&&(await host()).expressions[expression.id].version>expression.version);
  await selectValue(picker().getByRole('combobox',{name:'引用查找范围',exact:true}),'capability');
  await selectHit(capability.title,oldCapVersion);await picker().getByRole('button',{name:'添加这份准确引用',exact:true}).click();
  check('historical capability is an explicit citation without adopting it as the feedback target',(await storedDraft()).value.value.refs.some(r=>r.kind==='capability'&&r.id===capability.id&&r.version===oldCapVersion)&&(await storedDraft()).value.value.target===null);

  for(const material of media) {
    await selectValue(picker().getByRole('combobox',{name:'引用查找范围',exact:true}),'material');await selectHit(material.title);
    await selectValue(picker().getByRole('combobox',{name:'本次引用范围',exact:true}),'media');
    if(material.kind==='audio'||material.kind==='video') {
      await picker().getByRole('textbox',{name:'引用开始毫秒',exact:true}).fill('1000');
      await picker().getByRole('textbox',{name:'引用结束毫秒',exact:true}).fill('2000');
    } else {
      for(const [label,value] of [['引用左侧百分比','25'],['引用顶部百分比','5'],['引用宽度百分比','20'],['引用高度百分比','20']])await picker().getByRole('textbox',{name:label,exact:true}).fill(value);
    }
    check(material.kind+' cannot widen the saved source range',await picker().getByRole('button',{name:'添加这份准确引用',exact:true}).isDisabled()&&await picker().getByText('引用范围尚未就绪',{exact:true}).count()===1);
    if(material.kind==='audio'||material.kind==='video') await picker().getByRole('textbox',{name:'引用开始毫秒',exact:true}).fill('1500');
    else await picker().getByRole('textbox',{name:'引用左侧百分比',exact:true}).fill('60');
    if(material.kind==='audio'||material.kind==='video') {
      await picker().locator(material.kind).waitFor();
      await picker().locator(material.kind).evaluate(e=>{e.muted=true;});
      await page.waitForFunction(selector=>{const e=document.querySelector(selector);return e?.readyState>=1&&!e.seeking&&Math.abs(e.currentTime-1.5)<.03;},'.wb-reference-dialog '+material.kind);
      check(material.kind+' preview actually seeks after changing the draft anchor',Math.abs(await picker().locator(material.kind).evaluate(e=>e.currentTime)-1.5)<.03);
    }
    await picker().getByRole('button',{name:'查看所选原件与定位',exact:true}).click();await originalDialog.waitFor();
    if(material.kind==='pdf'){await originalDialog.locator('.wb-pdf-preview[data-pdf-page="2"][data-pdf-status=ready]').waitFor();check('PDF original keeps actual page and highlights the narrowed region',await originalDialog.locator('.wb-source-region').count()===1&&await originalDialog.getByText(/第 2 页/).count()>0);}
    else if(material.kind==='image'){await originalDialog.locator('img').waitFor();check('image original marks the narrowed original-coordinate region',Math.abs(await originalDialog.locator('.wb-source-region').evaluate(e=>parseFloat(e.style.left))-60)<.001);}
    else {await page.waitForFunction(selector=>{const e=document.querySelector(selector);return e?.readyState>=1&&!e.seeking&&Math.abs(e.currentTime-1.5)<.03;},'dialog[aria-label="原件与摘取位置"] '+material.kind);check(material.kind+' original starts at the exact chosen fragment',Math.abs(await originalDialog.locator(material.kind).evaluate(e=>e.currentTime)-1.5)<.03);}
    await originalDialog.getByRole('button',{name:'返回线索',exact:true}).click();await originalDialog.waitFor({state:'detached'});
    await picker().getByRole('button',{name:'添加这份准确引用',exact:true}).click();
  }
  await picker().getByRole('button',{name:'完成选择，返回反馈',exact:true}).click();await picker().waitFor({state:'detached'});
  const refs=(await storedDraft()).value.value.refs;check('all citations retain their own identity, version and local anchor without copying content',refs.length===7&&refs.every(r=>Object.keys(r).every(k=>['kind','id','version','anchor'].includes(k))));
  await button('只读查看这份引用').first().click();
  check('attached source preview reads only its exact chosen text',await latest().getByLabel('反馈引用文字',{exact:true}).innerText()==='😀乙');await button('返回反馈').click();

  // Save failure and newer local edits: the original persisted command, not the
  // latest picker selection, is retried by the existing single recovery owner.
  await injectContentFailure();await button('保存这条反馈').click();await button('核对并重试原命令').waitFor();
  const pending=JSON.parse(await readSinglePending(page));
  const attachment=page.locator('.wb-feedback-attachments article').first();await attachment.getByRole('button',{name:'从反馈草稿移除，不删原件',exact:true}).click();
  await box('实际观察').fill('保存失败后继续编辑的观察，尚未提交。');await button('核对并重试原命令').click();await saved();
  await page.getByText('原请求已核对保存；后来编辑的草稿仍保留，尚未保存。',{exact:true}).waitFor();
  let record=Object.values((await host()).feedbacks)[0];
  check('original-command retry commits seven original citations once, not the newer local draft',record.version===1&&record.versions[1].refs.length===7&&(await storedDraft()).value.value.refs.length===6&&pending!==null&&record.versions[1].facts!=='保存失败后继续编辑的观察，尚未提交。');

  // The original new-record form intentionally keeps later content. Reopen its
  // saved record, then explicitly reattach the oldest source and save version 2.
  await closeLatest();await button('待核对反馈').click();await page.locator('.wb-feedback-row').filter({hasText:record.title}).click();await button('编辑观察或核对版本').click();
  await box('实际观察').fill('检索当前反馈的明确事实');await button('保存反馈新版本').click();await button('编辑观察或核对版本').waitFor();await saved();
  record=(await host()).feedbacks[record.id];
  check('a subsequent explicit edit appends history without modifying original citation versions',record.version===2&&record.versions[1].refs.length===7&&record.versions[2].refs.length===7&&(await host()).materials[first.id].versions[1].text===savedText);
  await closeLatest();

  const search=async(queryText,history=false)=>{await page.keyboard.press('Control+k');await box('搜索当前内容').fill(queryText);await selectValue(page.getByRole('combobox',{name:'查找范围',exact:true}),'feedback');await page.getByRole('checkbox',{name:'包括历史正文版本',exact:true}).setChecked(history);};
  await search('检索当前反馈的明确事实');
  check('global search finds current feedback facts without a canvas-placement action',await page.locator('.wb-find-row').count()===1&&await page.locator('.wb-find-row .wb-button').count()===0);
  await page.locator('.wb-find-row [data-list-item]').click();await page.getByRole('dialog',{name:'能力版本反馈',exact:true}).waitFor();
  check('search opens the exact saved feedback version',await page.getByRole('combobox',{name:'查看反馈保存版本',exact:true}).getAttribute('data-selected-value')==='2');
  await page.getByRole('dialog',{name:'能力版本反馈',exact:true}).getByRole('button',{name:'返回搜索结果',exact:true}).click();check('return preserves feedback query and filter',await box('搜索当前内容').inputValue()==='检索当前反馈的明确事实'&&await page.getByRole('combobox',{name:'查找范围',exact:true}).getAttribute('data-selected-value')==='feedback');
  await box('搜索当前内容').fill('这些引用是我明确挑选的依据');await page.getByRole('checkbox',{name:'包括历史正文版本',exact:true}).check();await page.locator('.wb-find-row [data-list-item]').click();
  check('historical feedback search stays readonly on the actual matching old version',await page.getByRole('combobox',{name:'查看反馈保存版本',exact:true}).getAttribute('data-selected-value')==='1'&&await button('编辑观察或核对版本').count()===0&&await button('返回当前反馈').count()===1);
  await button('返回当前反馈').click();await page.locator('summary').filter({hasText:'撤回错误反馈'}).click();await box('反馈状态修改原因').fill('检索中也应保留错误观察及其历史');await button('撤回反馈，不删除历史').click();await button('明确恢复反馈').waitFor();await saved();await closeLatest();
  await search('准确引用的原始观察');
  check('withdrawn feedback remains findable with explicit current-state labeling',await page.locator('.wb-find-row').count()===1&&await page.locator('.wb-find-row').innerText().then(t=>t.includes('反馈当前已撤回')));
  await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'找回内容',exact:true}).waitFor({state:'detached'});

  // An otherwise structurally valid local draft with a widened clip must be
  // rejected by the actual Product owner, not just by client-side controls.
  await button('待核对反馈').click();await button('先记录一次人工观察').click();if(await button('记录另一条观察').count())await button('记录另一条观察').click();
  await box('反馈标题').fill('准确引用的原始观察');await box('实际观察').fill('Product校验不能被损坏草稿绕开');
  const draftInfo=await storedDraft();await closeLatest();
  const clip=media.find(m=>m.kind==='audio'),beforeInvalid=await state();
  await page.evaluate(({key,value,clip})=>{value.value.refs=[{kind:'material',id:clip.id,version:1,anchor:{type:'time',startMs:100,endMs:2000}}];localStorage.setItem(key,JSON.stringify(value));},{...draftInfo,clip});
  await button('待核对反馈').click();await button('先记录一次人工观察').click();expectInvalidReference();await button('保存这条反馈').click();
  await feedback().locator('summary').filter({hasText:'失败详情与其他恢复方式'}).click();
  await page.getByText('引用时间不能超出这份材料已保存的片段。',{exact:true}).waitFor();
  check('actual Product rejects a widened clip atomically and retains the local draft',(await state()).product.revision===beforeInvalid.product.revision&&Object.keys((await host()).feedbacks).length===1&&(await storedDraft()).value.value.refs[0].anchor.startMs===100);
  await button('添加准确引用').click();await selectHit(clip.title);await selectValue(picker().getByRole('combobox',{name:'本次引用范围',exact:true}),'media');await picker().getByRole('textbox',{name:'引用开始毫秒',exact:true}).fill('1500');await picker().getByRole('textbox',{name:'引用结束毫秒',exact:true}).fill('2000');
  const previousDraft=await storedDraft();await closeLatest();await closeLatest();
  const restart=async()=>{if(desktop)page=(await restartDesktop({abrupt:true})).page;else {const accept=d=>void d.accept().catch(()=>{});page.on('dialog',accept);await page.reload();page.off('dialog',accept);}await page.locator('[data-workbench-ready=true]').waitFor();};
  await restart();await nav('能力库').click();await button('待核对反馈').click();await button('先记录一次人工观察').click();await button('添加准确引用').click();
  check('actual refresh/process restart retains query, chosen identity and unsaved narrowed range',(await storedDraft()).value.picker.query===previousDraft.value.picker.query&&await picker().getByRole('textbox',{name:'引用开始毫秒',exact:true}).inputValue()==='1500'&&JSON.stringify((await storedDraft()).value.picker.selected)===JSON.stringify(previousDraft.value.picker.selected));
  const geometry=[];
  for(const appearance of ['light','dark']) {
    await windowSize(390,620);await page.emulateMedia({colorScheme:appearance,reducedMotion:'reduce'});await page.waitForFunction(v=>document.documentElement.dataset.traceAppearance===v,appearance);
    const bounds=await picker().boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+180);
    for(let i=0;i<8;i++){await page.mouse.wheel(0,700);await page.waitForTimeout(30);}
    const g=await picker().evaluate(d=>{const close=d.querySelector('header button'),done=[...d.querySelectorAll('button')].find(b=>b.textContent==='完成选择，返回反馈'),rect=e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom}};return{overflow:d.scrollWidth-d.clientWidth,scroll:d.scrollTop,close:rect(close),done:rect(done),height:innerHeight};});
    geometry.push({appearance,...g});check(appearance+' narrow picker keeps close and finish reachable by actual wheel',g.overflow<=1&&g.scroll>0&&g.close.top>=0&&g.close.bottom<=g.height&&g.done.top>=0&&g.done.bottom<=g.height);await capture('reference-picker-short-'+appearance+'-current-render');
  }
  fs.writeFileSync(path.join(out,'reference-layout-observations.json'),JSON.stringify(geometry,null,2));
  await windowSize(1440,940);await page.emulateMedia({colorScheme:'light',reducedMotion:'no-preference'});await closeLatest();
  const recovery=feedback().getByRole('region',{name:'未确认操作恢复',exact:true});
  if(!await recovery.getByRole('button',{name:'保留本地草稿，读取当前版本',exact:true}).isVisible())await recovery.locator('summary').click();
  const rejectedOriginal=await readSinglePending(page);await recovery.getByRole('button',{name:'保留本地草稿，读取当前版本',exact:true}).click();check('ordinary authoritative reread retains the exact rejected request',await readSinglePending(page)===rejectedOriginal);page.once('dialog',dialog=>dialog.accept());await recovery.getByRole('button',{name:'停止重试这份本地请求',exact:true}).click();await recovery.waitFor({state:'detached'});
  check('explicit local stop after reread retains the later reference draft and does not save or cancel a server command',(await state()).product.revision===beforeInvalid.product.revision&&await readSinglePending(page)===null&&(await storedDraft()).value.picker.start==='1500'&&(await storedDraft()).value.value.refs[0].anchor.startMs===100);
  await closeLatest();
  fs.writeFileSync(path.join(out,'reference-final-state.json'),JSON.stringify({product:(await state()).product,media:media.map(m=>({id:m.id,kind:m.kind,source:m.versions[1].origin})),scope:'Real UI-created citations and feedback retrieval; no model execution, user database, packaged main or physical IME acceptance.'},null,2));
};

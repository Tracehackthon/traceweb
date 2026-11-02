// Real formal UI + real storage; view-state fixtures are explicitly declared.
// Never submits a model request. Native gates delay an actual readonly reply.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {selectValue,selectedValue}=require('./select-control.cjs');
module.exports=async({page,state,saved,check,out,desktop,id,candidates,questionId,app})=>{
  const panel=()=>page.getByRole('region',{name:'激活旧线索工作面',exact:true}),btn=(name,scope=page)=>scope.getByRole('button',{name,exact:true}),box=(name,scope=page)=>scope.getByRole('textbox',{name,exact:true});
  const host=async()=>(await state()).product.host,key='trace-workbench:personal:activation:'+id+':reading';
  const stable=async()=>{await page.waitForFunction(()=>!document.querySelector('.wb-activation-panel [data-animating]'));};
  const restored=async()=>{await panel().waitFor();await page.waitForFunction(()=>document.querySelector('.wb-activation-panel')?.getAttribute('data-reading-restored')==='done');};
  const open=async()=>{await btn('激活旧线索').click();await restored();},close=async()=>{await btn('收起激活工作面',panel()).click();await panel().waitFor({state:'detached'});};
  const choose=async value=>{await selectValue(panel().getByRole('combobox',{name:'本画布探索记录',exact:true}),value);await restored();};
  const card=n=>panel().locator('[data-activation-candidate='+JSON.stringify(candidates[n].id)+']');
  const editRelation=async n=>{const scope=card(n);if(!await scope.locator('.wb-relation').count())await btn('查看或修订原关系',scope).click();const edit=btn('编辑关系说明',scope);if(await edit.count())await edit.click();await box('关系理由',scope).waitFor();};
  const saveRelation=async n=>{const scope=card(n);await btn('保存关系修订',scope).click();await scope.getByText('关系修订已保存，旧理由与来源仍保留。',{exact:true}).waitFor();await btn('编辑关系说明',scope).waitFor();await saved();};
  const disclosure=async(scope,title,open)=>{const summary=scope.locator('summary').filter({hasText:new RegExp('^'+title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')});assert.equal(await summary.count(),1,title);if(await summary.evaluate(e=>e.parentElement.open)!==open)await summary.click();await stable();};
  const read=()=>page.evaluate(key=>{const raw=localStorage.getItem(key);let meta=null;try{meta=JSON.parse(raw||'null');}catch{}return{raw,meta,top:document.querySelector('.wb-activation-body')?.scrollTop};},key);
  await choose(id);await btn('扩大工作面',panel()).click();await disclosure(panel(),'冻结范围：1 个起点 / 5 个候选材料',true);
  await disclosure(card(0),'候选原稿与人工处理历史',true);
  await editRelation(4);
  await box('关系理由',card(4)).fill('阅读验证中的真实修订：仍保留原候选，不把同框当作依据。');await saveRelation(4);
  await disclosure(card(4),'关系演变与原理由',true);
  await selectValue(card(4).getByRole('combobox',{name:'关系历史版本',exact:true}),2);await selectValue(card(4).getByRole('combobox',{name:'关系历史版本',exact:true}),1);
  // Reproduce the independent source33 counterexample: the displayed default
  // old version is a reading choice even without an onValueChange event.
  await editRelation(2);await box('关系理由',card(2)).fill('旁支关系真实v2：保留历史观察，不追随最新跳转。');await saveRelation(2);await close();await open();
  await disclosure(card(2),'关系演变与原理由',true);const branchHistory=card(2).getByRole('combobox',{name:'关系历史版本',exact:true});assert.equal(await selectedValue(branchHistory),'2');
  await editRelation(2);await box('关系理由',card(2)).fill('旁支关系真实v3：阅读仍在看v2，不自动换成新判断。');await saveRelation(2);
  assert.equal(await selectedValue(branchHistory),'2');const branchOut=(await host()).activations[id].decisions[candidates[2].id].at(-1).output,branchCanonical=JSON.stringify((await host()).relations[branchOut.relationId]);await close();const implicit=await read();await open();
  check('observed default old history remains v2 after real v3 editing and reopen without a synthetic selection',implicit.meta.values['relation:'+branchOut.relationId+':version']===2&&await selectedValue(branchHistory)==='2'&&JSON.stringify((await host()).relations[branchOut.relationId])===branchCanonical);
  const original=card(0).locator('[data-activation-scroll-key]');await original.hover();await page.mouse.wheel(0,280);await page.waitForFunction(()=>document.querySelector('[data-activation-scroll-key$=":original"]')?.scrollTop>20);
  const expectedInner=await original.evaluate(e=>e.scrollTop),before=await state();await close();const reading=await read();
  check('reading checkpoint stores expanded structure, explicit history selection and inner scroll, not a second body',reading.meta.schemaVersion===1&&reading.meta.expanded&&reading.meta.open['request:scope']&&reading.meta.open['candidate:'+candidates[0].id+':original']&&reading.meta.values['candidate:'+candidates[4].id+':relation']&&Object.values(reading.meta.values).includes(1)&&reading.meta.values['scroll:candidate:'+candidates[0].id+':original:y']===expectedInner&&!JSON.stringify(reading.meta).includes(candidates[0].commonality));
  await open();
  check('closing and reopening restores expanded frame and the same native disclosures',await panel().evaluate(e=>e.classList.contains('is-expanded'))&&await card(0).locator('details').filter({has:page.locator('summary').filter({hasText:'候选原稿与人工处理历史'})}).evaluate(e=>e.open)&&await card(4).getByRole('combobox',{name:'关系历史版本',exact:true}).count()===1);
  check('reopening restores the selected real old relation version and internal JSON scroll',await selectedValue(card(4).getByRole('combobox',{name:'关系历史版本',exact:true}))==='1'&&Math.abs(await original.evaluate(e=>e.scrollTop)-expectedInner)<2);
  check('view restoration does not create a Product revision or a layout command',JSON.stringify(await state())===JSON.stringify(before));
  await close();await page.reload();await page.locator('[data-workbench-ready=true]').waitFor();await open();
  check('full page reload restores the exact owner, expansion and nested history',await panel().getAttribute('data-reading-owner')===reading.meta.owner&&await panel().evaluate(e=>e.classList.contains('is-expanded'))&&await selectedValue(card(4).getByRole('combobox',{name:'关系历史版本',exact:true}))==='1'&&Math.abs(await original.evaluate(e=>e.scrollTop)-expectedInner)<2);
  const oldQuestion=(await host()).expressions[questionId],questionText='阅读接续修订：展开、历史和返回不另造正文。';
  await btn('继续编辑写回的问题',card(1)).click();await panel().waitFor({state:'detached'});await box('我的表达').fill(questionText);await btn('保存修改').click();await saved();await btn('返回本次激活探索').click();await restored();
  const revised=(await host()).expressions[questionId];
  check('real edit and explicit return preserve the same candidate, expanded states and input focus',revised.version===oldQuestion.version+1&&revised.versions[oldQuestion.version].text===oldQuestion.versions[oldQuestion.version].text&&await panel().evaluate(e=>e.classList.contains('is-expanded'))&&await selectedValue(card(4).getByRole('combobox',{name:'关系历史版本',exact:true}))==='1'&&await page.evaluate(()=>document.activeElement?.getAttribute('data-activation-focus-key'))==='candidate:'+candidates[1].id+':continue');
  const other=Object.values((await host()).activations).find(r=>r.id!==id&&r.result?.candidates.length===0);await choose(other.id);await disclosure(panel(),'冻结范围：1 个起点 / 5 个候选材料',false);check('another exploration starts from its own compact reading state',!await panel().evaluate(e=>e.classList.contains('is-expanded')));await choose(id);check('switching records does not import another exploration expansion or history choices',await panel().evaluate(e=>e.classList.contains('is-expanded'))&&await selectedValue(card(4).getByRole('combobox',{name:'关系历史版本',exact:true}))==='1');
  const canonical=JSON.stringify(await state()),good=(await read()).raw;
  for(const [label,raw]of [['invalid-json','{not-reading-json'],['unknown-version',JSON.stringify({schemaVersion:99,expanded:true})],['wrong-owner',JSON.stringify({...JSON.parse(good),owner:'another-workspace/another-activation'})]]){
    await close();await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key,raw});await btn('激活旧线索').click();await panel().getByText('阅读恢复信息需要核对',{exact:true}).waitFor();
    await btn('扩大工作面',panel()).click();check(label+' reading record remains byte-exact after actual view interaction',(await read()).raw===raw&&JSON.stringify(await state())===canonical);
    const exported=path.join(out,'reading-'+label+'.json');
    if(desktop){const start=await app.evaluate(()=>globalThis.__traceDownloads?.length||0);await btn('原样导出阅读恢复记录',panel()).click();let receipt;for(let i=0;i<100;i++){receipt=await app.evaluate((_,start)=>globalThis.__traceDownloads?.slice(start).find(d=>d.filename==='Trace-activation-reading-recovery.json'&&d.state==='completed'),start);if(receipt)break;await page.waitForTimeout(50);}assert.ok(receipt,'actual Electron will-download must complete');assert.equal(receipt.path,path.join(out,'Trace-activation-reading-recovery.json'));fs.copyFileSync(receipt.path,exported);}
    else{const wait=page.waitForEvent('download');await btn('原样导出阅读恢复记录',panel()).click();await(await wait).saveAs(exported);}
    check(label+' export contains the exact original bytes',fs.readFileSync(exported,'utf8')===raw);
    page.once('dialog',dialog=>dialog.dismiss());await btn('明确重置这份阅读恢复',panel()).click();check(label+' cancelling reset preserves original metadata',(await read()).raw===raw);
    const otherKeys=await page.evaluate(key=>Object.fromEntries(Object.keys(localStorage).filter(k=>k!==key).map(k=>[k,localStorage.getItem(k)])),key);
    page.once('dialog',dialog=>dialog.accept());await btn('明确重置这份阅读恢复',panel()).click();await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.schemaVersion===1,key);
    check(label+' explicit reset affects only reading metadata, never content or another draft',JSON.stringify(await state())===canonical&&JSON.stringify(await page.evaluate(key=>Object.fromEntries(Object.keys(localStorage).filter(k=>k!==key).map(k=>[k,localStorage.getItem(k)])),key))===JSON.stringify(otherKeys));
  }
  await close();await page.evaluate(({key,good})=>localStorage.setItem(key,good),{key,good});await open();
  if(desktop){
    await btn('沿此范围再探索',panel()).click();await btn('保存这次探索范围',panel()).click();await saved();const r=Object.values((await host()).activations).at(-1),prepared=JSON.stringify(await state());
    await btn('核对本次实际发送范围',panel()).click();await panel().getByText('6 份冻结片段 · 不含其它历史或原件',{exact:true}).waitFor();await close();
    await app.evaluate(()=>{globalThis.__readingPreviewGate={enabled:true,seen:false,release:null};});await btn('激活旧线索').click();await panel().waitFor();
    for(let i=0;i<100&&!await app.evaluate(()=>Boolean(globalThis.__readingPreviewGate?.seen));i++)await page.waitForTimeout(50);
    const held=await app.evaluate(()=>({seen:globalThis.__readingPreviewGate?.seen,activationId:globalThis.__readingPreviewGate?.activationId}));assert.ok(held.seen&&held.activationId===r.id,'gate holds a real exact input preview');
    check('restoring input preview waits for the actual readonly owner response without provider execution',await panel().getAttribute('data-reading-restored')==='pending'&&JSON.stringify(await state())===prepared);
    await disclosure(panel(),'人工整理候选（不是AI发现）',true);const edit=box('本次人工核对说明',panel());await edit.fill('用户已经继续输入，迟到恢复不得抢位置或改稿。');const focus=await edit.evaluate(e=>e===document.activeElement);
    await app.evaluate(()=>{globalThis.__readingPreviewGate.enabled=false;globalThis.__readingPreviewGate.release();});await panel().getByText('6 份冻结片段 · 不含其它历史或原件',{exact:true}).waitFor();
    check('user interaction cancels pending reading restoration and late preview cannot replace the draft or focus',focus&&await panel().getAttribute('data-reading-restored')==='cancelled'&&await edit.inputValue()==='用户已经继续输入，迟到恢复不得抢位置或改稿。'&&await edit.evaluate(e=>e===document.activeElement)&&JSON.stringify(await state())===prepared);
    const rows=await app.evaluate(async(_electron,file)=>{const {DatabaseSync}=process.getBuiltinModule('node:sqlite');const db=new DatabaseSync(file,{readOnly:true});try{return db.prepare('SELECT id,status,result,raw_output FROM attempts').all();}finally{db.close();}},path.join(out,'executions/agent.sqlite'));
    check('local input preview and view restore leave the actual Agent attempt ledger empty',rows.length===0);fs.writeFileSync(path.join(out,'reading-native-ledger.json'),JSON.stringify({fixture:'no-provider; actual readonly preview delayed',rows,held},null,2));
  }
  fs.writeFileSync(path.join(out,'reading-final-state.json'),JSON.stringify({state:await state(),reading:await read()},null,2));
};

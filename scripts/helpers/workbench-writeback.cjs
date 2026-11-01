// Full real application + native owner. Reuses only the closed, self-authored
// genuine-result fixture; this driver can never start an Agent/model operation.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {selectValue}=require('./select-control.cjs');
const original=require('./workbench-feedback-source.cjs');

exports.run=async({page,state,saved,check,capture,out,desktop,source})=>{
 assert.ok(desktop);
 const destination=process.env.TRACE_WRITEBACK_TARGET||'new-expression:question';
 assert.ok(['new-expression:note','new-expression:question','new-expression:understanding','new-expression:attempt','expression','relation','branch:question','saved','rejected','cancel'].includes(destination));
 const baseline=structuredClone((await state()).product.host),host=async()=>(await state()).product.host;
 const nav=name=>page.getByRole('navigation',{name:'三大工作区'}).getByRole('button',{name,exact:true});
 const b=(scope,name)=>scope.getByRole('button',{name,exact:true});
 await nav('Agent 协作').click();await page.locator('[data-record-id="'+source.run.sessionId+'"]').click();
 await selectValue(page.getByRole('combobox',{name:'选择思考消息',exact:true}),source.run.messageId);
 const item=page.locator('.wb-execution[data-run-id="'+source.run.id+'"] [data-item-id="paragraph-3"]');
 await item.getByRole('textbox',{name:'本项采纳正文',exact:true}).waitFor();
 check('genuine reviewed result is displayed by actual native source, with no new execution',await page.locator('.wb-execution[data-run-id="'+source.run.id+'"]').getAttribute('data-status')==='succeeded');
 const title='Writeback-'+destination.replace(/[:]/g,'-'),text='WritebackBodyNeedle：这是用户核对后的新表达，不是AI原稿或普遍成立的结论。';
 await item.getByRole('textbox',{name:'本项采纳正文',exact:true}).fill(text);
 const before=JSON.stringify((await state()).product);
 if(['saved','rejected','cancel'].includes(destination)){
  await b(item,destination==='saved'?'仅保留本项':destination==='rejected'?'不采纳本项':'取消本次写回，保留草稿').click();
  if(destination==='cancel'){await b(item,'继续这份写回草稿').click();check('cancel preserves editable writeback and does not mutate canonical content',await item.getByRole('textbox',{name:'本项采纳正文',exact:true}).inputValue()===text&&JSON.stringify((await state()).product)===before);}
  else {await item.getByText(destination==='saved'?'本项仅保留，未写入内容。可以重新核对再决定。':'本项不采纳，原稿仍保留。可以重新核对再决定。',{exact:true}).waitFor();check('non-adoption records only the real decision, not a fabricated writeback',JSON.stringify((await state()).product)===before&&await item.getByRole('textbox',{name:'本项采纳正文',exact:true}).inputValue()===text);}
 }else{
  let chosen=destination;
  const expression=Object.values(baseline.expressions).find(e=>e.author==='user'&&e.kind!=='ink');
  if(destination==='expression'){assert.ok(expression);chosen='expression:'+expression.id;}
  await selectValue(item.getByRole('combobox',{name:'采纳位置',exact:true}),chosen);
  if(destination!=='relation')await item.getByRole('textbox',{name:'写回内容名称',exact:true}).fill(title);
  const pick=async(which,ref)=>{
   await item.getByRole('button',{name:new RegExp('^选择关系'+(which==='from'?'起点':'终点')+'：')}).click();
   const modal=page.getByRole('dialog',{name:'添加准确引用',exact:true});
   const entry=baseline[{material:'materials',expression:'expressions',capability:'capabilities'}[ref.kind]][ref.id];
   await modal.getByRole('textbox',{name:'搜索可引用内容',exact:true}).fill(entry.title);
   const row=modal.locator('[data-reference-key="'+ref.kind+':'+ref.id+':'+ref.version+'"]');
   assert.equal(await row.count(),1,'exact saved title/version must identify one picker row');await row.click();
   await b(modal,'添加这份准确引用').click();await modal.waitFor({state:'detached'});
  };
  const material=Object.values(baseline.materials)[0],from={kind:'material',id:material.id,version:material.version};
  if(destination==='relation'||destination.startsWith('branch:')){
   await pick('from',from);
   if(destination==='relation'){assert.ok(expression);await pick('to',{kind:'expression',id:expression.id,version:expression.version});await item.getByRole('textbox',{name:'关系依据',exact:true}).fill('用户明确比较这两份保存内容；不冒充模型已证明的事实。');}
   await item.getByRole('textbox',{name:'差异与适用边界',exact:true}).fill('来源与语境不同，不能直接等同。');
   await item.getByRole('textbox',{name:'仍不确定的地方',exact:true}).fill('仍需实际观察，尚未验证。');
  }
  await capture('writeback-before-'+destination.replace(/[:]/g,'-'));await b(item,'确认采纳本项').click();await item.locator('[aria-label="已采纳正文"]').waitFor();await saved();
  let next=await host();const ledger=new DatabaseSync(path.join(out,'executions/agent.sqlite'),{readOnly:true}),adoption=ledger.prepare('SELECT plan,status FROM adoptions WHERE run_id=? AND item_id=? ORDER BY rowid DESC LIMIT 1').get(source.run.id,'paragraph-3');ledger.close();assert.equal(adoption.status,'committed');const plan=JSON.parse(adoption.plan),ref=plan.targetRef;
  check('actual native adoption points to exact protected original and saved reviewed text',plan.reviewedText===text&&next.expressions[plan.source.id].author==='agent'&&next.expressions[plan.source.id].versions[1].text===source.run.result.answer&&plan.source.version===1&&plan.source.anchor?.type==='text');
  if(destination==='relation'){
   const relation=next.relations[ref.id];check('a reviewed relationship preserves both exact ends and distinct evidence/difference/uncertainty/source',relation.status==='accepted'&&relation.from.id===material.id&&relation.to.id===expression.id&&relation.sources[0].id===plan.source.id&&relation.difference==='来源与语境不同，不能直接等同。'&&relation.uncertainty==='仍需实际观察，尚未验证。');
   await b(item,'查看这条关系的起点').click();await page.getByRole('tab',{name:'关联',exact:true}).click();const panel=page.locator('[aria-label="关系 '+ref.id+'"]');await b(panel,'编辑关系说明').click();await panel.getByRole('textbox',{name:'关系理由',exact:true}).fill('RevisedRelationNeedle：只在明确边界内参考。');await b(panel,'保存关系修订').click();await page.waitForFunction(()=>document.body.textContent.includes('关系修订已保存'));
   next=await host();check('direct relationship edit preserves exact old reason and provenance as history without repeated adoption',next.relations[ref.id].version===2&&next.relations[ref.id].history[0].reason===text&&next.relations[ref.id].modifiedBy==='user'&&next.relations[ref.id].reason.startsWith('RevisedRelationNeedle'));
   for(const [label,status]of [['暂存，尚不认可','saved'],['本次不采用关系','rejected'],['认可这条关系','accepted'],['解除关联，不删除材料','detached']]){await b(panel,label).click();await page.waitForFunction(({id,status})=>document.querySelector('[aria-label="关系 '+id+'"] > strong')?.textContent===({saved:'暂存关系，未认可',rejected:'本次不采用',accepted:'用户认可的关系',detached:'已解除关系'})[status],{id:ref.id,status});assert.equal((await host()).relations[ref.id].status,status);}
   check('detaching keeps both saved endpoints and complete relation versions, not a hidden delete',JSON.stringify((await host()).materials)===JSON.stringify(baseline.materials)&&JSON.stringify((await host()).expressions[expression.id])===JSON.stringify(expression)&&(await host()).relations[ref.id].history.length===5);
  }else{
   const value=next.expressions[ref.id];check('typed or existing expression is the actual single versioned user object',value.author==='user'&&value.versions[ref.version].text===text&&(destination==='expression'?value.version===expression.version+1&&JSON.stringify(value.versions[expression.version])===JSON.stringify(expression.versions[expression.version]):value.kind===destination.split(':')[1]&&value.version===1)&&value.versions[ref.version].refs.some(r=>r.id===plan.source.id&&r.anchor));
   if(destination.startsWith('branch:'))check('branch records a real relationship without forcing a capability or task',plan.relationRef&&next.relations[plan.relationRef.id].kind==='branch'&&next.relations[plan.relationRef.id].from.id===material.id&&next.relations[plan.relationRef.id].to.id===ref.id&&JSON.stringify(next.tasks)===JSON.stringify(baseline.tasks));
   await b(item,'放到当前画布并继续').click();await page.locator('.wb-inspector').waitFor();await saved();
   check('saved writeback is placed as an exact reference in the same Infinite Canvas, never a second body',(await state()).canvases.some(c=>c.nodes.some(n=>n.ref?.kind===ref.kind&&n.ref.id===ref.id&&n.ref.version===ref.version&&!JSON.stringify(n).includes(text))));
   await page.getByRole('button',{name:'围绕这条线索讨论',exact:true}).click();const sessions=(await host()).sessions,fresh=Object.values(sessions).find(s=>!baseline.sessions[s.id]);
   check('continue starts at the written object only, not automatic entire original graph or history',fresh&&fresh.refs.length===1&&fresh.refs[0].id===ref.id&&fresh.refs[0].version===ref.version&&fresh.messages.length===0);
  }
  check('writeback does not publish or rewrite a capability or the material original',JSON.stringify((await host()).capabilities)===JSON.stringify(baseline.capabilities)&&JSON.stringify((await host()).materials)===JSON.stringify(baseline.materials));
 }
 await capture('writeback-'+destination.replace(/[:]/g,'-'));
 const db=new DatabaseSync(path.join(out,'executions/agent.sqlite'),{readOnly:true}),attempts=db.prepare('SELECT id,input_hash,result_hash,status FROM attempts ORDER BY created').all();db.close();
 const finalHost=await host();check('all original user messages remain exact and no new provider attempt is started',Object.entries(baseline.sessions).every(([id,s])=>JSON.stringify(finalHost.sessions[id])===JSON.stringify(s))&&attempts.length===source.originalAttemptCount&&attempts.find(r=>r.id===source.run.id).input_hash===source.run.inputHash&&attempts.find(r=>r.id===source.run.id).result_hash===source.run.resultHash);
 original.verifyOriginal(source);
 fs.writeFileSync(path.join(out,'writeback-scope.json'),JSON.stringify({destination,source:'existing verified real-model fixture, never a new model or simulated provider',rawFirstCreation:'not exercised here: the retained genuine baseline already has an immutable AI original',originalUnchanged:true},null,2));
};

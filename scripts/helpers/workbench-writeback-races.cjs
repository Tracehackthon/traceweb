// Actual UI and Product reads. The real native read completes before only its
// acknowledgement is held; no data, response, model or success is fabricated.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {selectValue}=require('./select-control.cjs');
exports.run=async({page,state,saved,check,capture,out,desktop,app,source})=>{
 assert.ok(desktop);const mode=process.env.TRACE_WRITEBACK_RACE||'text';assert.ok(['control','text','target'].includes(mode));
 const host=(await state()).product.host,expression=Object.values(host.expressions).find(x=>x.author==='user'&&x.kind!=='ink');assert.ok(expression);
 const nav=name=>page.getByRole('navigation',{name:'三大工作区'}).getByRole('button',{name,exact:true});
 const open=async()=>{await nav('Agent 协作').click();await page.locator('[data-record-id="'+source.run.sessionId+'"]').click();await selectValue(page.getByRole('combobox',{name:'选择思考消息',exact:true}),source.run.messageId);};
 await open();const item=page.locator('.wb-execution[data-run-id="'+source.run.id+'"] [data-item-id="paragraph-3"]'),input=item.getByRole('textbox',{name:'本项采纳正文',exact:true}),combo=item.getByRole('combobox',{name:'采纳位置',exact:true});
 await input.waitFor();await selectValue(combo,'expression:'+expression.id);
 const original='RereadBeforeNeedle：读取开始前的草稿。',newer='RereadLaterNeedle：等待读取期间新写的内容，不能被旧闭包覆盖。',key='trace-adoption:'+source.run.id+':paragraph-3';
 await input.fill(original);const canonicalBefore=JSON.stringify((await state()).product);
 const ledger=()=>new DatabaseSync(path.join(out,'executions/agent.sqlite'),{readOnly:true});let db=ledger();const ledgerBefore=JSON.stringify(db.prepare('SELECT * FROM adoptions ORDER BY rowid').all());db.close();
 await app.evaluate(()=>{globalThis.__holdWritebackRead=true;});await item.getByRole('button',{name:'重新读取目标版本',exact:true}).click();
 await app.evaluate(()=>new Promise((resolve,reject)=>{const until=Date.now()+12000,t=setInterval(()=>{if(globalThis.__writebackReadHeld){clearInterval(t);resolve(true);}else if(Date.now()>until){clearInterval(t);reject(Error('No actual completed native read acknowledgement held'));}},20);}));
 if(mode==='text')await input.fill(newer);if(mode==='target')await selectValue(combo,'new-expression:question');
 const expectedText=mode==='text'?newer:original,expectedTarget=mode==='target'?'new-expression:question':'expression:'+expression.id;
 const snapshot=async()=>({text:await input.inputValue(),draft:await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key)});
 const before=await snapshot();assert.equal(before.text,expectedText);assert.equal(before.draft.target,expectedTarget);assert.equal(before.draft.text,expectedText);
 await app.evaluate(()=>globalThis.__releaseWritebackRead());await item.getByText(/已明确将比较基准换为当前|草稿去向已改变/).waitFor();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const after=await snapshot();await capture('reread-'+mode+'-after-reply');
 await nav('思考画布').click();await open();await input.waitFor();const reopened=await snapshot();
 db=ledger();const ledgerAfter=JSON.stringify(db.prepare('SELECT * FROM adoptions ORDER BY rowid').all()),attempts=db.prepare('SELECT COUNT(*) n FROM attempts').get().n;db.close();
 const observation={mode,changedVariable:mode==='control'?'No edit during read':mode==='text'?'Only newer text while a genuine read acknowledgement is delayed':'Only new target while a genuine read acknowledgement is delayed',expectedText,expectedTarget,before,after,reopened,retainedVisible:after.text===expectedText,retainedPersisted:after.draft.text===expectedText&&after.draft.target===expectedTarget,retainedAfterReopen:reopened.text===expectedText&&reopened.draft.target===expectedTarget,canonicalUnchanged:canonicalBefore===JSON.stringify((await state()).product),adoptionsUnchanged:ledgerBefore===ledgerAfter,noNewAttempt:attempts===source.originalAttemptCount};
 fs.writeFileSync(path.join(out,'reread-observation.json'),JSON.stringify(observation,null,2));
 check('read and local editing never mutate canonical content, adoption decisions or provider attempts',observation.canonicalUnchanged&&observation.adoptionsUnchanged&&observation.noNewAttempt);
 check('real reread preserves current visible text, persisted draft/target and reopening checkpoint',observation.retainedVisible&&observation.retainedPersisted&&observation.retainedAfterReopen);
};

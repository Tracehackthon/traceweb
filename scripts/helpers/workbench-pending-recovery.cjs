// Formal UI -> actual IDB / Product SQLite. Only declared, pre-commit storage
// failures and isolated local recovery-record corruption; never fake success.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const readSinglePending=require('./workbench-pending-record.cjs');
module.exports=async({page,state,saved,check,capture,out,desktop,app,restartDesktop,injectContentFailure})=>{
 const b=name=>page.getByRole('button',{name,exact:true}),box=name=>page.getByRole('textbox',{name,exact:true}),nav=name=>page.getByRole('navigation',{name:'三大工作区'}).getByRole('button',{name,exact:true});
 const details=async(root=page)=>{const summary=root.locator('summary').filter({hasText:'失败详情与其他恢复方式'}),element=summary.locator('..');if(await element.getAttribute('open')===null)await summary.click();return element;};
 const original='先存下的原话，保留中文 🧭 与准确范围。',sent='这份失败原请求 A：只重试原正文。',later='失败后继续编辑的草稿 B：不能被旧请求代写或清掉。';
 await nav('Agent 协作').click();await b('开始一段共同思考').click();await box('继续共同思考').fill(original);await b('留下这段思考').click();await saved();
 const initial=await state(),session=Object.values(initial.product.host.sessions)[0];
 await box('继续共同思考').fill(sent);await injectContentFailure();await b('留下这段思考').click();await b('核对并重试原命令').waitFor();
 const pendingRaw=await readSinglePending(page),pending=JSON.parse(pendingRaw),failed=await state();
 check('pre-commit failure leaves the original request durable and does not mutate canonical content',pending.body.operations.some(op=>op.text===sent||op.message?.text===sent||op.value?.text===sent)&&JSON.stringify(failed.product)===JSON.stringify(initial.product));
 fs.writeFileSync(path.join(out,'original-unconfirmed-request.json'),pendingRaw);
 const keys=await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('trace-workbench-pending:personal')));
 check('new requests use their own identity key instead of overwriting the legacy single record',keys.length===1&&keys[0].endsWith(':request-v1:'+pending.body.commandId));
 await box('继续共同思考').fill(later);const recovery=page.getByRole('region',{name:'未确认操作恢复',exact:true});await details(recovery);await recovery.getByRole('button',{name:'保留本地草稿，读取当前版本',exact:true}).click();
 check('ordinary authoritative reread retains the complete original request and later editable draft',await readSinglePending(page)===pendingRaw&&await box('继续共同思考').inputValue()===later);
 await b('核对并重试原命令').click();await saved();let current=await state();
 check('explicit retry commits only the frozen original, once, while retaining later unsaved text',current.product.host.sessions[session.id].messages.length===2&&current.product.host.sessions[session.id].messages[1].text===sent&&await box('继续共同思考').inputValue()===later&&await readSinglePending(page)===null);
 // Genuine old single-key request remains readable and idempotent; it is not
 // silently migrated or mistaken for a new draft.
 await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key:'trace-workbench-pending:personal',raw:pendingRaw});await page.reload();await page.locator('[data-workbench-ready=true]').waitFor();await b('核对并重试原命令').waitFor();await b('核对并重试原命令').click();await saved();
 check('legacy single-key recovery replays the identical real command without duplicating content',JSON.stringify((await state()).product)===JSON.stringify(current.product)&&await readSinglePending(page)===null);
 const samples=[{name:'invalid-json',key:'trace-workbench-pending:personal',raw:'{"unfinished": "原始恢复记录🧭"'},{name:'unknown-shape',key:'trace-workbench-pending:personal',raw:'{"futureRecovery":7,"text":"不可丢掉的原记录"}'},{name:'invalid-request-record',key:'trace-workbench-pending:personal:request-v1:unrecognized',raw:'{"path":"/api/product/commands","body":{}}'}];
 for(const sample of samples){
   await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),sample);await page.reload();await page.locator('[data-workbench-ready=true]').waitFor();await page.getByRole('region',{name:'无法识别的操作恢复',exact:true}).waitFor();
   const before=await state();await b('重新读取已保存内容').click();await b('重新读取已保存内容').waitFor();
   assert.equal(await page.evaluate(key=>localStorage.getItem(key),sample.key),sample.raw);
   await box('继续共同思考').fill(later);await b('留下这段思考').click();
   check(sample.name+' blocks new writes and ordinary reread keeps opaque raw and canonical data',await page.evaluate(key=>localStorage.getItem(key),sample.key)===sample.raw&&JSON.stringify((await state()).product)===JSON.stringify(before.product));
   const file=path.join(out,sample.name+'-export.json');
   if(desktop){await app.evaluate(()=>{globalThis.__traceDownloadState=null;});await b('原样导出恢复记录').click();const status=await app.evaluate(()=>new Promise((resolve,reject)=>{const start=Date.now(),timer=setInterval(()=>{if(globalThis.__traceDownloadState){clearInterval(timer);resolve(globalThis.__traceDownloadState);}else if(Date.now()-start>30000){clearInterval(timer);reject(Error('Recovery export completion was not observed'));}},50);}));assert.equal(status,'completed');fs.copyFileSync(path.join(out,'original-download.svg'),file);}
   else{const event=page.waitForEvent('download');await b('原样导出恢复记录').click();await(await event).saveAs(file);}
   check(sample.name+' export contains the exact original raw, not a reserialized replacement',fs.readFileSync(file,'utf8')===sample.raw);
   page.once('dialog',dialog=>dialog.dismiss());await b('明确重置这份本地恢复记录').click();assert.equal(await page.evaluate(key=>localStorage.getItem(key),sample.key),sample.raw);
   check(sample.name+' cancelling explicit reset retains the original record and current draft',await box('继续共同思考').inputValue()===later);
   page.once('dialog',dialog=>dialog.accept());await b('明确重置这份本地恢复记录').click();await page.getByRole('region',{name:'无法识别的操作恢复',exact:true}).waitFor({state:'detached'});
   check(sample.name+' explicit local reset clears only that recovery record, not content or the later draft',await page.evaluate(key=>localStorage.getItem(key),sample.key)===null&&JSON.stringify((await state()).product)===JSON.stringify(before.product)&&await box('继续共同思考').inputValue()===later);
 }
 await b('留下这段思考').click();await saved();current=await state();check('after explicit recovery, the later draft saves as its own new message, not a replay of the old request',current.product.host.sessions[session.id].messages.map(m=>m.text).join('\n')===[original,sent,later].join('\n'));
 const final=JSON.stringify(current.product);if(desktop){const restarted=await restartDesktop();page=restarted.page;}else await page.reload();await page.locator('[data-workbench-ready=true]').waitFor();
 check('Browser refresh or actual native process restart preserves the recovered exact content and empty outbox',JSON.stringify((await state()).product)===final&&await readSinglePending(page)===null);
 await capture('pending-recovery-current-render');
};

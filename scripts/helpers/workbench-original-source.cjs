// Closed self-authored fixture only. Restore the Product's actual stored
// pre-adoption revision, keep the genuine input/output hashes, and explicitly
// reset test-copy decisions. This is a composite fixture, not a new model run
// or a claim that the complete historical profile has been reconstructed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {DatabaseSync}=require('node:sqlite');
const original=require('./workbench-feedback-source.cjs');
const {selectValue}=require('./select-control.cjs');
let writer=null;
exports.cleanup=async()=>{if(writer){const child=writer;writer=null;if(child.exitCode!==null||child.signalCode)return;const ended=once(child,'exit');child.stdin.end('release');await ended;}};
exports.prepare=({root,out})=>{
 const source=original.prepare({root,out}),file=path.join(out,'product.sqlite');
 assert.ok(fs.realpathSync(file).startsWith(fs.realpathSync(out)+path.sep));
 assert.notEqual(fs.realpathSync(file),fs.realpathSync(source.files.find(f=>f.copy===file).path));
 let db=new DatabaseSync(path.join(out,'executions/agent.sqlite'));
 const first=db.prepare("SELECT plan FROM adoptions WHERE run_id=? AND status='committed' ORDER BY rowid LIMIT 1").get(source.run.id);assert.ok(first);
 const revision=JSON.parse(first.plan).command.expectedRevision;assert.ok(Number.isSafeInteger(revision)&&revision>0);db.close();
 db=new DatabaseSync(file);const captured=db.prepare('SELECT revision,entity_counts FROM web_snapshots WHERE revision=?').get(revision);assert.ok(captured);
 const originalRevision=db.prepare('SELECT revision FROM web_workspace').get().revision;
 db.exec('BEGIN IMMEDIATE');try{
  db.prepare('DELETE FROM web_commands WHERE committed_revision>?').run(revision);
  db.prepare('DELETE FROM web_entities WHERE workspace_revision>?').run(revision);
  db.prepare('DELETE FROM web_snapshots WHERE revision>?').run(revision);
  db.prepare('UPDATE web_workspace SET revision=?').run(revision);db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}
 db=new DatabaseSync(path.join(out,'executions/agent.sqlite'));const resetDecisions=db.prepare('SELECT COUNT(*) n FROM adoptions').get().n;
 db.exec('BEGIN IMMEDIATE');db.exec('DELETE FROM adoptions');db.prepare('UPDATE attempts SET review=NULL WHERE id=?').run(source.run.id);db.exec('COMMIT');db.close();
 const derived={originalRevision,restoredCapturedProductRevision:revision,entityCounts:JSON.parse(captured.entity_counts),testCopyDecisionsRemoved:resetDecisions,reviewResetForRun:source.run.id,inputHashUnchanged:source.run.inputHash,resultHashUnchanged:source.run.resultHash,scope:'Actual stored Product snapshot + unchanged genuine Agent result; test-only decisions/review reset explicitly. Not a complete historical profile or provider simulation.'};
 fs.writeFileSync(path.join(out,'derived-fixture.json'),JSON.stringify(derived,null,2));original.verifyOriginal(source);return{...source,derived};
};
exports.run=async({page,state,saved,check,capture,out,desktop,app,restartDesktop,source})=>{
 assert.ok(desktop);const baseline=structuredClone((await state()).product),host=()=>state().then(s=>s.product.host);
 check('composite fixture starts at the actual captured pre-adoption Product revision',baseline.revision===source.derived.restoredCapturedProductRevision&&Object.keys(baseline.host.expressions).length===0);
 const nav=name=>page.getByRole('navigation',{name:'三大工作区'}).getByRole('button',{name,exact:true});
 await nav('Agent 协作').click();await page.locator('[data-record-id="'+source.run.sessionId+'"]').click();await selectValue(page.getByRole('combobox',{name:'选择思考消息',exact:true}),source.run.messageId);
 let run=page.locator('.wb-execution[data-run-id="'+source.run.id+'"]'),bar=run.locator('[aria-label="独立保留AI原稿"]');
 const button=()=>bar.getByRole('button',{name:'单独保留AI原稿（不采纳）',exact:true});await button().waitFor();
 check('original can be kept without reviewing/adopting a paragraph',await run.locator('[aria-label="逐项采纳"]').count()===0);
 const lockScript=path.join(out,'hold-original-write.cjs');fs.writeFileSync(lockScript,"const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[2]);db.exec('BEGIN IMMEDIATE');console.log('LOCKED');process.stdin.once('data',()=>{db.exec('ROLLBACK');db.close();process.exit(0)});");
 writer=spawn(process.execPath,[lockScript,path.join(out,'product.sqlite')],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,TEMP:path.join(out,'tmp'),TMP:path.join(out,'tmp')}});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Actual SQLite writer did not lock')),10000);writer.stdout.on('data',chunk=>{if(String(chunk).includes('LOCKED')){clearTimeout(timer);resolve();}});writer.once('error',reject);});
 await button().click();await bar.locator('[role="alert"]').waitFor();
 check('real write lock never shows a kept original or optimistic Product mutation',JSON.stringify((await state()).product)===JSON.stringify(baseline)&&await bar.getByText('原稿已保留 · v1',{exact:true}).count()===0&&await button().isEnabled());
 await capture('original-write-lock-failure');fs.writeFileSync(path.join(out,'original-lock-observation.json'),JSON.stringify({database:'owned Product test copy',errorText:await bar.innerText(),productRevision:(await state()).product.revision,noKeptOriginal:true,sourceRunId:source.run.id},null,2));
 await exports.cleanup();await button().click();await bar.getByText('原稿已保留 · v1',{exact:true}).waitFor();await saved();
 const archived=(await host()).expressions['ai-'+source.run.id];
 check('explicit retry creates exactly one immutable saved AI original without adopting user belief',archived.author==='agent'&&archived.kind==='note'&&archived.status==='saved'&&archived.version===1&&Object.keys(archived.versions).length===1&&archived.versions[1].text===source.run.result.answer&&JSON.stringify(archived.versions[1].refs)===JSON.stringify(source.run.refs)&&Object.keys((await host()).expressions).length===1);
 check('raw keeping preserves materials, methods and all original user messages',JSON.stringify((await host()).materials)===JSON.stringify(baseline.host.materials)&&JSON.stringify((await host()).capabilities)===JSON.stringify(baseline.host.capabilities)&&JSON.stringify((await host()).sessions)===JSON.stringify(baseline.host.sessions));
 await capture('original-saved-without-adoption');
 ({page,app}=await restartDesktop());await page.locator('[data-workbench-ready=true]').waitFor();run=page.locator('.wb-execution[data-run-id="'+source.run.id+'"]');bar=run.locator('[aria-label="独立保留AI原稿"]');await nav('Agent 协作').click();await page.locator('[data-record-id="'+source.run.sessionId+'"]').click();await selectValue(page.getByRole('combobox',{name:'选择思考消息',exact:true}),source.run.messageId);await bar.getByText('原稿已保留 · v1',{exact:true}).waitFor();
 check('process restart reads the same single saved original and does not perform an automatic adoption',Object.keys((await host()).expressions).length===1&&(await host()).expressions[archived.id].versions[1].text===source.run.result.answer&&await run.locator('[aria-label="逐项采纳"]').count()===0);
 await bar.getByRole('button',{name:'核对已保存的原稿',exact:true}).click();const dialog=page.locator('dialog[open]').last();await dialog.getByText(source.run.result.answer,{exact:true}).waitFor();await dialog.getByRole('button',{name:'关闭对话框',exact:true}).click();
 await bar.getByRole('button',{name:'从原稿继续',exact:true}).click();await page.getByRole('button',{name:'围绕这条线索讨论',exact:true}).click();
 const fresh=Object.values((await host()).sessions).find(s=>!baseline.host.sessions[s.id]);check('explicit continuation can cite the saved AI original without treating it as a user-authored conclusion',fresh&&fresh.refs.length===1&&fresh.refs[0].id===archived.id&&fresh.refs[0].version===1&&fresh.messages.length===0);
 const db=new DatabaseSync(path.join(out,'executions/agent.sqlite'),{readOnly:true});const review=db.prepare('SELECT review FROM attempts WHERE id=?').get(source.run.id).review,decisions=db.prepare('SELECT COUNT(*) n FROM adoptions').get().n,attempts=db.prepare('SELECT id,input_hash,result_hash FROM attempts').all();db.close();
 check('first original keeping and continuation never create an adoption or provider attempt',review===null&&decisions===0&&attempts.length===source.originalAttemptCount&&attempts.find(r=>r.id===source.run.id).input_hash===source.run.inputHash&&attempts.find(r=>r.id===source.run.id).result_hash===source.run.resultHash);
 original.verifyOriginal(source);
};

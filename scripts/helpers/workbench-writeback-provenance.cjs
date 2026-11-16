// Full native application journey; only the explicitly owned fixture copy has
// its saved archive references changed. The genuine provider ledger is intact.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const original=require('./workbench-feedback-source.cjs');
const {selectValue}=require('./select-control.cjs');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
exports.prepare=({root,out})=>{
 const source=original.prepare({root,out}),mode=process.env.TRACE_WRITEBACK_PROVENANCE||'exact';assert.ok(['exact','missing'].includes(mode));
 const file=path.join(out,'product.sqlite');assert.ok(fs.realpathSync(file).startsWith(fs.realpathSync(out)+path.sep));assert.notEqual(fs.realpathSync(file),fs.realpathSync(source.files.find(f=>f.copy===file).path));
 const db=new DatabaseSync(file);try{
  const revision=db.prepare('SELECT revision FROM web_workspace').get().revision,id='ai-'+source.run.id;
  const row=db.prepare("SELECT payload,payload_sha256 FROM web_entities WHERE workspace_revision=? AND kind='content-expressions' AND object_id=?").get(revision,id);assert.ok(row);assert.equal(sha(row.payload),row.payload_sha256);
  const value=JSON.parse(row.payload);assert.equal(value.author,'agent');assert.equal(value.version,1);assert.equal(value.versions[1].text,source.run.result.answer);assert.deepEqual(value.versions[1].refs,source.run.refs);assert.ok(source.run.refs.length>0);
  const beforeRefs=structuredClone(value.versions[1].refs);if(mode==='missing')value.versions[1].refs=[];
  const payload=JSON.stringify(value);if(mode==='missing')db.prepare("UPDATE web_entities SET payload=?,payload_sha256=? WHERE workspace_revision=? AND kind='content-expressions' AND object_id=?").run(payload,sha(payload),revision,id);
  const derived={mode,revision,id,beforeRefs,afterRefs:value.versions[1].refs,beforePayloadSha256:row.payload_sha256,afterPayloadSha256:mode==='missing'?sha(payload):row.payload_sha256,scope:'Only saved archive provenance in an owned test copy; valid Product schema/checksum retained. Original answer, input/result hashes and Agent attempts are untouched. Not a fabricated provider result.'};
  fs.writeFileSync(path.join(out,'provenance-fixture.json'),JSON.stringify(derived,null,2));original.verifyOriginal(source);return {...source,provenance:derived};
 }finally{db.close();}
};
exports.run=async({page,state,saved,check,capture,out,desktop,app,source})=>{
 assert.ok(desktop);const baseline=structuredClone((await state()).product),ledger=()=>new DatabaseSync(path.join(out,'executions/agent.sqlite'),{readOnly:true});
 let db=ledger();const decisionsBefore=JSON.stringify(db.prepare('SELECT * FROM adoptions ORDER BY rowid').all()),attemptsBefore=JSON.stringify(db.prepare('SELECT id,input_hash,result_hash,status,payload,result FROM attempts ORDER BY created').all());db.close();
 const nav=name=>page.getByRole('navigation',{name:'三大工作区'}).getByRole('button',{name,exact:true});await nav('Agent 协作').click();await page.locator('[data-record-id="'+source.run.sessionId+'"]').click();await selectValue(page.getByRole('combobox',{name:'选择思考消息',exact:true}),source.run.messageId);
 const run=page.locator('.wb-execution[data-run-id="'+source.run.id+'"]'),item=run.locator('[data-item-id="paragraph-3"]'),input=item.getByRole('textbox',{name:'本项采纳正文',exact:true}),bar=run.locator('[aria-label="独立保留AI原稿"]');await input.waitFor();
 const keptBefore=await bar.getByText('原稿已保留 · v1',{exact:true}).count(),body='ProvenanceDraftNeedle：身份不一致时仍要保留我的待写回正文。';await input.fill(body);await selectValue(item.getByRole('combobox',{name:'采纳位置',exact:true}),'new-expression:question');
 await item.getByRole('button',{name:'确认采纳本项',exact:true}).click();await Promise.race([item.locator('[aria-label="已采纳正文"]').waitFor(),item.getByText('本项采纳尚未确认',{exact:true}).waitFor()]);await saved();
 const after=(await state()).product;db=ledger();const decisionsAfter=JSON.stringify(db.prepare('SELECT * FROM adoptions ORDER BY rowid').all()),attemptsAfter=JSON.stringify(db.prepare('SELECT id,input_hash,result_hash,status,payload,result FROM attempts ORDER BY created').all());db.close();
 const observation={mode:source.provenance.mode,keptIndicatorBefore:keptBefore,keptIndicatorAfter:await bar.getByText('原稿已保留 · v1',{exact:true}).count(),canonicalUnchanged:JSON.stringify(baseline)===JSON.stringify(after),decisionsUnchanged:decisionsBefore===decisionsAfter,attemptsUnchanged:attemptsBefore===attemptsAfter,localDraftRetained:await input.count()===1&&await input.inputValue()===body,sourceError:await app.evaluate(()=>globalThis.__lastAdoptSourceError||null),originalAnswerUnchanged:after.host.expressions[source.provenance.id].versions[1].text===source.run.result.answer,archiveRefs:after.host.expressions[source.provenance.id].versions[1].refs};
 fs.writeFileSync(path.join(out,'provenance-observation.json'),JSON.stringify(observation,null,2));await capture('archive-provenance-'+source.provenance.mode);original.verifyOriginal(source);
 check('the real original result and every provider attempt remain unchanged',observation.attemptsUnchanged&&observation.originalAnswerUnchanged);
 if(source.provenance.mode==='missing'){
  check('a saved archive with missing frozen references cannot authorize a writeback',observation.canonicalUnchanged&&observation.decisionsUnchanged&&observation.sourceError?.includes('来源'));
  check('source mismatch preserves the local user draft without a verified-original badge',observation.localDraftRetained&&observation.keptIndicatorAfter===0);
 }else{
  check('exact existing provenance still permits one actual reviewed writeback',!observation.canonicalUnchanged&&!observation.decisionsUnchanged&&observation.sourceError===null&&observation.keptIndicatorAfter===1&&await item.locator('[aria-label="已采纳正文"]').count()===1);
 }
};

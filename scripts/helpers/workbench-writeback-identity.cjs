// Imported/legacy content can have any valid stable Product identity. This
// synthetic collision lives only in an owned copy of the genuine-result fixture.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const original=require('./workbench-feedback-source.cjs');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
exports.prepare=({root,out})=>{
 const source=original.prepare({root,out}),file=path.join(out,'product.sqlite');assert.ok(fs.realpathSync(file).startsWith(fs.realpathSync(out)+path.sep));assert.notEqual(fs.realpathSync(file),fs.realpathSync(source.files.find(f=>f.copy===file).path));
 const db=new DatabaseSync(file);try{
  const revision=db.prepare('SELECT revision FROM web_workspace').get().revision,kind='content-expressions';
  const rows=db.prepare('SELECT payload,ordinal FROM web_entities WHERE workspace_revision=? AND kind=? ORDER BY ordinal').all(revision,kind),template=rows.map(r=>JSON.parse(r.payload)).find(e=>e.author==='user'&&e.kind!=='ink');assert.ok(template);
  const targetExpressionId='legacy:expression:中文',prefixExpressionId='legacy',added=[];let ordinal=Math.max(...rows.map(r=>r.ordinal))+1;
  db.exec('BEGIN IMMEDIATE');try{
   for(const [id,title,text]of [[prefixExpressionId,'PrefixDecoyNeedle','PrefixBodyNeedle：这不是用户选择的目标。'],[targetExpressionId,'SavedIdentityNeedle','SavedIdentityBodyNeedle：这是带冒号的稳定内容身份。']]){
    const value={...structuredClone(template),id,title,version:1,versions:{1:{text,refs:[]}}},payload=stable(value);db.prepare('INSERT INTO web_entities(workspace_revision,kind,object_id,ordinal,payload,payload_sha256) VALUES(?,?,?,?,?,?)').run(revision,kind,id,ordinal++,payload,sha(payload));added.push({id,payloadSha256:sha(payload)});
   }
   const counts=JSON.parse(db.prepare('SELECT entity_counts FROM web_snapshots WHERE revision=?').get(revision).entity_counts);counts[kind]+=2;db.prepare('UPDATE web_snapshots SET entity_counts=? WHERE revision=?').run(JSON.stringify(counts),revision);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  const identity={revision,targetExpressionId,prefixExpressionId,added,scope:'Two synthetic valid-schema content identities added to an owned Product snapshot only; unchanged genuine Agent payload/result, all original objects and source fixtures retained. Not a provider simulation.'};fs.writeFileSync(path.join(out,'identity-fixture.json'),JSON.stringify(identity,null,2));original.verifyOriginal(source);return {...source,identity};
 }finally{db.close();}
};
exports.run=context=>require('./workbench-writeback.cjs').run(context);

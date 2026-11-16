// Same formal UI -> actual MCP Product client -> actual Product HTTP/SQLite.
// Local self-authored materials and an explicitly synthetic test host identity;
// no model, provider, private profile or independent API/unit test.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {selectValue}=require('./select-control.cjs');
module.exports=async({page,state,saved,check,capture,out,desktop,projectRoot})=>{
  assert.ok(desktop,'External task handoff needs the actual connected Product service, not static Browser IDB');
  const button=(name,scope=page)=>scope.getByRole('button',{name,exact:true}),box=(name,scope=page)=>scope.getByRole('textbox',{name,exact:true});
  const host=async()=>(await state()).product.host;
  const materials=[['外部接续的已选材料','仅核对这份保存摘录：行为观察与机制解释不同。保留原始来源，不自动扩展到其它材料。'],['不应带入的旁边材料','这是未选择的独立材料，不能因为同在画布就交给外部任务。']];
  for(const [title,text]of materials){await button('留下文字、网页或对话材料').click();const modal=page.getByRole('dialog',{name:'留下材料',exact:true});await box('材料标题',modal).fill(title);await box('完整原文',modal).fill(text);await button('保存材料并放到画布',modal).click();await modal.waitFor({state:'detached'});await saved();}
  const selected=Object.values((await host()).materials).find(m=>m.title===materials[0][0]);
  await page.getByRole('navigation',{name:'三大工作区'}).getByRole('button',{name:'Agent 协作',exact:true}).click();await page.getByRole('radio',{name:'外部任务',exact:true}).click();await require('./open-task-draft.cjs')(page);
  const form=page.getByRole('form',{name:'外部任务准备',exact:true}),scope=page.getByRole('region',{name:'本次协作引用范围',exact:true});
  while(await scope.locator(':scope>article').count())await button('从本次草稿移除',scope.locator(':scope>article').first()).click();
  await button('选择本次准确引用',scope).click();const picker=page.getByRole('dialog',{name:'添加准确引用',exact:true});await box('搜索可引用内容',picker).fill(selected.title);await selectValue(picker.getByRole('combobox',{name:'引用查找范围',exact:true}),'material');await picker.locator('.wb-reference-result').first().click();await button('添加这份准确引用',picker).click();await button('完成选择，返回任务准备',picker).click();await picker.waitFor({state:'detached'});
  const goal='外部现场接续：只比较明确选择的这一份材料，结果先回到原任务复核，不改变我的理解。';await box('外部任务目标',form).fill(goal);await button('保存任务准备',form).click();await page.getByText('准备已保存，尚未执行。',{exact:true}).waitFor();await saved();
  const before=await state(),task=Object.values(before.product.host.tasks).at(-1);
  check('actual collaboration UI saves one schema2 Task with exact selected versions and no implicit canvas history',before.product.host.schemaVersion===2&&task.goal===goal&&task.refs.length===1&&task.refs[0].id===selected.id&&task.refs[0].version===1&&!task.execution&&task.results.length===0);
  const source=path.resolve(projectRoot,'../trace-runtime/apps/mcp/src/product-client.ts'),input=path.join(out,'version-inputs/product-client.ts');fs.mkdirSync(path.dirname(input),{recursive:true});const original=fs.readFileSync(source);fs.writeFileSync(input,original);
  const {TraceProductClient}=await import(pathToFileURL(input).href),testProject=path.join(out,'self-authored-project');fs.mkdirSync(testProject,{recursive:true});
  const client=new TraceProductClient({baseUrl:new URL(page.url()).origin,sessionId:'e2e-modern-task-owner'});let failure;
  try{await client.receive({projectDir:testProject,workId:task.id});}catch(error){failure={code:error.code,status:error.status,message:error.message};}
  fs.writeFileSync(path.join(out,'blocking-receive.json'),JSON.stringify({scope:'formal UI -> production MCP client -> actual HTTP Product SQLite -> formal UI; not MCP stdio/live Codex',fixture:'synthetic test host identity; no provider',input:{taskId:task.id,projectDir:testProject},clientSource:{path:source,sha256:crypto.createHash('sha256').update(original).digest('hex'),copiedInputSha256:crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex')},failure:failure||null,before,after:await state()},null,2));
  assert.ok(process.argv.includes('--codex-handoff-baseline'),'This pre-fix baseline must be replaced by real protocol2 success/failure assertions, never treated as delivery success');
  check('reproduced legacy MCP schema gate blocks the real modern Task without returning fabricated context',failure?.code==='NO_PRODUCT_WORKSPACE'&&failure.status===404);
  check('rejected external receive preserves the same authoritative Task, selected originals and zero adopted results',JSON.stringify(await state())===JSON.stringify(before));
  await page.reload();await page.locator('[data-workbench-ready=true]').waitFor();
  check('refresh after rejected external receive preserves exact Task identity and preparation rather than marking received',JSON.stringify(await state())===JSON.stringify(before));
  await capture('external-task-blocking-baseline');
};

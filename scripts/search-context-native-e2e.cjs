const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {launchHiddenNative}=require('./helpers/hidden-native.cjs');
const root=path.resolve(__dirname,'..'),phase=path.join(root,'.test-results/workbench-search-context');
const out=path.resolve(process.env.TRACE_VISUAL_OUT||''),exe=path.resolve(process.env.TRACE_DESKTOP_EXE||'');
assert(out.startsWith(phase+path.sep)&&!fs.existsSync(path.join(out,'report.json')));
assert(fs.existsSync(exe));fs.mkdirSync(out,{recursive:true});
const expected=process.env.TRACE_EXPECTED_ASAR;assert(/^[0-9a-f]{64}$/.test(expected||''));
const checks=[],errors=[],screens=[];let native,boundary;
const check=(name,value)=>{assert(value,name);checks.push(name);process.stdout.write('PASS '+name+'\n');};
const timeout=(promise,ms)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('Bounded hidden capture unavailable')),ms))]);
(async()=>{
 try{
  native=await launchHiddenNative({exe,out,asarSha256:expected,mainSha256:process.env.TRACE_EXPECTED_MAIN_SHA256});
  const page=native.page;page.setDefaultTimeout(12000);
  // Renderer-only viewport override; never resizes, shows or focuses an OS window.
  await page.setViewportSize({width:1440,height:940});
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  const ready=page.locator('[data-workbench-ready=true]');
  await page.waitForFunction(()=>document.querySelector('[data-workbench-ready=true]')||[...document.querySelectorAll('button')].some(button=>button.textContent==='开始画布'));
  const start=page.getByRole('button',{name:'开始画布',exact:true});if(await start.count())await start.click();await ready.waitFor();
  const state=async()=>({product:await page.evaluate(()=>window.traceNative.requestCapability({operation:'workbench.request',pathname:'/api/product/workspace',method:'GET'}))});
  const frame=await timeout(page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve({frame:true,visibility:document.visibilityState})))),3000);
  fs.writeFileSync(path.join(out,'hidden-frame-proof.json'),JSON.stringify(frame,null,2));
  check('guarded hidden real renderer delivers animation frames without any window show',frame.frame===true);
  const capture=async name=>{
   // Never show a window to obtain a screenshot. Headless Browser is the full
   // raster-visual lane; this native lane reports hidden-capture limits honestly.
   const observation={name,url:page.url(),viewport:page.viewportSize(),body:await page.locator('body').innerText(),screenshot:'not_run: no hidden native raster guarantee; never shows a window'};
   fs.writeFileSync(path.join(out,name+'.dom.json'),JSON.stringify(observation,null,2));screens.push(observation);
  };
  if(process.argv.includes('--preflight-only')){
   await page.getByRole('navigation',{name:'三大工作区'}).getByRole('button',{name:'Agent 协作',exact:true}).click();
   await page.getByRole('radio',{name:'Trace 内思考',exact:true}).click();await page.getByRole('button',{name:'新建共同思考',exact:true}).click();
   const text='隐藏原生界面验证：只明确保存这一段，不发模型请求。';
   await page.getByRole('textbox',{name:'继续共同思考',exact:true}).fill(text);await page.getByRole('button',{name:'留下这段思考',exact:true}).click();
   await page.getByText('思考记录已保存',{exact:true}).waitFor();
   const saved=(await state()).product;check('hidden UI save reaches the real native Product store exactly once',Object.values(saved.host.sessions).flatMap(session=>session.messages).filter(message=>message.text===text).length===1&&saved.storage.kind==='sqlite');
   await page.reload();await ready.waitFor();check('native renderer reload reads the same genuinely saved record',Object.values((await state()).product.host.sessions).flatMap(session=>session.messages).filter(message=>message.text===text).length===1);
   await capture('preflight-real-native-save');
  }else{
   await require('./helpers/workbench-search-context.cjs')({page,state,saved:()=>page.waitForFunction(()=>document.querySelector('.wb-save-status')?.textContent.includes('已保存内容')),check,capture,out,baseline:false});
  }
  check('native rendering has no page or console error',errors.length===0);
  const ledger=await page.evaluate(()=>window.traceNative.requestCapability({operation:'workbench.agent.list'}));check('native authoritative execution ledger remains empty',ledger.items.length===0);
 }catch(error){process.exitCode=1;errors.push(error.stack);process.stderr.write(error.stack+'\n');fs.writeFileSync(path.join(out,'failure.txt'),error.stack);}
 finally{
  if(native){try{boundary=await native.close();check('pre-main guarded native flow has zero own foreground or show events',boundary.foreground.passed&&boundary.guard.violations.length===0);}catch(error){process.exitCode=1;errors.push(error.stack);}}
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:!process.exitCode,checks,errors,exe,asarSha256:expected,scriptSha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),nativeIdentity:native?.identity,boundary,screens:screens.map(screen=>screen.name),screenshot:'not_run (headless full Browser provides raster visual verification)',physicalOSInput:false,newProviderTurns:0},null,2));
 }
})();

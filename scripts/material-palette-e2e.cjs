const {selectValue}=require('./helpers/select-control.cjs');
// Real served app + independent browser storage, no isolated component tests.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=process.env.TRACE_PALETTE_URL||'http://127.0.0.1:4326';
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(base));
const out=path.resolve(__dirname,'../.test-results/component-prompts/focus-palette',process.env.TRACE_PALETTE_RUN||'browser');
assert(!fs.existsSync(path.join(out,'report.json')),'Use a new run name');fs.mkdirSync(path.join(out,'tmp'),{recursive:true});
for(const k of ['TEMP','TMP','TMPDIR'])process.env[k]=path.join(out,'tmp');
const checks=[],errors=[],colors=[];let browser;
const check=(name,ok)=>{assert(ok,name);checks.push(name);console.log('PASS '+name);};
(async()=>{try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:940}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/app?view=collaboration');await page.getByRole('button',{name:'开始画布',exact:true}).click();await page.getByRole('button',{name:'开始一段共同思考',exact:true}).click();
  const input=page.getByRole('textbox',{name:'继续共同思考'}),quick=page.getByRole('searchbox',{name:'快速搜索当前资料'});
  for(const mode of ['light','dark']){
    await page.getByRole('button',{name:'设置',exact:true}).click();await selectValue(page.getByRole('combobox',{name:'外观',exact:true}),mode);await page.getByRole('button',{name:'关闭对话框',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
    await input.fill('配色检视：只留在草稿，不发送。');await input.click();
    check(mode+' composer focus has no bright outline',await input.evaluate(e=>getComputedStyle(e).outlineStyle==='none'&&getComputedStyle(e.closest('form')).outlineStyle==='none'));
    check(mode+' composer has tinted focus shadow',await input.evaluate(e=>getComputedStyle(e.closest('form')).boxShadow!=='none'));
    await page.locator('.wb-gooey-trigger').click();await quick.fill('检索草稿');
    const palette=await page.evaluate(()=>{
      const css=e=>getComputedStyle(e),rgb=c=>{const ctx=document.createElement('canvas').getContext('2d');ctx.fillStyle=c;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);};
      const luminance=c=>rgb(c).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
      const contrast=(a,b)=>{a=luminance(a);b=luminance(b);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
      const search=document.querySelector('.wb-gooey-search'),field=search.querySelector('input'),surface=search.querySelector('i'),submit=document.querySelector('.wb-thinking-composer .wb-primary');
      return {outline:css(search).outlineStyle,inputOutline:css(field).outlineStyle,shadow:css(search).boxShadow,searchContrast:contrast(css(field).color,css(surface).backgroundColor),buttonContrast:Math.min(...['--trace-material-accent','--trace-material-accent-end'].map(k=>contrast(css(submit).color,css(submit).getPropertyValue(k).trim())))};
    });colors.push({mode,...palette});
    check(mode+' search focus uses shadow instead of bright ring',palette.outline==='none'&&palette.inputOutline==='none'&&palette.shadow!=='none');
    check(mode+' search and submit text exceed 4.5:1',palette.searchContrast>=4.5&&palette.buttonContrast>=4.5);
    await quick.press('Escape');await page.locator('.wb-gooey-trigger').press('Enter');await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='快速搜索当前资料');check(mode+' keyboard search focus remains functional',await quick.evaluate(e=>e===document.activeElement));
    check(mode+' focus changes do not clear drafts',await input.inputValue()==='配色检视：只留在草稿，不发送。'&&await quick.inputValue()==='检索草稿');
    await page.screenshot({path:path.join(out,mode+'.png')});await quick.press('Escape');
  }
  await page.setViewportSize({width:390,height:844});await page.locator('.wb-gooey-trigger').click();check('narrow focused search remains on screen',await page.locator('.wb-gooey-search').evaluate(e=>e.getBoundingClientRect().right<=innerWidth));
  await page.screenshot({path:path.join(out,'narrow.png')});check('no renderer errors',errors.length===0);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,build:await(await page.request.get(base+'/api/web/build')).json(),checks,colors,errors},null,2));
}catch(e){fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:false,checks,colors,errors,error:e.stack},null,2));throw e;}finally{await browser?.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

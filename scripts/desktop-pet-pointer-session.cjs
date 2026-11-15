// Visible, project-isolated full app session for CUA OS pointer acceptance.
// This fixture never touches the normal user profile and sends no model turn.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),readline=require('node:readline');
const {_electron}=require('playwright');
const root=path.resolve(__dirname,'..'),exe=path.resolve(process.env.TRACE_POINTER_EXE||''),out=path.resolve(process.env.TRACE_POINTER_OUT||'');
if(!out.startsWith(path.join(root,'.test-results')+path.sep)||!exe.startsWith(path.join(root,'.test-results')+path.sep))throw Error('Use task-owned candidate and profile');
fs.mkdirSync(out,{recursive:false});for(const p of ['profile','tmp','project'])fs.mkdirSync(path.join(out,p));
const env={...process.env,APPDATA:path.join(out,'appdata'),LOCALAPPDATA:path.join(out,'localappdata'),TEMP:path.join(out,'tmp'),TMP:path.join(out,'tmp'),TRACE_PROJECT_DIR:path.join(out,'project'),TRACE_AGENT_ENABLED:'0',TRACE_CLOUD_ORIGIN:'https://127.0.0.1:1',TRACE_DESKTOP_INTEGRATIONS_FILE:path.join(out,'no-integrations.json')};delete env.ELECTRON_RUN_AS_NODE;
let app;const events=[],log=(type,value)=>{const r={type,value,time:new Date().toISOString()};events.push(r);fs.appendFileSync(path.join(out,'events.jsonl'),JSON.stringify(r)+'\n');console.log(JSON.stringify(r))};
(async()=>{
 app=await _electron.launch({executablePath:exe,args:['--user-data-dir='+path.join(out,'profile')],env,timeout:60000});
 const info=await app.evaluate(async({app,BrowserWindow,screen})=>{
  globalThis.__pointerProof={exceptions:[],mouse:[],shapes:[]};process.on('uncaughtException',e=>globalThis.__pointerProof.exceptions.push({message:e.message,stack:e.stack}));
  const w=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Trace 桌面插件');if(!w)throw Error('Overlay absent');
  const conceal=other=>{if(other===w||other.getTitle().startsWith('桌宠鼠标验证'))return;other.on('show',()=>other.hide());other.hide()};for(const other of BrowserWindow.getAllWindows())conceal(other);app.on('browser-window-created',(_,other)=>conceal(other));
  const shape=w.setShape.bind(w);w.setShape=rects=>{const before=w.isAlwaysOnTop();const value=shape(rects);globalThis.__pointerProof.shapes.push({rects,time:Date.now(),beforeTop:before,afterTop:w.isAlwaysOnTop()});if(globalThis.__pointerProof.shapes.length>20)globalThis.__pointerProof.shapes.shift();return value};
  w.webContents.on('before-mouse-event',(_event,input)=>{if(input.type==='mouseDown'||input.type==='mouseUp'){globalThis.__pointerProof.mouse.push({...input,time:Date.now()})}});
  const area=screen.getPrimaryDisplay().workArea;const back=new BrowserWindow({x:area.x+Math.max(0,area.width-640),y:area.y+Math.max(0,area.height-480),width:620,height:460,show:false,title:'桌宠鼠标验证 · 隔离背景',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  await back.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{background:#e9f0f4;color:#203848;font:16px/1.6 sans-serif;padding:28px}button{font:inherit;padding:12px;border:1px solid #9eb2c0;border-radius:10px;background:white}p{max-width:340px}</style><h2>桌宠真实鼠标验证</h2><p>这是独立验证空间，不是你的资料窗口。桌宠外的区域应该可以直接点击。</p><button onclick="this.textContent=\'背景点击：\'+(++window.count)">背景点击：0</button><script>window.count=0</script></html>'));
  back.showInactive();
  return{pid:process.pid,isPackaged:app.isPackaged,version:app.getVersion(),profile:app.getPath('userData'),overlayId:w.id,backdropId:back.id,scale:screen.getPrimaryDisplay().scaleFactor};
 });
 log('ready',{...info,exe,asarSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(path.dirname(exe),'resources/app.asar'))).digest('hex')});
 const attach=p=>p.on('pageerror',e=>log('pageerror',{url:p.url(),message:e.message}));app.on('window',attach);app.windows().forEach(attach);
 const input=readline.createInterface({input:process.stdin});
 input.on('line',async line=>{try{const command=JSON.parse(line);if(command.op==='snapshot'){
  const p=app.windows().find(p=>p.url().startsWith('file:'));const ui=await p.evaluate(()=>({text:document.body.innerText,pet:(()=>{const r=document.querySelector('.trace-pet-button').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})(),regions:[...document.querySelectorAll('[data-trace-interactive-region]')].map(e=>({kind:e.dataset.traceInteractiveRegion,rect:e.getBoundingClientRect().toJSON()}))}));
  const native=await app.evaluate(({BrowserWindow})=>({...globalThis.__pointerProof,windows:BrowserWindow.getAllWindows().map(w=>({id:w.id,title:w.getTitle(),bounds:w.getBounds(),content:w.getContentBounds(),visible:w.isVisible(),top:w.isAlwaysOnTop()}))}));const value={ui,native};fs.writeFileSync(path.join(out,'snapshot-'+Date.now()+'.json'),JSON.stringify(value,null,2));log('snapshot',value)
 }else if(command.op==='retop'){log('retop-diagnostic',await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Trace 桌面插件');const before=w.isAlwaysOnTop();w.setAlwaysOnTop(true,'screen-saver');return{before,after:w.isAlwaysOnTop()}}))}else if(command.op==='quit'){fs.writeFileSync(path.join(out,'session.json'),JSON.stringify({info,events},null,2));await app.close();input.close();process.exitCode=0}}catch(e){log('command-error',{message:e.message,stack:e.stack})}});
})().catch(async e=>{log('error',{message:e.message,stack:e.stack});if(app)await app.close().catch(()=>{});process.exitCode=1});

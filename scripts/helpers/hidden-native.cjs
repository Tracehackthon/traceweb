// Fail closed before product main is released. This changes visibility/focus and
// global-shortcut boundaries only; the packaged main, preload and stores stay real.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {createRequire}=require('node:module');
const {extractFile}=createRequire(path.resolve(__dirname,'../../apps/desktop-pet/package.json'))('@electron/asar');
const {chromium}=require('playwright');
const {startForegroundWatch}=require('./foreground-watch.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

class Inspector {
  constructor(socket){this.socket=socket;this.next=0;this.pending=new Map();this.events=[];socket.addEventListener('message',event=>{const data=JSON.parse(String(event.data));if(data.id){const job=this.pending.get(data.id);if(job){this.pending.delete(data.id);clearTimeout(job.timer);data.error?job.reject(Error(JSON.stringify(data.error))):job.resolve(data.result);}}else this.events.push(data);});}
  send(method,params={}){const id=++this.next;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Inspector timeout: '+method));},10000);this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params}));});}
  async evaluate(expression){const result=await this.send('Runtime.evaluate',{expression,includeCommandLineAPI:true,returnByValue:true,awaitPromise:false});if(result.exceptionDetails)throw Error('Inspector evaluation rejected: '+JSON.stringify(result.exceptionDetails));return result.result?.value;}
  close(){this.socket.close();}
}

function visibilityGuard(config){
  const electron=require('electron'),{app,BrowserWindow,globalShortcut}=electron;
  if(process.pid!==config.pid||app.isReady()||BrowserWindow.getAllWindows().length!==0)throw Error('Unsafe pre-main state; never release');
  if(!process.argv.includes('--user-data-dir='+config.profile))throw Error('Wrong profile argument');
  app.setPath('userData',config.profile);
  const guard=globalThis.__searchVisibilityGuard={nonce:config.nonce,pid:process.pid,profile:app.getPath('userData'),installedBeforeReady:!app.isReady(),attempts:[],violations:[],windows:[],originals:{}};
  const blockedMethods={};
  for(const method of ['show','showInactive','focus','moveTop']){
    const original=BrowserWindow.prototype[method];if(typeof original!=='function')throw Error('No native method: '+method);
    guard.originals[method]=String(original);
    const blocked=function(){guard.attempts.push({method,id:this.isDestroyed()?null:this.id,at:Date.now()});};
    Object.defineProperty(BrowserWindow.prototype,method,{value:blocked,writable:false,configurable:false});
    blockedMethods[method]=blocked;
    if(BrowserWindow.prototype[method]!==blocked)throw Error('Visibility method guard missing');
  }
  for(const method of ['register','registerAll'])Object.defineProperty(globalShortcut,method,{value:()=>{guard.attempts.push({method:'shortcut.'+method,at:Date.now()});return false;},writable:false,configurable:false});
  app.prependListener('browser-window-created',(_,window)=>{
    // Instance methods must not shadow the sealed prototype boundary.
    for(const [method,blocked] of Object.entries(blockedMethods)){Object.defineProperty(window,method,{value:blocked,writable:false,configurable:false});if(window[method]!==blocked)throw Error('Instance visibility guard missing: '+method);}
    window.setFocusable(false);window.webContents.setBackgroundThrottling(false);
    const setFocusable=window.setFocusable.bind(window);
    Object.defineProperty(window,'setFocusable',{value:value=>{if(value){guard.attempts.push({method:'setFocusable(true)',id:window.id,at:Date.now()});return;}return setFocusable(false);},writable:false,configurable:false});
    guard.windows.push(window.id);
    for(const event of ['show','focus'])window.on(event,()=>{guard.violations.push({event,id:window.id,at:Date.now()});window.hide();app.exit(119);});
    if(window.isVisible()||window.isFocused()||window.isFocusable())throw Error('Window created in unsafe state');
  });
  process.prependListener('uncaughtException',error=>{guard.violations.push({event:'uncaughtException',message:error.message,stack:error.stack});app.exit(120);});
  return{nonce:guard.nonce,pid:process.pid,profile:guard.profile,ready:app.isReady(),windowCount:BrowserWindow.getAllWindows().length,blockedMethods:Object.keys(guard.originals),beforeReady:guard.installedBeforeReady};
}

exports.launchHiddenNative=async function({exe,out,asarSha256,mainSha256}){
  const asar=path.join(path.dirname(exe),'resources/app.asar');if(hash(asar)!==asarSha256)throw Error('Native ASAR differs');
  if(!/^[0-9a-f]{64}$/.test(mainSha256||''))throw Error('Bind the exact packaged main before starting native validation');
  if(crypto.createHash('sha256').update(extractFile(asar,path.join('lib','desktop','main.mjs'))).digest('hex')!==mainSha256)throw Error('Packaged main differs before any launch');
  // Captured first-code pause in accepted029 is the side-effect-free leaf import,
  // not main: only exported function declarations, before any product startup.
  const entryURL=pathToFileURL(path.join(asar,'lib/desktop/runtime-readiness.mjs')).href;
  const entrySha256='a02e812e272f1ffdf9ad0e7bb2b2710c04ffe5509c6da91cc5b0ef864b43b146';
  if(crypto.createHash('sha256').update(extractFile(asar,path.join('lib','desktop','runtime-readiness.mjs'))).digest('hex')!==entrySha256)throw Error('Reviewed first-code leaf differs');
  if(fs.existsSync(path.join(out,'profile')))throw Error('Native verification requires a fresh profile; never reactivate an old instance');
  for(const name of ['profile','project','tmp','appdata','localappdata'])fs.mkdirSync(path.join(out,name),{recursive:true});
  const profile=path.join(out,'profile'),nonce=crypto.randomUUID();
  const watch=await startForegroundWatch(out,profile);
  let child,inspector,browser,ack,released=false,bootstrapReleased=false,logs='',spawnError,exited=false,browserSession;
  const write=()=>fs.writeFileSync(path.join(out,'native-bootstrap.log'),logs);
  const cleanup=async()=>{
    // Never disconnect an unguarded paused debugger before terminating its owner:
    // some debugger states resume when their last client disconnects.
    if(child?.pid&&!exited&&!released){child.kill();await Promise.race([new Promise(resolve=>exited?resolve():child.once('exit',resolve)),delay(10000)]);if(!exited)throw Error('Paused self process still alive; keep debugger and observer attached');}
    if(inspector&&ack){await inspector.evaluate("require('electron').app.quit();true").catch(()=>{});}
    if(browser)await browser.close().catch(()=>{});
    inspector?.close();
    if(child?.pid&&!exited){await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(6000)]);if(!exited){child.kill();await Promise.race([new Promise(resolve=>exited?resolve():child.once('exit',resolve)),delay(10000)]);if(!exited)throw Error('Own process still alive; observer deliberately left running');}}
    write();const foreground=await watch.stop();return foreground;
  };
  try{
    const env={...process.env,APPDATA:path.join(out,'appdata'),LOCALAPPDATA:path.join(out,'localappdata'),TEMP:path.join(out,'tmp'),TMP:path.join(out,'tmp'),TMPDIR:path.join(out,'tmp'),TRACE_AGENT_ENABLED:'0',TRACE_CLOUD_ORIGIN:'https://127.0.0.1:1',TRACE_PROJECT_DIR:path.join(out,'project'),TRACE_DESKTOP_INTEGRATIONS_FILE:path.join(out,'no-integrations.json')};
    for(const key of ['NODE_OPTIONS','NODE_PATH','NODE_INSPECT_RESUME_ON_START','ELECTRON_RUN_AS_NODE','ELECTRON_NO_ASAR'])delete env[key];
    child=spawn(exe,['--inspect-brk=127.0.0.1:0','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile],{windowsHide:true,cwd:path.dirname(exe),stdio:['ignore','pipe','pipe'],env});
    child.on('error',error=>{spawnError=error;});
    child.once('exit',()=>{exited=true;});
    await watch.rememberNativePid(child.pid);
    const collect=chunk=>{logs+=String(chunk);write();};child.stdout.on('data',collect);child.stderr.on('data',collect);
    let endpoint;for(let step=0;step<200;step++){if(spawnError)throw spawnError;endpoint=/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/.exec(logs)?.[1];if(endpoint)break;if(child.exitCode!==null)throw Error('Native exited before the debugger barrier');await delay(50);}
    if(!endpoint)throw Error('No inspector barrier; never resume');
    const socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.close();reject(Error('Inspector WebSocket open timed out before release'));},8000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',error=>{clearTimeout(timer);reject(error);},{once:true});});inspector=new Inspector(socket);
    await inspector.send('Runtime.enable');
    await inspector.send('Debugger.enable');
    // inspect-brk has TWO barriers: the early Node wait cannot require Electron.
    // Bootstrap and the statically reviewed, side-effect-free ESM imports may run
    // until the first-code pause. Never resume an unexpected frame or exception.
    const breakpoint=await inspector.send('Debugger.setBreakpointByUrl',{url:entryURL,lineNumber:0,columnNumber:0});
    if(!breakpoint.breakpointId)throw Error('No exact entry breakpoint; never initialize bootstrap');
    await inspector.send('Debugger.setPauseOnExceptions',{state:'all'});
    await inspector.send('Runtime.runIfWaitingForDebugger');bootstrapReleased=true;
    let pause;for(let step=0;step<200;step++){pause=inspector.events.find(event=>event.method==='Debugger.paused');if(pause)break;if(exited)throw Error('Native exited before entry pause');await delay(25);}
    if(!pause)throw Error('No automatic first-code pause; terminate while debugger remains attached');
    fs.writeFileSync(path.join(out,'automatic-entry-pause-raw.json'),JSON.stringify(pause,null,2));
    const frame=pause.params.callFrames[0],parsed=inspector.events.find(event=>event.method==='Debugger.scriptParsed'&&event.params.scriptId===frame?.location?.scriptId)?.params;
    const source=frame?await inspector.send('Debugger.getScriptSource',{scriptId:frame.location.scriptId}):null;
    const entry={entryURL,expectedEntrySha256:entrySha256,expectedMainSha256:mainSha256,actualURL:parsed?.url||frame?.url,line:frame?.location?.lineNumber,column:frame?.location?.columnNumber,reason:pause.params.reason,entrySha256:source?crypto.createHash('sha256').update(source.scriptSource).digest('hex'):null,breakpoint};
    fs.writeFileSync(path.join(out,'automatic-entry-pause.json'),JSON.stringify(entry,null,2));
    const entryReason=pause.params.reason==='Break on start'||pause.params.reason==='other'&&pause.params.hitBreakpoints?.includes(breakpoint.breakpointId);
    if(!entryReason||entry.actualURL!==entryURL||entry.entrySha256!==entrySha256||entry.line!==0)throw Error('Unexpected first-code pause; never resume');
    ack=await inspector.evaluate('('+visibilityGuard.toString()+')('+JSON.stringify({pid:child.pid,profile,nonce})+')');
    if(ack?.nonce!==nonce||ack.pid!==child.pid||ack.profile!==profile||ack.ready!==false||ack.windowCount!==0||!ack.beforeReady||ack.blockedMethods.length!==4)throw Error('Pre-main visibility ACK invalid; never resume');
    fs.writeFileSync(path.join(out,'pre-main-guard-ack.json'),JSON.stringify({ack,entry,asarSha256,guardSourceSha256:crypto.createHash('sha256').update(visibilityGuard.toString()).digest('hex')},null,2));
    const confirmed=await inspector.evaluate('Boolean(globalThis.__searchVisibilityGuard?.nonce==='+JSON.stringify(nonce)+')');if(!confirmed)throw Error('Guard lost before entry resume');
    await inspector.send('Debugger.removeBreakpoint',{breakpointId:breakpoint.breakpointId});
    await inspector.send('Debugger.setPauseOnExceptions',{state:'none'});
    await inspector.send('Debugger.resume');released=true;
    let chromeEndpoint;for(let step=0;step<300;step++){chromeEndpoint=/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/.exec(logs)?.[1];if(chromeEndpoint)break;if(child.exitCode!==null)throw Error('Guarded native main exited');await delay(50);}
    if(!chromeEndpoint)throw Error('Guarded Chromium endpoint unavailable');
    browser=await chromium.connectOverCDP(chromeEndpoint,{timeout:15000});
    browserSession=await browser.newBrowserCDPSession();
    await watch.rememberBrowserPids((await browserSession.send('SystemInfo.getProcessInfo')).processInfo.map(process=>process.id));
    let page;for(let step=0;step<200;step++){page=browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().startsWith('trace-app://'));if(page)break;await delay(50);}
    if(!page)throw Error('Actual packaged workbench did not open hidden');
    const identity=await inspector.evaluate("(()=>{const {app,BrowserWindow}=require('electron');return{pid:process.pid,version:app.getVersion(),packaged:app.isPackaged,appPath:app.getAppPath(),profile:app.getPath('userData'),windows:BrowserWindow.getAllWindows().map(w=>({id:w.id,visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()}))}})()");
    if(!identity.packaged||identity.windows.some(window=>window.visible||window.focused||window.focusable))throw Error('Hidden native identity/visibility guard failed');
    fs.writeFileSync(path.join(out,'native-identity.json'),JSON.stringify({identity,asarSha256,releasedAfterAck:released},null,2));
    return{page,browser,identity,inspector,async close(){let guard,readError,foreground;try{await watch.rememberBrowserPids((await browserSession.send('SystemInfo.getProcessInfo')).processInfo.map(process=>process.id));guard=await inspector.evaluate('globalThis.__searchVisibilityGuard');fs.writeFileSync(path.join(out,'visibility-guard-final.json'),JSON.stringify(guard,null,2));}catch(error){readError=error;}finally{foreground=await cleanup();}if(readError)throw readError;if(guard.violations.length||!foreground.passed)throw Error('Native visibility/foreground boundary violated');return{guard,foreground};}};
  }catch(error){fs.writeFileSync(path.join(out,'bootstrap-failure.json'),JSON.stringify({message:error.message,stack:error.stack,bootstrapReleased,productResumed:released,released,ack,pid:child?.pid},null,2));await cleanup().catch(cleanupError=>fs.writeFileSync(path.join(out,'cleanup-failure.txt'),cleanupError.stack));throw error;}
};

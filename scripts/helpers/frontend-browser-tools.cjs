// Task-scoped browser lane for Trace frontend replacement. No user profiles,
// global CLI migration, downloads, cloud browser, or automatic app installation.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {createRequire}=require('node:module');
const web=path.resolve(__dirname,'../..');
const directory=path.join(web,'.test-results/frontend-replacement/browser-tooling');
const sessionFile=path.join(directory,'session.json'),laneFile=path.join(directory,'controller.json');
const python='D:/AComputer/devtools/browser-use-cli/.venv/Scripts/python.exe';
const mcpPackage='D:/AComputer/nvm/nodejs/node_modules/@playwright/mcp/package.json';
const owner='trace-frontend-replacement';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const guard=(ok,message)=>{if(!ok)throw Error(message)};
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const alive=pid=>{try{process.kill(pid,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}};
function environment(){
  const home=path.join(directory,'harness'),tmp=path.join(directory,'tmp');
  fs.mkdirSync(tmp,{recursive:true});
  return {...process.env,BH_HOME:home,BROWSER_HARNESS_HOME:home,BH_CONFIG_DIR:home,
    BH_RUNTIME_DIR:path.join(home,'runtime'),BH_TMP_DIR:path.join(home,'tmp'),
    BH_AGENT_WORKSPACE:path.join(home,'agent-workspace'),BH_RUNTIME_DIR_SHARED:'0',
    BH_RECORD:'0',BH_TELEMETRY:'0',BROWSER_HARNESS_TELEMETRY:'0',ANONYMIZED_TELEMETRY:'false',
    BH_UPDATE_CHECK:'0',BH_TAB_MARKER:'0',BU_AUTOSPAWN:'',BU_CDP_WS:'',BU_NAME:'default',
    TEMP:tmp,TMP:tmp,TMPDIR:tmp,PYTHONPYCACHEPREFIX:path.join(tmp,'pycache'),PYTHONIOENCODING:'utf-8'};
}
function session(){
  const s=JSON.parse(fs.readFileSync(sessionFile,'utf8'));
  guard(s.owner===owner&&Number.isInteger(s.pid)&&s.pid>0&&s.profile===path.join(directory,'profile'),'Unknown browser session; not attaching.');
  return s;
}
async function version(endpoint){
  const u=new URL(endpoint);guard(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/','Only the owned loopback CDP endpoint is allowed.');
  const r=await fetch(new URL('/json/version',u),{signal:AbortSignal.timeout(3000)});guard(r.ok,'Owned CDP endpoint unavailable.');return r.json();
}
async function owned(){const s=session();guard(alive(s.pid),'Owned browser exited; use start explicitly.');const v=await version(s.endpoint);guard(v.webSocketDebuggerUrl===s.webSocketDebuggerUrl,'CDP identity changed; not attaching to a reused port.');return s;}
function takeLane(kind){
  if(fs.existsSync(laneFile)){const old=JSON.parse(fs.readFileSync(laneFile,'utf8'));guard(old.owner===owner,'Unknown browser controller lock.');guard(!alive(old.pid),'Another browser controller is active; do not run them in parallel.');fs.unlinkSync(laneFile);}
  const fd=fs.openSync(laneFile,'wx');fs.writeFileSync(fd,JSON.stringify({owner,kind,pid:process.pid}));fs.closeSync(fd);
  return()=>{const current=JSON.parse(fs.readFileSync(laneFile,'utf8'));if(current.pid===process.pid)fs.unlinkSync(laneFile)};
}
function run(command,args,env,stdio='inherit'){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd:web,env,stdio,windowsHide:true});
    const terminate=()=>child.kill('SIGTERM');process.once('SIGTERM',terminate);process.once('SIGINT',terminate);
    const finish=()=>{process.removeListener('SIGTERM',terminate);process.removeListener('SIGINT',terminate)};
    child.once('error',error=>{finish();reject(error)});child.once('exit',(code,signal)=>{finish();resolve({code:code??1,signal})});
  });
}
async function start(){
  if(fs.existsSync(sessionFile)){
    const old=session();if(alive(old.pid)){await owned();return old;}
    // A confirmed dead PID, not a metadata timeout, permits a new launch.
  }
  const r=createRequire(path.join(web,'package.json')),binary=r('playwright').chromium.executablePath();
  guard(fs.existsSync(binary),'Existing Chromium missing; no browser download was attempted.');
  const profile=path.join(directory,'profile');fs.mkdirSync(profile,{recursive:true});
  const launched=Date.now(),log=fs.openSync(path.join(directory,'chromium.log'),'a');
  const child=spawn(binary,['--headless=new','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',
    '--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','--disable-extensions',
    '--disable-background-networking','--disable-component-update','--disable-sync','about:blank'],
    {cwd:web,env:environment(),stdio:['ignore',log,log],windowsHide:true,detached:true});
  fs.closeSync(log);guard(child.pid,'Chromium did not start.');child.unref();
  const state={owner,pid:child.pid,binary,profile,startedAt:new Date(launched).toISOString(),phase:'starting'};write(sessionFile,state);
  const active=path.join(profile,'DevToolsActivePort');
  for(let i=0;i<100;i++){
    guard(alive(child.pid),'Owned Chromium exited during startup.');
    if(fs.existsSync(active)&&fs.statSync(active).mtimeMs>=launched-1000){
      const [port,wsPath]=fs.readFileSync(active,'utf8').trim().split(/\r?\n/);
      if(/^\d+$/.test(port)&&wsPath?.startsWith('/devtools/browser/')){
        const endpoint='http://127.0.0.1:'+port,details=await version(endpoint);
        if(details.webSocketDebuggerUrl==='ws://127.0.0.1:'+port+wsPath){Object.assign(state,{endpoint,webSocketDebuggerUrl:details.webSocketDebuggerUrl,browserVersion:details.Browser,phase:'ready'});write(sessionFile,state);return state;}
      }
    }
    await pause(200);
  }
  throw Error('Owned Chromium is still starting or inaccessible; its PID was preserved, not restarted.');
}
async function harnessStop(){
  const env=environment();
  const pidFile=path.join(env.BH_RUNTIME_DIR,'bu.pid');
  const pid=fs.existsSync(pidFile)?Number(fs.readFileSync(pidFile,'utf8').trim()):null;
  guard(pid===null||Number.isInteger(pid)&&pid>0,'Invalid owned daemon PID; not touching it.');
  const code="from browser_harness import _ipc as i\ntry:\n c,t=i.connect('default',timeout=2); r=i.request(c,t,{'meta':'shutdown'}); c.close(); assert r.get('ok'), r\nexcept (FileNotFoundError,ConnectionRefusedError): pass";
  // No setup text may contaminate the MCP JSON-RPC stdout stream.
  const result=await run(python,['-c',code],env,['ignore','ignore','inherit']);guard(result.code===0,'Owned browser-use daemon shutdown was not confirmed.');
  for(let i=0;i<50;i++){if(pid===null||!alive(pid))return;await pause(100);}
  throw Error('Owned browser-use daemon is still live; MCP was not started.');
}
async function useHarness(args){
  guard(args.length===0,'This task entry accepts browser-use Python on stdin only.');
  const release=takeLane('browser-use');try{const s=await owned();const env={...environment(),BU_CDP_URL:s.endpoint};return(await run(python,['-m','browser_harness.run'],env)).code;}finally{release();}
}
async function useMcp(){
  const release=takeLane('playwright-mcp');try{
    await harnessStop();const s=await owned(),r=createRequire(mcpPackage),pkg=r(mcpPackage);
    guard(pkg.version==='0.0.84','Playwright MCP version changed; inspect it before use.');
    const config=path.join(directory,'playwright-mcp.json');
    write(config,{browser:{browserName:'chromium',cdpEndpoint:s.endpoint},outputDir:path.join(directory,'mcp-output'),
      capabilities:['core','testing','network','devtools'],network:{allowedOrigins:['http://127.0.0.1:*','http://localhost:*']}});
    return(await run(process.execPath,[path.join(path.dirname(mcpPackage),'cli.js'),'--config',config,'--codegen','none'],environment())).code;
  }finally{release();}
}
async function stop(){
  const release=takeLane('shutdown');try{await harnessStop();const s=session();if(!alive(s.pid))return{closed:true};await owned();
    await new Promise((resolve,reject)=>{const socket=new WebSocket(s.webSocketDebuggerUrl);socket.addEventListener('open',()=>socket.send(JSON.stringify({id:1,method:'Browser.close'})));socket.addEventListener('close',resolve);socket.addEventListener('error',reject);});
    for(let i=0;i<50;i++){if(!alive(s.pid))return{closed:true};await pause(100);}throw Error('Browser close sent; process termination is not yet confirmed.');
  }finally{release();}
}
async function main(){fs.mkdirSync(directory,{recursive:true});const command=process.argv[2];
  if(command==='start')console.log(JSON.stringify(await start()));
  else if(command==='status')console.log(JSON.stringify(await owned()));
  else if(command==='detach'){await harnessStop();console.log(JSON.stringify({detached:true}));}
  else if(command==='browser-use')process.exitCode=await useHarness(process.argv.slice(3));
  else if(command==='mcp')process.exitCode=await useMcp();
  else if(command==='stop')console.log(JSON.stringify(await stop()));
  else throw Error('Use start, status, browser-use (Python stdin), detach, mcp or stop.');
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={directory,environment,owned};

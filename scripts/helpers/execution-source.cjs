// E2E-only bounded executor. Real Node child, real Agent service/SQLite/events;
// no model calls, prerecorded receipts, UI state injection, or timed completion.
const path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url'),{spawn}=require('node:child_process'),crypto=require('node:crypto');
module.exports=async({root,out})=>{
  const runtime=path.resolve(root,'../trace-runtime'),load=file=>import(pathToFileURL(path.join(runtime,'apps/agent',file)).href);
  const {createAgentStore}=await load('store.mjs'),{createAgentService}=await load('service.mjs'),{createAgentHttp}=await load('http.mjs'),{AgentError}=await load('protocol.mjs');
  const {createProductWorkspace}=await import('@trace/product-workspace/node'),context=createProductWorkspace({file:path.join(out,'execution-context.sqlite')});
  context.execute({protocolVersion:1,commandId:crypto.randomUUID(),expectedRevision:context.read().revision,operations:[{type:'capture.create',matterId:'execution-fixture',text:'仅供隔离执行验证的原范围，不是工作台任务上下文。'}]});
  const children=new Map(),evidence=[];
  const script=path.join(out,'bounded-child.cjs');fs.writeFileSync(script,"process.stdout.write('child ready\\n');process.stdin.once('data',()=>{if(process.argv[2]==='fail'){process.stderr.write('requested exit 17\\n');process.exit(17);}const value=6*7;process.stdout.write(JSON.stringify({answer:'actual child computed '+value+'\\n```js\\nconst result = 6 * 7;\\n```',replacement:null,citations:[],uncertainties:[]})+'\\n');});");
  const store=createAgentStore({file:path.join(out,'execution-events.sqlite'),workspaceKey:'isolated-execution-view'});
  const adapter={check:async()=>({authenticated:false,modelTurnTested:false}),execute:({runId,request,onEvent,signal})=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[script,request.input==='fail'?'fail':'success'],{cwd:out,windowsHide:true,env:{SystemRoot:process.env.SystemRoot||'',TEMP:path.join(out,'tmp'),TMP:path.join(out,'tmp')}}),row={runId,pid:child.pid,mode:request.input,exitCode:null,output:''};evidence.push(row);children.set(runId,child);
    onEvent('runtime.started',{pid:child.pid,summary:'bounded local Node process started'});let stdout='';
    child.stdout.on('data',chunk=>{const value=chunk.toString('utf8');stdout+=value;row.output+=value;onEvent('runtime.item',{summary:value,source:'actual stdout'});});child.stderr.on('data',chunk=>{row.output+=chunk.toString('utf8');onEvent('runtime.item',{summary:chunk.toString('utf8'),source:'actual stderr'});});
    const abort=()=>child.kill();signal.addEventListener('abort',abort,{once:true});child.once('error',reject);child.once('exit',(code,exitSignal)=>{row.exitCode=code;row.signal=exitSignal;row.exited=true;children.delete(runId);signal.removeEventListener('abort',abort);if(code!==0)return reject(new AgentError('LOCAL_PROCESS_FAILED','实际子进程退出：'+code,502));resolve({raw:stdout.trim().split('\n').at(-1),providedFragments:[],threadId:'child-'+child.pid,turnId:runId,runtimeVersion:process.version});});
  })};
  const service=createAgentService({store,readWorkspace:context.read,adapter,timeoutMs:120000,pollMs:100}),http=createAgentHttp({service});
  return {http,service,store,evidence,dropReads:false,
    async start(base,mode='success'){const snapshot=context.read(),session=snapshot.host.chain.sessions['execution-fixture'],response=await fetch(base+'/api/agent/runs',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({protocolVersion:1,requestId:crypto.randomUUID(),expectedRevision:snapshot.revision,matterId:'execution-fixture',contextMode:session.contextMode,contextEpoch:session.contextEpoch,purpose:'discuss',input:mode})});const value=await response.json();if(!response.ok)throw Error(JSON.stringify(value));return value.run;},
    release(id){const child=children.get(id);if(!child)throw Error('Child is not running');child.stdin.end('continue\n');},
    async cancel(base,id){const response=await fetch(base+'/api/agent/runs/'+id+'/cancel',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:'{}'});if(!response.ok)throw Error('cancel failed');return response.json();},
    async close(){await http.close();for(const child of children.values())child.kill();context.close();store.close();fs.writeFileSync(path.join(out,'actual-process-evidence.json'),JSON.stringify(evidence,null,2));}
  };
};

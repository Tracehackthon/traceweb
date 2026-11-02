import {Readable} from 'node:stream'
import {createProductWorkspace} from '@trace/product-workspace/node'
import {resolveContentRef,stableWorkbenchJson,effectiveContentReferences,prepareContentWriteback,activationInput,taskInput} from '@trace/product-workspace'

const RESPONSE_KIND = 'trace.native-product-response@1'
const jsonLimit = 8 * 1024 * 1024
const resourceLimit = 256 * 1024 * 1024

function originalOperations(host,runId,answer,refs) {
  const id='ai-'+runId,archive=host.expressions[id];
  // These are provenance, not permission to use a now-disabled method again.
  for(const ref of refs)resolveContentRef(host,ref);
  if(archive){
    if(archive.author!=='agent'||archive.kind!=='note'||archive.version!==1||archive.versions[1]?.text!==answer)throw Error('AI原稿身份冲突，未覆盖。');
    if(stableWorkbenchJson(archive.versions[1].refs)!==stableWorkbenchJson(refs))throw Error('已存AI原稿来源与本次冻结引用不一致，未覆盖或写回。');
    return [];
  }
  return [{type:'expression.create',id,kind:'note',title:'AI返回原稿（不可覆盖）',author:'agent',value:{text:answer,refs}}, {type:'expression.decide',id,expectedVersion:1,decision:'saved'}];
}

// One canonical SQLite owner for the new workspace. The legacy Runtime keeps
// its original web.sqlite; no implicit conversion, dual writer or fallback.
export function createDesktopWorkbench({file}) {
  let owner,activationCloseHandler
  const workspace = () => owner ||= createProductWorkspace({file})
  function afterCommit(command,result){
    if(result?.receipt?.status!=='committed'||result.receipt.commandId!==command?.commandId)return;
    for(const op of command.operations||[])if(op.type==='activation.close')activationCloseHandler?.(op.id);
  }
  async function dispatch(pathname, method, body, type='application/json') {
    const req=Readable.from(body?.length ? [body] : [])
    req.url=pathname;req.method=method;req.socket={encrypted:false}
    req.headers={host:'127.0.0.1',origin:'http://127.0.0.1','content-type':type,'content-length':String(body?.length||0)}
    let status=200,headers={},bytes=Buffer.alloc(0)
    const res={writeHead(code,value){status=code;headers=value},end(value){bytes=value===undefined?Buffer.alloc(0):Buffer.isBuffer(value)?value:Buffer.from(value)}}
    await workspace().handle(req,res)
    if(status>=400){const value=JSON.parse(bytes.toString('utf8'));return {kind:RESPONSE_KIND,ok:false,status,error:value.error}}
    if(type==='application/json' || method==='POST'){
      const value=JSON.parse(bytes.toString('utf8'))
      if(method==='POST'&&pathname==='/api/product/commands')afterCommit(JSON.parse(body.toString('utf8')),value)
      if(value.storage)value.storage={kind:'sqlite',label:'Trace 桌面新工作区（旧内容独立保留）',features:value.storage.features||[]}
      return value
    }
    return {bytes:new Uint8Array(bytes),mime:headers['content-type']||'application/octet-stream'}
  }
  return {
    activationSnapshot(id){return activationInput(workspace().read().host,id)},
    activationIsPrepared(id){return workspace().read().host?.activations?.[id]?.status==='prepared'},
    configureActivationCloseHandler(handler){if(typeof handler!=='function')throw Error('需要受控的执行停止处理器。');activationCloseHandler=handler},
    thinkingSnapshot(id,messageId,{legacy=false}={}) {
      const host=workspace().read().host,session=host?.sessions?.[id],index=session?.messages.findIndex(m=>m.id===messageId);
      if(!session||index<0)throw Error('讨论或本次消息不可用。');
      const message=session.messages[index],fragments=[],scope=message.scope||{refs:session.refs,excluded:session.excluded,historyIds:session.messages.slice(0,index).map(m=>m.id)};
      if(!message.scope&&!legacy)throw Error('这条旧消息没有独立冻结范围；请先将原话接入新草稿核对，不会改写旧消息或原运行。');
      for(const [role,refs] of [['reference',scope.refs],['instruction',message.instructions||[]]])for(const ref of effectiveContentReferences(refs,scope.excluded)){
        const {item,value}=resolveContentRef(host,ref,{forUse:true});let text=role==='instruction'?value.prompt:ref.kind==='capability'?JSON.stringify(value):value.text;
        if(ref.anchor&&ref.anchor.type!=='text')throw Error('当前文本执行器不能读取这个媒体局部；未扩大成整份材料发送。请保留引用，或先人工摘取为可读文字。')
        if(ref.anchor?.type==='text')text=text.slice(ref.anchor.start,ref.anchor.end);
        if(!text?.trim())throw Error('所选材料没有文字摘录；不会自动上传原件。');
        fragments.push({id:`${role}:${fragments.length+1}`,role,revision:ref.version,text,title:item.title,ref:structuredClone(ref)});
      }
      for(const m of session.messages.slice(0,index+1).filter(m=>m.id===messageId||scope.historyIds.includes(m.id)))fragments.push({id:'message:'+m.id,role:'user',revision:1,text:m.text,title:'本讨论中的用户原话'});
      const result={kind:'thinking',sessionId:id,messageId,...(message.scope?{messageScope:structuredClone(scope)}:{}),task:{id:'thinking-'+id+'-'+messageId,title:session.title,goal:message.text,refs:structuredClone(scope.refs),excluded:structuredClone(scope.excluded),instructions:structuredClone(message.instructions||[]),status:'prepared'},fragments};
      if(Buffer.byteLength(JSON.stringify(result))>256*1024)throw Error('本讨论上下文超过256 KiB，请缩小引用范围。');
      return result;
    },
    archiveResult({runId,answer,refs}) {
      const snapshot=workspace().read(),operations=originalOperations(snapshot.host,runId,answer,refs);
      if(operations.length)workspace().execute({protocolVersion:1,commandId:'archive-'+runId,expectedRevision:snapshot.revision,operations});
      return {source:{kind:'expression',id:'ai-'+runId,version:1},adopted:false};
    },
    async committedAdoption(commandId) {
      const result=await dispatch('/api/product/commands/'+encodeURIComponent(commandId),'GET');
      if(result.kind===RESPONSE_KIND&&result.ok===false){if(result.status===404&&result.error?.code==='UNKNOWN_COMMAND')return false;throw Error(result.error?.message||'原写回回执暂不可核对，未推定已保存。');}
      if(result.receipt?.protocolVersion!==1||result.receipt.commandId!==commandId||result.receipt.status!=='committed')throw Error('原写回回执身份不一致，未推定已保存。');
      return true;
    },
    verifyAdoptionSource({runId,answer,refs,plan}) {
      const host=workspace().read().host,sourceId='ai-'+runId;
      if(plan.source?.kind!=='expression'||plan.source.id!==sourceId||plan.source.version!==1)throw Error('原写回来源身份不一致，未执行。');
      originalOperations(host,runId,answer,refs);
      const creation=plan.command?.operations?.find(op=>op.type==='expression.create'&&op.id===sourceId);
      if(creation){if(creation.author!=='agent'||creation.kind!=='note'||creation.value?.text!==answer||stableWorkbenchJson(creation.value.refs)!==stableWorkbenchJson(refs))throw Error('原写回冻结的AI原稿或来源与当前记录不一致，未执行。');}
      else if(!host.expressions[sourceId])throw Error('原写回引用的AI原稿不可用，未重新创建或改用另一来源。');
    },
    planAdoption({id,runId,answer,refs,target,expectedVersion,text,title,sourceAnchor}) {
      const snapshot=workspace().read(),host=snapshot.host,operations=originalOperations(host,runId,answer,refs);
      const source={kind:'expression',id:'ai-'+runId,version:1,...(sourceAnchor?{anchor:sourceAnchor}:{})};
      const {operations:destination,...planned}=prepareContentWriteback(host,{id,source,target,expectedVersion,text,title,provenance:{purpose:'本次AI结果经用户逐项复核保留',scope:'尚未试用，需继续验证',evidence:'来自已保存的AI原稿 '+runId,reason:'逐项复核采纳 '+runId,annotationTitle:'采纳摘记',branchEvidence:'用户逐项核对的讨论内容'}});
      operations.push(...destination);
      return {command:{protocolVersion:1,commandId:id,expectedRevision:snapshot.revision,operations},source,...planned};
    },
    execute(command){const result=workspace().execute(command);afterCommit(command,result);return result},
    configureFeedbackEvidenceResolver(resolver){workspace().configureFeedbackEvidenceResolver(resolver)},
    configureActivationEvidenceResolver(resolver){workspace().configureActivationEvidenceResolver(resolver)},
    configureTaskDispatchResolver(resolver){workspace().configureTaskDispatchResolver(resolver)},
    reserveNativeDispatch(input){return workspace().reserveNativeDispatch(input)},
    cancelNativeDispatch(input){return workspace().cancelNativeDispatch(input)},
    taskDispatchIsCurrent(id,runId,inputHash){
      const host=workspace().read().host,task=host?.tasks?.[id],claim=task?.dispatch;
      if(task?.status!=='prepared'||task.execution||claim?.source!=='native'||claim.runId!==runId||claim.inputHash!==inputHash||claim.cancelledAt)return false;
      try{taskInput(host,id);return true}catch{return false}
    },
    taskSnapshot(id) {return taskInput(workspace().read().host,id)},
    async request(request) {
      if(request?.operation==='workbench.request'){
        const p=request.pathname,m=request.method||'GET'
        const read=p==='/api/product/workspace'||p==='/api/product/canvases'||/^\/api\/product\/canvases\/[a-zA-Z0-9_-]{1,128}$/.test(p)||/^\/api\/product\/commands\/[a-zA-Z0-9_-]{1,200}$/.test(p)
        const write=p==='/api/product/commands'||/^\/api\/product\/canvases\/[a-zA-Z0-9_-]{1,128}\/commands$/.test(p)
        if(!(m==='GET'&&read||m==='POST'&&write))throw Error('不支持这个工作台操作')
        const body=m==='POST'?Buffer.from(JSON.stringify(request.body)):undefined
        if(body&&body.length>jsonLimit)throw Error('工作台命令超过8 MiB')
        return dispatch(p,m,body)
      }
      if(request?.operation==='product.resource.save'){
        const bytes=request.bytes instanceof Uint8Array?request.bytes:request.bytes instanceof ArrayBuffer?new Uint8Array(request.bytes):null
        if(!bytes||bytes.byteLength>resourceLimit||typeof request.mime!=='string'||!/^\w[\w.+-]*\/[\w.+-]+$/.test(request.mime))throw Error('原件数据或类型不正确')
        return dispatch('/api/product/resources','POST',Buffer.from(bytes),request.mime)
      }
      if(request?.operation==='product.resource.read'){
        if(typeof request.resourceId!=='string'||!/^[a-f0-9]{64}$/.test(request.resourceId))throw Error('原件身份不正确')
        return dispatch(`/api/product/resources/${request.resourceId}/content`,'GET',undefined,'application/octet-stream')
      }
      throw Error('不支持这个本机工作区操作')
    },
    close(){owner?.close();owner=undefined},
  }
}

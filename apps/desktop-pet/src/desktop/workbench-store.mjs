import {Readable} from 'node:stream'
import {createProductWorkspace} from '@trace/product-workspace/node'
import {resolveContentRef,stableWorkbenchJson} from '@trace/product-workspace'

const RESPONSE_KIND = 'trace.native-product-response@1'
const jsonLimit = 8 * 1024 * 1024
const resourceLimit = 256 * 1024 * 1024

// One canonical SQLite owner for the new workspace. The legacy Runtime keeps
// its original web.sqlite; no implicit conversion, dual writer or fallback.
export function createDesktopWorkbench({file}) {
  let owner
  const workspace = () => owner ||= createProductWorkspace({file})
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
      if(value.storage)value.storage={kind:'sqlite',label:'Trace 桌面新工作区（旧内容独立保留）',features:value.storage.features||[]}
      return value
    }
    return {bytes:new Uint8Array(bytes),mime:headers['content-type']||'application/octet-stream'}
  }
  return {
    thinkingSnapshot(id,messageId) {
      const host=workspace().read().host,session=host?.sessions?.[id],index=session?.messages.findIndex(m=>m.id===messageId);
      if(!session||index<0)throw Error('讨论或本次消息不可用。');
      const message=session.messages[index],fragments=[],excluded=new Set(session.excluded.map(stableWorkbenchJson));
      for(const [role,refs] of [['reference',session.refs],['instruction',message.instructions||[]]])for(const ref of refs){
        if(excluded.has(stableWorkbenchJson(ref)))continue;
        const {item,value}=resolveContentRef(host,ref,{forUse:true});let text=role==='instruction'?value.prompt:ref.kind==='capability'?JSON.stringify(value):value.text;
        if(ref.anchor&&ref.anchor.type!=='text')throw Error('当前文本执行器不能读取这个媒体局部；未扩大成整份材料发送。请保留引用，或先人工摘取为可读文字。')
        if(ref.anchor?.type==='text')text=text.slice(ref.anchor.start,ref.anchor.end);
        if(!text?.trim())throw Error('所选材料没有文字摘录；不会自动上传原件。');
        fragments.push({id:`${role}:${fragments.length+1}`,role,revision:ref.version,text,title:item.title,ref:structuredClone(ref)});
      }
      for(const m of session.messages.slice(0,index+1))fragments.push({id:'message:'+m.id,role:'user',revision:1,text:m.text,title:'本讨论中的用户原话'});
      const result={kind:'thinking',sessionId:id,messageId,task:{id:'thinking-'+id+'-'+messageId,title:session.title,goal:message.text,refs:structuredClone(session.refs),excluded:structuredClone(session.excluded),instructions:structuredClone(message.instructions||[]),status:'prepared'},fragments};
      if(Buffer.byteLength(JSON.stringify(result))>256*1024)throw Error('本讨论上下文超过256 KiB，请缩小引用范围。');
      return result;
    },
    planAdoption({id,runId,answer,refs,target,expectedVersion,text,title}) {
      const snapshot=workspace().read(),host=snapshot.host,operations=[],archiveId='ai-'+runId,archive=host.expressions[archiveId];
      for(const ref of refs)resolveContentRef(host,ref,{forUse:true});
      if(archive){if(archive.author!=='agent'||archive.versions[1].text!==answer)throw Error('AI原稿身份冲突，未覆盖。');}
      else operations.push({type:'expression.create',id:archiveId,kind:'note',title:'AI返回原稿（不可覆盖）',author:'agent',value:{text:answer,refs}}, {type:'expression.decide',id:archiveId,expectedVersion:1,decision:'saved'});
      const source={kind:'expression',id:archiveId,version:1};let targetRef;
      if(target.kind==='material'){
        const material=host.materials[target.id];if(!material)throw Error('材料已不可用。');
        const materialRef={kind:'material',id:material.id,version:material.version},expressionId='adopted-'+material.id,item=host.expressions[expressionId];
        if((item?.version||0)!==expectedVersion)throw Object.assign(Error('材料采纳摘记已有新版本，请重新读取并比较后再采纳。'),{code:'CONTENT_CONFLICT'});
        if(item&&(item.author!=='user'||item.kind!=='annotation'||!item.versions[item.version].refs.some(r=>r.kind==='material'&&r.id===material.id)))throw Error('采纳摘记身份冲突。');
        const old=item?.versions[item.version],value={text:old?old.text+'\n\n'+text:text,refs:[...(old?.refs||[materialRef]),source].filter((r,i,a)=>a.findIndex(x=>stableWorkbenchJson(x)===stableWorkbenchJson(r))===i)};
        operations.push(item?{type:'expression.edit',id:expressionId,expectedVersion,title:item.title,value}:{type:'expression.create',id:expressionId,kind:'annotation',title:'采纳摘记 · '+material.title,author:'user',value});
        targetRef={kind:'expression',id:expressionId,version:expectedVersion+1};
      }else if(target.kind==='capability'){
        const item=host.capabilities[target.id];if(!item||item.version!==expectedVersion)throw Object.assign(Error('能力已有新版本，请重新读取并比较后再采纳。'),{code:'CONTENT_CONFLICT'});
        const value=structuredClone(item.versions[item.version]);value.steps=value.steps?value.steps+'\n\n'+text:text;value.refs=[...value.refs,source];
        if(value.stepItems)value.stepItems.push({id:'step-'+id,text,checked:false});
        operations.push({type:'capability.edit',id:item.id,expectedVersion,value,reason:'逐项复核采纳 '+runId});targetRef={kind:'capability',id:item.id,version:expectedVersion+1};
      }else if(target.kind==='new-capability'){
        const cid='cap-'+id;operations.push({type:'capability.create',id:cid,value:{title,purpose:'本次AI结果经用户逐项复核保留',scope:'尚未试用，需继续验证',steps:text,evidence:'来自已保存的AI原稿 '+runId,examples:'',refs:[source]}});targetRef={kind:'capability',id:cid,version:1};
      }else throw Error('请选择材料摘记或能力草稿作为采纳位置。');
      return {command:{protocolVersion:1,commandId:id,expectedRevision:snapshot.revision,operations},targetRef,source};
    },
    execute(command){return workspace().execute(command)},
    configureFeedbackEvidenceResolver(resolver){workspace().configureFeedbackEvidenceResolver(resolver)},
    taskSnapshot(id) {
      const host=workspace().read().host,task=host?.tasks?.[id]
      if(!task||task.status!=='prepared')throw Error('任务准备不可用或已取消。')
      if(task.execution)throw Error('任务已绑定其他执行回执，请从原回执入口继续，未重复提交。')
      const excluded=new Set(task.excluded.map(ref=>stableWorkbenchJson(ref)))
      const fragments=[]
      for(const [role,refs] of [['reference',task.refs],['instruction',task.instructions||[]]])for(const ref of refs){
        if(excluded.has(stableWorkbenchJson(ref)))continue
        const {item,value}=resolveContentRef(host,ref,{forUse:true})
        let text=role==='instruction'?value.prompt:ref.kind==='capability'?JSON.stringify(value):value.text
        if(ref.anchor&&ref.anchor.type!=='text')throw Error('当前文本执行器不能读取这个媒体局部；未扩大成整份材料发送。请保留引用，或先人工摘取为可读文字。')
        if(ref.anchor?.type==='text')text=text.slice(ref.anchor.start,ref.anchor.end)
        if(!text?.trim())throw Error('所选材料没有文字摘录，请先摘取文字；不会自动上传原件。')
        fragments.push({id:`${role}:${fragments.length+1}`,role,revision:ref.version,text,title:item.title,ref:structuredClone(ref)})
      }
      const result={task:structuredClone(task),fragments}
      if(Buffer.byteLength(JSON.stringify(result))>256*1024)throw Error('本次引用超过256 KiB，请缩小文字范围后再提交。')
      return result
    },
    async request(request) {
      if(request?.operation==='workbench.request'){
        const p=request.pathname,m=request.method||'GET'
        const read=p==='/api/product/workspace'||p==='/api/product/canvases'||/^\/api\/product\/canvases\/[a-zA-Z0-9_-]{1,128}$/.test(p)
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

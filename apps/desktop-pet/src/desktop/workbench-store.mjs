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
      if(value.storage)value.storage={kind:'sqlite',label:'Trace 桌面新工作区（旧内容独立保留）'}
      return value
    }
    return {bytes:new Uint8Array(bytes),mime:headers['content-type']||'application/octet-stream'}
  }
  return {
    taskSnapshot(id) {
      const host=workspace().read().host,task=host?.tasks?.[id]
      if(!task||task.status!=='prepared')throw Error('任务准备不可用或已取消。')
      if(task.execution)throw Error('任务已绑定其他执行回执，请从原回执入口继续，未重复提交。')
      const excluded=new Set(task.excluded.map(ref=>stableWorkbenchJson(ref)))
      const fragments=[]
      for(const [role,refs] of [['reference',task.refs],['instruction',task.instructions||[]]])for(const ref of refs){
        if(excluded.has(stableWorkbenchJson(ref)))continue
        const {item,value}=resolveContentRef(host,ref,{forUse:true})
        let text=ref.kind==='capability'?JSON.stringify(value):value.text
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

// The same Product rules as SQLite, with an explicit IDB v2 upgrade and Blob
// records. No model call, second content store, or base64 business snapshot.
import {applyProductOperations,validateProductCommand,validateWorkbench,decodeCapabilityPacket,validResourceDescriptor,stableWorkbenchJson,emptyCanvas,applyCanvasCommand,validateCanvasCommand,validateCanvasDocument,resolveContentRef,freezeCanvasContentRef} from '@trace/product-workspace';
const database=location.pathname.startsWith('/app/demo')?'trace-web-complete-demo-v3':'trace-portal-workspace-v1';
export const browserWorkbenchFeatures=Object.freeze(['capability-packet-v1','capability-feedback-v1','message-reference-scope-v1']);
const info={kind:'indexeddb',mode:'workbench',features:browserWorkbenchFeatures,location:'当前浏览器 · 原件与布局独立保存'};
const failure=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
const get=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
const canvasId=id=>typeof id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id);
function open(){return new Promise((resolve,reject)=>{const req=indexedDB.open(database,2);let blocked=false;req.onupgradeneeded=()=>{for(const name of ['workspace','commands','resources','canvases','canvas-commands'])if(!req.result.objectStoreNames.contains(name))req.result.createObjectStore(name);};req.onsuccess=()=>{if(blocked)req.result.close();else resolve(req.result);};req.onerror=()=>reject(req.error);req.onblocked=()=>{blocked=true;reject(failure('STORAGE_BLOCKED','请关闭此网站其它标签页后重试，未重置原数据。',503));};});}
async function transaction(stores,mode,action){const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(stores,mode);let value,error;tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(error||tx.error||failure('STORAGE_FAILURE','保存未确认，请保留草稿。',503));Promise.resolve(action(tx)).then(result=>{value=result;},cause=>{error=cause;try{tx.abort();}catch{reject(cause);}});});}finally{db.close();}}
function snapshot(row){if(row===undefined)return{revision:0,host:null,storage:info};if(!row||row.schemaVersion!==1||!Number.isSafeInteger(row.revision)||row.revision<1)throw failure('STORAGE_CORRUPT','已保存工作区版本异常，未清空。',503);if(row.host?.schemaVersion===2)validateWorkbench(row.host);else if(row.host?.schemaVersion!==1)throw failure('STORAGE_CORRUPT','内容格式异常，未清空。',503);return {revision:row.revision,host:row.host,storage:info};}
export async function browserProductCommand(command){
  validateProductCommand(command);const fingerprint='product-v1:'+await sha(new TextEncoder().encode(stableWorkbenchJson(command)));
  if(new TextEncoder().encode(stableWorkbenchJson(command)).length>8*1024*1024)throw failure('BODY_TOO_LARGE','内容命令超过8 MiB。',413);
  // Hashing a Blob yields to WebCrypto; doing it inside a write transaction
  // would let IndexedDB auto-commit. Preflight bytes, then atomically compare
  // descriptors again. A known receipt remains replayable if a source is lost.
  const prior=await transaction(['commands'],'readonly',tx=>get(tx.objectStore('commands').get(command.commandId)));
  if(!prior){const ids=[...new Set(command.operations.flatMap(op=>op.type==='resource.register'?[op.resource.id]:op.type==='material.create'&&op.value.resourceId?[op.value.resourceId]:op.type==='capability.package.receive'?[op.packetResourceId,...op.manifest.resources.map(r=>r.id)]:op.type==='capability.package.export'?[op.packetResourceId]:[]))];for(const id of ids)await readBrowserResource(id);for(const op of command.operations)if(op.type==='capability.package.export'||op.type==='capability.package.receive'){const row=await readBrowserResource(op.packetResourceId),packet=await decodeCapabilityPacket(row.blob);if(stableWorkbenchJson(packet.manifest)!==stableWorkbenchJson(op.manifest))throw failure('PACKET_CONTENT_CONFLICT','命令说明与版本包原件不一致，未提交。',409);}}
  return transaction(['workspace','commands','resources'],'readwrite',async tx=>{
    const workspaces=tx.objectStore('workspace'),commands=tx.objectStore('commands'),resources=tx.objectStore('resources');
    const [row,known]=await Promise.all([get(workspaces.get('current')),get(commands.get(command.commandId))]);const saved=snapshot(row);
    if(known){if(known.fingerprint!==fingerprint)throw failure('COMMAND_CONFLICT','同一命令ID不能包含不同操作。',409);if(!known.host||!known.receipt)throw failure('COMMAND_CONFLICT','该命令ID已用于旧版保存。',409);return{revision:known.revision,host:known.host,receipt:known.receipt,headRevision:saved.revision,storage:info};}
    if(saved.revision!==command.expectedRevision)throw failure('REVISION_CONFLICT','另一窗口已有更新；草稿没有覆盖保存。',409);
    const host=applyProductOperations(saved.host,command.operations),ids=command.operations.flatMap(op=>op.type==='resource.register'?[op.resource.id]:op.type==='material.create'&&op.value.resourceId?[op.value.resourceId]:op.type==='capability.package.receive'?[op.packetResourceId,...op.manifest.resources.map(r=>r.id)]:op.type==='capability.package.export'?[op.packetResourceId]:[]);
    const originalResources=await Promise.all(ids.map(id=>get(resources.get(id))));for(let i=0;i<ids.length;i++)if(!originalResources[i]||stableWorkbenchJson(originalResources[i].resource)!==stableWorkbenchJson(host.resources[ids[i]]))throw failure('RESOURCE_UNAVAILABLE','原件没有完整保存或元信息不一致。',409);
    const revision=saved.revision+1,receipt={protocolVersion:1,receiptId:'product:'+command.commandId,commandId:command.commandId,status:'committed',beforeRevision:saved.revision,afterRevision:revision,requestHash:fingerprint.slice('product-v1:'.length),hostDelivery:'not_requested'};
    workspaces.put({schemaVersion:1,revision,host},'current');commands.put({fingerprint,revision,host:structuredClone(host),receipt},command.commandId);return{revision,host,receipt,headRevision:revision,storage:info};
  });
}
export async function readBrowserProductCommand(id){
  if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,200}$/.test(id))throw failure('INVALID_COMMAND_ID','命令身份无效。');
  return transaction(['workspace','commands'],'readonly',async tx=>{
    const [known,row]=await Promise.all([get(tx.objectStore('commands').get(id)),get(tx.objectStore('workspace').get('current'))]);
    if(!known)throw failure('UNKNOWN_COMMAND','尚未找到这份命令回执；没有推定保存或取消。',404);
    if(!known.fingerprint?.startsWith('product-v1:')||known.receipt?.protocolVersion!==1||known.receipt.commandId!==id||known.receipt.requestHash!==known.fingerprint.slice('product-v1:'.length))throw failure('COMMAND_CONFLICT','原命令回执格式或身份不一致。',409);
    return{revision:known.revision,host:known.host,receipt:known.receipt,headRevision:snapshot(row).revision,storage:info};
  });
}
export async function saveBrowserResource(blob){
  if(!(blob instanceof Blob)||blob.size>256*1024*1024)throw failure('RESOURCE_TOO_LARGE','原件超过256 MiB。',413);
  const bytes=await blob.arrayBuffer(),hash=await sha(bytes),type=/^[\w.+-]+\/[\w.+-]+$/.test(blob.type)?blob.type:'application/octet-stream';const resource={id:hash,sha256:hash,mime:type,bytes:blob.size};
  const known=await transaction(['resources'],'readonly',tx=>get(tx.objectStore('resources').get(hash)));if(known)return(await readBrowserResource(hash)).resource;
  return transaction(['resources'],'readwrite',async tx=>{const store=tx.objectStore('resources'),known=await get(store.get(hash));if(known){if(known.resource.sha256!==hash||known.resource.bytes!==blob.size)throw failure('RESOURCE_CORRUPT','原件身份损坏，未覆盖。',503);return known.resource;}store.put({resource,blob:new Blob([bytes],{type})},hash);return resource;});
}
export async function readBrowserResource(id){if(!/^[a-f0-9]{64}$/.test(id))throw failure('INVALID_RESOURCE','原件ID无效。');const row=await transaction(['resources'],'readonly',tx=>get(tx.objectStore('resources').get(id)));if(!row||!(row.blob instanceof Blob))throw failure('RESOURCE_UNAVAILABLE','原件不可用，已保存摘录仍保留。',404);if(!validResourceDescriptor(row.resource)||row.resource.id!==id||row.blob.size!==row.resource.bytes||await sha(await row.blob.arrayBuffer())!==id)throw failure('RESOURCE_CORRUPT','原件完整性检查失败。',503);return row;}
export async function readBrowserCanvas(id){if(!canvasId(id))throw failure('INVALID_CANVAS_ID','画布ID无效。');return transaction(['canvases'],'readonly',async tx=>validateCanvasDocument(await get(tx.objectStore('canvases').get(id))||emptyCanvas(id)));}
export async function listBrowserCanvases(){return transaction(['canvases'],'readonly',async tx=>(await get(tx.objectStore('canvases').getAll())).map(d=>{validateCanvasDocument(d);return{id:d.id,title:d.title,revision:d.revision};}));}
export async function browserCanvasCommand(id,command){if(!canvasId(id))throw failure('INVALID_CANVAS_ID','画布ID无效。');validateCanvasCommand(command);const fingerprint=await sha(new TextEncoder().encode(stableWorkbenchJson(command)));return transaction(['workspace','canvases','canvas-commands'],'readwrite',async tx=>{const docs=tx.objectStore('canvases'),commands=tx.objectStore('canvas-commands'),key=id+':'+command.commandId;const [row,prior,product]=await Promise.all([get(docs.get(id)),get(commands.get(key)),get(tx.objectStore('workspace').get('current'))]);const before=row||emptyCanvas(id);if(prior){if(prior.fingerprint!==fingerprint)throw failure('COMMAND_CONFLICT','同一布局命令不能对应不同操作。',409);return {...prior.result,headRevision:before.revision};}const host=snapshot(product).host;if(host?.schemaVersion!==2)throw failure('CONTENT_UPGRADE_REQUIRED','请先准备新内容工作区。',409);const document=applyCanvasCommand(before,command);for(const node of document.nodes)if(node.ref)resolveContentRef(host,freezeCanvasContentRef(host,node.ref));for(const edge of document.connections)if(edge.relationId&&!Object.hasOwn(host.relations,edge.relationId))throw failure('RELATION_UNAVAILABLE','语义关系不存在。');const result={document,receipt:{commandId:command.commandId,beforeRevision:before.revision,afterRevision:document.revision,status:'committed'}};docs.put(document,id);commands.put({fingerprint,result},key);return result;});}

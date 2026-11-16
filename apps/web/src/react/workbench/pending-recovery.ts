import {stableWorkbenchJson,validateCanvasCommand,validateProductCommand} from '@trace/product-workspace';

// Recovery is an outbox of immutable requests, not another content store.
// Keep the old single key readable; new requests never overwrite it or each other.
export interface PendingWrite {path:string;body:unknown;owner?:string}
export interface PendingRecord {key:string;raw:string;request:PendingWrite}
export interface PendingRecoveryIssue {key:string;raw:string|null;reason:string}
export const pendingKey='trace-workbench-pending:'+(location.pathname.startsWith('/app/demo')?'demo':'personal');
const requestPrefix=pendingKey+':request-v1:';
export const isPendingStorageKey=(key:string|null)=>key===null||key===pendingKey||Boolean(key?.startsWith(requestPrefix));

export function validatePendingWrite(value:unknown):asserts value is PendingWrite {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('恢复记录不是可识别的原请求。');
  const row=value as Record<string,unknown>;
  if(Object.keys(row).some(key=>!['path','body','owner'].includes(key))||typeof row.path!=='string'||!Object.hasOwn(row,'body')||Object.hasOwn(row,'owner')&&(typeof row.owner!=='string'||!row.owner||row.owner.length>4096||/[\u0000-\u001f]/.test(row.owner)))throw Error('恢复记录字段未知或不完整；未替换原记录。');
  if(row.path==='/api/product/commands')validateProductCommand(row.body);
  else if(/^\/api\/product\/canvases\/[a-zA-Z0-9_-]+\/commands$/.test(row.path))validateCanvasCommand(row.body);
  else throw Error('恢复记录的操作入口无法识别；没有代为发送。');
}

export function samePendingWrite(a:PendingWrite|null|undefined,b:PendingWrite|null|undefined):boolean {
  return Boolean(a&&b&&stableWorkbenchJson(a)===stableWorkbenchJson(b));
}

export function pendingRecordKey(request:PendingWrite):string {
  validatePendingWrite(request);
  return requestPrefix+encodeURIComponent((request.body as {commandId:string}).commandId);
}

export function readPendingRecords(storage:Storage):{records:PendingRecord[];issues:PendingRecoveryIssue[]} {
  const records:PendingRecord[]=[],issues:PendingRecoveryIssue[]=[],keys=new Set<string>([pendingKey]);
  try{for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(requestPrefix))keys.add(key);}}
  catch{issues.push({key:pendingKey,raw:null,reason:'本地恢复记录暂不可读取；未重置记录或发送新请求。'});return{records,issues};}
  for(const key of [...keys].sort()){
    let raw:string|null=null;
    try{
      raw=storage.getItem(key);if(raw===null)continue;
      const request:unknown=JSON.parse(raw);validatePendingWrite(request);
      if(key!==pendingKey&&key!==pendingRecordKey(request))throw Error('恢复记录与原命令身份不一致；未代为重试。');
      records.push({key,raw,request});
    }catch(error){issues.push({key,raw,reason:error instanceof Error?error.message:'恢复记录无法识别；原始内容仍保留。'});}
  }
  return{records,issues};
}

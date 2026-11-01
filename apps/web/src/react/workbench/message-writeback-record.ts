import {validateProductCommand,stableWorkbenchJson} from '@trace/product-workspace';
import type {PreparedContentCommand,ContentRef,ContentValue} from './client';
export type MessageWritebackRecord={schemaVersion:2;command:PreparedContentCommand};
export type MessageWritebackPlan=MessageWritebackRecord&{source:ContentRef;targetRef:ContentRef|{kind:'relation';id:string;version:number};capture:{title:string;value:ContentValue};reviewedText:string};
// Derive the destination and displayed body from the exact original command,
// not independently editable local destination metadata. A matching real
// Product receipt hash is still required before calling this plan committed.
export function projectMessageWritebackRecord(record:MessageWritebackRecord,sessionId:string,messageId:string):MessageWritebackPlan {
 if(!record||record.schemaVersion!==2||Object.keys(record).some(k=>!['schemaVersion','command'].includes(k)))throw Error('原话写回恢复记录缺少当前格式的完整原命令；请保留并导出，未执行或覆盖。');
 validateProductCommand(record.command);
 const ops=record.command.operations as any[],capture=ops[0],origin=capture?.value?.origin,first=ops[1];
 if(ops.length>3||!capture||capture.type!=='material.create'||capture.kind!=='dialogue'||origin?.kind!=='thinking-message'||origin.message.sessionId!==sessionId||origin.message.messageId!==messageId||capture.value.resourceId!==null)throw Error('原命令的原话身份或摘录范围不属于当前讨论；未改选来源。');
 const source:ContentRef={kind:'material',id:capture.id,version:1};let targetRef:MessageWritebackPlan['targetRef']=source,reviewedText='';
 if(first){
  if(!['expression.create','expression.edit','capability.create','capability.edit','relation.create'].includes(first.type)||first.type==='expression.create'&&first.author!=='user')throw Error('原命令包含不是本次人工写回的动作；没有执行或解释为已保存。');
  const kind=first.type.split('.')[0],version=first.type.endsWith('.create')?1:first.expectedVersion+1;targetRef={kind,id:first.id,version} as MessageWritebackPlan['targetRef'];
  reviewedText=first.value?.text??first.value?.steps??first.reason;
  if(typeof reviewedText!=='string'||!reviewedText.trim())throw Error('原命令的实际写入正文缺失；没有用后来草稿替代。');
  const refs=first.value?.refs||first.sources||[];if(!refs.some(r=>stableWorkbenchJson(r)===stableWorkbenchJson(source)))throw Error('原命令的写回去向没有引用这份准确摘录。');
 }
 if(ops[2]&&(!first||first.type!=='expression.create'||ops[2].type!=='relation.create'||ops[2].kind!=='branch'||ops[2].to.id!==first.id||ops[2].to.version!==1))throw Error('旁支原命令的内容与连接不一致。');
 return{...record,source,targetRef,capture:{title:capture.title,value:capture.value},reviewedText};
}

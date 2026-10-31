import React from 'react';
import './execution-view.css';

// Read-only projection of persisted records. Missing time/sequence stays missing;
// array position is explicitly not presented as a runtime event identity.
export function ExecutionLog({events,title='已保存执行事件'}:{events:any[];title?:string}) {
  const visible=events.slice(-2000);
  return <details open className="wb-execution-log"><summary>{title}（{events.length}）</summary>{events.length>visible.length&&<p>显示最近2000条；完整历史仍保留在执行服务。</p>}<ol>{visible.map((event,index)=><li key={event.sequence??event.id??index}><header><span>{Number.isSafeInteger(event.sequence)?'#'+event.sequence:'记录索引 '+(events.length-visible.length+index+1)} {event.type||'未标记事件'}</span><time>{event.at||event.createdAt||'未记录时间'}</time></header><pre>{JSON.stringify(event.data===undefined?event:event.data,null,2)}</pre></li>)}</ol>{!events.length&&<p>尚无已保存事件；不会补入演示日志。</p>}</details>;
}

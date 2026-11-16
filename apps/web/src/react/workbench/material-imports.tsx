import {FormFeedback} from './feedback';
import React,{useEffect,useRef,useState} from 'react';
import {WorkbenchClient,makeId,saveResource,type Resource,type CanvasDocument} from './client';
import {fileText,materialFileKind} from './source-locator.mjs';
import './halo-controls.css';

type Phase='queued'|'reading'|'saving'|'placing'|'done'|'failed'|'cancelled';
type Row={id:string;file:File;target:{id:string;title:string};position:{x:number;y:number};phase:Phase;error?:string;resource?:Resource;text?:string;materialId:string;nodeId:string;cancelled:boolean};
const labels:Record<Phase,string>={queued:'等待导入',reading:'读取原件',saving:'保存材料',placing:'放到目标画布',done:'已保存并放到画布',failed:'未完成，可重试',cancelled:'已取消，未创建材料'};

// Queue owns only transient File handles, never a second copy of product state.
export function useMaterialImports(client:WorkbenchClient,onPlaced:(doc:CanvasDocument,nodeId:string)=>void) {
  const rows=useRef<Row[]>([]),running=useRef(false),mounted=useRef(true),callback=useRef(onPlaced);
  callback.current=onPlaced;
  const [display,setDisplay]=useState<Row[]>([]),[collapsed,setCollapsed]=useState(false);
  const publish=()=>{if(mounted.current)setDisplay(rows.current.map(r=>({...r})));};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;for(const r of rows.current)if(['queued','reading'].includes(r.phase))r.cancelled=true;};},[]);
  const pump=async()=>{
    if(running.current)return;running.current=true;
    try { while(true) {
      const row=rows.current.find(r=>r.phase==='queued');if(!row)break;
      try {
        if(client.getSnapshot().pending)throw Error('上一保存尚未确认，请先在工作台核对原命令，再重试此文件。');
        row.phase='reading';publish();
        if(!row.resource)row.resource=await saveResource(row.file);
        if(row.cancelled){row.phase='cancelled';publish();continue;}
        if(row.text===undefined)row.text=materialFileKind(row.file)==='text'?await fileText(row.file):'';
        if(row.cancelled){row.phase='cancelled';publish();continue;}
        const kind=materialFileKind(row.file);
        row.phase='saving';publish();
        if(!client.getSnapshot().host?.materials[row.materialId])await client.command([{type:'resource.register',resource:row.resource},{type:'material.create',id:row.materialId,kind,title:row.file.name,value:{text:row.text,resourceId:row.resource.id,origin:{kind:'local',fileName:row.file.name}}}], 'import:'+row.id);
        row.phase='placing';publish();
        const latest=(await client.readCanvas(row.target.id)).document;
        let document=latest;
        if(!latest.nodes.some(n=>n.id===row.nodeId))document=(await client.layout({nodes:[...latest.nodes,{id:row.nodeId,ref:{kind:'material',id:row.materialId,version:null},position:row.position,width:320,height:kind==='audio'?160:kind==='text'?220:300,groupId:null,label:''}],connections:latest.connections},'replace',undefined,latest.revision,latest.id,'import:'+row.id)).document;
        row.phase='done';row.error=undefined;publish();callback.current(document,row.nodeId);
      } catch(error) {row.phase='failed';row.error=error instanceof Error?error.message:'导入未完成；原文件仍可重试。';publish();}
    }} finally {running.current=false;}
  };
  const enqueue=(files:FileList|File[],position:{x:number;y:number})=>{
    const target=client.getSnapshot().canvas;if(!target)return;
    setCollapsed(false);
    rows.current.push(...Array.from(files).map((file,index):Row=>({id:makeId('import'),file,target:{id:target.id,title:target.title},position:{x:position.x+index*32,y:position.y+index*32},phase:'queued',materialId:makeId('material'),nodeId:makeId('node'),cancelled:false})));
    publish();void pump();
  };
  const cancel=(id:string)=>{const row=rows.current.find(r=>r.id===id);if(row&&['queued','reading'].includes(row.phase)){row.cancelled=true;row.phase='cancelled';publish();}};
  const retry=(id:string)=>{const row=rows.current.find(r=>r.id===id);if(row?.phase==='failed'){row.phase='queued';row.error=undefined;publish();void pump();}};
  const remove=(id:string)=>{rows.current=rows.current.filter(r=>r.id!==id||!['done','cancelled','failed'].includes(r.phase));publish();};
  const active=display.some(r=>['queued','reading','saving','placing'].includes(r.phase));
  useEffect(()=>{const beforeUnload=(e:BeforeUnloadEvent)=>{if(active){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',beforeUnload);return()=>window.removeEventListener('beforeunload',beforeUnload);},[active]);
  const panel=display.length>0&&<section className="wb-import-panel" aria-label="材料导入队列"><header><h3>材料导入</h3><button type="button" className="wb-button" aria-expanded={!collapsed} aria-controls="wb-import-rows" onClick={()=>setCollapsed(v=>!v)}>{collapsed?'展开队列':'收起队列'}</button><span className="wb-import-status" role="status">{active?'正在处理原件':`${display.filter(r=>r.phase==='done').length} 个已放到画布`}</span></header><p hidden={collapsed} className="wb-import-status">按真实保存阶段显示；关闭页面会丢失尚未提交的文件，请等待或取消。</p><ul id="wb-import-rows" hidden={collapsed} className="wb-import-list">{display.map(row=><li className="wb-import-row" key={row.id} data-phase={row.phase}><div><strong>{row.file.name}</strong><small>{(row.file.size/1024).toFixed(1)} KiB · 目标：{row.target.title}</small><small>{labels[row.phase]}</small><FormFeedback client={client} owner={'import:'+row.id} message={row.error||''} error={Boolean(row.error)}/></div>{['queued','reading'].includes(row.phase)&&<button type="button" className="wb-button" aria-label={'取消导入 '+row.file.name} onClick={()=>cancel(row.id)}>取消</button>}{row.phase==='failed'&&<button type="button" className="wb-button" aria-label={'重试导入 '+row.file.name} disabled={Boolean(client.getSnapshot().pending)} onClick={()=>retry(row.id)}>重试</button>}{['done','cancelled','failed'].includes(row.phase)&&<button type="button" className="wb-button" aria-label={'移除队列记录 '+row.file.name} onClick={()=>remove(row.id)}>移除记录</button>}</li>)}</ul></section>;
  return {enqueue,panel};
}

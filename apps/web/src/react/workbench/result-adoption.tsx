import React,{useState,useSyncExternalStore} from 'react';
import type {WorkbenchClient,ContentEntry} from './client';
import type {Run} from './task-execution';
import {resultItems} from '../../../../../shared/workbench-result-items.mjs';
import {HaloNotice,HaloBadge,HaloSurface} from './halo-surfaces';
import {Tabs} from 'radix-ui';
import {HaloField,HaloInput,HaloTextarea,HaloSelect} from './halo-controls';
import {HaloDisclosure} from './halo-disclosure';

const call=(operation:string,body:any)=>(window as any).traceNative.requestCapability({operation:'workbench.agent.'+operation,...body});
export function ResultAdoption({run,client,refresh}:{run:Run;client:WorkbenchClient;refresh:()=>Promise<void>}){
 const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot);
 return <section aria-label="逐项采纳" className="wb-result-adoption"><h4>逐项采纳</h4><p>按原稿段落核对，可修改本项采纳正文。材料原文不覆盖：写成关联摘记；能力追加方法并生成新草稿版本，不自动发布。AI原稿另存且不可覆盖。</p>{resultItems(run.result.answer).map(item=><AdoptionItem key={item.id} item={item} run={run} client={client} host={state.host} refresh={refresh}/>)}</section>;
}
function AdoptionItem({item,run,client,host,refresh}:any){
 const record=run.adoptions?.filter(a=>a.itemId===item.id).at(-1);
 const draftKey='trace-adoption:'+run.id+':'+item.id;let draft:any={};try{draft=JSON.parse(localStorage.getItem(draftKey)||'{}');}catch{}
 const [text,setText]=useState(record?.plan?.reviewedText||draft.text||item.text),[target,setTarget]=useState(draft.target||'new-capability'),[title,setTitle]=useState(draft.title||item.text.slice(0,40)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const committed=record?.status==='committed',pending=record?.status==='prepared';
 const saveDraft=(patch:any)=>{try{localStorage.setItem(draftKey,JSON.stringify({text,target,title,...patch}));}catch{setError('采纳草稿未能落盘，请复制后再关闭。');}};
 const submit=async(decision:string)=>{if(busy)return;setBusy(true);setError('');try{
   const [kind,id]=target.split(':');let expectedVersion=0;
   if(kind==='material')expectedVersion=host.expressions['adopted-'+id]?.version||0;
   if(kind==='capability')expectedVersion=host.capabilities[id]?.version||0;
   await call('adopt',{runId:run.id,resultHash:run.resultHash,itemId:item.id,requestId:crypto.randomUUID(),decision,target:{kind,id},expectedVersion,text,title});
   await refresh();await client.load();
 }catch(e){setError(e.message||'采纳未完成；本项正文保留。');}finally{setBusy(false);}};
 const retry=async()=>{setBusy(true);setError('');try{await call('adoption.retry',{runId:run.id,adoptionId:record.id});await refresh();await client.load();}catch(e){setError(e.message);}finally{setBusy(false);}};
 const targetRef=record?.plan?.targetRef,entry=targetRef&&(targetRef.kind==='capability'?host?.capabilities:host?.expressions)?.[targetRef.id];
 const [targetKind,targetId]=target.split(':'),previewEntry=targetKind==='material'?host?.expressions['adopted-'+targetId]:targetKind==='capability'?host?.capabilities[targetId]:null;
 const priorText=previewEntry?(targetKind==='material'?previewEntry.versions[previewEntry.version].text:previewEntry.versions[previewEntry.version].steps):'';
 return <article aria-label={item.id} className="wb-adoption-item" data-item-id={item.id} data-adoption-status={record?.status||'unreviewed'}>
  <h5>原稿第 {item.id.replace('paragraph-','')} 段</h5><HaloDisclosure title="查看本项 AI 原稿"><p>{item.text}</p></HaloDisclosure>
  {committed?<section className="wb-adopted-review" aria-label="已采纳正文"><h5>本项已采纳正文</h5><p tabIndex={0}>{record?.plan?.reviewedText||text}</p></section>:<HaloField label="本项采纳正文"><HaloTextarea aria-label="本项采纳正文" rows={4} value={text} readOnly={busy||pending} onChange={e=>{setText(e.target.value);saveDraft({text:e.target.value});}}/></HaloField>}
  {!committed&&!pending&&<><HaloField label="采纳位置"><HaloSelect aria-label="采纳位置" disabled={busy} value={target} onValueChange={value=>{setTarget(value);saveDraft({target:value});}}><option value="new-capability">新建能力草稿</option>{Object.values(host?.materials||{}).map((m:any)=><option key={m.id} value={'material:'+m.id}>材料摘记：{m.title}</option>)}{Object.values(host?.capabilities||{}).filter((c:any)=>c.status!=='disabled').map((c:any)=><option key={c.id} value={'capability:'+c.id}>追加能力方法：{c.title} · v{c.version}</option>)}</HaloSelect></HaloField>{target==='new-capability'&&<HaloField label="能力草稿名称"><HaloInput aria-label="能力草稿名称" disabled={busy} maxLength={200} value={title} onChange={e=>{setTitle(e.target.value);saveDraft({title:e.target.value});}}/></HaloField>}
  <HaloDisclosure title={<>预览本项写入效果 · 当前 v{previewEntry?.version||0}</>}><ResultVersionPreview before={priorText} after={priorText?priorText+'\n\n'+text:text} version={previewEntry?.version||0}/></HaloDisclosure>
  <div className="wb-actions"><button className="wb-button wb-primary" disabled={busy||!text.trim()||!title.trim()} aria-busy={busy} onClick={()=>submit('adopt')}>{busy?'正在核对回执…':'确认采纳本项'}</button><button className="wb-button" disabled={busy} onClick={()=>submit('saved')}>仅保留本项</button><button className="wb-button" disabled={busy} onClick={()=>submit('rejected')}>不采纳本项</button></div></>}
  {pending&&<><HaloNotice tone="error" title={record.error||'采纳尚未确认'} description="原请求已保存，重启后也能确认重试；不会另建一条内容。"/><button className="wb-button" disabled={busy} onClick={retry}>重试原采纳请求</button></>}
  {record?.status==='conflict'&&<HaloNotice tone="error" title={record.error} description="旧请求没有覆盖新版本。请重新读取、比较后再明确采纳。"/>}
  {record?.status==='decided'&&<p role="status">{record.decision==='saved'?'本项仅保留，未写入内容。':'本项不采纳，原稿仍保留。'}可以重新核对再决定。</p>}
  {committed&&<><HaloNotice title={'已采纳到 '+(entry?.title||'内容')+' · v'+targetRef.version} description="原AI全文、原材料和旧版本都保留；再次点击不会重复写入。"/>{entry&&<AdoptedVersions entry={entry} host={host}/>}</>}
  {error&&<HaloNotice tone="error" title="本项采纳尚未确认" description={error}/>}<button className="wb-button" disabled={busy} onClick={()=>{void client.load();}}>重新读取目标版本</button>
 </article>;
}
function ResultVersionPreview({before,after,version}:{before:string;after:string;version:number}){
 return <HaloSurface className="wb-version-surface"><Tabs.Root defaultValue="after" className="wb-version-preview"><Tabs.List className="wb-halo-tabs wb-version-tabs" aria-label="写入版本对照"><Tabs.Trigger type="button" value="before">保留的当前版</Tabs.Trigger><Tabs.Trigger type="button" value="after">采纳后预览</Tabs.Trigger></Tabs.List><Tabs.Content value="before" className="wb-version-panel"><header><h5>当前正文</h5><HaloBadge>{version?'v'+version:'尚未新建'}</HaloBadge></header><p className="wb-version-hint">这一版会保留，不被覆盖。</p><div className="wb-version-text" tabIndex={0} aria-label="保留版正文">{before||'尚无内容，确认后才会新建。'}</div></Tabs.Content><Tabs.Content value="after" className="wb-version-panel"><header><h5>确认后新版本</h5><HaloBadge>v{version+1} · 仅预览</HaloBadge></header><p className="wb-version-hint">只有明确确认采纳后才会保存。</p><div className="wb-version-text" tabIndex={0} aria-label="采纳后预览正文">{after}</div></Tabs.Content></Tabs.Root></HaloSurface>;
}
export function AdoptedVersions({entry,host}:{entry:ContentEntry;host:any}){
 const [version,setVersion]=useState(entry.version),value=entry.versions[version]||entry.versions[entry.version];
 return <HaloDisclosure title="查看实际内容与保留版本"><HaloField label="内容版本"><HaloSelect aria-label="采纳内容版本" value={version} onValueChange={value=>setVersion(Number(value))}>{Object.keys(entry.versions).map(v=><option key={v} value={v}>v{v}{Number(v)===entry.version?' 当前':''}</option>)}</HaloSelect></HaloField><pre className="wb-adopted-text">{value.text||value.steps}</pre>{value.refs?.filter(r=>r.kind==='expression'&&host.expressions[r.id]?.author==='agent').map(r=><HaloDisclosure key={r.id} title="对应 AI 返回全文（原稿）"><pre className="wb-adopted-text">{host.expressions[r.id].versions[r.version]?.text}</pre></HaloDisclosure>)}</HaloDisclosure>;
}
export function AdoptedMaterial({id,host}:{id:string;host:any}){const entry=host.expressions['adopted-'+id];return entry?<section aria-label="材料的AI采纳摘记"><h4>{entry.title}</h4><p>{entry.versions[entry.version].text}</p><AdoptedVersions key={entry.version} entry={entry} host={host}/></section>:null;}

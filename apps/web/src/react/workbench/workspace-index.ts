import type {ContentHost,ContentRef} from './client';
import type {IconName} from '../ui/icon';

export type SearchGroup='all'|'material'|'expression'|'capability'|'thinking'|'task'|'feedback';
export interface SearchOptions {group:SearchGroup;history:boolean}
export type SearchTarget={type:'content';ref:ContentRef}|{type:'thinking';id:string;messageId?:string}|{type:'task';id:string}|{type:'feedback';id:string;version:number};
export interface SearchHit {key:string;group:Exclude<SearchGroup,'all'>;title:string;label:string;icon:IconName;parts:string[];version?:number;currentVersion?:number;status:string;target:SearchTarget}
export const searchGroups:{value:SearchGroup;label:string}[]=[{value:'all',label:'全部工作区'},{value:'material',label:'材料'},{value:'expression',label:'我的表达与 AI 原稿'},{value:'capability',label:'能力'},{value:'thinking',label:'共同思考'},{value:'task',label:'外部任务'},{value:'feedback',label:'能力反馈'}];
const materialLabels:Record<string,string>={text:'文字材料',dialogue:'对话片段',code:'代码',image:'图片',video:'视频片段',audio:'音频',pdf:'PDF 局部',web:'网页摘录',ink:'手绘'};
const expressionLabels:Record<string,string>={note:'我的表达',annotation:'我的摘记',question:'未决问题',understanding:'当前理解',ink:'手绘'};
const statusLabels:Record<string,string>={pending:'待采用的 AI 原稿',accepted:'已采用',saved:'暂存',rejected:'已拒绝',disabled:'已停用',received:'已接收，未采用',draft:'草稿',published:'个人库已发布',trial:'试用准备'};
const materialIcon=(kind:string):IconName=>kind==='video'?'video':kind==='audio'?'audio':kind==='image'?'image':kind==='code'?'code':kind==='web'?'external':kind==='dialogue'?'discussion':kind==='ink'?'pencil':'document';

// Only canonical saved content is indexed. Layout changes do not rebuild this
// projection, and no source file, model, or execution service is queried here.
export function indexWorkspace(host:ContentHost):SearchHit[]{
  const rows:SearchHit[]=[];
  for(const group of ['material','expression','capability'] as const){
    const collection=group==='material'?host.materials:group==='expression'?host.expressions:host.capabilities;
    for(const entry of Object.values(collection).reverse()){
      for(const version of Object.keys(entry.versions).map(Number).sort((a,b)=>b-a)){
        const value=entry.versions[version],label=group==='capability'?(value.usage==='instruction'?'AI 指令':value.usage==='template'?'提示模板':'方法'):group==='expression'?(entry.author==='agent'?'AI 原稿':expressionLabels[entry.kind]||'我的表达'):materialLabels[entry.kind]||'材料';
        const title=group==='capability'?value.title||'未命名能力':entry.title||label;
        rows.push({key:`${group}:${entry.id}:${version}`,group,title,label,icon:group==='capability'?'library':materialIcon(entry.kind),parts:[value.text,value.purpose,value.scope,value.steps,value.prompt,value.evidence,value.examples,value.origin?.fileName,value.origin?.url].filter((x):x is string=>typeof x==='string'&&x.length>0),version,currentVersion:entry.version,status:statusLabels[entry.status]||'',target:{type:'content',ref:{kind:group,id:entry.id,version}}});
      }
    }
  }
  for(const session of Object.values(host.sessions).reverse()){
    rows.push({key:`thinking:${session.id}`,group:'thinking',title:session.title||'共同思考',label:'共同思考',icon:'discussion',parts:[...session.messages].reverse().map(message=>message.text),status:'已保存的用户讨论',target:{type:'thinking',id:session.id}});
  }
  for(const task of Object.values(host.tasks).reverse()){
    rows.push({key:`task:${task.id}`,group:'task',title:task.title||'外部任务',label:'外部任务',icon:'work',parts:[task.goal,task.destination,...(task.plan||[]).map(step=>step.text)],status:task.status==='cancelled'?'已取消的任务准备':'已保存的任务准备',target:{type:'task',id:task.id}});
  }
  for(const entry of Object.values(host.feedbacks||{}).reverse())for(const version of Object.keys(entry.versions).map(Number).sort((a,b)=>b-a)){
    const value=entry.versions[version],target=value.target&&host.capabilities[value.target.id]?.versions[value.target.version],decisions={open:'未决定',kept:'保留事实',revised:'已修订',disabled:'已停用',withdrawn:'已撤回'};
    rows.push({key:`feedback:${entry.id}:${version}`,group:'feedback',title:value.title||'未命名反馈',label:'能力版本反馈',icon:'discussion',parts:[value.facts,value.interpretation,value.scope,value.resolution.reason,target?.title||'',value.target?'对应能力 v'+value.target.version:'能力版本未绑定'],version,currentVersion:entry.version,status:entry.status==='withdrawn'?'反馈当前已撤回':decisions[entry.versions[entry.version].resolution.action],target:{type:'feedback',id:entry.id,version}});
  }
  return rows;
}

// Preview and navigation must use the same saved part, in the same order.
// Header-only terms do not prevent a body match; terms split across different
// bodies can match the record, but cannot claim an exact message destination.
export function selectSearchPart(parts:string[],terms:string[]){
  const bodies=parts.map(part=>part.toLocaleLowerCase()),unique=[...new Set(terms.map(term=>term.toLocaleLowerCase()).filter(Boolean))],bodyTerms=unique.filter(term=>bodies.some(body=>body.includes(term)));
  let index=parts.length?0:-1,best=0;
  bodies.forEach((body,at)=>{const score=bodyTerms.filter(term=>body.includes(term)).length;if(score>best){index=at;best=score;}});
  return {index,hasMatch:best>0,dispersed:best>0&&best<bodyTerms.length};
}

export function previewSearchHit(parts:string[],terms:string[]):string{
  const body=parts[selectSearchPart(parts,terms).index]||'没有已保存的正文';
  const at=terms.length?Math.max(0,body.toLocaleLowerCase().indexOf(terms.find(term=>body.toLocaleLowerCase().includes(term))||'')):0;
  // Work in Unicode characters: neither emoji nor supplementary CJK characters
  // are sliced into lone surrogate halves at the excerpt boundary.
  const before=Array.from(body.slice(0,at)).length,chars=Array.from(body),start=Math.max(0,before-24),end=Math.min(chars.length,start+150);
  return(start?'…':'')+chars.slice(start,end).join('')+(end<chars.length?'…':'');
}

export function filterWorkspaceIndex(index:SearchHit[],query:string,options:SearchOptions,contentOnly=false) {
 const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 return index.filter(hit=>(!contentOnly||hit.target.type==='content')&&(options.group==='all'||hit.group===options.group)&&(options.history||hit.version===undefined||hit.version===hit.currentVersion)&&terms.every(term=>[hit.title,hit.label,...hit.parts].some(part=>part.toLocaleLowerCase().includes(term))));
}

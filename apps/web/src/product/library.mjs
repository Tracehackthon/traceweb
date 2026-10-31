export const h = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const titleOf = matter => matter?.title || (matter?.whyCare || matter?.originalText || '未命名的事').split('\n')[0];
export const short = (value,n=70) => Array.from(value||'').slice(0,n).join('')+(Array.from(value||'').length>n?'…':'');
/** @returns {import('../react/types').LibraryRecord[]} */
export function recordsOf(host) {
  const rows=[];
  for(const m of host.chain.matters) {
    const route={view:'chain',matterId:m.id,screen:'resume'};
    const push=(kind,id,text,extra={})=>rows.push({kind,id,matterId:m.id,title:titleOf(m),text,route:{...route},...extra});
    push('expression',`${m.id}:original`,m.originalText,{route:{...route,anchor:{field:'originalText',start:0,end:m.originalText.length,text:m.originalText,baseVersion:m.originalTextVersion}}});
    if(m.understanding)push('understanding',`${m.id}:understanding`,m.understanding,{meta:`当前 v${m.understandingVersion}`,route:{...route,screen:'understanding'}});
    for(const msg of host.chain.sessions[m.id]?.discussion?.messages||[])push('discussion',`${m.id}:${msg.id}`,msg.text,{route:{...route,screen:'discussion'}});
    for(const b of m.branches||[])push('branch',`${m.id}:${b.id}`,b.text||b.title,{route:{...route,screen:'discussion'}});
    for(const r of m.revisions||[])push('revision',`${m.id}:${r.id}`,r.after||r.text||'',{meta:`历史记录 · v${r.version||r.afterVersion||r.toVersion||'—'}`,before:r.before,route:{...route,screen:'understanding'}});
  }
  for(const s of host.chain.sources) {
    const m=host.chain.matters.find(m=>m.id===s.ownerMatterId);
    const links=(m?.links||[]).filter(l=>l.sourceId===s.id);
    const provenance=s.origin==='provider-snapshot'&&s.provider==='zhihu'?`知乎公开内容${s.author?` · ${s.author}`:''}`:'';
    rows.push({kind:'source',id:s.id,matterId:m?.id,title:s.title||'手工带入的材料',text:s.excerpt||'',meta:links.length?`${provenance?`${provenance} · `:''}已关联为${links.map(l=>({limit:'限制',limitation:'限制',support:'支持',supplement:'补充',challenge:'挑战'}[l.relationship.type]||'相关材料')).join('、')} · 还未写入我的理解`:provenance?`${provenance} · 尚未关联`:'尚未关联 · 用户粘贴，来源未核验',route:m?{view:'chain',matterId:m.id,screen:'resume'}:null});
  }
  for(const w of Object.values(host.worksite.works)) {
    const s=host.worksite.sessions[w.id];
    const matterId=s?.intake[0]?.matterId;
    const returned=w.connected&&w.connection?.status==='returned_for_review'||Boolean(s?.result?.fact)||Boolean(s?.results?.length);
    const meta=returned?'Codex 已返回 · 等待你确认':w.connected?'已连接本机 Agent':'本地工作记录 · 尚未发送';
    rows.push({kind:'work',id:w.id,matterId,title:w.title,text:`${w.agent} · ${w.project}`,meta,route:{view:'worksite',workId:w.id,matterId,screen:'overview'}});
    for(const r of s?.results||[]) rows.push({kind:'result',id:`${w.id}:${r.id}`,matterId:r.matterId,title:w.title,text:r.fact,interpretation:r.interpretation,unconfirmed:r.unconfirmed,meta:r.decision==='revised'?'依据此结果确认过修订':'只留下结果 · 理解未改变',route:{view:'worksite',workId:w.id,matterId:r.matterId,screen:'results',resultId:r.id}});
    for(const f of s?.findings||[])rows.push({kind:'discussion',id:`${w.id}:${f.id}`,matterId:f.matterId,title:w.title,text:f.text,meta:'工作中留下的发现',route:{view:'worksite',workId:w.id,matterId,screen:'finding'}});
  }
  return rows;
}
export function queryRecords(host,{q='',kind='',matterId=''}={}) {
  const needle=q.trim().toLocaleLowerCase();
  return recordsOf(host).filter(r=>(!kind||r.kind===kind)&&(!matterId||r.matterId===matterId)&&(!needle||[r.title,r.text,r.interpretation,r.unconfirmed,r.before].join('\n').toLocaleLowerCase().includes(needle))).reverse();
}
export function routeForRecord(record) {
  if (!record?.route) return null;
  // A work card is already the doorway to its workspace. Opening a generic
  // record dialog on top made the first click feel blocked. Historical search
  // hits still carry their id so the exact item can be reviewed in context.
  return record.kind === 'work' ? {...record.route} : {...record.route,recordId:record.id};
}

// A library route replaces the DOM that opened it.  Keep the return target as
// a semantic route description instead of retaining an element that React may
// unmount before Escape is handled.
export function returnFocusSelectors(route) {
  const target = route?.returnTarget || route || {};
  if (target.view === 'chain') return [
    '.web-context-menu button:first-of-type',
    '.chain-root .chain-heading h1',
    '.chain-root h1',
  ];
  if (target.view === 'home') return [
    '.home-nav [data-action="search"]',
    '#home-title',
    '.home-header button',
  ];
  if (target.view === 'matters') return [
    '.matters-search-input',
    '.matters-hero h1',
    '.matters-brand',
  ];
  if (target.view === 'worksite') return [
    '.worksite-root h1',
    '.worksite-brand',
  ];
  return ['[data-route-host] h1', '[data-route-host] button'];
}
export function homeEntries(host) {
  return Object.fromEntries([...host.chain.matters].reverse().slice(0,4).map((m,i)=>{
    const sourceIds = [...new Set([...(m.sourceIds || []), ...(m.links || []).map(link => link.sourceId)])];
    const sources = sourceIds.map(id => host.chain.sources.find(source => source.id === id)).filter(Boolean)
      .map(source => ({ title: source.title || '一份材料', excerpt: source.excerpt || '', author: source.author || '', url: source.url || null }));
    const results = [
      ...(m.results || []),
      ...Object.values(host.worksite.sessions || {}).flatMap(session => (session.results || []).filter(result => result.matterId === m.id)),
    ].filter(result => result?.fact || result?.interpretation || result?.unconfirmed)
      .map(result => ({ fact: result.fact || '', interpretation: result.interpretation || '', unconfirmed: result.unconfirmed || '' }));
    const history = (m.revisions || []).map(revision => ({ before: revision.before || '', after: revision.after || '' }));
    return [['thought','work','fresh','handoff'][i],{
      matterId:m.id,
      title:short(titleOf(m),40),
      detailTitle:titleOf(m),
      subtitle:m.stop?`停在：${short(m.stop,35)}`:m.understanding?`我的理解 v${m.understandingVersion} · ${short(m.understanding,30)}`:'原话已保留 · 从这里接着',
      // The overview bubble stays concise; the adjacent reader gets the
      // canonical fields below without exposing ids, versions or storage
      // details to the interface.
      originalText: m.originalText || m.whyCare || '',
      whyCare: m.whyCare || '',
      understanding: m.understanding || '',
      stop: m.stop || '',
      sources,
      results,
      history,
    }];
  }));
}
export function mattersView(host) {
  const matters = [...host.chain.matters].reverse().map(m => {
    const linked = (m.links || []).map(link => link.sourceId);
    const sourceIds = [...new Set([...(m.sourceIds || []), ...linked])];
    const sources = sourceIds.map(id => host.chain.sources.find(source => source.id === id)).filter(Boolean).map(source => ({ ...source, example: false }));
    const linkedSource = sources.find(source => linked.includes(source.id)) || sources[0] || null;
    const latestResult = [...(m.results || [])].reverse().find(result => result?.fact || result?.interpretation || result?.unconfirmed) || null;
    // Reentry must reflect an actual linked material/result.  Do not turn an
    // empty local record into a made-up "later change" sentence.
    const laterChange = latestResult?.fact || linkedSource?.excerpt || '';
    const lastStop = m.stop || short(m.understanding, 42) || '原话已保留，还可以继续想';
    return {
      id: m.id,
      title: short(titleOf(m), 34),
      whyCare: m.whyCare || m.originalText || '',
      lastStop,
      contextHint: m.stop ? '从你自己留下的停点继续。' : '继续补充、找对照，或写下自己的理解。',
      hasComparison: linked.length > 0,
      changed: false,
      branch: null,
      originalUnderstanding: m.understanding || '',
      understanding: m.understanding || '',
      unresolved: m.stop || '',
      currentJudgment: m.stop || '',
      laterChange,
      comparison: { title: linkedSource?.title || '', challenges: linkedSource?.excerpt || '', uncertain: latestResult?.unconfirmed || '', sourceId: linkedSource?.id || linked[0] || '' },
      relation: linked.length ? 'unreviewed' : '',
      quotes: [],
      sources,
    };
  });
  return {mode:'overview',query:'',notice:'',example:false,selectedId:null,selected:null,matters,search:{counts:{matters:0,quotes:0,sources:0},matters:[],quotes:[],sources:[]}};
}

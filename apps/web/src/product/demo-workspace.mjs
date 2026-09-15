import {
  applyPendingComparison,
  attachProviderSourceProvenance,
  captureInput,
  createBridge,
  createWorkFromHandoff,
  deliverComparisonResult,
  dispatchChain,
  dispatchComparison,
  dispatchWorksite,
  openComparison,
  selectComparison,
  selectComparisonAnchor,
} from './bridge.mjs';
import { DEMO_ZHIHU_SNAPSHOT } from './demo-zhihu-snapshot.mjs';

export const COMPLETE_DEMO = Object.freeze({
  version: 3,
  matterId: 'demo:continuity',
  comparisonId: 'demo:comparison',
  workId: 'demo:work',
  home: Object.freeze({
    handoffMatterId: 'demo:evidence-handoff',
    freshMatterId: 'demo:fresh-look',
    workMatterId: 'demo:work-interface',
    workId: 'demo:work-interface:work',
  }),
});

function chain(host, type, fields = {}) {
  return dispatchChain(host, { matterId: COMPLETE_DEMO.matterId, action: { type, ...fields } });
}

function compare(host, type, fields = {}) {
  return dispatchComparison(host, { sessionId: COMPLETE_DEMO.comparisonId, action: { type, ...fields } });
}

function commitComparison(host) {
  const requestId = selectComparison(host, COMPLETE_DEMO.comparisonId)?.request?.id;
  if (!requestId) throw new Error('演示对照没有生成可提交请求');
  const ids = { sessionId: COMPLETE_DEMO.comparisonId, requestId };
  const applied = applyPendingComparison(host, ids);
  if (!applied.outcome.ok) throw new Error(applied.outcome.error?.message || '演示对照提交失败');
  return deliverComparisonResult(applied.host, { ...ids, outcome: applied.outcome });
}

function work(host, type, fields = {}) {
  return dispatchWorksite(host, { workId: COMPLETE_DEMO.workId, action: { type, ...fields } });
}

/**
 * A deterministic, fully traversable workspace built through the same product
 * commands as user data. It lives in a separate IndexedDB database and every
 * value is labelled as demonstration content in the shell.
 */
export function createCompleteDemoWorkspace() {
  let host = createBridge();
  const [zhihuOrigin, zhihuCounterpoint] = DEMO_ZHIHU_SNAPSHOT.items;

  // These three supporting matters make the home scene a faithful, useful
  // overview rather than a one-card fixture.  They are built through the same
  // commands as personal content and intentionally precede the primary matter:
  // homeEntries reverses creation order into thought / work / fresh / handoff.
  host = captureInput(host, {
    matterId: COMPLETE_DEMO.home.handoffMatterId,
    text: '多 Agent 交接时，怎样既保留原始证据，又不让后来生成的结论冒充事实？',
  });
  host = dispatchChain(host, { matterId: COMPLETE_DEMO.home.handoffMatterId, action: { type: 'UNDERSTANDING_DRAFT', text: '交接内容要同时带上原话、当前判断、未确认部分和结果回来的入口。' } });
  host = dispatchChain(host, { matterId: COMPLETE_DEMO.home.handoffMatterId, action: { type: 'SAVE_UNDERSTANDING' } });
  host = dispatchChain(host, { matterId: COMPLETE_DEMO.home.handoffMatterId, action: { type: 'STOP_DRAFT', text: '还有一个判断等待验证：怎样证明 Agent 使用的是哪一版上下文？' } });

  host = captureInput(host, {
    matterId: COMPLETE_DEMO.home.freshMatterId,
    text: '想重新看一段材料，但先不被自己上一次的理解带走。',
  });

  host = captureInput(host, {
    matterId: COMPLETE_DEMO.home.workMatterId,
    text: '工作 UI 如何承接一段正在变化的理解，而不是复制出另一个聊天窗口？',
  });
  host = dispatchChain(host, { matterId: COMPLETE_DEMO.home.workMatterId, action: { type: 'UNDERSTANDING_DRAFT', text: '工作现场应保留带入快照、过程发现与结果回流，而不是替 Agent 重做一套界面。' } });
  host = dispatchChain(host, { matterId: COMPLETE_DEMO.home.workMatterId, action: { type: 'SAVE_UNDERSTANDING' } });
  host = createWorkFromHandoff(host, {
    matterId: COMPLETE_DEMO.home.workMatterId,
    workId: COMPLETE_DEMO.home.workId,
    destination: { agent: 'Codex Harness', project: 'Trace Web', task: '验证工作现场的承接方式' },
    role: 'reference',
    note: '合成演示工作；只建立本地交接记录，未连接或执行外部 Agent。',
  });

  host = captureInput(host, {
    matterId: COMPLETE_DEMO.matterId,
    text: '我收藏了很多内容，却很少真正回来。我在意的也许不是保存，而是以后还能不能接回当时的问题。',
    source: {
      id: zhihuOrigin.id,
      title: zhihuOrigin.title,
      excerpt: zhihuOrigin.excerpt,
      sourceType: zhihuOrigin.sourceType,
      context: `知乎开放平台公开搜索摘要 · 作者：${zhihuOrigin.author}。只作为来源快照，不等于作者全文或我的理解。`,
    },
  });
  host = attachProviderSourceProvenance(host, {
    matterId: COMPLETE_DEMO.matterId,
    sourceId: zhihuOrigin.id,
    provenance: { ...DEMO_ZHIHU_SNAPSHOT, ...zhihuOrigin },
  });
  host = chain(host, 'COMPOSER_DRAFT', { text: '如果只留下原文，几周后我还能认出自己当时真正卡住的问题吗？' });
  host = chain(host, 'SEND');
  host = chain(host, 'UNDERSTANDING_DRAFT', { text: '收藏不是终点。要想以后接回来，至少要保留原现场、当时的问题和仍未确认的部分。' });
  host = chain(host, 'SAVE_UNDERSTANDING');
  host = chain(host, 'STOP_DRAFT', { text: '还需要验证：不写附言时，具体任务能不能成为新的接续入口？' });

  const anchor = selectComparisonAnchor(host, COMPLETE_DEMO.matterId, { field: 'understanding' });
  host = openComparison(host, {
    sessionId: COMPLETE_DEMO.comparisonId,
    matterId: COMPLETE_DEMO.matterId,
    anchor,
    returnTarget: { view: 'chain', matterId: COMPLETE_DEMO.matterId, screen: 'understanding', contextMode: 'resume' },
  });
  const sourceIdsBeforeComparison = new Set(host.chain.sources.map(source => source.id));
  host = compare(host, 'IMPORT_MATERIAL', { material: {
    id: zhihuCounterpoint.id,
    title: zhihuCounterpoint.title,
    excerpt: zhihuCounterpoint.excerpt,
    sourceType: `${zhihuCounterpoint.sourceType} · ${zhihuCounterpoint.author}`,
    context: '知乎开放平台公开搜索摘要。它提出“知识管理靠使用而不是积累”的另一种判断，用来挑战“只要保留得更完整就足够”的倾向；关系仍由用户确认。',
  } });
  const comparisonSourceId = host.chain.sources.find(source =>
    source.ownerMatterId === COMPLETE_DEMO.matterId && !sourceIdsBeforeComparison.has(source.id))?.id;
  host = compare(host, 'LINK');
  host = commitComparison(host);
  host = compare(host, 'OPEN_REVISION');
  host = compare(host, 'REVISION_DRAFT', { text: '收藏不是终点。保留原现场和当时的问题能帮助接回；在持续项目中，具体任务本身也可能成为新的入口。' });
  host = compare(host, 'CONFIRM_REVISION');
  host = commitComparison(host);
  host = attachProviderSourceProvenance(host, {
    matterId: COMPLETE_DEMO.matterId,
    sourceId: comparisonSourceId,
    provenance: { ...DEMO_ZHIHU_SNAPSHOT, ...zhihuCounterpoint },
  });

  host = createWorkFromHandoff(host, {
    matterId: COMPLETE_DEMO.matterId,
    workId: COMPLETE_DEMO.workId,
    destination: { agent: 'Codex', project: 'Trace 产品交互', task: '验证六个动作能否形成完整接续' },
    role: 'trial',
    note: '只带入当前理解，结果回来后仍由用户复核。',
  });
  host = work(host, 'COMPOSER_DRAFT', { text: '实际演示时，访客需要在数秒内找到每一个动作留下的数据。' });
  host = work(host, 'OPEN_FINDING');
  host = work(host, 'SET_FINDING_RELATION', { decision: 'linked', matterId: COMPLETE_DEMO.matterId });
  host = work(host, 'KEEP_FINDING');
  host = work(host, 'RESULT_DRAFT', { patch: {
    matterId: COMPLETE_DEMO.matterId,
    fact: '六个动作现在都有可打开的记录，并能从动作清单直达原处。',
    interpretation: '把演示数据放进真实产品模型，比静态截图更能说明 Trace 的接续关系。',
    unconfirmed: '知乎内容来自 2026-09-15 的公开搜索摘要快照，尚未代表实时结果、完整原文或全部社区观点。',
    proposedUnderstanding: 'Trace 要保留来源、问题、理解、对照、工作与结果之间的接续关系；完整演示必须让六个动作的数据都能被打开和核对。',
    relation: 'support',
  } });
  host = work(host, 'OPEN_REVISION_REVIEW');
  host = work(host, 'CONFIRM_REVISION');
  host.route = { view: 'home' };
  host.preferences = { displayName: '', reduceMotion: false };
  host.experience = {
    kind: 'complete-demo',
    version: COMPLETE_DEMO.version,
    synthetic: true,
    sourceSnapshot: {
      provider: DEMO_ZHIHU_SNAPSHOT.provider,
      query: DEMO_ZHIHU_SNAPSHOT.query,
      fetchedAt: DEMO_ZHIHU_SNAPSHOT.fetchedAt,
      contentMode: DEMO_ZHIHU_SNAPSHOT.contentMode,
      count: DEMO_ZHIHU_SNAPSHOT.items.length,
    },
  };
  return host;
}

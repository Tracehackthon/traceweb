import {
  applyPendingComparison,
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

export const COMPLETE_DEMO = Object.freeze({
  matterId: 'demo:continuity',
  comparisonId: 'demo:comparison',
  workId: 'demo:work',
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
  host = captureInput(host, {
    matterId: COMPLETE_DEMO.matterId,
    text: '我收藏了很多内容，却很少真正回来。我在意的也许不是保存，而是以后还能不能接回当时的问题。',
    source: {
      id: 'demo:zhihu-origin',
      title: '知乎阅读现场 · 关于“第二大脑”的讨论（演示摘录）',
      excerpt: '任何需要手动建设的“第二大脑”都是伪命题。',
      context: '演示摘录，用来说明来源、个人触动和后续判断如何保持不同身份。',
    },
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
  host = compare(host, 'IMPORT_MATERIAL', { material: {
    title: '持续项目里的另一种情况（演示材料）',
    excerpt: '即使没有给收藏写附言，重新处理同一个具体任务时，问题和原来的阅读现场也可能一起浮现。',
    context: '完整演示数据，不对应真实作者；它只挑战“必须写附言”这一绝对条件。',
  } });
  host = compare(host, 'LINK');
  host = commitComparison(host);
  host = compare(host, 'OPEN_REVISION');
  host = compare(host, 'REVISION_DRAFT', { text: '收藏不是终点。保留原现场和当时的问题能帮助接回；在持续项目中，具体任务本身也可能成为新的入口。' });
  host = compare(host, 'CONFIRM_REVISION');
  host = commitComparison(host);

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
    unconfirmed: '尚未代表跨设备账号同步，也不代表知乎授权已经完成。',
    proposedUnderstanding: 'Trace 要保留来源、问题、理解、对照、工作与结果之间的接续关系；完整演示必须让六个动作的数据都能被打开和核对。',
    relation: 'support',
  } });
  host = work(host, 'OPEN_REVISION_REVIEW');
  host = work(host, 'CONFIRM_REVISION');
  host.route = { view: 'home' };
  host.preferences = { displayName: '演示访客', reduceMotion: false };
  host.experience = { kind: 'complete-demo', version: 1, synthetic: true };
  return host;
}

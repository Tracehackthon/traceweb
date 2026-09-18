const recordTitles = {
  expression: '当时留下的原话',
  understanding: '当前保存的理解',
  discussion: '留下的补充',
  branch: '留下的旁支',
  source: '原材料与来处',
  result: '保存下来的这次结果',
  revision: '这次修订的记录',
  work: '这次工作的记录',
};

export function recordDialogTitle(kind) {
  return Object.hasOwn(recordTitles, kind) ? recordTitles[kind] : '这条记录';
}

const routeTitles = {
  home: '把此刻的一点，带到以后',
  matters: '在意的事',
  chain: '一件事',
  compare: '找个对照',
  worksite: '工作现场',
  works: '工作现场',
  search: '搜索',
  all: '全部痕迹',
  discussion: '深度讨论',
};

export function routeDocumentTitle(view) {
  return `Trace · ${Object.hasOwn(routeTitles, view) ? routeTitles[view] : '接着想'}`;
}

const runtimeStatuses = {
  attached: '正在跟随', paused: '已暂停', ended: '已结束',
  disabled: '未启用', enabled: '已启用', idle: '等待任务', ready: '已就绪',
  running: '处理中', queued: '等待处理', completed: '已完成', succeeded: '已完成',
  failed: '未完成，可重试', stopped: '已停止', degraded: '部分可用',
  proposed: '待判断', trial: '试用中', adopted: '已采用', rejected: '已忽略',
  candidate: '待准备', staged: '已暂存', trial_queued: '等待试用',
  validated: '已通过验证', published: '已发布', rolled_back: '已回滚',
  active: '已生效', revoked: '已撤回', cancelled: '已取消',
};

export function runtimeStatusLabel(status, empty = '状态待确认') {
  return status ? (Object.hasOwn(runtimeStatuses, status) ? runtimeStatuses[status] : '状态待确认') : empty;
}

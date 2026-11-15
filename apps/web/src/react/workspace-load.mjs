// The workspace read is a prerequisite for rendering saved content, but it is
// not allowed to become an unbounded prerequisite for rendering the shell.
// Keep the timing and public failure policy in one small, testable boundary so
// the browser and packaged desktop window agree on what a read result means.
export const WORKSPACE_LOAD_TIMEOUT_MS = 12_000;

export const WORKSPACE_LOAD_STATES = Object.freeze({
  loading: 'loading',
  ready: 'ready',
  empty: 'empty',
  recoverableError: 'recoverable-error',
  unrecoverableError: 'unrecoverable-error',
});

const UNRECOVERABLE_CODES = new Set([
  'INVALID_HOST',
  'STORAGE_CORRUPT',
  'STORAGE_SCHEMA',
  'WORKSPACE_RESPONSE_INVALID',
]);

/** @param {string} message @param {{code?: string, status?: number}} [options] */
export function workspaceError(message, { code = 'STORAGE_FAILURE', status } = {}) {
  const error = new Error(message || '工作区读取没有完成');
  error.code = code;
  if (Number.isInteger(status)) error.status = status;
  return error;
}

export function withWorkspaceTimeout(promise, {
  timeoutMs = WORKSPACE_LOAD_TIMEOUT_MS,
  message = '读取内容超时，原有内容没有被覆盖。',
  code = 'WORKSPACE_READ_TIMEOUT',
} = {}) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(workspaceError(message, { code })), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function classifyWorkspaceLoadFailure(error) {
  const code = String(error?.code || '').trim().toUpperCase();
  const status = Number(error?.status);
  if (UNRECOVERABLE_CODES.has(code)) return WORKSPACE_LOAD_STATES.unrecoverableError;
  if (status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 409 && status !== 429) {
    return WORKSPACE_LOAD_STATES.unrecoverableError;
  }
  return WORKSPACE_LOAD_STATES.recoverableError;
}

export function publicWorkspaceLoadMessage(state) {
  if (state === WORKSPACE_LOAD_STATES.unrecoverableError) {
    return '这份内容暂时无法安全读取。Trace 没有重置它，请先保留草稿或备份，再重新检查。';
  }
  return '内容暂时无法读取。原有内容没有被覆盖，可以重新读取或载入已保存版本。';
}

export function workspaceDataState(data) {
  if (!data || !Number.isSafeInteger(data.revision) || data.revision < 0) {
    throw workspaceError('工作区读取结果不完整。', { code: 'WORKSPACE_RESPONSE_INVALID' });
  }
  if (data.host == null) {
    if (data.revision !== 0) throw workspaceError('工作区版本与内容不一致。', { code: 'STORAGE_CORRUPT' });
    return WORKSPACE_LOAD_STATES.empty;
  }
  return WORKSPACE_LOAD_STATES.ready;
}

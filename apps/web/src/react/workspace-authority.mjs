// Save/read envelope checks, not a second Product reducer or storage owner.
// Product/IndexedDB still own domain validation and commits. Keep this boundary
// browser-safe so a malformed 200 cannot become an acknowledged UI snapshot.
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const copy = value => structuredClone(value);

function invalid(message, code = 'WORKSPACE_ACK_INVALID') {
  return Object.assign(new Error(message), { code });
}

export function assertWorkspaceHost(host) {
  if (!plain(host) || host.schemaVersion !== 1 || !plain(host.chain) || host.chain.schemaVersion !== 1
    || !plain(host.worksite) || host.worksite.schemaVersion !== 1
    || !Array.isArray(host.chain.matters) || !Array.isArray(host.chain.sources)
    || !plain(host.chain.sessions) || !plain(host.comparisons) || !plain(host.workGuards)
    || !plain(host.worksite.works) || !plain(host.worksite.sessions)
    || !plain(host.chain.capture) || typeof host.chain.capture.text !== 'string'
    || !Array.isArray(host.chain.capture.sourceIds) || typeof host.chain.capture.excerpt !== 'string'
    || !(host.chain.capture.excerptSourceId === null || typeof host.chain.capture.excerptSourceId === 'string')
    || host.error != null) {
    throw invalid('保存回执中的内容结构不完整。未确认保存，请保留草稿后重试。');
  }
  const stack = [[host, 0]];
  let count = 0;
  while (stack.length) {
    const [value, depth] = stack.pop();
    if (++count > 250000 || depth > 64) throw invalid('保存回执的结构超出可安全读取的范围。');
    if (typeof value === 'number' && !Number.isFinite(value)) throw invalid('保存回执包含无效数字。');
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (forbidden.has(key)) throw invalid('保存回执包含无效对象键。');
        stack.push([child, depth + 1]);
      }
    }
  }
  return host;
}

export function validateWorkspaceAcknowledgement(data, request, { productCommand = false } = {}) {
  if (!plain(data) || !Number.isSafeInteger(data.revision) || data.revision !== request.expectedRevision + 1) {
    throw invalid('保存回执的版本不完整或未前进。未确认保存，请保留草稿后重试。');
  }
  assertWorkspaceHost(data.host);
  if (productCommand && (data.receipt === undefined || data.headRevision === undefined)) {
    throw invalid('产品命令缺少可核对的回执或当前版本。未继续后续操作。');
  }
  if (data.headRevision !== undefined) {
    if (!Number.isSafeInteger(data.headRevision) || data.headRevision < data.revision) {
      throw invalid('保存回执的当前版本无效。');
    }
    if (data.headRevision !== data.revision) {
      throw invalid('这次修改已有提交记录，但工作区又有后续更新。请先保留草稿，再载入最新版本。', 'WORKSPACE_ACK_STALE');
    }
  }
  if (data.receipt !== undefined) {
    const receipt = data.receipt;
    if (!plain(receipt) || receipt.protocolVersion !== 1 || receipt.commandId !== request.commandId
      || receipt.status !== 'committed' || receipt.beforeRevision !== request.expectedRevision
      || receipt.afterRevision !== data.revision) {
      throw invalid('保存回执与本次命令不一致。未继续后续操作。');
    }
  }
  return data;
}

function equal(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equal(value, right[index]));
  }
  if (!plain(left) || !plain(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
}

/**
 * Rebase only independent edits. Arrays are atomic: we do not guess at domain
 * identities/order, or auto-resolve concurrent revisions of the same content.
 * On conflict the caller retains both full snapshots instead of applying the
 * partially merged result. No server mutation happens here.
 */
export function reconcileWorkspaceAuthority(base, local, authoritative) {
  const conflicts = [];
  const absent = Symbol('absent');
  const at = (value, key) => Object.hasOwn(value, key) ? value[key] : absent;
  const merge = (before, current, remote, pointer) => {
    if (equal(current, before)) return remote;
    if (equal(remote, before) || equal(current, remote)) return current;
    if (plain(before) && plain(current) && plain(remote)) {
      const merged = {};
      for (const key of new Set([...Object.keys(before), ...Object.keys(current), ...Object.keys(remote)])) {
        const value = merge(at(before, key), at(current, key), at(remote, key), `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
        if (value !== absent) merged[key] = value;
      }
      return merged;
    }
    conflicts.push(pointer || '/');
    return current;
  };
  const host = merge(base, local, authoritative, '');
  return { host: copy(host), conflicts };
}

/** One export shape for the status bar and the initial-load recovery surface. */
export function workspaceRecoveryExport(snapshot) {
  const recovery = snapshot.recoveryDraft;
  return copy({
    revision: snapshot.revision,
    host: snapshot.host,
    unsaved: snapshot.pending || Boolean(recovery),
    recovery: Boolean(recovery),
    ...(recovery ? { recoveryDetails: recovery } : {}),
  });
}

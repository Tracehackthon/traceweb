// Read-only view projections. Product remains the only business owner.
export const recordKindLabels = Object.freeze({ expression: '原表达', understanding: '当前理解', discussion: '讨论与补充', source: '材料', result: '工作结果', revision: '历史修订', work: '工作现场', branch: '旁支' });
export function sourceLink(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function recordSource(host, record) {
  if (record?.kind !== 'source') return null;
  return host?.chain?.sources?.find(source => source.id === record.id) || null;
}
export function evolutionEntries(host, record) {
  const matter = host?.chain?.matters?.find(item => item.id === record?.matterId);
  if (!matter) return [];
  const entries = [{ id: `${matter.id}:original`, action: '原表达', description: matter.originalText || '', state: 'original', before: null, after: matter.originalText || '' }];
  const revisions = [...new Map((matter.revisions || []).map(revision => [revision.id, revision])).values()];
  const undoneIds = new Set(revisions.filter(revision => revision.kind === 'undo').map(revision => revision.revisionId));
  for (const revision of revisions) {
    const beforeVersion = revision.beforeVersion ?? revision.baseVersion ?? revision.fromVersion;
    const afterVersion = revision.afterVersion ?? revision.version ?? revision.toVersion;
    const undone = Boolean(revision.undone || revision.undoneBy || undoneIds.has(revision.id));
    const current = !undone && afterVersion === matter.understandingVersion && revision.after === matter.understanding;
    entries.push({ id: `${matter.id}:${revision.id}`, action: undone ? '已撤销的修订' : revision.kind === 'undo' ? '撤销修订' : revision.target ? '局部理解修订' : '理解修订', description: revision.after ?? '', state: undone ? 'undone' : current ? 'current' : 'historical', before: revision.before ?? '', after: revision.after ?? '', beforeVersion, afterVersion, resultId: revision.resultId || null });
  }
  // Direct edits do not yet have immutable snapshots in the existing model.
  // Show the actual head, never synthesize missing historical versions/dates.
  if (matter.understanding && !entries.some(entry => entry.state === 'current')) entries.push({ id: `${matter.id}:understanding`, action: '当前理解', description: matter.understanding, state: 'current', before: null, after: matter.understanding, afterVersion: matter.understandingVersion });
  return entries;
}
export function referenceItems(host, matterId) {
  const matter = host?.chain?.matters?.find(item => item.id === matterId);
  if (!matter) return [];
  const ids = new Set([...(matter.sourceIds || []), ...(matter.links || []).map(link => link.sourceId)]);
  return (host.chain.sources || []).filter(source => source.ownerMatterId === matterId || ids.has(source.id)).map(source => ({ id: source.id, title: source.title || '未命名材料', text: source.excerpt || '', href: sourceLink(source.url), linked: (matter.links || []).some(link => link.sourceId === source.id) }));
}

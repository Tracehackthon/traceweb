// Lookup selection belongs to navigation, not to the Product command schema.
// Keep the locked Product contract unchanged and do not send view-only fields
// hidden inside a nested comparison returnTarget.
const presentationKeys = ['selectedId', 'detailTab', 'includeHistory'];
export function productReturnRoute(route) {
  if (!route) return route;
  const next = structuredClone(route);
  for (const key of presentationKeys) delete next[key];
  if (next.returnTarget) next.returnTarget = productReturnRoute(next.returnTarget);
  return next;
}
export function retainPresentationReturn(authoritative, presentation) {
  if (!presentation || authoritative?.view !== presentation.view || authoritative?.matterId !== presentation.matterId || authoritative?.workId !== presentation.workId) return authoritative;
  const next = { ...authoritative };
  for (const key of presentationKeys) if (Object.hasOwn(presentation,key)) next[key] = presentation[key];
  if (Object.hasOwn(presentation,'returnTarget')) next.returnTarget = structuredClone(presentation.returnTarget);
  // Authoritative anchor and anchorStatus always win over stale UI selection.
  return next;
}

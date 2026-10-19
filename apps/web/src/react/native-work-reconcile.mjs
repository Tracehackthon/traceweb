/**
 * A native work.run has already written the Codex return to the Product
 * Workspace. The UI may adopt that authoritative snapshot only when it is
 * the same work and return, never merely because an Agent call succeeded.
 */
export function matchesAuthoritativeWorkReturn(workspace, workId, matterId, returned) {
  const work = workspace?.host?.worksite?.works?.[workId]
  const session = workspace?.host?.worksite?.sessions?.[workId]
  const latest = session?.codexReturns?.at(-1)
  return Number.isSafeInteger(workspace?.revision)
    && work?.connected === true
    && work?.connection?.status === 'returned_for_review'
    && session?.result?.matterId === matterId
    && typeof session?.result?.externalReturnId === 'string'
    && latest?.returnId === session.result.externalReturnId
    && typeof returned?.result?.fact === 'string'
    && returned.result.fact.length > 0
    && latest?.result?.fact === returned.result.fact
    && session.result.fact === returned.result.fact
}

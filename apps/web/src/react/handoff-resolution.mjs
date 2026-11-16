/**
 * Resolve an incoming desktop/Harness handoff against the canonical Product
 * Workspace. A Trace-native observation id is the Product matter id returned
 * by `workspace.capture`; opening that observation must therefore reuse it
 * instead of creating a second matter with the same text.
 */
export function existingMatterForHandoff(matters, handoff) {
  if (!Array.isArray(matters) || !handoff) return null

  if (handoff.origin === 'trace-native' && typeof handoff.observationId === 'string' && handoff.observationId) {
    const canonical = matters.find((item) => item?.id === handoff.observationId)
    if (canonical) return canonical
  }

  return matters.find((item) => {
    const marker = item?.externalHandoff
    if (marker?.origin !== handoff.origin) return false
    return handoff.observationId
      ? marker.observationId === handoff.observationId
      : marker.text === handoff.text && marker.source === handoff.source
  }) || null
}

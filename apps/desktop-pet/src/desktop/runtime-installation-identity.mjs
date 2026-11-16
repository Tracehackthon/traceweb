import { randomUUID } from 'node:crypto'

const ID_PATTERN = /^(?:installation|workspace)-[a-f0-9]{32,64}$/i

export function isStableRuntimeIdentity(value, kind) {
  return typeof value === 'string' && value.startsWith(`${kind}-`) && ID_PATTERN.test(value)
}

/**
 * The packaged desktop owns one product database under its userData state
 * directory. Keep the two opaque IDs in the same durable settings file so a
 * restart (and a legacy database upgrade) cannot silently become a different
 * Trace installation. The runtime still validates the IDs and database
 * binding; this helper only supplies the instance-owned values.
 */
export function ensureRuntimeIdentity(settings = {}, randomId = () => randomUUID().replaceAll('-', '')) {
  const current = settings && typeof settings.runtimeIdentity === 'object' && !Array.isArray(settings.runtimeIdentity)
    ? settings.runtimeIdentity
    : {}
  const installationId = isStableRuntimeIdentity(current.installationId, 'installation')
    ? current.installationId
    : `installation-${randomId()}`
  const workspaceId = isStableRuntimeIdentity(current.workspaceId, 'workspace')
    ? current.workspaceId
    : `workspace-${randomId()}`
  const changed = current.installationId !== installationId || current.workspaceId !== workspaceId
  return {
    identity: { installationId, workspaceId },
    settings: changed ? { ...settings, runtimeIdentity: { installationId, workspaceId } } : settings,
    changed,
  }
}

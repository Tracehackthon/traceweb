export function isReadableProductWorkspace(value) {
  return value?.protocolVersion === 1
    && Number.isSafeInteger(value.revision)
    && value.revision >= 0
    && value.storage !== null
    && typeof value.storage === 'object'
    && !Array.isArray(value.storage)
}

export async function probeProductWorkspace(origin, fetchImpl = fetch, timeoutMs = 1_200) {
  try {
    const response = await fetchImpl(new URL('/api/product/workspace', origin), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json', origin },
    })
    if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) return false
    return isReadableProductWorkspace(await response.json())
  } catch {
    return false
  }
}

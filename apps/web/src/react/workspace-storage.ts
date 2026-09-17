// The hosted build uses browser storage. The complete demo always uses its
// own IndexedDB namespace, including during local development, so synthetic
// records can never be written into a maintainer's personal SQLite workspace.
const completeDemoStorage = location.pathname === '/app/demo' || location.pathname.startsWith('/app/demo/');
type NativeWorkspaceBridge = { requestWorkspace?: (pathname: string, options: { method?: string; body?: string }) => Promise<{ status: number; body: string; contentType?: string; contentDisposition?: string }> };
type NativeCapabilityBridge = { requestCapability?: (request: Record<string, unknown>) => Promise<any> };
const nativeBridge = (): NativeWorkspaceBridge | undefined => (window as Window & { traceNative?: NativeWorkspaceBridge }).traceNative;
const nativeCapabilityBridge = (): NativeCapabilityBridge | undefined => (window as Window & { traceNative?: NativeCapabilityBridge }).traceNative;
const nativeStorage = !completeDemoStorage && typeof nativeBridge()?.requestWorkspace === 'function';
export const browserStorage = !nativeStorage && (import.meta.env.VITE_TRACE_STORAGE === 'browser' || completeDemoStorage);
export const storageLabel = completeDemoStorage ? '本次演示会话' : nativeStorage ? 'Trace 桌面端' : browserStorage ? '当前浏览器' : '本机';

async function requestNativeWorkspace(url: string, options: RequestInit): Promise<Response> {
  const bridge = nativeBridge();
  if (!bridge?.requestWorkspace) throw new Error('Trace 桌面工作区尚未连接。');
  const result = await bridge.requestWorkspace(url, { method: options.method || 'GET', ...(typeof options.body === 'string' ? { body: options.body } : {}) });
  return new Response(result.body, { status: result.status, headers: {
    'content-type': result.contentType || 'application/json; charset=utf-8',
    ...(result.contentDisposition ? { 'content-disposition': result.contentDisposition } : {}),
  } });
}

/**
 * Product writes are command-shaped, not whole-host snapshots. Keep this
 * helper beside the legacy workspace transport so an older installed shell
 * can still use its read/migration path while current desktop builds use the
 * authoritative Product Workspace CAS ledger.
 */
export async function productCommandRequest(payload: { protocolVersion?: number; commandId: string; expectedRevision: number; operations: unknown[] }): Promise<Response> {
  const bridge = nativeCapabilityBridge();
  if (!bridge?.requestCapability) throw new Error('Trace 桌面工作区尚未连接。');
  const value = await bridge.requestCapability({ operation: 'product.command', protocolVersion: payload.protocolVersion ?? 1, ...payload });
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

export async function workspaceRequest(url: string, options: RequestInit = {}): Promise<Response> {
  if (completeDemoStorage) {
    const { demoWorkspaceRequest } = await import('./demo-workspace-storage');
    return demoWorkspaceRequest(url, options);
  }
  if (nativeStorage) {
    const response = await requestNativeWorkspace(url, options);
    // One-time migration for users who installed an earlier desktop build:
    // only import the old private IndexedDB snapshot into a still-empty SQLite
    // workspace, through the authenticated native bridge.
    if (url === '/api/web/workspace' && (options.method || 'GET') === 'GET' && response.ok) {
      const nativeValue = await response.clone().json();
      if (!nativeValue.host && nativeValue.revision === 0) {
        const { browserWorkspaceRequest } = await import('../product/browser-workspace.mjs');
        const legacy = await browserWorkspaceRequest('/api/web/workspace', { cache: 'no-store' });
        const legacyValue = legacy.ok ? await legacy.json() : null;
        if (legacyValue?.host) {
          const migrated = await requestNativeWorkspace('/api/web/workspace', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expectedRevision: 0, commandId: `desktop-migrate-${crypto.randomUUID()}`, host: legacyValue.host }),
          });
          if (migrated.ok) return migrated;
        }
      }
    }
    return response;
  }
  if (!browserStorage) return fetch(url, options);
  const { browserWorkspaceRequest } = await import('../product/browser-workspace.mjs');
  return browserWorkspaceRequest(url, options);
}

export async function exportWorkspace(): Promise<void> {
  const response = await workspaceRequest('/api/web/export', { cache: 'no-store' });
  if (!response.ok) throw new Error('导出失败，未清除任何数据。');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `Trace-workspace-${Date.now()}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

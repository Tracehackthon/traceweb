// The hosted build uses browser storage. The complete demo always uses its
// own IndexedDB namespace, including during local development, so synthetic
// records can never be written into a maintainer's personal SQLite workspace.
const completeDemoStorage = location.pathname === '/app/demo' || location.pathname.startsWith('/app/demo/');
export const browserStorage = import.meta.env.VITE_TRACE_STORAGE === 'browser' || completeDemoStorage;
export const storageLabel = browserStorage ? '当前浏览器' : '本机';

export async function workspaceRequest(url: string, options: RequestInit = {}): Promise<Response> {
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

// This is a build-time choice, never an automatic fallback after an API error.
export const browserStorage = import.meta.env.VITE_TRACE_STORAGE === 'browser';
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

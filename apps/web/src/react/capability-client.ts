export type SearchSource = 'zhihu' | 'global';
export type SearchItem = { id: string; provider: 'zhihu'; source: SearchSource; title: string; author: string | null; url: string | null; excerpt: string; content_id?: string | null; content_type: string; comment_count?: number | null; vote_up_count?: number | null; authority_level?: string | null; edited_at?: string | null; content_mode: string; fetched_at: string };
export type SearchResult = { source: SearchSource; query: string; items: SearchItem[]; content_mode: string; saved_to_trace: false };

type NativeCapabilityBridge = { requestCapability?: (request: Record<string, unknown>) => Promise<any> };

function nativeBridge(): NativeCapabilityBridge | undefined {
  return (window as Window & { traceNative?: NativeCapabilityBridge }).traceNative;
}

async function api(path: string, body?: unknown): Promise<any> {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'same-origin', headers: body === undefined ? {} : { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('当前环境没有提供这个 Trace 接口。');
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error?.message || `Trace 接口请求失败（${response.status}）。`);
  return value;
}

export async function searchPublic(source: SearchSource, query: string, count = 3): Promise<SearchResult> {
  const bridge = nativeBridge();
  if (bridge?.requestCapability) return bridge.requestCapability({ operation: 'search', source, query, count });
  return api(source === 'global' ? '/api/search/global' : '/api/search/zhihu', { query, count });
}

export type ZhihuAuthorizationStatus = {
  enabled?: boolean;
  oauth?: { configured?: boolean; status?: string; expires_at?: string | null };
  user_content_configured?: boolean;
  notice?: string;
};

export async function zhihuAuthorizationStatus(): Promise<ZhihuAuthorizationStatus> {
  const bridge = nativeBridge();
  if (bridge?.requestCapability) return bridge.requestCapability({ operation: 'zhihu.status' });
  return api('/api/zhihu/status');
}

export async function startZhihuAuthorization(): Promise<any> {
  const bridge = nativeBridge();
  if (bridge?.requestCapability) return bridge.requestCapability({ operation: 'zhihu.oauth.start' });
  return api('/api/zhihu/oauth/start', {});
}

export async function checkZhihuAuthorization(): Promise<ZhihuAuthorizationStatus> {
  const bridge = nativeBridge();
  if (bridge?.requestCapability) return bridge.requestCapability({ operation: 'zhihu.oauth.check' });
  return zhihuAuthorizationStatus();
}

export async function disconnectZhihuAuthorization(): Promise<any> {
  const bridge = nativeBridge();
  if (bridge?.requestCapability) return bridge.requestCapability({ operation: 'zhihu.oauth.disconnect' });
  return api('/api/zhihu/oauth/disconnect', {});
}

export type ZhihuUserContentKind = 'contents' | 'favorites' | 'favorite_lists' | 'favorite_items' | 'followees';

export async function readZhihuUserContent(kind: ZhihuUserContentKind, limit = 3, favoriteId?: string): Promise<any> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('一次最多读取 10 条知乎内容。');
  const bridge = nativeBridge();
  const payload = { operation: 'zhihu.user.read', kind, limit, offset: '0', ...(favoriteId ? { favorite_id: favoriteId } : {}) };
  if (bridge?.requestCapability) return bridge.requestCapability(payload);
  return api('/api/zhihu/user/read', { kind, limit, offset: '0', ...(favoriteId ? { favorite_id: favoriteId } : {}) });
}

export async function agentCapabilities(): Promise<any> {
  const bridge = nativeBridge();
  if (bridge?.requestCapability) return bridge.requestCapability({ operation: 'capabilities' });
  return { enabled: false, profiles: [], boundary: 'native-desktop-only' };
}

export async function runNativeAgent(input: { text: string; source: SearchSource | 'none'; profileId?: string }): Promise<any> {
  const bridge = nativeBridge();
  if (!bridge?.requestCapability) throw new Error('请先启动 Trace 桌宠，再使用 Codex 或自定义 Agent。网页不会接触本机登录信息或密钥。');
  return bridge.requestCapability({ operation: 'agent.run', ...input });
}

export async function startNativeAgent(input: { text: string; source: SearchSource | 'none'; profileId?: string }): Promise<any> {
  const bridge = nativeBridge();
  if (!bridge?.requestCapability) throw new Error('请先启动 Trace 桌宠，再使用 Codex 或自定义 Agent。网页不会接触本机登录信息或密钥。');
  return bridge.requestCapability({ operation: 'agent.run.start', ...input });
}

export async function readNativeAgentRun(runId: string): Promise<any> {
  const bridge = nativeBridge();
  if (!bridge?.requestCapability) throw new Error('Trace 桌宠尚未连接。');
  return bridge.requestCapability({ operation: 'agent.run.read', runId });
}

export async function readNativeAgentEvents(runId: string, after = 0): Promise<any> {
  const bridge = nativeBridge();
  if (!bridge?.requestCapability) throw new Error('Trace 桌宠尚未连接。');
  return bridge.requestCapability({ operation: 'agent.run.events', runId, after });
}

export async function cancelNativeAgent(runId: string): Promise<any> {
  const bridge = nativeBridge();
  if (!bridge?.requestCapability) throw new Error('Trace 桌宠尚未连接。');
  return bridge.requestCapability({ operation: 'agent.run.cancel', runId });
}

export async function adoptNativeAgent(runId: string, action: 'accept' | 'dismiss' | 'undo', expectedRevision?: number): Promise<any> {
  const bridge = nativeBridge();
  if (!bridge?.requestCapability) throw new Error('Trace 桌宠尚未连接。');
  return bridge.requestCapability({ operation: 'agent.run.adoption', runId, action, ...(expectedRevision === undefined ? {} : { expectedRevision }) });
}

export async function readDesktopRuntimePanel(): Promise<any> {
  const bridge = nativeBridge();
  if (!bridge?.requestCapability) return null;
  return bridge.requestCapability({ operation: 'host.panel.read' });
}

export async function runDesktopRuntimeAction(action: string, payload: Record<string, unknown> = {}): Promise<any> {
  const bridge = nativeBridge();
  if (!bridge?.requestCapability) throw new Error('请先启动 Trace 桌面版。');
  return bridge.requestCapability({ operation: 'host.panel.action', action, ...payload });
}

export async function sendProductCommand(input: {
  commandId: string;
  expectedRevision: number;
  operations: unknown[];
}): Promise<any> {
  const bridge = nativeBridge();
  if (!bridge?.requestCapability) throw new Error('请先启动 Trace 桌面版。');
  return bridge.requestCapability({ operation: 'product.command', protocolVersion: 1, ...input });
}

export type NativeWorkEnvironment = {
  connected: boolean;
  projectName: string;
  agentLabel: string;
  locationLabel: string;
  projectBinding?: {
    status?: 'unbound' | 'candidate' | 'confirmed' | 'conflict-or-drift' | string;
    source?: string;
    sourceLabel?: string;
    projectId?: string | null;
    identityHint?: string | null;
    repositoryVerified?: boolean;
    diagnostic?: { code?: string; message?: string; action?: string } | null;
  };
};

export async function nativeWorkEnvironment(): Promise<NativeWorkEnvironment | null> {
  const bridge = nativeBridge();
  if (!bridge?.requestCapability) return null;
  return bridge.requestCapability({ operation: 'work.environment' });
}

export async function runNativeWork(input: {
  workId: string;
  matterId: string;
  title: string;
  text: string;
  role: 'reference' | 'trial';
  note?: string;
  source?: SearchSource | 'none';
  profileId?: string;
}): Promise<any> {
  const bridge = nativeBridge();
  if (!bridge?.requestCapability) throw new Error('请先启动 Trace 桌宠，再把这次工作交给本机 Codex。');
  return bridge.requestCapability({ operation: 'work.run', ...input });
}

export async function readNativeWork(workId: string): Promise<any> {
  const bridge = nativeBridge();
  if (!bridge?.requestCapability) return null;
  return bridge.requestCapability({ operation: 'work.read', workId });
}

export async function desktopSetupStatus(): Promise<any> {
  const bridge = nativeBridge();
  if (!bridge?.requestCapability) return null;
  return bridge.requestCapability({ operation: 'setup.status' });
}

export async function selectDesktopProject(): Promise<any> {
  const bridge = nativeBridge();
  if (!bridge?.requestCapability) return null;
  return bridge.requestCapability({ operation: 'work.project.select' });
}

/** Confirm the currently observed project candidate before any Codex work. */
export async function confirmDesktopProject(): Promise<any> {
  const bridge = nativeBridge();
  if (!bridge?.requestCapability) return null;
  return bridge.requestCapability({ operation: 'work.project.confirm' });
}

/** Persist an explicit Codex profile choice; array order is never a choice. */
export async function selectCodexProfile(profileId: string): Promise<any> {
  const bridge = nativeBridge();
  if (!bridge?.requestCapability) throw new Error('请先启动 Trace 桌面版。');
  return bridge.requestCapability({ operation: 'setup.codex.profile.select', profileId });
}

export async function checkCodexConnection(): Promise<any> {
  const bridge = nativeBridge();
  if (!bridge?.requestCapability) throw new Error('请先启动 Trace 桌面版。');
  return bridge.requestCapability({ operation: 'setup.codex.check' });
}

export async function connectTraceCodexPlugin(): Promise<any> {
  const bridge = nativeBridge();
  if (!bridge?.requestCapability) throw new Error('请先启动 Trace 桌面版。');
  return bridge.requestCapability({ operation: 'setup.codex.connect' });
}

export function hasNativeCapabilityBridge(): boolean { return Boolean(nativeBridge()?.requestCapability); }

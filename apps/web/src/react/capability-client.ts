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

export async function agentCapabilities(): Promise<any> {
  const bridge = nativeBridge();
  if (bridge?.requestCapability) return bridge.requestCapability({ operation: 'capabilities' });
  return { enabled: false, profiles: [], boundary: 'native-desktop-only' };
}

export async function runNativeAgent(input: { text: string; source: SearchSource | 'none'; profileId?: string }): Promise<any> {
  const bridge = nativeBridge();
  if (!bridge?.requestCapability) throw new Error('Codex 与自定义 Agent 需要由 Trace 桌宠连接本机 Runtime；网页不会暴露本机登录或密钥。');
  return bridge.requestCapability({ operation: 'agent.run', ...input });
}

export function hasNativeCapabilityBridge(): boolean { return Boolean(nativeBridge()?.requestCapability); }

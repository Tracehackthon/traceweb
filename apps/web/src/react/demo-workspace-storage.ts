const storage = {
  kind: 'memory',
  mode: 'complete-demo',
  location: '本次演示会话（刷新后重新生成，不会写入个人空间）',
};

let revision = 0;
let host: any = null;
const commands = new Map<string, { fingerprint: string; revision: number }>();

const clone = <T>(value: T): T => value === null ? value : structuredClone(value);
const stable = (value: any): string => Array.isArray(value)
  ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
    : JSON.stringify(value);

function failure(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

function snapshot(): Record<string, unknown> {
  return { revision, host: clone(host), storage };
}

/**
 * The published demo is a disposable, deterministic fixture. Keeping its
 * mutations in page memory makes it usable even when IndexedDB is disabled,
 * corrupt, blocked by another tab, or unavailable in a privacy context.
 * Personal `/app` content continues to use its separate durable adapter.
 */
export async function demoWorkspaceRequest(url: string, options: RequestInit = {}): Promise<Response> {
  const method = options.method || 'GET';
  if (url === '/api/web/workspace' && method === 'GET') return Response.json(snapshot());
  if (url === '/api/web/export' && method === 'GET') {
    return Response.json({ format: 'trace-web-export', schemaVersion: 1, exportedAt: new Date().toISOString(), ...snapshot() });
  }
  if (url !== '/api/web/workspace' || method !== 'PUT') return failure(404, 'NOT_FOUND', '不存在的演示会话操作。');

  let payload: any;
  try {
    payload = JSON.parse(String(options.body || ''));
  } catch {
    return failure(400, 'INVALID_COMMAND', '演示会话命令无法读取。');
  }
  if (!Number.isSafeInteger(payload?.expectedRevision) || payload.expectedRevision < 0
    || typeof payload.commandId !== 'string' || !payload.commandId || payload.commandId.length > 200
    || !payload.host || payload.host.schemaVersion !== 1) {
    return failure(400, 'INVALID_COMMAND', '演示会话命令不完整。');
  }

  const fingerprint = stable({ expectedRevision: payload.expectedRevision, host: payload.host });
  const known = commands.get(payload.commandId);
  if (known) {
    if (known.fingerprint !== fingerprint) return failure(409, 'COMMAND_REUSED', '同一演示命令包含不同内容。');
    return Response.json({ revision: known.revision, replayed: true, storage });
  }
  if (payload.expectedRevision !== revision) return failure(409, 'REVISION_CONFLICT', '演示页面已有更新，请重新打开。');

  revision += 1;
  host = clone(payload.host);
  commands.set(payload.commandId, { fingerprint, revision });
  return Response.json({ revision, replayed: false, storage });
}

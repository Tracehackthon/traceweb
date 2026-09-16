// Origin-scoped storage for the static deployment. Never fall back to an
// empty workspace after a read failure, and never report success before commit.
const DEMO_WORKSPACE = location.pathname === '/app/demo' || location.pathname.startsWith('/app/demo/');
const DATABASE = DEMO_WORKSPACE ? 'trace-web-complete-demo-v3' : 'trace-portal-workspace-v1';
const STORE = 'workspace';
const COMMANDS = 'commands';
const info = { kind: 'indexeddb', mode: DEMO_WORKSPACE ? 'complete-demo' : 'personal', location: DEMO_WORKSPACE ? '当前浏览器 · 独立演示空间（不会混入个人空间）' : '当前浏览器 · IndexedDB（仅当前网站，不跨设备同步）' };
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
function failure(status, code, message) { return Object.assign(new Error(message), { status, code }); }
function validateHost(host) {
  if (!host || host.schemaVersion !== 1 || host.chain?.schemaVersion !== 1 || host.worksite?.schemaVersion !== 1
    || !Array.isArray(host.chain.matters) || !Array.isArray(host.chain.sources) || !host.chain.sessions
    || !host.comparisons || !host.worksite.works || !host.worksite.sessions || !host.workGuards
    || host.chain.isDemo === true || host.worksite.isDemo === true) {
    throw failure(422, 'INVALID_HOST', '工作区结构或版本不正确，未覆盖已保存内容。');
  }
  // Builds before the canonical capture object existed stored the home draft
  // directly as a string. Preserve that text and repair the in-memory shape;
  // the next successful write commits the canonical representation.
  if (typeof host.chain.capture === 'string') {
    host.chain.capture = { text: host.chain.capture, sourceIds: [], excerpt: '', excerptSourceId: null };
  }
  const capture = host.chain.capture;
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)
    || typeof capture.text !== 'string' || !Array.isArray(capture.sourceIds)
    || typeof capture.excerpt !== 'string'
    || !(capture.excerptSourceId === null || typeof capture.excerptSourceId === 'string')) {
    throw failure(422, 'INVALID_HOST', '首页草稿结构不正确，未覆盖已保存内容。');
  }
}
function snapshot(record) {
  if (record === undefined) return { revision: 0, host: null, storage: info };
  if (!record || record.schemaVersion !== 1 || !Number.isSafeInteger(record.revision) || record.revision < 1) {
    throw failure(503, 'STORAGE_CORRUPT', '浏览器工作区版本异常，未重置数据。');
  }
  validateHost(record.host);
  return { revision: record.revision, host: record.host, storage: info };
}
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
      request.result.createObjectStore(COMMANDS);
    };
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(failure(503, 'STORAGE_BLOCKED', '请关闭此网站的其它标签页后重试，未重置数据。')); };
  });
}

export async function readBrowserWorkspace() {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get('current');
      tx.oncomplete = () => { try { resolve(snapshot(request.result)); } catch (error) { reject(error); } };
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function putBrowserWorkspace(payload) {
  if (!payload || !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0
    || typeof payload.commandId !== 'string' || !payload.commandId || payload.commandId.length > 200) {
    throw failure(400, 'INVALID_COMMAND', '保存命令不完整，未写入。');
  }
  const host = structuredClone(payload.host);
  validateHost(host);
  const bytes = new TextEncoder().encode(stable({ expectedRevision: payload.expectedRevision, host }));
  if (bytes.byteLength > 8 * 1024 * 1024) throw failure(413, 'BODY_TOO_LARGE', '工作区超过 8 MiB，请先导出备份。');
  // Finish async hashing before opening the IndexedDB transaction, otherwise
  // the browser may auto-commit it while the digest promise is pending.
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE, COMMANDS], 'readwrite');
      const workspaces = tx.objectStore(STORE), commands = tx.objectStore(COMMANDS);
      let result, error;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(error || tx.error || failure(503, 'STORAGE_FAILURE', '保存未完成，请重试或导出。'));
      const current = workspaces.get('current');
      current.onsuccess = () => {
        try {
          const saved = snapshot(current.result);
          const known = commands.get(payload.commandId);
          known.onsuccess = () => {
            try {
              if (known.result) {
                if (known.result.fingerprint !== fingerprint) throw failure(409, 'COMMAND_REUSED', '同一命令包含不同内容，未覆盖数据。');
                result = { revision: known.result.revision, replayed: true, storage: info };
                return;
              }
              if (saved.revision !== payload.expectedRevision) throw failure(409, 'REVISION_CONFLICT', '另一标签页已有更新，请先导出，再载入已保存版本。');
              const revision = saved.revision + 1;
              workspaces.put({ schemaVersion: 1, revision, host }, 'current');
              commands.put({ fingerprint, revision }, payload.commandId);
              result = { revision, replayed: false, storage: info };
            } catch (cause) { error = cause; tx.abort(); }
          };
        } catch (cause) { error = cause; tx.abort(); }
      };
    });
  } finally { db.close(); }
}

export async function browserWorkspaceRequest(url, options = {}) {
  try {
    const method = options.method || 'GET';
    let value;
    if (url === '/api/web/workspace' && method === 'GET') value = await readBrowserWorkspace();
    else if (url === '/api/web/workspace' && method === 'PUT') value = await putBrowserWorkspace(JSON.parse(options.body));
    else if (url === '/api/web/export' && method === 'GET') value = { format: 'trace-web-export', schemaVersion: 1, exportedAt: new Date().toISOString(), ...await readBrowserWorkspace() };
    else throw failure(404, 'NOT_FOUND', '不存在的浏览器存储操作。');
    return Response.json(value);
  } catch (error) {
    return Response.json({ error: { code: error?.code || 'STORAGE_FAILURE', message: error?.message || '浏览器存储不可用，请保留草稿并导出。' } }, { status: error?.status || 503 });
  }
}

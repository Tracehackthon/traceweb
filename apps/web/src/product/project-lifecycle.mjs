import { mark, icon } from '../home-icons.js';

const QUARANTINE_NAME = '.trace-lifecycle-quarantine';
const MAX_ENTRIES = 10_000;
const native = () => window.traceNative?.requestCapability;

function request(operation, payload = {}) {
  const invoke = native();
  if (!invoke) throw new Error('当前环境不支持桌面文件操作。');
  return invoke({ operation: `project.lifecycle.${operation}`, ...payload });
}

function openBrowserDb() {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('trace-project-library', 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error || new Error('无法打开浏览器项目目录。'));
  });
}

function transaction(db, stores, mode, callback) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const result = callback(tx);
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error || new Error('浏览器项目目录没有保存。'));
    tx.onabort = () => reject(tx.error || new Error('浏览器项目目录操作已取消。'));
  });
}

async function browserProjects() {
  const db = await openBrowserDb();
  try {
    const [projects, setting] = await new Promise((resolve, reject) => {
      const tx = db.transaction(['projects', 'settings'], 'readonly');
      const all = tx.objectStore('projects').getAll();
      const active = tx.objectStore('settings').get('activeProjectId');
      tx.oncomplete = () => resolve([all.result || [], active.result?.value || null]);
      tx.onerror = () => reject(tx.error || new Error('无法读取浏览器项目目录。'));
    });
    return { projects: projects.map(({ id, name }) => ({ id, name, available: true })), activeProjectId: setting, runtime: { state: 'unavailable', entries: [], warnings: [] } };
  } finally { db.close(); }
}

async function browserAddProject() {
  if (typeof window.showDirectoryPicker !== 'function') throw new Error('此浏览器不支持安全的目录授权；请在 Trace 桌面版管理项目文件。');
  const handle = await window.showDirectoryPicker({ mode: 'read' });
  if (!handle || handle.kind !== 'directory') throw new Error('没有选择项目目录。');
  const permission = await handle.queryPermission({ mode: 'read' });
  if (permission !== 'granted') {
    const granted = await handle.requestPermission({ mode: 'read' });
    if (granted !== 'granted') throw new Error('没有获得读取此项目目录的授权。');
  }
  const db = await openBrowserDb();
  try {
    const existing = await new Promise((resolve, reject) => {
      const tx = db.transaction('projects', 'readonly');
      const all = tx.objectStore('projects').getAll();
      tx.oncomplete = async () => {
        for (const record of all.result || []) {
          try { if (await record.handle.isSameEntry?.(handle)) return resolve(record); } catch { /* A stale handle is not the selected entry. */ }
        }
        resolve(null);
      };
      tx.onerror = () => reject(tx.error || new Error('无法检查已保存的项目目录。'));
    });
    if (existing) return { id: existing.id, name: existing.name, available: true };
    const record = { id: crypto.randomUUID(), name: handle.name || '未命名项目', handle, addedAt: new Date().toISOString() };
    await transaction(db, 'projects', 'readwrite', (tx) => tx.objectStore('projects').put(record));
    return { id: record.id, name: record.name, available: true };
  } finally { db.close(); }
}

async function browserSetActive(id) {
  const db = await openBrowserDb();
  try {
    const project = await new Promise((resolve, reject) => {
      const tx = db.transaction('projects', 'readonly');
      const get = tx.objectStore('projects').get(id);
      tx.oncomplete = () => resolve(get.result);
      tx.onerror = () => reject(tx.error || new Error('无法读取所选项目。'));
    });
    if (!project) throw new Error('所选项目不在浏览器项目库中。');
    await transaction(db, 'settings', 'readwrite', (tx) => tx.objectStore('settings').put({ key: 'activeProjectId', value: id }));
    return { activeProjectId: id };
  } finally { db.close(); }
}

function entryId(projectId, relativePath) {
  // Browser inventory IDs only need to be stable within this project/session.
  return `${projectId}:${relativePath}`;
}

function databaseFamily(relativePath) {
  const name = relativePath.split('/').at(-1) || '';
  const base = name.replace(/\.owner$/i, '').replace(/-(?:shm|wal)$/i, '');
  return /\.(?:sqlite|db)$/i.test(base);
}

function classify(relativePath, type) {
  const name = relativePath.split('/').at(-1) || '';
  if (type === 'symlink') return { lifecycle: 'review', category: 'symlink', reason: '浏览器目录接口无法核验符号链接目标；只读保留。' };
  if (relativePath === 'project.json') return { lifecycle: 'active', category: 'project-descriptor', reason: 'Trace 项目实例身份文件；保护。' };
  if (relativePath === 'state' && type === 'directory') return { lifecycle: 'retained', category: 'database-state-container', reason: '本地状态容器；保护其中的数据库及伴随文件。' };
  if (databaseFamily(relativePath)) return { lifecycle: 'retained', category: 'database-state', reason: '数据库及 WAL/SHM/owner 属于同一受保护状态家族。' };
  if (relativePath === 'project-adoptions' || relativePath.startsWith('project-adoptions/')) return { lifecycle: 'retained', category: 'adoption-history', reason: '项目能力采用历史；保留以支持来源核验与回滚。' };
  if (relativePath.includes('trace-project-workflow-fidelity-') && relativePath.includes('candidate-eval-project')) return { lifecycle: 'review', category: 'evaluation-fixture', reason: '评估项目夹具；可能存在内部引用，先核验再处置。' };
  if (/^trace-project-workflow-fidelity-\d{8}(?:-|\.json$)/.test(name)) return { lifecycle: 'review', category: 'evaluation-evidence', reason: '已识别为工作流评估证据；可能被任务引用，默认保留。' };
  return { lifecycle: 'review', category: 'unknown', reason: '用途或引用未被受管清单证明；默认保留。' };
}

async function inventoryBrowserProject(projectId) {
  const db = await openBrowserDb();
  let handle;
  try {
    const project = await new Promise((resolve, reject) => {
      const tx = db.transaction('projects', 'readonly');
      const get = tx.objectStore('projects').get(projectId);
      tx.oncomplete = () => resolve(get.result);
      tx.onerror = () => reject(tx.error || new Error('无法读取所选项目。'));
    });
    handle = project?.handle;
  } finally { db.close(); }
  if (!handle) throw new Error('此浏览器项目目录已不可用，请重新添加。');
  let permission = await handle.queryPermission({ mode: 'read' });
  if (permission !== 'granted') permission = await handle.requestPermission({ mode: 'read' });
  if (permission !== 'granted') throw new Error('需要重新授权读取此目录，未扫描任何内容。');

  let trace;
  try { trace = await handle.getDirectoryHandle('.trace'); }
  catch (error) {
    if (error?.name === 'NotFoundError') return { scope: 'project-trace', projectState: 'missing', complete: true, entries: [], warnings: [] };
    throw error;
  }
  let projectState = 'legacy-or-uninitialized';
  try { await trace.getFileHandle('project.json'); projectState = 'initialized'; } catch (error) { if (error?.name !== 'NotFoundError') projectState = 'blocked'; }
  const entries = [];
  const warnings = [];
  const pending = [{ handle: trace, relative: '' }];
  let complete = projectState !== 'blocked';
  while (pending.length) {
    const current = pending.pop();
    const children = [];
    try { for await (const [name, child] of current.handle.entries()) children.push([name, child]); }
    catch (error) { complete = false; warnings.push(`无法读取目录 ${current.relative || '.trace'}：${error.message}`); continue; }
    children.sort(([a], [b]) => a.localeCompare(b, 'en'));
    for (const [name, child] of children) {
      const relative = current.relative ? `${current.relative}/${name}` : name;
      if (relative === QUARANTINE_NAME || relative.startsWith(`${QUARANTINE_NAME}/`)) continue;
      if (entries.length >= MAX_ENTRIES) { complete = false; warnings.push(`超过条目上限 ${MAX_ENTRIES}；未扫描剩余路径。`); pending.length = 0; break; }
      const type = child.kind === 'directory' ? 'directory' : 'file';
      const details = classify(relative, type);
      let bytes = null;
      if (type === 'file') {
        try { bytes = (await child.getFile()).size; } catch (error) { complete = false; warnings.push(`无法读取条目 ${relative}：${error.message}`); }
      }
      entries.push({ id: entryId(projectId, relative), scope: 'project-trace', path: relative, type, bytes, ...details, allowedActions: ['inspect'] });
      if (type === 'directory') pending.push({ handle: child, relative });
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  warnings.push('网页模式只读；浏览器接口不提供隔离、恢复或永久清除。符号链接无法由此盘点器证明安全。');
  return { scope: 'project-trace', projectState, complete, entries, warnings };
}

const lifecycleLabels = { active: '当前受保护', retained: '明确保留', review: '待确认', quarantined: '隔离中', purgeable: '候选（需复核）' };
const html = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const bytesLabel = (value) => value == null ? '—' : value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;

export function mountProjectLifecycle({ root, onNavigate, onBack, onProfile }) {
  let projectState = { projects: [], activeProjectId: null, runtime: { state: 'unavailable', entries: [], warnings: [] } };
  let inventory = null;
  let quarantine = { entries: [], warnings: [] };
  let activeTab = 'inventory';
  let notice = '';
  let busy = false;

  root.innerHTML = `<section class="web-library trace-projects"><header class="web-header"><button class="web-brand" data-route="home" type="button" aria-label="Trace，返回首页"><span class="brand-tile">${mark}</span>Trace</button><nav aria-label="Trace 导航"><button data-route="matters" type="button">在意的事</button><button data-route="all" type="button">全部痕迹</button><button data-route="works" type="button">工作现场</button></nav></header><main class="web-library-main trace-projects-main"><div class="web-library-title"><div><h1>项目与文件<span>。</span></h1><p class="web-library-description">查看项目里的 Trace 文件；网页只读，桌面版可隔离与恢复。</p></div></div><section class="trace-projects-picker" aria-label="项目操作"><label for="trace-project-select">项目</label><select id="trace-project-select" aria-label="选择要管理的项目"></select><button class="web-shell-button" data-action="add" type="button">添加项目</button><button class="web-shell-button" data-action="activate" type="button" hidden>设为当前</button><button class="web-primary" data-action="scan" type="button" hidden>开始盘点</button></section><p class="trace-projects-boundary">范围仅限所选项目的 <code>.trace/</code>；数据库、采用历史和当前 Runtime 受保护。不会自动删除。</p><div class="web-filters" role="group" aria-label="文件生命周期视图"><button data-tab="inventory" aria-pressed="true" type="button">项目文件</button><button data-tab="quarantine" aria-pressed="false" type="button">隔离区</button></div><p class="trace-projects-notice" role="status" aria-live="polite" hidden></p><div class="trace-projects-content"></div><details class="trace-runtime-inventory"><summary>桌面 Runtime <span>受保护，不参与项目清理</span></summary><div class="trace-runtime-content"></div></details></main><button class="web-profile" data-action="profile" type="button" aria-label="个人与设置">${icon('user')}</button></section>`;

  const $ = (selector) => root.querySelector(selector);
  const currentProject = () => projectState.projects.find((item) => item.id === projectState.activeProjectId) || projectState.projects.find((item) => item.id === $('#trace-project-select')?.value) || null;
  const selectedProject = () => projectState.projects.find((item) => item.id === $('#trace-project-select')?.value) || null;

  function renderProjects() {
    const select = $('#trace-project-select');
    select.innerHTML = projectState.projects.length
      ? projectState.projects.map((project) => `<option value="${html(project.id)}" ${project.id === projectState.activeProjectId ? 'selected' : ''} ${project.available === false ? 'disabled' : ''}>${html(project.name)}${project.available === false ? ' · 不可访问' : ''}${project.id === projectState.activeProjectId ? ' · 当前' : ''}</option>`).join('')
      : '<option value="">尚未添加项目</option>';
    renderProjectActions();
  }

  function renderProjectActions() {
    const select = $('#trace-project-select');
    const activate = $('[data-action="activate"]');
    const scan = $('[data-action="scan"]');
    $('.web-filters').hidden = !select.value;
    activate.hidden = !select.value || select.value === projectState.activeProjectId;
    activate.disabled = !select.value || select.value === projectState.activeProjectId;
    scan.hidden = !select.value;
    scan.disabled = !select.value || busy;
    scan.textContent = busy ? '正在盘点…' : inventory ? '重新盘点' : '开始盘点';
  }

  function renderInventory() {
    const content = $('.trace-projects-content');
    if (activeTab === 'quarantine') {
      const entries = quarantine.entries || [];
      content.innerHTML = `<p class="trace-artifact-summary">隔离区 ${entries.length} 项 <span>· 可恢复；恢复时不会覆盖原位置已有内容</span></p>${entries.length ? `<div class="trace-artifact-list">${entries.map((item) => `<article class="trace-artifact-row" data-state="quarantined"><div class="trace-artifact-main"><div><strong>${html(item.name)}</strong><span class="trace-artifact-state">${html(lifecycleLabels.quarantined)}</span></div><p>.trace/${html(item.originalPath)} · ${bytesLabel(item.bytes)} · ${html(item.createdAt || '')}</p></div><div class="trace-artifact-actions"><button data-action="restore" data-id="${html(item.id)}" ${item.available === false ? 'disabled' : ''}>恢复</button><button class="danger" data-action="purge" data-id="${html(item.id)}" ${item.available === false ? 'disabled' : ''}>永久清除</button></div></article>`).join('')}</div>` : '<div class="trace-artifact-empty"><strong>隔离区为空</strong><p>只有逐项确认的普通文件会进入这里。</p></div>'}`;
      if (quarantine.warnings?.length) content.insertAdjacentHTML('beforeend', `<ul class="trace-artifact-warnings">${quarantine.warnings.map((warning) => `<li>${html(warning)}</li>`).join('')}</ul>`);
      return;
    }
    if (!selectedProject()) {
      content.innerHTML = '<div class="trace-artifact-empty"><strong>尚未选择项目</strong><p>从上方选择或添加项目；只会查看对应项目，不扫描整个磁盘。</p></div>';
      return;
    }
    if (!inventory) {
      content.innerHTML = `<div class="trace-artifact-empty"><strong>${busy ? '正在盘点…' : '尚未盘点'}</strong><p>只读取文件名与元数据，不打开数据库内容。</p></div>`;
      return;
    }
    const counts = inventory.entries.reduce((result, entry) => { result[entry.lifecycle] = (result[entry.lifecycle] || 0) + 1; return result; }, {});
    content.innerHTML = `<p class="trace-artifact-summary"><strong>${inventory.entries.length} 项</strong> <span>· ${inventory.projectState === 'initialized' ? 'Trace 实例已初始化' : inventory.projectState === 'missing' ? '.trace/ 尚不存在' : inventory.projectState === 'blocked' ? '目录受阻' : '.trace/ 存在，尚未确认实例初始化'} · ${inventory.complete ? '盘点完整' : '盘点不完整，处置已禁用'}</span></p>${inventory.entries.length ? `<div class="trace-artifact-list">${inventory.entries.map((entry) => `<article class="trace-artifact-row" data-state="${html(entry.lifecycle)}"><div class="trace-artifact-main"><div><strong>${html(entry.path)}</strong><span class="trace-artifact-state">${html(lifecycleLabels[entry.lifecycle] || '待确认')}</span></div><p>${html(entry.category)} · ${bytesLabel(entry.bytes)} · ${html(entry.reason)}</p>${entry.groupId ? `<small>保护组：${html(entry.groupId)}</small>` : ''}</div><div class="trace-artifact-actions">${entry.allowedActions?.includes('quarantine') && inventory.complete && native() ? `<button class="danger" data-action="quarantine" data-id="${html(entry.id)}">隔离</button>` : '<span class="trace-artifact-protected">只读</span>'}</div></article>`).join('')}</div>` : '<div class="trace-artifact-empty"><strong>没有发现 .trace 条目</strong><p>这不是删除信号；目录可能尚未初始化。</p></div>'}${inventory.warnings?.length ? `<ul class="trace-artifact-warnings">${inventory.warnings.map((warning) => `<li>${html(warning)}</li>`).join('')}</ul>` : ''}`;
  }

  function renderRuntime() {
    const content = $('.trace-runtime-content');
    const runtime = projectState.runtime || { state: 'unavailable', entries: [], warnings: [] };
    const item = runtime.entries?.[0];
    content.innerHTML = item
      ? `<article><strong>${html(item.path)}</strong><span class="trace-artifact-state">${html(lifecycleLabels[item.lifecycle] || '受保护')}</span><p>${html(item.reason)}</p></article>${runtime.warnings?.map((warning) => `<small>${html(warning)}</small>`).join('') || ''}`
      : `<p>${native() ? '当前桌面宿主没有提供可验证的 Runtime 清单；保持只读。' : '浏览器无法访问桌面安装目录。请在 Trace 桌面版查看当前 Runtime；网页不会触碰本机安装目录。'}</p>${runtime.warnings?.map((warning) => `<small>${html(warning)}</small>`).join('') || ''}`;
  }

  async function refreshProjects() {
    projectState = native() ? await request('projects.read') : await browserProjects();
    renderProjects(); renderRuntime();
    const current = currentProject();
    if (current && current.id !== selectedProject()?.id) $('#trace-project-select').value = current.id;
  }

  async function refreshInventory() {
    const project = selectedProject();
    if (!project) { inventory = null; renderInventory(); return; }
    busy = true; renderProjectActions(); renderInventory();
    try {
      inventory = native()
        ? await request('inventory', { projectId: project.id })
        : await inventoryBrowserProject(project.id);
      notice = inventory.complete ? '只读盘点完成；未移动、改写或删除任何文件。' : '盘点不完整；处置动作保持关闭。';
    } catch (error) { inventory = null; notice = error?.message || '盘点未完成。'; }
    finally { busy = false; renderProjectActions(); renderNotice(); renderInventory(); }
  }

  async function refreshQuarantine() {
    const project = selectedProject();
    quarantine = project && native() ? await request('quarantine.read', { projectId: project.id }) : { entries: [], warnings: [] };
    renderInventory();
  }

  function renderNotice() { $('.trace-projects-notice').textContent = notice; $('.trace-projects-notice').hidden = !notice; }
  function setTab(tab) {
    activeTab = tab;
    root.querySelectorAll('[data-tab]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.tab === tab)));
    if (tab === 'quarantine') void refreshQuarantine(); else renderInventory();
  }

  async function addProject() {
    const created = native() ? await request('project.add') : await browserAddProject();
    await refreshProjects();
    if (created?.id) $('#trace-project-select').value = created.id;
    renderProjectActions();
    inventory = null; notice = '项目已加入本机项目库；添加本身没有更改项目内容。'; renderNotice(); renderInventory();
  }

  async function activateProject() {
    const project = selectedProject();
    if (!project) return;
    if (native()) await request('project.activate', { projectId: project.id });
    else await browserSetActive(project.id);
    await refreshProjects();
    notice = `${project.name} 已设为当前项目。`; renderNotice();
  }

  async function quarantineEntry(id) {
    const project = selectedProject();
    const entry = inventory?.entries?.find((item) => item.id === id);
    if (!project || !entry) return;
    const ok = window.confirm(`将「${entry.path}」移入可恢复隔离区？\n\n这是待确认文件，可能仍被项目任务引用。隔离会移动单个文件，但可在恢复前检查；不会永久删除。`);
    if (!ok) return;
    busy = true; notice = '正在核验文件并隔离…'; renderNotice();
    try {
      await request('quarantine', { projectId: project.id, entryId: id });
      inventory = null; notice = '文件已进入可恢复隔离区。';
      if (activeTab === 'quarantine') await refreshQuarantine(); else await refreshInventory();
    } catch (error) { notice = error?.message || '未能隔离此文件。'; }
    finally { busy = false; renderNotice(); renderInventory(); }
  }

  async function restoreEntry(id) {
    const project = selectedProject();
    if (!project) return;
    try {
      await request('restore', { projectId: project.id, id });
      notice = '文件已恢复；原位置冲突会被拒绝覆盖。';
      await refreshQuarantine();
    } catch (error) { notice = error?.message || '未能恢复文件。'; }
    renderNotice();
  }

  async function purgeEntry(id) {
    const entry = quarantine.entries.find((item) => item.id === id);
    if (!entry || !selectedProject()) return;
    const ok = window.confirm(`永久清除「${entry.name}」？\n\n此操作不可撤销。Trace 桌面宿主还会再次要求确认。`);
    if (!ok) return;
    try {
      await request('purge', { projectId: selectedProject().id, id });
      notice = '已永久清除已确认的隔离文件。';
      await refreshQuarantine();
    } catch (error) { notice = error?.message || '未能永久清除。'; }
    renderNotice();
  }

  const click = async (event) => {
    const button = event.target.closest('button[data-action],button[data-tab],button[data-route]');
    if (!button || !root.contains(button) || button.disabled) return;
    try {
      if (button.dataset.route) { onNavigate?.({ view: button.dataset.route }); return; }
      if (button.dataset.tab) { setTab(button.dataset.tab); return; }
      switch (button.dataset.action) {
        case 'back': onBack?.(); break;
        case 'home': onBack?.(); break;
        case 'profile': onProfile?.(); break;
        case 'add': await addProject(); break;
        case 'activate': await activateProject(); break;
        case 'scan': await refreshInventory(); break;
        case 'quarantine': await quarantineEntry(button.dataset.id); break;
        case 'restore': await restoreEntry(button.dataset.id); break;
        case 'purge': await purgeEntry(button.dataset.id); break;
      }
    } catch (error) { notice = error?.message || '操作没有完成。'; renderNotice(); }
  };
  const change = () => { inventory = null; quarantine = { entries: [], warnings: [] }; renderProjectActions(); renderInventory(); };
  root.addEventListener('click', click);
  root.addEventListener('change', change);
  void refreshProjects().then(refreshInventory).catch((error) => { notice = error?.message || '无法载入本机项目库。'; renderNotice(); renderInventory(); });
  return { destroy() { root.removeEventListener('click', click); root.removeEventListener('change', change); root.replaceChildren(); }, update() {} };
}

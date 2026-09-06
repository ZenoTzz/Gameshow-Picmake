import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createCloudApi } from '../utils/cloudApi';
import './CloudSync.css';
import { normalizePosterTemplate } from '../utils/coreUtils.js';
import { createProjectFromTemplate } from '../utils/projectCreation.js';

// Compare immutable project snapshots once; large images should not be serialized every poll.
const fingerprints = new WeakMap();
function fingerprint(project) {
  if (fingerprints.has(project)) return fingerprints.get(project);
  const result = JSON.stringify(normalizePosterTemplate(project), (_, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
    }
    return value;
  });
  fingerprints.set(project, result);
  return result;
}

const SELECTED_PROJECT_KEY = 'gameshow-cloud-project-id';
function readDetached() {
  try { return localStorage.getItem('gameshow-cloud-detached') === 'true'; } catch { return false; }
}
async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function readSelectedProject() {
  try { return localStorage.getItem(SELECTED_PROJECT_KEY); } catch { return null; }
}

export function CloudSync({ poster, onLoad, onPreserve, onNewProject, controllerRef, onIdentityChange, hasLocalDraft = true, localIdentity, enabled = true, themes = {}, onWorkflowChange, onOpenEditor }) {
  const api = useRef(createCloudApi()).current;
  const current = useRef({ poster, onLoad, onPreserve, onNewProject, onIdentityChange, hasLocalDraft, localIdentity, enabled, themes, onWorkflowChange, onOpenEditor });
  current.current = { poster, onLoad, onPreserve, onNewProject, onIdentityChange, hasLocalDraft, localIdentity, enabled, themes, onWorkflowChange, onOpenEditor };
  const state = useRef({ generation: 0, busy: false, ready: false, baseline: '', revision: 0, pollAt: 0, changedAt: 0, activeId: null, activeName: localIdentity?.projectName || '', conflict: false, detached: readDetached(), createAttempt: null });
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState('正在连接云端…');
  const [error, setError] = useState('');
  const [remote, setRemote] = useState(null);
  const [view, setView] = useState(null);
  const dialogRef = useRef(null);
  const actions = useRef({});
  const pendingAction = useRef(null);
  const [createStep, setCreateStep] = useState(1);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [sharedTemplates, setSharedTemplates] = useState([]);
  const [sharedLoaded, setSharedLoaded] = useState(false);
  const [sharedLoading, setSharedLoading] = useState(false);
  const sharedBusy = useRef(false);
  const setOpen = (value) => { if (value) setView('conflict'); else setView(null); };
  useEffect(() => {
    const dialog = dialogRef.current;
    if (view && !dialog.open) dialog.showModal();
    else if (!view && dialog.open) dialog.close();
  }, [view]);

  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState(null);
  const [available, setAvailable] = useState(true);
  const [projects, setProjects] = useState([]);
  const [active, setActive] = useState(null);
  const [search, setSearch] = useState('');
  const [projectName, setProjectName] = useState(localIdentity?.projectName || '');
  const [rename, setRename] = useState('');
  const [checkpointName, setCheckpointName] = useState('');
  const [storage, setStorage] = useState(null);
  const [storageError, setStorageError] = useState(false);
  const [storageLoading, setStorageLoading] = useState(false);
  const storageBusy = useRef(false);
  useEffect(() => {
    current.current.onWorkflowChange?.({ status, busy, authenticated: !!session?.authenticated, activeName: state.current.activeName || localIdentity?.projectName || '', hasProject: !!active?.id });
  }, [status, busy, session, active, localIdentity?.projectName]);
  async function refreshStorage() {
    if (storageBusy.current) return;
    storageBusy.current = true; setStorageLoading(true);
    const generation = state.current.generation;
    try {
      const value = await api.storage();
      if (generation === state.current.generation) { setStorage(value); setStorageError(false); }
    } catch {
      if (generation === state.current.generation) setStorageError(true);
    } finally { storageBusy.current = false; setStorageLoading(false); }
  }
  function identity() { return { projectId: state.current.activeId, projectName: state.current.activeName || (!current.current.localIdentity?.projectId ? current.current.localIdentity?.projectName : null) || null }; }
  useLayoutEffect(() => {
    if (!controllerRef) return;
    const controller = {
      getIdentity: identity,
      isBusy: () => state.current.busy,
      showHistory: () => actions.current.showHistory(),
      showAccount: () => actions.current.showAccount(),
      startProject: () => actions.current.startProject(),
      saveProject: () => actions.current.saveProject(),
      detach() {
        const s = state.current;
        if (s.busy) return false;
        s.generation += 1; s.ready = false; s.detached = true; s.activeId = null; s.activeName = ''; s.baseline = ''; s.revision = 0; s.conflict = false;
        setActive(null); setRemote(null); setVersions(null); setProjectName(''); setStatus('本地独立草稿 · 尚未保存为云端项目');
        current.current.onIdentityChange?.(identity());
        try { localStorage.removeItem(SELECTED_PROJECT_KEY); localStorage.removeItem('gameshow-cloud-baseline'); localStorage.setItem('gameshow-cloud-detached', 'true'); } catch { /* Optional persistence. */ }
        return true;
      },
    };
    controllerRef.current = controller;
    return () => { if (controllerRef.current === controller) controllerRef.current = null; };
  }, [controllerRef]);
  async function persistBaseline(project, id, revision) {
    const generation = state.current.generation;
    const hash = await digest(fingerprint(project));
    if (generation !== state.current.generation || id !== state.current.activeId || revision !== state.current.revision) return;
    try { localStorage.setItem('gameshow-cloud-baseline', JSON.stringify({ id, revision, hash })); } catch { /* Optional persistence. */ }
  }
  useEffect(() => {
    const s = state.current;
    s.changedAt = Date.now();
    if (s.ready && fingerprint(poster) !== s.baseline) {
      setStatus(navigator.onLine ? '待同步' : '离线待同步');
    }
  }, [poster]);
  useEffect(() => {
    if (!session?.authenticated) return;
    const beforeUnload = (event) => {
      const s = state.current;
      if (s.busy || (s.ready && fingerprint(current.current.poster) !== s.baseline)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const connectionChanged = () => {
      const s = state.current;
      if (s.ready && fingerprint(current.current.poster) !== s.baseline) {
        setStatus(navigator.onLine ? '待同步' : '离线待同步');
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('online', connectionChanged);
    window.addEventListener('offline', connectionChanged);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('online', connectionChanged);
      window.removeEventListener('offline', connectionChanged);
    };
  }, [session?.authenticated]);

  function fail(err) {
    setError(err.message || '无法连接云端，请检查网络后重试。');
    setStatus('云端未同步');
    if (err.status === 401) {
      state.current.ready = false;
      setSession({ authenticated: false });
      setRemote(null); setView('login');
    }
  }
  async function run(operation) {
    const s = state.current;
    if (s.busy || !current.current.enabled) return;
    s.busy = true; setBusy(true); setError('');
    const generation = s.generation;
    const valid = () => generation === s.generation && current.current.enabled;
    try { await operation(valid); }
    catch (err) { if (valid()) fail(err); }
    finally { if (generation === s.generation) { s.busy = false; setBusy(false); } }
  }
  function rememberProject(envelope) {
    const previousId = state.current.activeId;
    const previousName = state.current.activeName;
    state.current.activeId = envelope.id;
    state.current.activeName = envelope.name || '';
    state.current.detached = false;
    current.current.onIdentityChange?.(identity());
    setActive({ id: envelope.id, name: envelope.name });
    setRename((value) => previousId !== envelope.id || value === previousName ? envelope.name || '' : value);
    try { localStorage.setItem(SELECTED_PROJECT_KEY, envelope.id); localStorage.removeItem('gameshow-cloud-detached'); } catch { /* Sync still works without storage. */ }
  }
  function updateProjectList(envelope, project) {
    setProjects((items) => {
      const previous = items.find((item) => item.id === envelope.id);
      const row = { ...previous, ...envelope, project: undefined,
        cardCount: project.games.length, theme: project.theme };
      return [row, ...items.filter((item) => item.id !== row.id)];
    });
  }
  async function reconcile(valid, id = state.current.activeId) {
    const before = current.current.poster;
    void refreshStorage();
    const listing = await api.projects();
    if (!valid()) return;
    setProjects(listing.projects);
    if (state.current.detached) { setStatus('本地独立草稿 · 尚未保存为云端项目'); return; }
    const selected = listing.projects.find((item) => item.id === (id || current.current.localIdentity?.projectId || readSelectedProject())) || listing.projects[0];
    if (!selected) {
      state.current.ready = false;
      setRemote(null); setStatus('本地草稿 · 尚未保存到服务器');
      return;
    }
    const envelope = await api.project(selected.id);
    if (!valid()) return;
    state.current.ready = false;
    if (envelope.project && !state.current.conflict && current.current.poster === before) {
      const project = await api.download(envelope);
      if (!valid()) return;
      if (current.current.poster !== before) { setRemote(envelope); setOpen(true); setStatus('请选择同步方式'); return; }
      let savedBaseline;
      try { savedBaseline = JSON.parse(localStorage.getItem('gameshow-cloud-baseline')); } catch { /* No baseline. */ }
      const hash = await digest(fingerprint(before));
      if (!valid()) return;
      if (current.current.poster !== before) { setRemote(envelope); setOpen(true); setStatus('请选择同步方式'); return; }
      const cleanLocal = current.current.localIdentity?.projectId === envelope.id && savedBaseline?.id === envelope.id && savedBaseline.hash === hash;
      if (!current.current.hasLocalDraft || cleanLocal || fingerprint(before) === fingerprint(project)) {
        await applyRemote(envelope, valid, { before, switching: true, downloaded: project });
        return;
      }
    }
    setRemote(envelope); setOpen(true);
    setStatus(envelope.project ? '请选择同步方式' : '云端尚无项目');
  }
  useEffect(() => {
    let alive = true;
    api.session().then((value) => {
      if (!alive) return;
      setSession(value); setAvailable(true);
      setStatus(value.authenticated ? '等待同步' : '未登录云端');
      if (value.authenticated) run(reconcile);
    }).catch(() => {
      if (alive) { setAvailable(false); setStatus('当前站点未启用云端'); }
    });
    return () => { alive = false; state.current.generation += 1; state.current.busy = false; state.current.ready = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (enabled && session?.authenticated && !state.current.ready && !remote && !state.current.detached) run(reconcile);
  }, [enabled, session]); // eslint-disable-line react-hooks/exhaustive-deps

  async function applyRemote(envelope, valid, { historical = false, switching = false, before = current.current.poster, downloaded } = {}) {
    const sourceId = state.current.activeId;
    const project = downloaded || await api.download(envelope);
    if (!valid() || !project || sourceId !== state.current.activeId) return false;
    if (current.current.poster !== before) throw new Error('下载期间本地内容已修改，请重新打开项目或同步。');
    await current.current.onPreserve(before, identity());
    if (!valid() || sourceId !== state.current.activeId) return false;
    if (current.current.poster !== before) throw new Error('备份期间本地内容已修改，请重新打开项目或同步。');
    if (!historical) {
      state.current.baseline = fingerprint(project);
      state.current.revision = envelope.revision;
      rememberProject(envelope);
      updateProjectList(envelope, project);
    }
    current.current.onLoad(project, { resetHistory: switching, ...identity(), revision: state.current.revision });
    state.current.ready = true;
    if (!historical) void persistBaseline(project, envelope.id, envelope.revision);
    state.current.conflict = false;
    if (switching) { setView(null); current.current.onOpenEditor?.(); }
    state.current.pollAt = Date.now();
    setRemote(null); setVersions(null);
    setStatus(historical ? '历史版本已载入，等待上传' : `已同步 · 版本 ${envelope.revision}`);
    return true;
  }
  async function upload(valid, revision = state.current.revision, name, targetId = state.current.activeId) {
    const snapshot = current.current.poster;
    const sourceId = state.current.activeId;
    const id = targetId;
    if (!id) throw new Error('请先为当前内容创建一个项目。');
    setStatus('正在上传云端…');
    try {
      const result = await api.upload(snapshot, revision, id, name);
      if (!valid() || state.current.activeId !== sourceId) return false;
      state.current.revision = result.revision;
      state.current.baseline = fingerprint(snapshot);
      state.current.ready = true;
      state.current.conflict = false;
      state.current.pollAt = Date.now();
      const envelope = { name: state.current.activeName, ...result, id, ...(name === undefined ? {} : { name }) };
      rememberProject(envelope);
      updateProjectList(envelope, snapshot);
      void persistBaseline(snapshot, id, result.revision);
      setRemote(null);
      setStatus(fingerprint(current.current.poster) === state.current.baseline
        ? `已同步 · 版本 ${result.revision}`
        : (navigator.onLine ? '待同步' : '离线待同步'));
      return true;
    } catch (err) {
      if (valid() && state.current.activeId === sourceId && err.status === 409) {
        state.current.ready = false;
        state.current.conflict = true;
        await reconcile(valid, id);
        setError('另一台设备已更新本项目。请选择保留哪个版本；不会自动覆盖。');
        return false;
      }
      throw err;
    }
  }
  async function flushBeforeSwitch(valid, allowConflictCopy = false) {
    if (state.current.conflict && !allowConflictCopy) throw new Error('请先解决当前项目冲突，或将当前内容另存为独立项目，再切换项目。');
    const before = current.current.poster;
    if (state.current.ready && fingerprint(before) !== state.current.baseline) {
      if (!await upload(valid)) return null;
    }
    if (!valid()) return null;
    if (current.current.poster !== before) throw new Error('保存期间本地内容已修改，请停止编辑后重新打开项目。');
    return before;
  }
  async function openProject(id, valid) {
    const before = await flushBeforeSwitch(valid);
    if (!before || !valid()) return;
    const sourceId = state.current.activeId;
    const envelope = await api.project(id);
    if (!valid() || state.current.activeId !== sourceId) return;
    await applyRemote(envelope, valid, { before, switching: true });
  }
  async function createProject(valid, blank, copying = false) {
    const name = projectName.trim();
    if (!name) throw new Error('请先填写新项目名称。');
    const before = blank ? await flushBeforeSwitch(valid) : current.current.poster;
    if (!before || !valid()) return;
    const sourceId = state.current.activeId;
    const project = blank
      ? (current.current.onNewProject?.() || { ...before, games: [] })
      : before;
    await current.current.onPreserve(before, identity());
    if (!valid() || sourceId !== state.current.activeId) return;
    if (current.current.poster !== before) throw new Error('备份期间本地内容已修改，请重新创建项目。');
    const key = `${name}\0${fingerprint(project)}`;
    if (state.current.createAttempt?.key !== key) state.current.createAttempt = { key, requestId: crypto.randomUUID() };
    const envelope = await api.create(project, name, state.current.createAttempt.requestId);
    if (!valid() || sourceId !== state.current.activeId) return;
    updateProjectList(envelope, project);
    if (current.current.poster !== before) throw new Error('项目已创建，但期间本地内容已修改。当前编辑保持不变，可在项目列表打开新项目。');
    rememberProject(envelope);
    state.current.baseline = fingerprint(project);
    state.current.revision = envelope.revision;
    state.current.ready = true;
    state.current.conflict = false;
    state.current.pollAt = Date.now();
    void persistBaseline(project, envelope.id, envelope.revision);
    if (blank || copying) current.current.onLoad(project, { resetHistory: true, ...identity(), revision: envelope.revision });
    state.current.createAttempt = null;
    setRemote(null); setVersions(null); setProjectName('');
    setStatus(`已同步 · 版本 ${envelope.revision}`);
    setView(null); if (blank || copying) current.current.onOpenEditor?.();
  }
  useEffect(() => {
    if (!enabled || !session?.authenticated) return;
    const timer = setInterval(() => {
      const s = state.current;
      if (!s.ready || s.busy || !navigator.onLine) return;
      const dirty = fingerprint(current.current.poster) !== s.baseline;
      if (dirty && Date.now() - s.changedAt > 1200) {
        // Back off on errors; keep local changes for the next attempt.
        if (Date.now() - s.pollAt < 3000) return;
        s.pollAt = Date.now();
        run((valid) => upload(valid));
      } else if (!dirty && Date.now() - s.pollAt > 15000) {
        s.pollAt = Date.now();
        run(async (valid) => {
          const envelope = await api.project(s.activeId);
          if (!valid() || envelope.revision === s.revision) return;
          if (fingerprint(current.current.poster) !== s.baseline) return;
          await applyRemote(envelope, valid);
        });
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [enabled, session]); // eslint-disable-line react-hooks/exhaustive-deps

  function requireLogin(action) {
    if (session?.authenticated) return false;
    pendingAction.current = action;
    setView('login');
    return true;
  }
  function showHistory() {
    if (requireLogin('history')) return;
    setSearch(''); setView('history');
    void run(async (valid) => { const result = await api.projects(); if (valid()) setProjects(result.projects); });
  }
  function startProject() {
    if (state.current.busy || !current.current.enabled) return;
    setProjectName(''); setCreateStep(1);
    setSelectedTemplate(`local:${current.current.poster.theme}`);
    setError(''); setView('create');
  }
  function saveProject() {
    if (state.current.busy || !current.current.enabled) return;
    if (requireLogin('save')) return;
    if (state.current.conflict || remote?.project) { setView('conflict'); return; }
    if (state.current.activeId && state.current.ready) {
      void run((valid) => upload(valid));
    } else {
      setProjectName(state.current.activeName || current.current.localIdentity?.projectName || projectName);
      setView('save');
    }
  }
  actions.current = { showHistory, startProject, saveProject, showAccount: () => { setView('account'); if (session?.authenticated) void refreshStorage(); } };
  async function loadSharedTemplates() {
    if (requireLogin('templates')) return;
    if (sharedBusy.current) return;
    sharedBusy.current = true; setSharedLoading(true); setError('');
    try {
      const result = await api.templates();
      setSharedTemplates(result.templates); setSharedLoaded(true);
    } catch (err) { fail(err); }
    finally { sharedBusy.current = false; setSharedLoading(false); }
  }
  async function beginDraft(valid) {
    const name = projectName.trim();
    if (!name) throw new Error('请填写项目名称。');
    const before = await flushBeforeSwitch(valid);
    if (!before || !valid()) return;
    const sourceId = state.current.activeId;
    let template = before;
    if (selectedTemplate.startsWith('shared:')) {
      template = await api.download(await api.template(selectedTemplate.slice(7)));
      if (!template) throw new Error('此模板暂时无法读取，请重新选择。');
    } else {
      const theme = selectedTemplate.slice(6);
      if (!current.current.themes[theme]) throw new Error('请选择一个模板。');
      template = { ...before, theme };
    }
    if (!valid() || sourceId !== state.current.activeId) return;
    const project = createProjectFromTemplate(template);
    await current.current.onPreserve(before, identity());
    if (!valid() || sourceId !== state.current.activeId) return;
    if (current.current.poster !== before) throw new Error('备份期间内容已修改，请重新创建。');
    const s = state.current;
    s.ready = false; s.detached = true; s.activeId = null; s.activeName = name; s.baseline = ''; s.revision = 0; s.conflict = false; s.createAttempt = null;
    try { localStorage.removeItem(SELECTED_PROJECT_KEY); localStorage.removeItem('gameshow-cloud-baseline'); localStorage.setItem('gameshow-cloud-detached', 'true'); } catch { /* Optional persistence. */ }
    setActive(null); setRemote(null); setVersions(null);
    current.current.onIdentityChange?.({ projectId: null, projectName: name });
    current.current.onLoad(project, { resetHistory: true, projectId: null, projectName: name });
    setStatus('本地草稿 · 点击保存项目存入服务器'); setView(null); current.current.onOpenEditor?.();
  }
  async function authenticate(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const form = event.currentTarget;
    await run(async (valid) => {
      const generation = state.current.generation;
      const result = await api.login(Object.fromEntries(data), session?.setupRequired);
      if (generation !== state.current.generation) return;
      form.reset(); setSession(result); setStatus('已登录 · 本地草稿已保留');
      if (!valid()) return;
      const intent = pendingAction.current; pendingAction.current = null;
      if (intent === 'save' && !state.current.activeId && (state.current.detached || !current.current.localIdentity?.projectId)) {
        setProjectName(state.current.activeName || current.current.localIdentity?.projectName || '');
        setView('save');
      } else if (intent === 'history') {
        const listing = await api.projects();
        if (valid()) { setProjects(listing.projects); setView('history'); }
      } else if (intent === 'templates') {
        const listing = await api.templates();
        if (valid()) { setSharedTemplates(listing.templates); setSharedLoaded(true); setView('create'); }
      } else await reconcile(valid);
    });
  }
  async function syncNow(valid) {
    if (!state.current.ready) return reconcile(valid);
    if (fingerprint(current.current.poster) !== state.current.baseline) return upload(valid);
    const id = state.current.activeId;
    const envelope = await api.project(id);
    if (!valid() || id !== state.current.activeId) return;
    if (envelope.revision !== state.current.revision) {
      if (fingerprint(current.current.poster) !== state.current.baseline) throw new Error('检查云端期间内容已修改，请重新同步。');
      await applyRemote(envelope, valid);
    } else setStatus(`已同步 · 版本 ${envelope.revision}`);
  }
  const disabled = busy || !enabled;
  const filteredProjects = projects.filter((item) => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const titles = { create: '创建项目', history: '服务器历史项目', save: '保存项目到服务器', copy: '复制为独立项目', current: '当前项目管理', conflict: '确认要继续编辑的版本', account: '账号与同步', login: '登录私人账号' };
  return <div className="cloud-sync-global">
    <dialog ref={dialogRef} className="cloud-dialog" aria-labelledby="cloud-dialog-title" onCancel={(event) => { if (busy) event.preventDefault(); else setView(null); }} onClose={() => setView(null)}>
      <header className="cloud-dialog-header"><div><small>展会制图 · 项目工作区</small><h2 id="cloud-dialog-title">{titles[view] || '项目与同步'}</h2></div><button type="button" aria-label="关闭项目窗口" disabled={busy} onClick={() => setView(null)}>关闭</button></header>
      <div className="cloud-panel">
        {view === 'create' && <>
          <ol className="cloud-steps"><li className={createStep === 1 ? 'active' : ''}>1 项目名称</li><li className={createStep === 2 ? 'active' : ''}>2 选择模板</li><li>3 开始编辑</li></ol>
          {createStep === 1 ? <form onSubmit={(event) => { event.preventDefault(); setCreateStep(2); }}>
            <label>项目名称<input autoFocus value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={100} placeholder="例如：2026 年 9 月 State of Play" required /></label>
            <p className="cloud-hint">项目保存这次活动的文字和图片。先选择模板并编辑，完成后点击顶部「保存项目」，即可在服务器历史项目中找到它。</p>
            <button className="cloud-primary" disabled={disabled || !projectName.trim()}>下一步：选择模板</button>
          </form> : <>
            <p>为「{projectName}」选择排版起点，新项目将从空白卡片列表开始。</p>
            <div className="cloud-template-grid">{Object.entries(themes).map(([id, theme]) => <button type="button" key={id} className={selectedTemplate === `local:${id}` ? 'selected' : ''} aria-pressed={selectedTemplate === `local:${id}`} onClick={() => setSelectedTemplate(`local:${id}`)} disabled={disabled}><span className="cloud-template-swatch" style={{ background: theme.bg }}><i style={{ background: theme.card, borderColor: theme.cardBorder || theme.line }} /></span><strong>{theme.label || id}</strong><small>{id.startsWith('custom_') ? '自定义模板' : '内置模板'}</small></button>)}</div>
            <div className="cloud-section-heading"><h3>服务器共享模板</h3><button disabled={disabled || sharedLoading} onClick={loadSharedTemplates}>{sharedLoading ? '读取中…' : sharedLoaded ? '刷新共享模板' : session?.authenticated ? '读取共享模板' : '登录并读取'}</button></div>
            {sharedLoaded && !sharedTemplates.length && <p className="cloud-hint">服务器还没有共享模板。可先选择内置模板。</p>}
            <div className="cloud-shared-templates">{sharedTemplates.map((item) => <button type="button" key={item.id} aria-pressed={selectedTemplate === `shared:${item.id}`} className={selectedTemplate === `shared:${item.id}` ? 'selected' : ''} onClick={() => setSelectedTemplate(`shared:${item.id}`)} disabled={disabled}>{item.name}</button>)}</div>
            <div className="cloud-actions"><button disabled={disabled} onClick={() => setCreateStep(1)}>上一步</button><button className="cloud-primary" disabled={disabled || !selectedTemplate} onClick={() => run(beginDraft)}>使用此模板，开始编辑</button></div>
            <p className="cloud-hint">开始编辑会先备份当前内容；新项目在首次保存前只保存在这台设备。</p>
          </>}
        </>}
        {(view === 'save' || view === 'copy') && <form onSubmit={(event) => { event.preventDefault(); void run((valid) => createProject(valid, false, view === 'copy')); }}>
          <label>{view === 'copy' ? '副本名称' : '项目名称'}<input autoFocus value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={100} required placeholder="为本次活动命名" /></label>
          <p>将当前的 {poster.games.length} 张卡片、文字、图片及排版完整保存到服务器历史项目。</p><p className="cloud-hint">首次保存后，后续编辑会自动同步。每个项目独立保存，也可以在项目管理中找回旧版本。</p>
          <button className="cloud-primary" disabled={disabled || !projectName.trim()}>{busy ? '正在保存…' : view === 'copy' ? '保存副本并继续编辑' : '保存项目到服务器'}</button>
        </form>}
        {view === 'history' && <>
          <p className="cloud-hint">这里是已保存到服务器的项目。打开后可继续修改，文字和图片会一起恢复。</p>
          <div className="cloud-search"><label>搜索历史项目<input autoFocus type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="按项目名称搜索" /></label><button disabled={disabled} onClick={() => run(async (valid) => { const result = await api.projects(); if (valid()) setProjects(result.projects); })}>刷新列表</button></div>
          <ul className="cloud-project-list">{filteredProjects.map((item) => <li key={item.id} className={item.id === active?.id ? 'current' : ''}><div><strong>{item.name}</strong>{item.id === active?.id && <span className="cloud-current-badge">当前项目</span>}<small>模板：{themes[item.theme]?.label || (item.theme?.startsWith('custom_') ? '自定义模板' : item.theme) || '自定义模板'} · {item.cardCount} 张卡片</small><small>最近保存：{new Date(item.updatedAt).toLocaleString()}</small></div><button disabled={disabled || state.current.conflict} onClick={() => item.id === active?.id && state.current.ready ? (setView(null), current.current.onOpenEditor?.()) : run((valid) => openProject(item.id, valid))}>{item.id === active?.id && state.current.ready ? '继续编辑' : '打开项目'}</button></li>)}</ul>
          {!filteredProjects.length && <div className="cloud-empty"><strong>{projects.length ? '没有匹配的项目' : '还没有保存到服务器的项目'}</strong><p>{projects.length ? '试试其他项目名称。' : '创建项目、选择模板并编辑后，点击顶部「保存项目」。'}</p></div>}
          <footer className="cloud-actions">{active && <button disabled={disabled} onClick={() => setView('current')}>管理当前项目</button>}<button disabled={disabled} onClick={() => setView('account')}>账号与同步状态</button></footer>
        </>}
        {view === 'conflict' && <>
          {remote?.project ? <div className="cloud-choice"><p>服务器项目「{remote.name}」有版本 {remote.revision}（{new Date(remote.updatedAt).toLocaleString()}）。当前本地内容与它不同，请选择继续使用的内容。</p><div className="cloud-actions"><button disabled={disabled} onClick={() => run((valid) => applyRemote(remote, valid, { switching: true }))}>打开服务器版本</button><button disabled={disabled} onClick={() => run((valid) => upload(valid, remote.revision, undefined, remote.id))}>用本地内容更新此项目</button><button disabled={disabled} onClick={() => { setProjectName(`${state.current.activeName || remote.name} 副本`); setView('copy'); }}>将本地内容另存为独立项目</button></div><small>打开前会先备份本地内容；更新服务器也会保留项目的旧版本。</small></div> : <><p>服务器尚无项目，当前内容仍保留在本地。</p><button disabled={disabled} onClick={() => { setProjectName(current.current.localIdentity?.projectName || ''); setView('save'); }}>保存当前项目到服务器</button></>}
        </>}
        {view === 'current' && <>
          <p>当前项目：<strong>{active?.name || state.current.activeName || '本地草稿'}</strong></p>
          {active && state.current.ready ? <>
            <div className="cloud-rename"><label>项目名称<input value={rename} onChange={(event) => setRename(event.target.value)} maxLength={100} /></label><button disabled={disabled || !rename.trim() || rename.trim() === active.name} onClick={() => run((valid) => upload(valid, state.current.revision, rename.trim()))}>保存名称</button></div>
            <div className="cloud-actions"><button disabled={disabled} onClick={() => { setProjectName(`${active.name} 副本`); setView('copy'); }}>复制为独立项目</button><button disabled={disabled} onClick={() => run(async (valid) => { const id = state.current.activeId; const result = await api.history(id); if (valid() && id === state.current.activeId) setVersions(result.versions); })}>查看本项目版本</button></div>
            <div className="cloud-checkpoint"><label>保存一个命名版本<input value={checkpointName} onChange={(event) => setCheckpointName(event.target.value)} maxLength={100} placeholder="例如：发布前定稿" /></label><button disabled={disabled || !checkpointName.trim()} onClick={() => run(async (valid) => {
              const before = await flushBeforeSwitch(valid); if (!before || !valid()) return;
              const id = state.current.activeId; await api.checkpoint(id, state.current.revision, checkpointName.trim());
              if (!valid() || id !== state.current.activeId) return;
              setCheckpointName(''); const result = await api.history(id); if (valid() && id === state.current.activeId) setVersions(result.versions);
            })}>保存版本</button></div>
            {versions && <div className="cloud-history"><h3>「{active.name}」的版本记录</h3><p className="cloud-hint">恢复前会备份当前内容，恢复结果作为新版本同步。</p>{!versions.length && <p>暂无历史版本。</p>}{versions.map((item) => <button key={item.revision} disabled={disabled || !state.current.ready} onClick={() => run(async (valid) => { const before = current.current.poster; const id = state.current.activeId; const envelope = await api.version(item.revision, id); if (valid() && id === state.current.activeId) await applyRemote(envelope, valid, { historical: true, before }); })}>{item.name ? `${item.name} · ` : ''}恢复版本 {item.revision} · {new Date(item.updatedAt).toLocaleString()}</button>)}</div>}
          </> : <button disabled={disabled} onClick={saveProject}>保存项目到服务器</button>}
          <button disabled={disabled} onClick={showHistory}>返回服务器历史项目</button>
        </>}
        {(view === 'account' || view === 'login') && <>
          {!available ? <><p>暂时无法连接同步服务，请检查网络。</p><button disabled={disabled} onClick={() => run(async (valid) => { const value = await api.session(); if (!valid()) return; setAvailable(true); setSession(value); setStatus(value.authenticated ? '等待同步' : '未登录服务器'); })}>重新连接</button></> : !session ? <p>正在检查账号…</p> : !session.authenticated ? <form onSubmit={authenticate} className="cloud-login"><p>登录后即可保存项目、访问服务器历史项目和共享模板。</p>{session.setupRequired && <label>一次性设置令牌<input name="setupToken" type="password" autoComplete="off" required /></label>}<label>用户名<input autoFocus name="username" autoComplete="username" required maxLength={64} /></label><label>密码<input name="password" type="password" autoComplete={session.setupRequired ? 'new-password' : 'current-password'} minLength={session.setupRequired ? 12 : undefined} required /></label><button className="cloud-primary" disabled={disabled}>{session.setupRequired ? '创建账号' : '登录并继续'}</button></form> : <>
            <p>已登录：{session.username}</p><p role="status">{status}</p><p className="cloud-hint">本地草稿自动保存。项目首次保存到服务器后，后续更改会自动同步。</p>
            <div className="cloud-storage"><span>{storage ? `服务器素材：${(storage.usedBytes / 1024 ** 2).toFixed(1)} MB / ${(storage.limitBytes / 1024 ** 3).toFixed(1)} GB` : '尚未读取素材用量'}{storageError ? ' · 读取失败' : ''}</span><button disabled={storageLoading || !enabled} onClick={() => void refreshStorage()}>{storageLoading ? '读取中…' : '刷新用量'}</button></div>
            <div className="cloud-actions"><button disabled={disabled} onClick={() => run(syncNow)}>立即同步 / 重试</button><button disabled={disabled} onClick={showHistory}>服务器历史项目</button><button disabled={disabled} onClick={() => run(async (valid) => {
              if (state.current.conflict) throw new Error('请先解决项目冲突，再退出登录。');
              if (state.current.ready && fingerprint(current.current.poster) !== state.current.baseline && !await upload(valid)) return;
              const generation = state.current.generation; await api.logout(); if (generation !== state.current.generation) return;
              state.current.ready = false; state.current.conflict = false; state.current.activeId = null; setActive(null); setProjects([]); setSession({ authenticated: false }); setRemote(null); setVersions(null); setSharedTemplates([]); setSharedLoaded(false); setStatus('未登录服务器'); setView('login');
            })}>退出登录</button></div>
          </>}
        </>}
        {error && <p className="cloud-error" role="alert">{error} 本地内容仍会自动保存。</p>}
        {busy && <p className="cloud-hint" role="status">正在处理，请稍候…</p>}
      </div>
    </dialog>
  </div>;
}

export default CloudSync;

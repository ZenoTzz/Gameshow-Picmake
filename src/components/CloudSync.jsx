import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createCloudApi } from '../utils/cloudApi';
import './CloudSync.css';
import { normalizePosterTemplate } from '../utils/coreUtils.js';

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

export function CloudSync({ poster, onLoad, onPreserve, onNewProject, controllerRef, onIdentityChange, hasLocalDraft = true, localIdentity, enabled = true }) {
  const api = useRef(createCloudApi()).current;
  const current = useRef({ poster, onLoad, onPreserve, onNewProject, onIdentityChange, hasLocalDraft, localIdentity, enabled });
  current.current = { poster, onLoad, onPreserve, onNewProject, onIdentityChange, hasLocalDraft, localIdentity, enabled };
  const state = useRef({ generation: 0, busy: false, ready: false, baseline: '', revision: 0, pollAt: 0, changedAt: 0, activeId: null, activeName: '', conflict: false, detached: readDetached(), createAttempt: null });
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState('正在连接云端…');
  const [error, setError] = useState('');
  const [remote, setRemote] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState(null);
  const [available, setAvailable] = useState(true);
  const [projects, setProjects] = useState([]);
  const [active, setActive] = useState(null);
  const [search, setSearch] = useState('');
  const [projectName, setProjectName] = useState('');
  const [rename, setRename] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [checkpointName, setCheckpointName] = useState('');
  const [storage, setStorage] = useState(null);
  const [storageError, setStorageError] = useState(false);
  const [storageLoading, setStorageLoading] = useState(false);
  const storageBusy = useRef(false);
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
  function identity() { return { projectId: state.current.activeId, projectName: state.current.activeName || null }; }
  useLayoutEffect(() => {
    if (!controllerRef) return;
    const controller = {
      getIdentity: identity,
      isBusy: () => state.current.busy,
      detach() {
        const s = state.current;
        if (s.busy) return false;
        s.generation += 1; s.ready = false; s.detached = true; s.activeId = null; s.activeName = ''; s.baseline = ''; s.revision = 0; s.conflict = false;
        setActive(null); setRemote(null); setVersions(null); setLibraryOpen(true); setStatus('本地独立草稿 · 尚未保存为云端项目');
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
      setRemote(null);
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
    const envelope = selected ? await api.project(selected.id) : { id: null, revision: 0, project: null };
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
    if (switching) setLibraryOpen(false);
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
      if (!state.current.ready) setLibraryOpen(false);
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
        setLibraryOpen(true);
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
  async function createProject(valid, blank) {
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
    setLibraryOpen(false);
    state.current.pollAt = Date.now();
    void persistBaseline(project, envelope.id, envelope.revision);
    current.current.onLoad(project, { resetHistory: true, ...identity(), revision: envelope.revision });
    state.current.createAttempt = null;
    setRemote(null); setVersions(null); setProjectName('');
    setStatus(`已同步 · 版本 ${envelope.revision}`);
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

  async function authenticate(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const form = event.currentTarget;
    await run(async (valid) => {
      const generation = state.current.generation;
      const result = await api.login(Object.fromEntries(data), session?.setupRequired);
      // Authentication changes the cookie even while an import temporarily pauses editing.
      if (generation !== state.current.generation) return;
      form.reset(); setSession(result); setStatus('等待同步');
      if (valid()) await reconcile(valid);
    });
  }

  return <section className="cloud-sync" aria-label="云端同步">
    <button type="button" className="cloud-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
      ☁ {active?.name ? `${active.name} · ` : ''}{status} <span>{open ? '收起' : '项目与同步'}</span>
    </button>
    {open && <div className="cloud-panel">
      <p>本地自动保存始终保留。登录后可同步卡片、图片和自定义模板。</p>
      {!available ? <><p>暂时无法连接同步服务。如果当前使用 GitHub Pages，请从私人网站打开编辑器。</p><button disabled={busy || !enabled} onClick={() => run(async (valid) => {
        const generation = state.current.generation;
        const value = await api.session();
        if (generation !== state.current.generation) return;
        setAvailable(true); setSession(value); setStatus(value.authenticated ? '等待同步' : '未登录云端');
        if (value.authenticated && valid()) await reconcile(valid);
      })}>重新连接</button></> : !session ? <p>正在检查账号…</p> : !session.authenticated ?
        <form onSubmit={authenticate} className="cloud-login">
          <strong>{session.setupRequired ? '首次创建私人账号' : '登录私人账号'}</strong>
          {session.setupRequired && <label>一次性设置令牌<input name="setupToken" type="password" autoComplete="off" required /></label>}
          <label>用户名<input name="username" autoComplete="username" required maxLength={64} /></label>
          <label>密码<input name="password" type="password" autoComplete={session.setupRequired ? 'new-password' : 'current-password'} minLength={session.setupRequired ? 12 : undefined} required /></label>
          <button disabled={busy || !enabled}>{session.setupRequired ? '创建账号' : '登录'}</button>
        </form> : <>
          <p>已登录：{session.username} · 当前项目：<strong>{active?.name || '尚未选择'}</strong></p>
          <div className="cloud-storage"><span>{storage ? `云端素材：${(storage.usedBytes / 1024 ** 2).toFixed(1)} MB / ${(storage.limitBytes / 1024 ** 3).toFixed(1)} GB` : '云端素材用量尚未读取'}{storageError ? ' · 读取失败，可重试' : ''}</span><button disabled={storageLoading || !enabled} onClick={() => void refreshStorage()}>{storageLoading ? '读取中…' : '刷新用量'}</button></div>
          {remote && <div className="cloud-choice">
            <p>{remote.project ? `「${remote.name}」有版本 ${remote.revision}（${new Date(remote.updatedAt).toLocaleString()}）。请选择要继续编辑的内容。` : '云端为空。填写项目名称后，将本地内容保存为第一个项目。'}</p>
            {remote.project && <>
              <button disabled={busy || !enabled} onClick={() => run((valid) => applyRemote(remote, valid, { switching: true }))}>使用云端内容（先备份本地）</button>
              <button disabled={busy || !enabled} onClick={() => run((valid) => upload(valid, remote.revision, undefined, remote.id))}>使用本地内容更新此项目</button>
              <small>也可在下方把本地内容复制为独立项目。更新云端会保留本项目版本；载入前先备份本地内容。</small>
            </>}
          </div>}
          <details className="cloud-library" open={libraryOpen} onToggle={(event) => setLibraryOpen(event.currentTarget.open)}>
            <summary>历史项目 · {projects.length}</summary>
            <div className="cloud-library-content">
            <p>每个项目保存一场活动的卡片、图片和排版，拥有独立的版本记录。模板用于复用样式。</p>
            <label>新项目名称<input value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={100} placeholder="例如：2026 年 9 月发布会" /></label>
            <div className="cloud-actions">
              <button disabled={busy || !enabled || state.current.conflict || !projectName.trim()} onClick={() => run((valid) => createProject(valid, true))}>新建空白项目</button>
              <button disabled={busy || !enabled || !projectName.trim()} onClick={() => run((valid) => createProject(valid, false))}>{projects.length ? (active ? '复制当前项目后编辑' : '将草稿保存为新项目') : '将当前内容保存为项目'}</button>
            </div>
            <small>空白项目沿用模板样式并清空卡片。复制会直接保存独立副本；此前已经自动同步的修改仍保留在原项目。</small>
            <label>搜索项目<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="按项目名称搜索" /></label>
            <button className="cloud-refresh" disabled={busy || !enabled} onClick={() => run(async (valid) => { void refreshStorage(); const result = await api.projects(); if (valid()) setProjects(result.projects); })}>刷新项目列表</button>
            <ul className="cloud-project-list">
              {projects.filter((item) => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((item) => <li key={item.id}>
                <div><strong>{item.name}{item.id === active?.id ? ' · 当前' : ''}</strong><small>{item.cardCount} 张卡片 · {new Date(item.updatedAt).toLocaleString()}</small></div>
                <button disabled={busy || !enabled || state.current.conflict || (item.id === active?.id && state.current.ready)} onClick={() => run((valid) => openProject(item.id, valid))}>打开</button>
              </li>)}
            </ul>
            {!projects.length && <p>尚无云端项目。</p>}
            {projects.length > 0 && !projects.some((item) => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && <p>没有匹配的项目。</p>}
            {active && state.current.ready && <div className="cloud-rename"><label>当前项目名称<input value={rename} onChange={(event) => setRename(event.target.value)} maxLength={100} /></label><button disabled={busy || !enabled || !rename.trim() || rename.trim() === active.name} onClick={() => run((valid) => upload(valid, state.current.revision, rename.trim()))}>保存名称</button></div>}
            </div>
          </details>
          <div className="cloud-actions">
            <button disabled={busy || !enabled} onClick={() => run(async (valid) => {
              if (!state.current.ready) return reconcile(valid);
              if (fingerprint(current.current.poster) !== state.current.baseline) return upload(valid);
              const id = state.current.activeId;
              const envelope = await api.project(id);
              if (!valid() || id !== state.current.activeId) return;
              if (envelope.revision !== state.current.revision) {
                if (fingerprint(current.current.poster) !== state.current.baseline) throw new Error('检查云端期间本地内容已修改，请重新同步。');
                await applyRemote(envelope, valid);
              } else setStatus(`已同步 · 版本 ${envelope.revision}`);
            })}>立即同步 / 重试</button>
            <button disabled={busy || !enabled || !active || !state.current.ready} onClick={() => run(async (valid) => { const id = state.current.activeId; const result = await api.history(id); if (valid() && id === state.current.activeId) setVersions(result.versions); })}>本项目版本</button>
            <button disabled={busy || !enabled} onClick={() => run(async (valid) => {
              if (state.current.ready && fingerprint(current.current.poster) !== state.current.baseline && !await upload(valid)) return;
              const generation = state.current.generation;
              await api.logout(); if (generation !== state.current.generation) return;
              state.current.ready = false; state.current.conflict = false; state.current.activeId = null; setActive(null); setProjects([]); setSession({ authenticated: false }); setRemote(null); setVersions(null); setStatus('未登录云端');
            })}>退出登录</button>
          </div>
          {active && state.current.ready && <div className="cloud-checkpoint"><label>版本名称<input value={checkpointName} onChange={(event) => setCheckpointName(event.target.value)} maxLength={100} placeholder="例如：发布前定稿" /></label><button disabled={busy || !enabled || !checkpointName.trim()} onClick={() => run(async (valid) => {
            const before = await flushBeforeSwitch(valid);
            if (!before || !valid()) return;
            const id = state.current.activeId;
            await api.checkpoint(id, state.current.revision, checkpointName.trim());
            if (!valid() || id !== state.current.activeId) return;
            setCheckpointName('');
            const result = await api.history(id);
            if (valid() && id === state.current.activeId) setVersions(result.versions);
          })}>保存命名版本</button></div>}
          {versions && <div className="cloud-history"><strong>「{active?.name}」的版本记录</strong><p>恢复后将作为本项目的新版本同步。当前本地内容会先备份。</p>{versions.length === 0 && <p>暂无历史版本。</p>}{versions.map((item) => <button key={item.revision} disabled={busy || !enabled || !state.current.ready} onClick={() => run(async (valid) => {
            const before = current.current.poster;
            const id = state.current.activeId;
            const envelope = await api.version(item.revision, id);
            if (valid() && id === state.current.activeId) await applyRemote(envelope, valid, { historical: true, before });
          })}>{item.name ? `${item.name} · ` : ''}恢复版本 {item.revision} · {new Date(item.updatedAt).toLocaleString()}</button>)}</div>}
        </>}
      {error && <p className="cloud-error" role="alert">{error} 本地内容仍会自动保存。</p>}
    </div>}
  </section>;
}

export default CloudSync;

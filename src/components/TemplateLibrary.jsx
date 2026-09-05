import { useRef, useState } from 'react';
import { createCloudApi } from '../utils/cloudApi.js';
import { applyTemplateSnapshot, buildTemplateSnapshot } from '../utils/templateLibrary.js';
import './TemplateLibrary.css';

export function TemplateLibrary({ poster, onApply, enabled = true }) {
  const api = useRef(createCloudApi()).current;
  const current = useRef({ poster, enabled, onApply });
  current.current = { poster, enabled, onApply };
  const lock = useRef(false);
  const pendingSave = useRef(null);
  const [items, setItems] = useState([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [message, setMessage] = useState('展开后连接共享模板库。');
  const [error, setError] = useState('');

  async function run(operation) {
    if (lock.current || !current.current.enabled) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const session = await api.session();
      setAuthenticated(Boolean(session.authenticated));
      if (!session.authenticated) {
        setItems([]);
        setMessage('请先在云端同步区域登录，然后刷新模板库。');
        return;
      }
      if (current.current.enabled) await operation();
    } catch (err) {
      if (err.status === 401) { setAuthenticated(false); setItems([]); }
      setError(err.status === 404 || err instanceof SyntaxError
        ? '共享模板库需要连接私人云端服务。请在部署了云端服务的网站使用。'
        : err.message || '模板库暂时无法连接，请重试。');
    } finally { lock.current = false; setBusy(false); }
  }

  async function list() {
    const result = await api.templates();
    setItems(result.templates || []);
    setMessage('这些模板可在登录后的其他设备使用。');
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed) { setError('请给模板起个名字。'); return; }
    const source = current.current.poster;
    if (!pendingSave.current || pendingSave.current.source !== source || pendingSave.current.name !== trimmed) {
      pendingSave.current = { source, name: trimmed, snapshot: buildTemplateSnapshot(source, trimmed), requestId: crypto.randomUUID() };
    }
    const pending = pendingSave.current;
    run(async () => {
      await api.saveTemplate(pending.snapshot, trimmed, pending.requestId);
      pendingSave.current = null;
      setName('');
      await list();
      setMessage(`“${trimmed}”已保存为独立模板。以后修改当前项目不会改变模板库。`);
    });
  }

  function apply(item) {
    const source = current.current.poster;
    run(async () => {
      const snapshot = await api.download(await api.template(item.id));
      if (!snapshot) throw new Error('此模板没有可用的样式。');
      if (!current.current.enabled || current.current.poster !== source) {
        throw new Error('项目在载入期间发生了变化，请重新点击应用模板。');
      }
      current.current.onApply(applyTemplateSnapshot(source, snapshot));
      setMessage(`已应用“${item.name}”的样式，卡片内容、标题和署名文字已保留。`);
    });
  }

  return (
    <details className="template-library" onToggle={(event) => { if (event.currentTarget.open) run(list); }}>
      <summary>共享模板库</summary>
      <p>跨项目、跨设备复用配色、排版、字体和 Logo。应用时保留当前项目的卡片内容、标题及署名文字。</p>
      <div className="template-library-actions">
        <button type="button" disabled={!enabled || busy} onClick={() => run(list)}>刷新模板库</button>
      </div>
      <p role="status" aria-live="polite">{busy ? '正在处理模板…' : message}</p>
      {error && <p className="template-library-error" role="alert">{error}</p>}
      {authenticated && <>
        <form className="template-library-save" onSubmit={(event) => { event.preventDefault(); save(); }}>
          <label>新模板名称<input value={name} maxLength={100} placeholder="例如：每周游戏资讯" disabled={busy || !enabled} onChange={(event) => setName(event.target.value)} /></label>
          <button type="submit" disabled={busy || !enabled || !name.trim()}>保存当前样式为新模板</button>
        </form>
        {items.length === 0 && !busy && <p>还没有共享模板。保存当前样式后，就能在其他项目中使用。</p>}
        <ul>{items.map((item) => <li key={item.id}>
          <span><strong>{item.name}</strong>{item.updatedAt && <small>{new Date(item.updatedAt).toLocaleString('zh-CN')}</small>}</span>
          <button type="button" disabled={busy || !enabled} onClick={() => apply(item)} aria-label={`应用模板：${item.name}`}>应用样式</button>
        </li>)}</ul>
      </>}
    </details>
  );
}

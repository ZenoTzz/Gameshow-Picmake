import { packProject, unpackProject, collectAssetIds, hashBlob } from './projectAssets.js';

export class CloudError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function createCloudApi() {
  let csrfToken = '';
  async function request(path, { method = 'GET', body, blob, csrfRetried = false } = {}) {
    const headers = {};
    if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (blob) headers['Content-Type'] = blob.type;
    const response = await fetch(`/api${path}`, {
      method, credentials: 'same-origin', headers,
      body: blob || (body !== undefined ? JSON.stringify(body) : undefined),
      signal: AbortSignal.timeout(60000), cache: 'no-store',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (response.status === 403 && !csrfRetried && error.error === '会话校验失败，请刷新重试') {
        await request('/session');
        return request(path, { method, body, blob, csrfRetried: true });
      }
      throw new CloudError(error.error || `云端请求失败 (${response.status})`, response.status);
    }
    if (path.startsWith('/assets/') && method === 'GET') return response.blob();
    const result = await response.json();
    if (result.csrfToken) csrfToken = result.csrfToken;
    return result;
  }
  const projectPath = (id) => id ? `/projects/${encodeURIComponent(id)}` : '/project';
  const historyPath = (id) => id ? `${projectPath(id)}/history` : '/history';
  async function prepare(input) {
    const { project, assets } = await packProject(input);
    const { missing } = await request('/assets/check', { method: 'POST', body: { ids: [...assets.keys()] } });
    for (const id of missing) {
      if (!assets.has(id)) throw new Error('云端返回了无效的素材请求。');
      await request(`/assets/${id}`, { method: 'PUT', blob: assets.get(id) });
    }
    return project;
  }
  return {
    session: () => request('/session'),
    login: (body, setup = false) => request(setup ? '/setup' : '/login', { method: 'POST', body }),
    logout: () => request('/logout', { method: 'POST', body: {} }),
    projects: () => request('/projects'),
    storage: () => request('/storage'),
    project: (id) => request(projectPath(id)),
    history: (id) => request(historyPath(id)),
    version: (revision, id) => request(`${historyPath(id)}/${revision}`),
    checkpoint: (id, revision, name) => request(`${projectPath(id)}/checkpoints`, { method: 'POST', body: { revision, name } }),
    templates: () => request('/templates'),
    template: (id) => request(`/templates/${encodeURIComponent(id)}`),
    async saveTemplate(input, name, requestId) {
      const project = await prepare({ ...input, games: [] });
      return request('/templates', { method: 'POST', body: { name, project, ...(requestId ? { requestId } : {}) } });
    },
    async create(input, name, requestId) {
      const project = await prepare(input);
      return request('/projects', { method: 'POST', body: { name, project, ...(requestId ? { requestId } : {}) } });
    },
    async download(envelope) {
      if (!envelope.project) return null;
      const assets = new Map();
      for (const id of collectAssetIds(envelope.project)) {
        const blob = await request(`/assets/${id}`);
        if (await hashBlob(blob) !== id) throw new Error('云端图片校验失败，请重试。');
        assets.set(id, blob);
      }
      return unpackProject(envelope.project, assets);
    },
    async upload(input, baseRevision, id, name) {
      const project = await prepare(input);
      return request(projectPath(id), { method: 'PUT', body: { project, baseRevision, ...(name === undefined ? {} : { name }) } });
    },
  };
}

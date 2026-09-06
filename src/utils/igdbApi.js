// Credentials stay on the server; this client uses the existing same-origin session.
export class IgdbError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
let csrfToken = '';
async function request(path, { signal, body, retried = false } = {}) {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 403 && !retried && result.error === '会话校验失败，请刷新重试') {
      await request('/session', { signal });
      return request(path, { signal, body, retried: true });
    }
    throw new IgdbError(response.status === 401 ? '登录网站后即可从 IGDB 选图。请先在云端同步中登录，再点击重试。'
      : response.status === 404 ? '当前站点尚未提供 IGDB 搜图，请使用已部署此功能的网站。'
        : result.error || `搜图请求失败（${response.status}），请稍后重试。`, response.status);
  }
  if (result.csrfToken) csrfToken = result.csrfToken;
  return result;
}
export const igdbApi = {
  status: (signal) => request('/igdb/status', { signal }),
  search: (query, signal) => request(`/igdb/search?q=${encodeURIComponent(query)}`, { signal }),
  images: (id, signal) => request(`/igdb/games/${encodeURIComponent(id)}/images`, { signal }),
  async importImage(gameId, image, signal) {
    if (!csrfToken) await request('/session', { signal });
    return request('/igdb/import', { signal, body: { gameId, imageId: image.id, kind: image.kind } });
  },
};

import { setTimeout as delay } from 'node:timers/promises';

const fail = (status, message) => Object.assign(new Error(message), { status });
const IMAGE_ID = /^[a-zA-Z0-9_]{1,100}$/;
const KINDS = ['screenshot', 'artwork', 'cover'];
const GAME_FIELDS = 'name,alternative_names.name,game_localizations.name,game_type.type,first_release_date,platforms.name,cover.image_id';
const IMAGE_FIELDS = 'image_id,width,height';
const imageUrl = (id, size) => `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg`;
const validId = (id) => Number.isSafeInteger(id) && id > 0;
const normalizedName = (value) => typeof value === 'string' ? value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '') : '';
function relevance(game, query) {
  const name = normalizedName(game.name);
  const aliases = [...(game.alternative_names || []), ...(game.game_localizations || [])].map((item) => normalizedName(item.name));
  const exact = name === query || aliases.includes(query);
  const type = normalizedName(game.game_type?.type);
  const unofficial = ['mod', 'fangame'].includes(type);
  const typeOrder = ['maingame', 'remake', 'remaster', 'port', 'standaloneexpansion', 'expansion', 'dlcaddon'].indexOf(type);
  const match = exact || name.startsWith(query) ? 0 : name.includes(query) ? 1 : aliases.some((alias) => alias.startsWith(query)) ? 2 : aliases.some((alias) => alias.includes(query)) ? 3 : 4;
  // Exact names (including translated ones) win. Otherwise keep official games
  // ahead of similarly named mods, retaining IGDB's order for equal relevance.
  return [exact ? 0 : 1, unofficial ? 1 : 0, match, typeOrder < 0 ? 7 : typeOrder];
}

// One service per application keeps credentials, token renewal, rate limiting and caches server-side.
export function createIGDB({ clientId, clientSecret, fetchImpl = globalThis.fetch, now = Date.now, sleep = delay, timeoutMs = 12000 } = {}) {
  const configured = Boolean(clientId?.trim() && clientSecret?.trim());
  let token = null, tokenPending = null, nextStart = 0, queued = 0, downloads = 0;
  let queue = Promise.resolve();
  const cache = new Map(), pending = new Map();
  function ready() { if (!configured) throw fail(503, '尚未配置 IGDB 图片服务，请在服务器配置 Client ID 和 Client Secret'); }
  async function bytes(response, limit) {
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw fail(413, 'IGDB 图片或响应超过大小限制'); }
    const chunks = []; let size = 0;
    if (!response.body) throw fail(502, 'IGDB 返回了空响应，请稍后重试');
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw fail(413, 'IGDB 图片或响应超过大小限制');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async function request(url, options, parse) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...options, redirect: 'error', signal: controller.signal });
      if (!response.ok) await response.body?.cancel();
      if (response.status === 429) throw fail(429, 'IGDB 请求过于频繁，请稍后重试');
      if (response.status === 401 || response.status === 403) throw fail(503, 'IGDB 凭据失效，请检查服务器配置');
      if (!response.ok) throw fail(502, 'IGDB 暂时无法提供图片，请稍后重试');
      return await parse(response);
    } catch (error) {
      if (error.status) throw error;
      throw fail(502, controller.signal.aborted ? 'IGDB 请求超时，请稍后重试' : '无法连接 IGDB 图片服务，请稍后重试');
    } finally { clearTimeout(timeout); }
  }
  const json = async (response) => JSON.parse((await bytes(response, 2 * 1024 ** 2)).toString('utf8'));
  async function accessToken() {
    ready();
    if (token && token.expires > now()) return token.value;
    if (!tokenPending) {
      tokenPending = request('https://id.twitch.tv/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }).toString(),
      }, json).then((result) => {
        if (typeof result.access_token !== 'string' || !result.access_token || !Number.isFinite(result.expires_in) || result.expires_in <= 0) throw fail(502, 'IGDB 认证响应无效');
        token = { value: result.access_token, expires: now() + Math.max(1, result.expires_in - Math.min(60, result.expires_in / 10)) * 1000 };
        return token.value;
      }).finally(() => { tokenPending = null; });
    }
    return tokenPending;
  }
  async function api(endpoint, query) {
    ready();
    if (queued >= 16) throw fail(429, '图片搜索请求较多，请稍后重试');
    queued++;
    const submitted = now();
    // Serialize requests: <= 4 starts per second, <= 1 open IGDB connection.
    const work = queue.then(async () => {
      if (now() - submitted > 15000) throw fail(429, '图片搜索繁忙，请稍后重试');
      for (let attempt = 0; attempt < 2; attempt++) {
        const access = await accessToken();
        await sleep(Math.max(0, nextStart - now()));
        nextStart = now() + 270;
        let unauthorized = false;
        const result = await request(`https://api.igdb.com/v4/${endpoint}`, {
          method: 'POST', headers: { 'Client-ID': clientId, Authorization: `Bearer ${access}`, 'Content-Type': 'text/plain', Accept: 'application/json' }, body: query,
        }, json).catch((error) => {
          if (error.status === 503 && attempt === 0) { if (token?.value === access) token = null; unauthorized = true; return null; }
          throw error;
        });
        if (unauthorized) continue;
        if (!Array.isArray(result)) throw fail(502, 'IGDB 数据格式无效，请稍后重试');
        return result;
      }
    }).finally(() => { queued--; });
    queue = work.catch(() => {});
    return work;
  }
  async function cached(key, operation) {
    ready();
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.value;
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 16) throw fail(429, '图片搜索请求较多，请稍后重试');
    const work = operation().then((value) => {
      cache.delete(key);
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(key, { value, expires: now() + 5 * 60000 });
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, work);
    return work;
  }
  function queryText(input) {
    if (typeof input !== 'string' || input.length > 120) throw fail(400, '游戏名称需要 1 至 120 个字符');
    // Quotes, escapes and control syntax never enter the Apicalypse string literal.
    const value = input.normalize('NFKC').replace(/[^\p{L}\p{M}\p{N}\s:’'&.!?+\-]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!value || !/[\p{L}\p{N}]/u.test(value)) throw fail(400, '请输入游戏名称');
    return value;
  }
  function gameSummary(game) {
    const date = Number.isFinite(game.first_release_date) ? new Date(game.first_release_date * 1000) : null;
    return { id: game.id, name: game.name, alternativeNames: [...new Set([...(game.alternative_names || []), ...(game.game_localizations || [])].map((item) => item.name).filter((name) => typeof name === 'string'))],
      year: date && Number.isFinite(date.getTime()) ? date.getUTCFullYear() : null,
      platforms: (game.platforms || []).map((item) => item.name).filter((name) => typeof name === 'string'),
      cover: IMAGE_ID.test(game.cover?.image_id || '') ? { imageId: game.cover.image_id, thumbnailUrl: imageUrl(game.cover.image_id, 'cover_small') } : null };
  }
  async function search(input) {
    ready(); const query = queryText(input);
    return cached(`search:${query.toLowerCase()}`, async () => {
      const games = await api('games', `search "${query}"; fields ${GAME_FIELDS}; limit 30;`);
      // IGDB's main search does not consistently index translated/alternative names.
      if (games.length < 5 || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query)) {
        const aliases = await api('alternative_names', `fields game; where name ~ *"${query}"*; limit 20;`);
        if (!aliases.length && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query)) {
          aliases.push(...await api('game_localizations', `fields game; where name ~ *"${query}"*; limit 20;`));
        }
        const ids = [...new Set(aliases.map((item) => item.game).filter(validId))].filter((id) => !games.some((game) => game.id === id));
        if (ids.length) games.push(...await api('games', `fields ${GAME_FIELDS}; where id = (${ids.join(',')}); limit 20;`));
      }
      const unique = [...new Map(games.filter((game) => validId(game.id) && typeof game.name === 'string').map((game) => [game.id, game])).values()];
      const normalizedQuery = normalizedName(query);
      const ranked = unique.map((game) => ({ game, rank: relevance(game, normalizedQuery) })).sort((a, b) => {
        for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i];
        return 0;
      });
      return { games: ranked.slice(0, 20).map(({ game }) => gameSummary(game)), query };
    });
  }
  async function images(gameId) {
    ready(); if (!validId(gameId)) throw fail(400, '游戏编号无效');
    return cached(`images:${gameId}`, async () => {
      const [game] = await api('games', `fields name,url,screenshots.${IMAGE_FIELDS.replaceAll(',', ',screenshots.')},artworks.${IMAGE_FIELDS.replaceAll(',', ',artworks.')},cover.${IMAGE_FIELDS.replaceAll(',', ',cover.')}; where id = ${gameId}; limit 1;`);
      if (!game || game.id !== gameId || typeof game.name !== 'string') throw fail(404, '未找到这个游戏');
      const results = [];
      for (const [kind, entries] of [['screenshot', game.screenshots || []], ['artwork', game.artworks || []], ['cover', game.cover ? [game.cover] : []]]) {
        for (const item of entries.slice(0, 100)) {
          if (!IMAGE_ID.test(item.image_id || '')) continue;
          results.push({ id: item.image_id, kind, width: Number.isSafeInteger(item.width) && item.width > 0 ? item.width : 0,
            height: Number.isSafeInteger(item.height) && item.height > 0 ? item.height : 0,
            thumbnailUrl: imageUrl(item.image_id, 'screenshot_med'), previewUrl: imageUrl(item.image_id, '1080p') });
        }
      }
      const url = typeof game.url === 'string' && /^https:\/\/www\.igdb\.com\/games\/[a-zA-Z0-9_\-/]+$/.test(game.url) ? game.url : `https://www.igdb.com/games/${gameId}`;
      return { game: { id: game.id, name: game.name, url }, images: results };
    });
  }
  async function importImage(input) {
    ready();
    if (!input || !validId(input.gameId) || typeof input.imageId !== 'string' || !IMAGE_ID.test(input.imageId) || !KINDS.includes(input.kind)) throw fail(400, '请选择有效的游戏图片');
    if (downloads >= 3) throw fail(429, '正在读取其他图片，请稍后重试');
    downloads++;
    try {
      const listing = await images(input.gameId);
      if (!listing.images.some((item) => item.id === input.imageId && item.kind === input.kind)) throw fail(400, '这张图片不属于所选游戏，请重新选择');
      const dataUrl = await request(imageUrl(input.imageId, '1080p'), { headers: { Accept: 'image/jpeg,image/png,image/webp' } }, async (response) => {
        const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) { await response.body?.cancel(); throw fail(502, 'IGDB 返回了不支持的图片格式'); }
        const data = await bytes(response, 20 * 1024 ** 2);
        const matches = mime === 'image/jpeg' ? data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
          : mime === 'image/png' ? data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && data.toString('ascii', 12, 16) === 'IHDR'
            : data.length >= 16 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
        if (!matches) throw fail(502, 'IGDB 图片内容无效，请选择其他图片');
        return `data:${mime};base64,${data.toString('base64')}`;
      });
      return { dataUrl, source: { provider: 'igdb', gameId: listing.game.id, gameName: listing.game.name, imageId: input.imageId, kind: input.kind, url: listing.game.url } };
    } finally { downloads--; }
  }
  return { configured, search, images, importImage };
}

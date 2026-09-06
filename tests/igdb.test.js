import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createIGDB } from '../server/igdb.js';
import { createApp } from '../server/app.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const games = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `Game ${i + 1}` }));
const details = { id: 1, name: 'Zelda', url: 'https://www.igdb.com/games/zelda',
  screenshots: [{ image_id: 'sc_test', width: 1920, height: 1080 }], artworks: [{ image_id: 'ar_test', width: 2000, height: 1000 }], cover: { image_id: 'co_test', width: 600, height: 900 } };
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9]);
function fixture(handler = () => json(games)) {
  let time = 100000, tokens = 0;
  const calls = [];
  const service = createIGDB({ clientId: 'test-client', clientSecret: 'test-secret', now: () => time, sleep: async (ms) => { time += ms; }, fetchImpl: async (url, options) => {
    calls.push({ url, options, time });
    if (url === 'https://id.twitch.tv/oauth2/token') { tokens++; return json({ access_token: `token-${tokens}`, expires_in: 100 }); }
    return handler(url, options, calls);
  } });
  return { service, calls, advance: (ms) => { time += ms; }, tokens: () => tokens };
}

test('IGDB configuration is optional and all unconfigured operations fail clearly', async () => {
  const service = createIGDB({ fetchImpl: () => { throw new Error('must not request'); } });
  assert.equal(service.configured, false);
  for (const work of [() => service.search('Zelda'), () => service.images(1), () => service.importImage({ gameId: 1, imageId: 'test', kind: 'cover' })]) {
    await assert.rejects(work, (error) => error.status === 503 && error.message.includes('尚未配置'));
  }
});

test('IGDB caches duplicate searches, shares token, spaces calls and refreshes before expiration', async () => {
  const f = fixture();
  const results = await Promise.all([f.service.search('Zelda'), f.service.search('Zelda'), f.service.search('Mario')]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(f.tokens(), 1);
  const apiCalls = f.calls.filter((call) => call.url.includes('/v4/'));
  assert.equal(apiCalls.length, 2); assert.ok(apiCalls[1].time - apiCalls[0].time >= 250);
  f.advance(91000); await f.service.search('Kirby'); assert.equal(f.tokens(), 2);
  assert.equal(f.calls[0].url.includes('test-secret'), false);
  assert.equal(new URLSearchParams(f.calls[0].options.body).get('grant_type'), 'client_credentials');
  assert.equal(JSON.stringify(results).includes('test-secret'), false);
});

test('IGDB renews revoked token once and reports upstream errors without leaking responses', async () => {
  let apiCalls = 0;
  const f = fixture(() => ++apiCalls === 1 ? json({ message: 'token-private-details' }, 401) : json(games));
  assert.equal((await f.service.search('Zelda')).games.length, 5);
  assert.equal(f.tokens(), 2);
  for (const [status, expected] of [[401, 503], [429, 429], [500, 502]]) {
    const bad = fixture(() => json({ message: 'private-secret' }, status));
    await assert.rejects(() => bad.service.search('game'), (error) => error.status === expected && !error.message.includes('private-secret'));
    assert.equal(bad.tokens(), status === 401 ? 2 : 1);
  }
  const broken = fixture(() => { throw new Error('secret in network error'); });
  await assert.rejects(() => broken.service.search('game'), (error) => error.status === 502 && !error.message.includes('secret'));
});

test('IGDB searches Chinese alternative/localized names and returns disambiguating metadata', async () => {
  for (const localizations of [false, true]) {
    const f = fixture((url, options) => {
      if (options.body.startsWith('search')) return json([]);
      if (url.endsWith('/alternative_names')) return json(localizations ? [] : [{ game: 1 }, { game: 'injection' }]);
      if (url.endsWith('/game_localizations')) return json([{ game: 1 }]);
      assert.match(options.body, /where id = \(1\);/);
      return json([{ id: 1, name: 'Zelda', alternative_names: [{ name: '塞尔达传说' }], game_localizations: [{ name: '薩爾達傳說' }], first_release_date: Date.UTC(2023, 4, 12) / 1000,
        platforms: [{ name: 'Nintendo Switch' }], cover: { image_id: 'co123' } }]);
    });
    const result = await f.service.search('塞尔达传说');
    assert.equal(result.games[0].year, 2023);
    assert.deepEqual(result.games[0].platforms, ['Nintendo Switch']);
    assert.deepEqual(result.games[0].alternativeNames, ['塞尔达传说', '薩爾達傳說']);
    assert.match(result.games[0].cover.thumbnailUrl, /^https:\/\/images\.igdb\.com\//);
    assert.equal(f.calls.length, localizations ? 5 : 4);
  }
});

test('IGDB rejects empty/oversized inputs and strips Apicalypse control characters', async () => {
  const f = fixture();
  for (const input of ['', ' '.repeat(4), null, 'x'.repeat(121), '";\\*']) await assert.rejects(() => f.service.search(input), { status: 400 });
  const result = await f.service.search('Zelda"; where id = 1; \\*');
  assert.equal(result.query, 'Zelda where id 1');
  const query = f.calls.find((call) => call.url.includes('/v4/')).options.body;
  assert.equal(query.split('"').length, 3);
  assert.equal(query.includes('where id = 1'), false);
});

test('IGDB ranks the exact official title before mods, DLC and partial names without hiding them', async () => {
  const candidates = [
    { id: 1, name: 'Super Mario Odyssey: F.L.U.D.D.', game_type: { type: 'Mod' } },
    { id: 2, name: 'Super Mario Odyssey 64', game_type: { type: 'Fan Game' } },
    { id: 3, name: "Super Mario Odyssey: Luigi’s Balloon World", game_type: { type: 'DLC Addon' } },
    { id: 4, name: 'SUPER MARIO: ODYSSEY', game_type: { type: 'Mod' } },
    { id: 5, name: 'Super Mario Odyssey', game_type: { type: 'Main Game' } },
    { id: 5, name: 'Super Mario Odyssey', game_type: { type: 'Main Game' } },
  ];
  const f = fixture((_url, options) => { assert.match(options.body, /game_type\.type/); return json(candidates); });
  const result = await f.service.search('ＳＵＰＥＲ　ＭＡＲＩＯ：ＯＤＹＳＳＥＹ');
  assert.equal(result.games[0].id, 5);
  assert.deepEqual(new Set(result.games.map((game) => game.id)), new Set([1, 2, 3, 4, 5]));
  assert.equal(result.games.length, 5);
  assert.ok(result.games.findIndex((game) => game.id === 3) < result.games.findIndex((game) => game.id === 1));
  assert.equal('game_type' in result.games[0], false);
});

test('IGDB ranks exact Chinese aliases/localizations first, then official main games for broad Chinese searches', async () => {
  const candidates = [
    { id: 1, name: 'Zelda Fan Game', alternative_names: [{ name: '塞尔达传说：旷野之息同人版' }], game_type: { type: 'Fan game' } },
    { id: 2, name: 'The Legend of Zelda: Expansion', alternative_names: [{ name: '塞尔达传说：旷野之息扩展包' }], game_type: { type: 'Expansion' } },
    { id: 3, name: 'The Legend of Zelda: Breath of the Wild', alternative_names: [{ name: '塞尔达传说：旷野之息' }], game_type: { type: 'MainGame' } },
    { id: 4, name: 'The Legend of Zelda: Remake', game_localizations: [{ name: '塞尔达传说：旷野之息' }], game_type: { type: 'Remake' } },
    { id: 5, name: 'Other game', game_type: { type: 'Main Game' } },
  ];
  const f = fixture((url) => url.endsWith('/games') ? json(candidates) : json([]));
  const exact = await f.service.search('塞尔达传说 旷野之息');
  assert.deepEqual(exact.games.slice(0, 2).map((game) => game.id), [3, 4]);
  const broad = await f.service.search('塞尔达传说');
  assert.deepEqual(broad.games.slice(0, 3).map((game) => game.id), [3, 4, 2]);
  assert.equal(broad.games.length, 5);
});

test('IGDB sorts before the response limit so an exact title late in upstream results remains selectable', async () => {
  const candidates = Array.from({ length: 24 }, (_, i) => ({ id: i + 1, name: `Super Mario Odyssey Mod ${i}`, game_type: { type: 'Mod' } }));
  candidates.push({ id: 99, name: 'Super Mario Odyssey', game_type: { type: 'Main Game' } });
  const f = fixture(() => json(candidates));
  const result = await f.service.search('Super Mario Odyssey');
  assert.equal(result.games[0].id, 99);
  assert.equal(result.games.length, 20);
});

test('IGDB lists screenshot/artwork/cover, validates ownership and only downloads fixed CDN paths', async () => {
  const f = fixture((url, options) => {
    if (url.includes('/v4/')) return json([details]);
    assert.equal(url, 'https://images.igdb.com/igdb/image/upload/t_1080p/sc_test.jpg');
    assert.equal(options.redirect, 'error');
    return new Response(jpeg, { headers: { 'Content-Type': 'image/jpeg' } });
  });
  const listing = await f.service.images(1);
  assert.deepEqual(listing.images.map((image) => image.kind), ['screenshot', 'artwork', 'cover']);
  for (const input of [
    { gameId: 1, imageId: 'other_game_image', kind: 'screenshot' },
    { gameId: 1, imageId: 'sc_test', kind: 'cover' },
    { gameId: 1, imageId: '../secret', kind: 'screenshot' },
    { gameId: '1', imageId: 'sc_test', kind: 'screenshot' },
  ]) await assert.rejects(() => f.service.importImage(input), { status: 400 });
  assert.equal(f.calls.filter((call) => call.url.includes('images.igdb.com')).length, 0);
  const imported = await f.service.importImage({ gameId: 1, imageId: 'sc_test', kind: 'screenshot', url: 'https://evil.test' });
  assert.equal(imported.dataUrl, `data:image/jpeg;base64,${jpeg.toString('base64')}`);
  assert.deepEqual(imported.source, { provider: 'igdb', gameId: 1, gameName: 'Zelda', imageId: 'sc_test', kind: 'screenshot', url: details.url });
  assert.equal(f.calls.filter((call) => call.url.includes('/v4/')).length, 1);
});

test('IGDB rejects oversized, spoofed or redirected image payloads and unsafe source links', async () => {
  for (const response of [
    () => new Response('bad', { headers: { 'Content-Type': 'image/jpeg' } }),
    () => new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
    () => new Response(jpeg, { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(20 * 1024 ** 2 + 1) } }),
    () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(20 * 1024 ** 2 + 1)); controller.close(); } }), { headers: { 'Content-Type': 'image/jpeg' } }),
    () => new Response('', { status: 302, headers: { Location: 'http://127.0.0.1/private' } }),
  ]) {
    const f = fixture((url) => url.includes('/v4/') ? json([{ ...details, url: 'javascript:alert(1)' }]) : response());
    assert.equal((await f.service.images(1)).game.url, 'https://www.igdb.com/games/1');
    await assert.rejects(() => f.service.importImage({ gameId: 1, imageId: 'sc_test', kind: 'screenshot' }), (error) => [413, 502].includes(error.status));
  }
});

test('IGDB bounds pending searches under rapid input', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const f = fixture(async () => { await gate; return json(games); });
  const requests = Array.from({ length: 16 }, (_, i) => f.service.search(`game${i}`));
  await assert.rejects(() => f.service.search('overflow'), { status: 429 });
  release(); await Promise.all(requests);
});

test('IGDB times out stalled response bodies and does not retain failed token requests', async () => {
  let attempts = 0;
  const service = createIGDB({ clientId: 'test-client', clientSecret: 'test-secret', timeoutMs: 10,
    fetchImpl: async (_url, { signal }) => {
      attempts++;
      return new Response(new ReadableStream({ start(controller) {
        signal.addEventListener('abort', () => controller.error(new Error('private transport detail')), { once: true });
      } }), { headers: { 'Content-Type': 'application/json' } });
    } });
  for (let retry = 0; retry < 2; retry++) await assert.rejects(() => service.search('Zelda'), (error) => error.status === 502 && error.message.includes('超时') && !error.message.includes('private'));
  assert.equal(attempts, 2);
});

test('IGDB HTTP endpoints require session, Origin and CSRF, and do not write project assets', async () => {
  for (const configured of [false, true]) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'picmake-igdb-'));
    const origin = 'https://pic.example.com';
    const app = await createApp({ dataDir: directory, origin, bootstrapToken: 'bootstrap', allowInsecureCookies: true,
      ...(configured ? { igdbClientId: 'test-client', igdbClientSecret: 'test-secret', igdbFetch: async (url) => url.includes('/oauth2/') ? json({ access_token: 'test-token', expires_in: 3600 }) : url.includes('/v4/') ? json([details]) : new Response(jpeg, { headers: { 'Content-Type': 'image/jpeg' } }) } : {}) });
    try {
      await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
      const base = `http://127.0.0.1:${app.server.address().port}`;
      for (const route of ['/api/igdb/status', '/api/igdb/search?q=Zelda', '/api/igdb/games/1/images']) assert.equal((await fetch(base + route)).status, 401);
      const setup = await fetch(base + '/api/setup', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'me', password: 'test-strong-password', setupToken: 'bootstrap' }) });
      assert.equal(setup.status, 200);
      const cookie = setup.headers.get('set-cookie').split(';')[0];
      const { csrfToken } = await setup.json();
      const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken };
      assert.deepEqual(await (await fetch(base + '/api/igdb/status', { headers })).json(), { configured });
      const input = JSON.stringify({ gameId: 1, imageId: 'sc_test', kind: 'screenshot' });
      for (const invalid of [{ ...headers, 'X-CSRF-Token': '' }, { ...headers, Origin: 'https://evil.test' }]) assert.equal((await fetch(base + '/api/igdb/import', { method: 'POST', headers: invalid, body: input })).status, 403);
      const result = await fetch(base + '/api/igdb/import', { method: 'POST', headers, body: input });
      assert.equal(result.status, configured ? 200 : 503);
      assert.equal(JSON.stringify(await result.json()).includes('test-secret'), false);
      const listing = await fetch(base + '/api/igdb/games/1/images', { headers }); assert.equal(listing.status, configured ? 200 : 503);
      assert.equal((await (await fetch(base + '/api/storage', { headers })).json()).usedBytes, 0);
    } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
  }
});

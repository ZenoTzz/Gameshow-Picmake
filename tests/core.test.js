import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePosterTemplate, getTemplateFields, githubRequest, waitForExportAssets } from '../src/utils/coreUtils.js';
import { paginateGames } from '../src/utils/paginate.js';

const game = (overrides = {}) => ({ title: '游戏', date: '待定', info: '', image: '', platforms: ['PC'], ...overrides });

test('normalization gives missing and duplicate IDs distinct identities that survive round-trip', () => {
  const original = { games: [game({ id: 'existing' }), game({ id: 'existing' }), game(), game({ id: '' })] };
  const normalized = normalizePosterTemplate(original);
  assert.equal(normalized.games[0].id, 'existing');
  assert.equal(new Set(normalized.games.map((entry) => entry.id)).size, 4);
  assert.ok(normalized.games.every((entry) => typeof entry.id === 'string' && entry.id));
  const restored = normalizePosterTemplate(JSON.parse(JSON.stringify(getTemplateFields(normalized))));
  assert.deepEqual(restored.games, normalized.games);
  assert.equal(original.games[1].id, 'existing');
  assert.equal(original.games[2].id, undefined);
});

test('normalization rejects malformed project fields instead of rendering invalid data', () => {
  const invalid = [null, [], 'text', { schemaVersion: 99 }, { games: {} }, { games: Array(1001).fill(game()) },
    { games: [null] }, { games: [game({ title: {} })] }, { theme: 12 }, { logoImages: [] },
    { logoImages: { stateOfPlay: 1 } }, { themeText: { stateOfPlay: { title: 1 } } },
    { customThemes: { custom_bad: { label: 123 } } }];
  for (const input of invalid) assert.throws(() => normalizePosterTemplate(input), Error, JSON.stringify(input)?.slice(0, 100));
  const normalized = normalizePosterTemplate({ games: [game()], theme: 'missing', infoFontSize: 1000, logoScales: { stateOfPlay: -5 } });
  assert.equal(normalized.theme, 'stateOfPlay');
  assert.equal(normalized.infoFontSize, 32);
  assert.equal(normalized.logoScales.stateOfPlay, 50);
});

test('custom theme definition and per-theme text survive portable template round-trip without registration', () => {
  const input = { games: [game()], theme: 'custom_portable',
    customThemes: { custom_portable: { label: '私人主题', bg: '#123456', cardBorderWidth: 6 } },
    themeText: { custom_portable: { title: '我的展会', eventLabel: '个人测试', subtitle: '' } },
    logoImages: { custom_portable: 'data:image/png;base64,aGVsbG8=' } };
  const normalized = normalizePosterTemplate(input);
  const exported = JSON.parse(JSON.stringify(getTemplateFields(normalized)));
  const restored = normalizePosterTemplate(exported);
  assert.equal(exported.schemaVersion, 2);
  assert.equal(restored.theme, 'custom_portable');
  assert.deepEqual(restored.customThemes, normalized.customThemes);
  assert.deepEqual(restored.themeText.custom_portable, input.themeText.custom_portable);
  assert.deepEqual(restored.logoImages, input.logoImages);
  assert.equal(restored.customThemes.custom_portable.cardBorderWidth, 6);
});

test('GitHub missing read is recoverable but missing write is an error', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
  });
  assert.deepEqual(await githubRequest('/repos/test/missing', 'test-token'), { ok: false, status: 404 });
  assert.deepEqual(await githubRequest('/repos/test/missing', 'test-token', { method: 'GET' }), { ok: false, status: 404 });
  await assert.rejects(githubRequest('/repos/test/missing', 'test-token', { method: 'PUT', body: '{}' }), /Not Found/);
  assert.equal(calls[2].options.method, 'PUT');
});

class FakeImage extends EventTarget {
  constructor(complete = false, naturalWidth = 0) { super(); this.complete = complete; this.naturalWidth = naturalWidth; this.listeners = new Set(); }
  addEventListener(type, fn, options) { this.listeners.add(fn); super.addEventListener(type, fn, options); }
  removeEventListener(type, fn, options) { this.listeners.delete(fn); super.removeEventListener(type, fn, options); }
}
const root = (...images) => ({ querySelectorAll: () => images });
function mockDocument(t, ready = Promise.resolve()) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { fonts: { ready } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
}

test('export rejects an already failed image immediately and removes listeners', async (t) => {
  mockDocument(t);
  const image = new FakeImage(true, 0);
  await assert.rejects(waitForExportAssets(root(image), 30), /图片加载失败/);
  assert.equal(image.listeners.size, 0);
});

test('export handles successful cached images and asynchronously loaded images', async (t) => {
  mockDocument(t);
  const cached = new FakeImage(true, 100);
  const pending = new FakeImage();
  const wait = waitForExportAssets(root(cached, pending), 100);
  await new Promise((resolve) => setImmediate(resolve));
  pending.naturalWidth = 100;
  pending.dispatchEvent(new Event('load'));
  await wait;
  assert.equal(cached.listeners.size, 0);
  assert.equal(pending.listeners.size, 0);
});

test('export rejects an error event and a stalled image with bounded waits', async (t) => {
  mockDocument(t);
  const failed = new FakeImage();
  const wait = waitForExportAssets(root(failed), 100);
  await new Promise((resolve) => setImmediate(resolve));
  failed.dispatchEvent(new Event('error'));
  await assert.rejects(wait, /图片加载失败/);
  assert.equal(failed.listeners.size, 0);
  const stalled = new FakeImage();
  await assert.rejects(waitForExportAssets(root(stalled), 10), /图片加载超时/);
  assert.equal(stalled.listeners.size, 0);
});

test('export font loading also has a timeout', async (t) => {
  mockDocument(t, new Promise(() => {}));
  await assert.rejects(waitForExportAssets(root(), 10), /字体加载超时/);
});

test('pagination subtracts list padding and includes inter-card gap at first-page boundary', () => {
  const games = [game({ id: 'a' }), game({ id: 'b' })];
  // List height is 1540 with 16 px top / 8 px bottom padding: 1516 available.
  assert.deepEqual(paginateGames(games, [754, 754]).map((page) => page.length), [2]);
  assert.deepEqual(paginateGames(games, [754, 755]).map((page) => page.length), [1, 1]);
  assert.deepEqual(paginateGames(games, [754.1, 754]).map((page) => page.length), [1, 1]);
});

test('compact follow-up pages subtract padding and keep game order at boundary', () => {
  const games = ['a', 'b', 'c'].map((id) => game({ id }));
  // Follow-up list height is 1836 minus 24 px padding: 1812 available.
  assert.deepEqual(paginateGames(games, [100, 902, 902], { compactFollowupPages: true, firstPageMax: 1 }).map((page) => page.map((entry) => entry.id)), [['a'], ['b', 'c']]);
  assert.deepEqual(paginateGames(games, [100, 902, 903], { compactFollowupPages: true, firstPageMax: 1 }).map((page) => page.map((entry) => entry.id)), [['a'], ['b'], ['c']]);
});


test('a large saved project can be restored and export waits can be cancelled', async (t) => {
  const { packProject, unpackProject } = await import('../src/utils/projectAssets.js');
  const packed = await packProject(normalizePosterTemplate({ games: Array.from({ length: 501 }, () => game()) }));
  assert.equal(normalizePosterTemplate(await unpackProject(packed.project, packed.assets)).games.length, 501);
  const previous = globalThis.document;
  globalThis.document = { fonts: { ready: Promise.resolve() } };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const image = new FakeImage();
  const controller = new AbortController();
  const waiting = waitForExportAssets(root(image), 15000, controller.signal);
  controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(image.listeners.size, 0);
});


test('removing all platform tags survives project serialization and reload', () => {
  const project = normalizePosterTemplate({ games: [game({ platforms: [] })] });
  const restored = normalizePosterTemplate(JSON.parse(JSON.stringify(getTemplateFields(project))));
  assert.deepEqual(restored.games[0].platforms, []);
});

test('card metadata visibility defaults on for legacy cards and rejects invalid flags', () => {
  const restored = normalizePosterTemplate({ games: [game()] });
  assert.equal(restored.games[0].showDate, true);
  assert.equal(restored.games[0].showPlatforms, true);
  for (const key of ['showDate', 'showPlatforms']) {
    assert.throws(() => normalizePosterTemplate({ games: [game({ [key]: 'false' })] }), /开关值/);
  }
});

test('individual visibility switches and hidden values survive template and ZIP round-trips', async () => {
  const { exportProjectBackup, importProjectBackup } = await import('../src/utils/projectBackup.js');
  const cards = [true, false].flatMap(showDate => [true, false].map(showPlatforms => game({ showDate, showPlatforms, date: '2026-09-20', platforms: ['PC', 'PS5'] })));
  const project = normalizePosterTemplate({ games: cards });
  const template = normalizePosterTemplate(JSON.parse(JSON.stringify(getTemplateFields(project))));
  const backup = normalizePosterTemplate(await importProjectBackup(await exportProjectBackup(project)));
  assert.deepEqual(template.games, project.games);
  assert.deepEqual(backup.games, project.games);
});

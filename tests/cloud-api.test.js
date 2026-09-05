import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudApi, CloudError } from '../src/utils/cloudApi.js';
import { hashBlob } from '../src/utils/projectAssets.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('cloud upload sends checked assets before project with its known revision and CSRF', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push({ path, options });
    if (path === '/api/session') return json({ authenticated: true, csrfToken: 'csrf-test' });
    if (path === '/api/assets/check') return json({ missing: JSON.parse(options.body).ids });
    return json(path === '/api/project' ? { revision: 8 } : { id: path.split('/').at(-1) });
  });
  const api = createCloudApi();
  await api.session();
  const result = await api.upload({ theme: 'stateOfPlay', games: [{ title: 'Test', image: 'data:image/png;base64,AQID' }] }, 7);
  assert.equal(result.revision, 8);
  assert.equal(calls[1].path, '/api/assets/check');
  assert.match(calls[2].path, /^\/api\/assets\/[a-f0-9]{64}$/);
  assert.equal(calls[2].options.body.type, 'image/png');
  assert.equal(calls[3].path, '/api/project');
  const body = JSON.parse(calls[3].options.body);
  assert.equal(body.baseRevision, 7);
  assert.equal(typeof body.project.games[0].image.$asset, 'string');
  assert.equal(calls[3].options.headers['X-CSRF-Token'], 'csrf-test');
});

test('cloud conflicts retain HTTP status for explicit reconciliation', async (t) => {
  t.mock.method(globalThis, 'fetch', async (path) => path === '/api/assets/check'
    ? json({ missing: [] }) : json({ error: 'conflict', revision: 9 }, 409));
  await assert.rejects(createCloudApi().upload({ theme: 'stateOfPlay', games: [] }, 7),
    (error) => error instanceof CloudError && error.status === 409);
});

test('cloud download rejects corrupted bytes and restores verified image data', async (t) => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  const id = await hashBlob(blob);
  const envelope = { revision: 2, project: { theme: 'stateOfPlay', games: [{ title: 'Test', image: { $asset: id } }] } };
  let corrupt = true;
  t.mock.method(globalThis, 'fetch', async () => new Response(corrupt ? new Uint8Array([9]) : blob, { headers: { 'Content-Type': 'image/png' } }));
  const api = createCloudApi();
  await assert.rejects(api.download(envelope), /校验失败/);
  corrupt = false;
  assert.equal((await api.download(envelope)).games[0].image, 'data:image/png;base64,AQID');
});

test('named projects keep reads, writes and history scoped to their own IDs', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push({ path, options });
    return json(path === '/api/assets/check' ? { missing: [] } : { revision: 4, projects: [] });
  });
  const api = createCloudApi();
  await api.projects();
  await api.project('project-a');
  await api.upload({ theme: 'stateOfPlay', games: [] }, 3, 'project-b', 'Renamed project');
  await api.history('project-a');
  await api.version(2, 'project-b');
  assert.deepEqual(calls.map((call) => call.path), [
    '/api/projects', '/api/projects/project-a', '/api/assets/check', '/api/projects/project-b',
    '/api/projects/project-a/history', '/api/projects/project-b/history/2',
  ]);
  assert.deepEqual(JSON.parse(calls[3].options.body), {
    project: { theme: 'stateOfPlay', games: [], schemaVersion: 2, customThemes: {} },
    baseRevision: 3, name: 'Renamed project',
  });
});

test('new project creates packed content without writing any existing project', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push({ path, options });
    return json(path === '/api/assets/check' ? { missing: [] } : { id: 'new-project', name: 'New', revision: 1 });
  });
  const result = await createCloudApi().create({ theme: 'stateOfPlay', games: [{ title: 'Copied card' }] }, 'New');
  assert.equal(result.id, 'new-project');
  assert.equal(calls.at(-1).path, '/api/projects');
  assert.equal(calls.at(-1).options.method, 'POST');
  const body = JSON.parse(calls.at(-1).options.body);
  assert.equal(body.name, 'New');
  assert.equal(body.project.games[0].title, 'Copied card');
  assert.equal(Object.hasOwn(body, 'baseRevision'), false);
});

test('CSRF mismatch refreshes once and retries with the new token', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push({ path, options });
    if (path === '/api/session') return json({ authenticated: true, csrfToken: 'renewed' });
    if (calls.length === 1) return json({ error: '会话校验失败，请刷新重试' }, 403);
    return json({ ok: true });
  });
  await createCloudApi().checkpoint('alpha', 4, 'Ready');
  assert.deepEqual(calls.map((call) => call.path), ['/api/projects/alpha/checkpoints', '/api/session', '/api/projects/alpha/checkpoints']);
  assert.equal(calls[2].options.headers['X-CSRF-Token'], 'renewed');
  assert.deepEqual(JSON.parse(calls[2].options.body), { revision: 4, name: 'Ready' });
});

test('unrelated 403 and repeated CSRF mismatch do not cause unbounded retries', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return json({ error: 'Forbidden origin' }, 403); });
  await assert.rejects(createCloudApi().logout(), (error) => error.status === 403);
  assert.equal(calls, 1);
  calls = 0;
  globalThis.fetch = async (path) => {
    calls += 1;
    return path === '/api/session' ? json({ csrfToken: 'renewed' }) : json({ error: '会话校验失败，请刷新重试' }, 403);
  };
  await assert.rejects(createCloudApi().logout(), (error) => error.status === 403);
  assert.equal(calls, 3);
});

test('creation forwards stable request ID and template saves exclude cards', async (t) => {
  const writes = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    if (path === '/api/assets/check') return json({ missing: [] });
    writes.push({ path, body: JSON.parse(options.body) });
    return json({ id: 'saved', revision: 1 });
  });
  const api = createCloudApi();
  const input = { theme: 'stateOfPlay', games: [{ title: 'Private card' }] };
  await api.create(input, 'Copy', 'stable-create-token');
  await api.saveTemplate(input, 'Style', 'stable-template-token');
  assert.equal(writes[0].body.requestId, 'stable-create-token');
  assert.equal(writes[1].path, '/api/templates');
  assert.equal(writes[1].body.requestId, 'stable-template-token');
  assert.deepEqual(writes[1].body.project.games, []);
});

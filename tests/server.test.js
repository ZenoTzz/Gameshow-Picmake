import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashBlob } from '../src/utils/projectAssets.js';

test('private sync: setup, sessions, CSRF, assets, conflicts, history and static files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'picmake-server-'));
  const publicDir = path.join(directory, 'public'); await mkdir(publicDir); await writeFile(path.join(publicDir, 'index.html'), '<h1>Picmake</h1>');
  const origin = 'https://pic.example.com';
  const app = await createApp({ dataDir: path.join(directory, 'data'), publicDir, origin, bootstrapToken: 'test-bootstrap-token', allowInsecureCookies: true });
  try {
    await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${app.server.address().port}`;
    let cookie = '', csrf = '';
    const request = async (route, method = 'GET', input, headers = {}) => {
      const response = await fetch(base + route, { method, headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: input === undefined ? undefined : JSON.stringify(input) });
      return { response, data: await response.json() };
    };
    assert.deepEqual((await request('/api/session')).data, { authenticated: false, setupRequired: true });
    assert.equal((await request('/api/project')).response.status, 401);
    assert.equal((await fetch(base + '/api/assets/' + '0'.repeat(64))).status, 401);
    assert.equal((await request('/api/setup', 'POST', { username: 'me', password: 'a-strong-password', setupToken: 'wrong' })).response.status, 403);
    assert.equal((await request('/api/setup', 'POST', { username: 'me', password: 'a-strong-password', setupToken: 'test-bootstrap-token' }, { Origin: 'https://evil.example' })).response.status, 403);
    const setup = await request('/api/setup', 'POST', { username: 'me', password: 'a-strong-password', setupToken: 'test-bootstrap-token' });
    assert.equal(setup.response.status, 200); assert.equal(setup.data.username, 'me');
    cookie = setup.response.headers.get('set-cookie').split(';')[0]; csrf = setup.data.csrfToken;
    assert.match(setup.response.headers.get('set-cookie'), /HttpOnly/);
    assert.equal((await request('/api/session')).data.authenticated, true);
    assert.equal((await request('/api/setup', 'POST', { username: 'other', password: 'a-strong-password', setupToken: 'test-bootstrap-token' })).response.status, 403);
    assert.equal((await request('/api/project', 'PUT', { baseRevision: 0, project: { games: [], theme: 'default' } }, { 'X-CSRF-Token': '' })).response.status, 403);
    const image = new Blob(['image bytes'], { type: 'image/png' }); const id = await hashBlob(image);
    assert.deepEqual((await request('/api/assets/check', 'POST', { ids: [id] })).data, { missing: [id] });
    const upload = (assetId) => fetch(base + '/api/assets/' + assetId, { method: 'PUT', headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': image.type }, body: image });
    assert.equal((await upload('0'.repeat(64))).status, 400);
    assert.equal((await upload(id)).status, 200);
    assert.deepEqual((await request('/api/assets/check', 'POST', { ids: [id] })).data, { missing: [] });
    const asset = await fetch(base + '/api/assets/' + id, { headers: { Cookie: cookie } });
    assert.equal(await asset.text(), 'image bytes'); assert.match(asset.headers.get('content-security-policy'), /sandbox/);
    const project = { schemaVersion: 2, theme: 'default', games: [{ title: 'Card', image: { $asset: id }, showDate: false, showPlatforms: false }], customThemes: {} };
    assert.equal((await request('/api/project', 'PUT', { baseRevision: 0, project: { ...project, title: 'data:image/png;base64,YQ==' } })).response.status, 400);
    assert.equal((await request('/api/project', 'PUT', { baseRevision: 0, project: { ...project, games: [{ title: 'x', image: { $asset: '0'.repeat(64) } }] } })).response.status, 400);
    const saved = await request('/api/project', 'PUT', { baseRevision: 0, project }); assert.equal(saved.data.revision, 1);
    const conflict = await request('/api/project', 'PUT', { baseRevision: 0, project }); assert.equal(conflict.response.status, 409); assert.equal(conflict.data.revision, 1);
    assert.deepEqual((await request('/api/project')).data.project, project);
    const concurrent = await Promise.all([request('/api/project', 'PUT', { baseRevision: 1, project }), request('/api/project', 'PUT', { baseRevision: 1, project })]);
    assert.deepEqual(concurrent.map((r) => r.response.status).sort(), [200, 409]);
    for (let revision = 2; revision < 23; revision++) assert.equal((await request('/api/project', 'PUT', { baseRevision: revision, project })).data.revision, revision + 1);
    assert.equal((await request('/api/history')).data.versions.length, 20);
    assert.equal((await request('/api/history/1')).response.status, 404);
    assert.deepEqual((await request('/api/history/23')).data.project, project);
    assert.equal((await fetch(base + '/')).status, 200);
    assert.equal((await fetch(base + '/.env')).status, 404);
    assert.equal((await fetch(base + '/%2e%2e%2fdata/projects.sqlite')).status, 404);
    assert.equal((await request('/api/logout', 'POST', {})).response.status, 200);
    assert.equal((await request('/api/project')).response.status, 401);
    assert.equal((await request('/api/login', 'POST', { username: 'me', password: 'wrong' })).response.status, 401);
    const login = await request('/api/login', 'POST', { username: 'me', password: 'a-strong-password' }); assert.equal(login.response.status, 200);
    assert.notEqual(login.data.csrfToken, csrf);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('credentials and projects survive restart; production sessions are Secure and initialization stays closed', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'picmake-persist-'));
  const origin = 'https://pic.example.com';
  let app;
  async function start() {
    app = await createApp({ dataDir: directory, origin, bootstrapToken: 'bootstrap' });
    await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
    return `http://127.0.0.1:${app.server.address().port}`;
  }
  try {
    let base = await start();
    const setup = await fetch(base + '/api/setup', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'me', password: 'long-private-password', setupToken: 'bootstrap' }) });
    assert.equal(setup.status, 200); assert.match(setup.headers.get('set-cookie'), /; Secure/);
    const cookie = setup.headers.get('set-cookie').split(';')[0]; const { csrfToken } = await setup.json();
    const headers = { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken };
    const pollution = await fetch(base + '/api/project', { method: 'PUT', headers, body: '{"baseRevision":0,"project":{"theme":"x","games":[],"__proto__":{"polluted":true}}}' });
    assert.equal(pollution.status, 400);
    assert.equal((await fetch(base + '/api/project', { method: 'PUT', headers, body: JSON.stringify({ baseRevision: 0, project: { theme: 'x', games: [] } }) })).status, 200);
    await app.close(); app = undefined;
    base = await start();
    assert.equal((await (await fetch(base + '/api/session')).json()).setupRequired, false);
    const recovered = await fetch(base + '/api/project', { headers: { Cookie: cookie } });
    assert.equal((await recovered.json()).revision, 1);
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'me', password: 'long-private-password' }) });
    assert.equal(login.status, 200);
  } finally { if (app) await app.close(); await rm(directory, { recursive: true, force: true }); }
});

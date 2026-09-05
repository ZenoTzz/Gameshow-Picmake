import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { scryptSync } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashBlob } from '../src/utils/projectAssets.js';
const origin = 'https://pic.example.com';
const credentials = { username: 'owner', password: 'private-password-123' };
async function start(directory, setup = false) {
  const app = await createApp({ dataDir: directory, origin, bootstrapToken: 'bootstrap', allowInsecureCookies: true });
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(base + (setup ? '/api/setup' : '/api/login'), { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...credentials, setupToken: 'bootstrap' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0], csrfToken = (await login.json()).csrfToken;
  const request = async (route, method = 'GET', input) => {
    const response = await fetch(base + route, { method, headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' }, body: input === undefined ? undefined : JSON.stringify(input) });
    return { status: response.status, data: await response.json() };
  };
  return { app, request, base, cookie };
}
const project = (title) => ({ theme: 'default', games: [{ title }], customThemes: {} });

test('named projects have independent revisions/history, renaming CAS, and a permanent legacy alias', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'picmake-projects-'));
  const { app, request } = await start(directory, true);
  try {
    assert.deepEqual((await request('/api/projects')).data, { projects: [] });
    for (const name of ['', ' ', 'x'.repeat(101), null]) assert.equal((await request('/api/projects', 'POST', { name, project: project('a') })).status, 400);
    const a = await request('/api/projects', 'POST', { name: ' 展会 A ', project: project('A') });
    assert.equal(a.status, 201); assert.match(a.data.id, /^[a-f0-9-]{36}$/); assert.equal(a.data.name, '展会 A'); assert.equal(a.data.revision, 1);
    const b = await request('/api/projects', 'POST', { name: '展会 B', project: project('B') });
    assert.notEqual(a.data.id, b.data.id);
    const aUrl = '/api/projects/' + a.data.id, bUrl = '/api/projects/' + b.data.id;
    const list = (await request('/api/projects')).data.projects;
    assert.equal(list.length, 2); assert.equal(list.find((p) => p.id === a.data.id).cardCount, 1); assert.equal(list[0].theme, 'default');
    assert.deepEqual((await request('/api/project')).data, { revision: 0, project: null, updatedAt: null });
    assert.equal((await request('/api/project', 'PUT', { baseRevision: 0, project: project('Old tab') })).data.revision, 1);
    assert.equal((await request(aUrl)).data.project.games[0].title, 'A');
    assert.equal((await request(bUrl)).data.project.games[0].title, 'B');
    const concurrent = await Promise.all([request(aUrl, 'PUT', { baseRevision: 1, name: 'Changed', project: project('A2') }), request(aUrl, 'PUT', { baseRevision: 1, name: 'Changed', project: project('A2') })]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await request(aUrl)).data.name, 'Changed');
    assert.equal((await request(aUrl, 'PUT', { baseRevision: 1, name: 'Stale', project: project('bad') })).status, 409);
    assert.equal((await request(aUrl)).data.name, 'Changed');
    assert.equal((await request(bUrl, 'PUT', { baseRevision: 1, project: project('B2') })).data.revision, 2);
    assert.equal((await request('/api/project')).data.project.games[0].title, 'Old tab');
    for (let revision = 2; revision < 23; revision++) assert.equal((await request(aUrl, 'PUT', { baseRevision: revision, project: project('A' + (revision + 1)) })).data.revision, revision + 1);
    assert.equal((await request(aUrl + '/history')).data.versions.length, 20);
    assert.equal((await request(aUrl + '/history/1')).status, 404);
    assert.equal((await request(bUrl + '/history')).data.versions.length, 2);
    assert.equal((await request(bUrl + '/history/1')).data.project.games[0].title, 'B');
    assert.equal((await request('/api/history/1')).data.project.games[0].title, 'Old tab');
    assert.equal((await request('/api/projects/00000000-0000-0000-0000-000000000000', 'PUT', { baseRevision: 0, project: project('x') })).status, 404);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('old database migrates once, preserving account, images and history across restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'picmake-migration-'));
  const image = new Blob(['preserved image'], { type: 'image/png' }), imageId = await hashBlob(image);
  await mkdir(path.join(directory, 'assets')); await writeFile(path.join(directory, 'assets', imageId), Buffer.from(await image.arrayBuffer()));
  const old = new DatabaseSync(path.join(directory, 'projects.sqlite'));
  old.exec('CREATE TABLE account(username TEXT PRIMARY KEY,salt TEXT NOT NULL,password TEXT NOT NULL); CREATE TABLE assets(id TEXT PRIMARY KEY,mime TEXT NOT NULL,size INTEGER NOT NULL); CREATE TABLE versions(revision INTEGER PRIMARY KEY,project TEXT NOT NULL,updatedAt TEXT NOT NULL);');
  old.prepare('INSERT INTO account VALUES(?,?,?)').run(credentials.username, 'old-salt', scryptSync(credentials.password, 'old-salt', 64).toString('hex'));
  old.prepare('INSERT INTO assets VALUES(?,?,?)').run(imageId, image.type, image.size);
  const packed = { ...project('Migrated'), games: [{ title: 'Migrated', image: { $asset: imageId } }] };
  for (let revision = 1; revision <= 3; revision++) old.prepare('INSERT INTO versions VALUES(?,?,?)').run(revision, JSON.stringify(packed), `2026-09-0${revision}T00:00:00.000Z`);
  old.close();
  let running;
  try {
    running = await start(directory);
    const list = (await running.request('/api/projects')).data.projects;
    assert.equal(list.length, 1); assert.equal(list[0].id, 'legacy'); assert.equal(list[0].name, 'State of Play（旧站导入）'); assert.equal(list[0].revision, 3);
    assert.equal(list[0].createdAt, '2026-09-01T00:00:00.000Z');
    assert.deepEqual((await running.request('/api/projects/legacy')).data.project, packed);
    const preserved = await fetch(running.base + '/api/assets/' + imageId, { headers: { Cookie: running.cookie } }); assert.equal(await preserved.text(), 'preserved image');
    for (let revision = 3; revision < 23; revision++) assert.equal((await running.request('/api/projects/legacy', 'PUT', { baseRevision: revision, project: packed })).status, 200);
    await running.app.close(); running = undefined;
    running = await start(directory);
    assert.equal((await running.request('/api/projects')).data.projects.length, 1);
    assert.equal((await running.request('/api/project')).data.revision, 23);
    assert.equal((await running.request('/api/history')).data.versions.length, 20);
    assert.equal((await running.request('/api/history/1')).status, 404);
    assert.deepEqual((await running.request('/api/projects/legacy')).data.project, packed);
  } finally { if (running) await running.app.close(); await rm(directory, { recursive: true, force: true }); }
});

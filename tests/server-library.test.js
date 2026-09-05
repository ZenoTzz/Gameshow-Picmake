import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { scryptSync } from 'node:crypto';
import { inspectGarbage, replaceAccountPassword } from '../server/maintenance.js';
const origin = 'https://pic.example.com';
const project = { theme: 'default', games: [], customThemes: {} };
async function start(dataDir, setup = true) {
  const app = await createApp({ dataDir, origin, bootstrapToken: 'bootstrap', allowInsecureCookies: true });
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const auth = await fetch(base + (setup ? '/api/setup' : '/api/login'), { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'me', password: 'long-private-password', setupToken: 'bootstrap' }) });
  assert.equal(auth.status, 200);
  const cookie = auth.headers.get('set-cookie').split(';')[0], token = (await auth.json()).csrfToken;
  return { app, request: async (route, method = 'GET', body) => {
    const response = await fetch(base + route, { method, headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  } };
}

test('named checkpoints survive pruning; creation retries are idempotent; library CAS cannot change projects', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'picmake-library-'));
  const { app, request } = await start(dir);
  try {
    const input = { name: 'Project', project, requestId: 'create-project-one' };
    const first = await request('/api/projects', 'POST', input);
    assert.equal(first.status, 201);
    assert.deepEqual((await request('/api/projects', 'POST', input)).data, first.data);
    assert.equal((await request('/api/projects', 'POST', { ...input, name: 'Different' })).status, 409);
    assert.equal((await request('/api/projects')).data.projects.length, 1);
    const url = '/api/projects/' + first.data.id;
    assert.equal((await request(url + '/checkpoints', 'POST', { revision: 1, name: 'Before edits' })).status, 200);
    assert.equal((await request(url + '/checkpoints', 'POST', { revision: 999, name: 'Missing' })).status, 404);
    for (let revision = 1; revision < 25; revision++) assert.equal((await request(url, 'PUT', { baseRevision: revision, project: { ...project, title: 'Edit ' + revision } })).status, 200);
    const history = (await request(url + '/history')).data.versions;
    assert.equal(history.length, 21); assert.equal(history.filter((row) => !row.pinned).length, 20);
    assert.equal(history.find((row) => row.revision === 1).name, 'Before edits');
    assert.equal((await request(url + '/history/1')).status, 200); assert.equal((await request(url + '/history/2')).status, 404);
    assert.equal((await request(url)).data.revision, 25);
    // Even after updates, a delayed POST retry returns the original response, not a second project.
    assert.deepEqual((await request('/api/projects', 'POST', input)).data, first.data);
    const appearance = { ...project, customThemes: { custom_a: { id: 'custom_a', label: 'Blue', color: 'blue' } }, theme: 'custom_a' };
    const templateInput = { name: 'Blue style', project: appearance, requestId: 'create-template-one' };
    const template = await request('/api/templates', 'POST', templateInput);
    assert.equal(template.status, 201);
    assert.deepEqual((await request('/api/templates', 'POST', templateInput)).data, template.data);
    assert.equal((await request('/api/templates', 'POST', { ...templateInput, project: { ...appearance, games: [{ title: 'Not style' }] } })).status, 400);
    const templateUrl = '/api/templates/' + template.data.id;
    const newer = await request(templateUrl, 'PUT', { name: 'Red style', baseRevision: 1, project: { ...appearance, customThemes: { custom_a: { id: 'custom_a', label: 'Red', color: 'red' } } } });
    assert.equal(newer.data.revision, 2);
    assert.equal((await request(templateUrl, 'PUT', { name: 'Stale', baseRevision: 1, project: appearance })).status, 409);
    assert.equal((await request('/api/templates')).data.templates.length, 1);
    assert.equal((await request(url)).data.project.theme, 'default');
    assert.deepEqual((await request('/api/storage')).data, { usedBytes: 0, limitBytes: 2 * 1024 ** 3 });
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});

test('library migration preserves each source custom-theme snapshot and runs once', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'picmake-library-migrate-'));
  const db = new DatabaseSync(path.join(dir, 'projects.sqlite'));
  db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,createdAt TEXT NOT NULL); CREATE TABLE project_versions(projectId TEXT NOT NULL,revision INTEGER NOT NULL,project TEXT NOT NULL,updatedAt TEXT NOT NULL,PRIMARY KEY(projectId,revision));');
  for (const color of ['red', 'blue']) {
    db.prepare('INSERT INTO projects VALUES(?,?,?)').run(color, color, '2026-01-01');
    db.prepare('INSERT INTO project_versions VALUES(?,?,?,?)').run(color, 1, JSON.stringify({ ...project, title: 'Content must not migrate', games: [{ title: color }], theme: 'custom_shared', customThemes: { custom_shared: { id: 'custom_shared', label: color, color } }, logoImages: { custom_shared: 'https://example.com/' + color, unrelated: 'unrelated' } }), '2026-01-01');
  }
  db.close();
  let running;
  try {
    running = await start(dir);
    const list = (await running.request('/api/templates')).data.templates;
    assert.equal(list.length, 2); assert.notEqual(list[0].id, list[1].id);
    for (const template of list) {
      const snapshot = (await running.request('/api/templates/' + template.id)).data.project;
      assert.deepEqual(snapshot.games, []); assert.equal(snapshot.title, undefined);
      assert.equal(snapshot.customThemes.custom_shared.color, template.name);
      assert.equal(snapshot.logoImages.unrelated, undefined);
    }
    await running.app.close(); running = undefined;
    running = await start(dir, false);
    assert.deepEqual((await running.request('/api/templates')).data.templates, list);
  } finally { if (running) await running.app.close(); await rm(dir, { recursive: true, force: true }); }
});

test('GC dry-run preserves historical/template/legacy/idempotency references and identifies only garbage', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'picmake-gc-'));
  await mkdir(path.join(dir, 'assets'));
  const db = new DatabaseSync(path.join(dir, 'projects.sqlite'));
  db.exec('CREATE TABLE assets(id TEXT PRIMARY KEY,size INTEGER); CREATE TABLE project_versions(project TEXT); CREATE TABLE templates(project TEXT); CREATE TABLE versions(project TEXT); CREATE TABLE requests(response TEXT);');
  try {
    for (const [index, table] of ['project_versions', 'templates', 'versions', 'requests', null].entries()) {
      const id = String(index + 1).repeat(64); await writeFile(path.join(dir, 'assets', id), 'abc');
      db.prepare('INSERT INTO assets VALUES(?,?)').run(id, 3);
      if (table) db.prepare(`INSERT INTO ${table} VALUES(?)`).run(JSON.stringify({ nested: { $asset: id } }));
    }
    db.close();
    const report = await inspectGarbage(dir);
    assert.deepEqual(report.candidates.map((file) => file.filename), ['5'.repeat(64)]);
    assert.equal(report.reclaimableBytes, 3); assert.equal(report.referencedAssets, 4);
    assert.deepEqual(report.unreferencedRows, ['5'.repeat(64)]);
    assert.equal((await inspectGarbage(dir)).reclaimableBytes, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('password recovery changes only credentials and revokes every old session', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE account(username TEXT,salt TEXT,password TEXT); CREATE TABLE sessions(id TEXT); CREATE TABLE project_versions(project TEXT); INSERT INTO account VALUES('owner','old','old'); INSERT INTO sessions VALUES('device-a'),('device-b'); INSERT INTO project_versions VALUES('preserved');");
    assert.throws(() => replaceAccountPassword(db, 'short'), /12/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 2);
    replaceAccountPassword(db, 'new-long-private-password');
    const account = db.prepare('SELECT * FROM account').get();
    assert.equal(account.username, 'owner'); assert.notEqual(account.salt, 'old');
    assert.equal(account.password, scryptSync('new-long-private-password', account.salt, 64).toString('hex'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    assert.equal(db.prepare('SELECT project FROM project_versions').get().project, 'preserved');
  } finally { db.close(); }
});

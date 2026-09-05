import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ASSET_ID, IMAGE_TYPE, PROJECT_LIMITS, mapProject, validateProject } from '../src/utils/projectAssets.js';
const scrypt = promisify(scryptCallback);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
async function body(req, limit) {
  if (Number(req.headers['content-length']) > limit) throw fail(413, '请求过大');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw fail(413, '请求过大'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function jsonBody(req, limit = PROJECT_LIMITS.manifest + 1024) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw fail(415, '需要 JSON 请求');
  try { return JSON.parse(await body(req, limit)); } catch (error) { if (error.status) throw error; throw fail(400, 'JSON 无效'); }
}
export async function createApp({ dataDir, publicDir, origin, bootstrapToken, allowInsecureCookies = false }) {
  if (!origin || new URL(origin).origin !== origin) throw new Error('PUBLIC_ORIGIN must be an exact origin');
  dataDir = path.resolve(dataDir);
  if (publicDir && (dataDir === path.resolve(publicDir) || dataDir.startsWith(`${path.resolve(publicDir)}${path.sep}`))) throw new Error('DATA_DIR must not be inside PUBLIC_DIR');
  await mkdir(path.join(dataDir, 'assets'), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, 'projects.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS account(username TEXT PRIMARY KEY,salt TEXT NOT NULL,password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,mime TEXT NOT NULL,size INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS versions(revision INTEGER PRIMARY KEY,project TEXT NOT NULL,updatedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS project_versions(projectId TEXT NOT NULL,revision INTEGER NOT NULL,project TEXT NOT NULL,updatedAt TEXT NOT NULL,PRIMARY KEY(projectId,revision));
    CREATE TABLE IF NOT EXISTS checkpoints(projectId TEXT NOT NULL,revision INTEGER NOT NULL,name TEXT NOT NULL,PRIMARY KEY(projectId,revision));
    CREATE TABLE IF NOT EXISTS templates(id TEXT PRIMARY KEY,name TEXT NOT NULL,revision INTEGER NOT NULL,project TEXT NOT NULL,updatedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests(scope TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(scope,id));`);
  // One transaction and a durable marker prevent old pruned revisions being re-imported on restart.
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT name FROM migrations WHERE name=?').get('named-projects-v1')) {
      const oldest = db.prepare('SELECT updatedAt FROM versions ORDER BY revision LIMIT 1').get();
      if (oldest) {
        db.prepare('INSERT INTO projects VALUES(?,?,?)').run('legacy', 'State of Play（旧站导入）', oldest.updatedAt);
        db.exec("INSERT INTO project_versions SELECT 'legacy',revision,project,updatedAt FROM versions");
      }
      db.prepare('INSERT INTO migrations VALUES(?)').run('named-projects-v1');
    }
    if (!db.prepare('SELECT name FROM migrations WHERE name=?').get('template-library-v1')) {
      const sources = db.prepare(`SELECT p.id,v.project,v.updatedAt FROM projects p JOIN project_versions v ON v.projectId=p.id
        WHERE v.revision=(SELECT MAX(revision) FROM project_versions WHERE projectId=p.id) ORDER BY p.id`).all();
      for (const source of sources) {
        const project = JSON.parse(source.project);
        for (const [themeId, theme] of Object.entries(project.customThemes || {})) {
          const snapshot = { schemaVersion: 2, games: [], theme: themeId, customThemes: { [themeId]: theme } };
          for (const key of ['themeText', 'logoImages', 'logoPositions', 'logoScales']) {
            if (project[key]?.[themeId] !== undefined) snapshot[key] = { [themeId]: project[key][themeId] };
          }
          for (const key of ['posterFontFamily', 'headerFontFamily', 'gameTitleFontFamily', 'metadataFontFamily',
            'infoFontFamily', 'creditFontFamily', 'infoFontSize', 'footerLogoImage', 'footerCreditText']) {
            if (project[key] !== undefined) snapshot[key] = project[key];
          }
          const digest = hash(`template-library-v1:${source.id}:${themeId}`);
          const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
          db.prepare('INSERT INTO templates VALUES(?,?,?,?,?)').run(id, String(theme.label || themeId).slice(0, 100), 1, JSON.stringify(snapshot), source.updatedAt);
        }
      }
      db.prepare('INSERT INTO migrations VALUES(?)').run('template-library-v1');
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  const rates = new Map(); let activeAuth = 0; let activeUploads = 0; let uploadQueue = Promise.resolve();
  const account = () => db.prepare('SELECT * FROM account LIMIT 1').get();
  const current = (id) => db.prepare('SELECT * FROM project_versions WHERE projectId=? ORDER BY revision DESC LIMIT 1').get(id);
  const envelope = (row) => row ? { revision: row.revision, project: JSON.parse(row.project), updatedAt: row.updatedAt } : { revision: 0, project: null, updatedAt: null };
  const metadata = (id) => db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  const namedEnvelope = (id, row = current(id)) => ({ ...metadata(id), ...envelope(row) });
  function projectName(value) {
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 100) throw fail(400, '项目名称需要 1 至 100 个字符');
    return value.trim();
  }
  async function checkedProject(project) {
    const ids = new Set(); let size = 0;
    try {
      const restored = await mapProject(project, (value) => { if (/^(?:data:image\/|blob:)/i.test(value)) throw new Error('图片需要先上传'); return value; }, (id) => {
        if (!ids.has(id)) { const asset = db.prepare('SELECT size FROM assets WHERE id=?').get(id); if (!asset) throw new Error('项目素材缺失'); ids.add(id); size += asset.size; }
        return `asset:${id}`;
      });
      validateProject(restored);
      if (ids.size > PROJECT_LIMITS.assetCount || size > PROJECT_LIMITS.totalAssets) throw new Error('项目素材超过限制');
    } catch (error) { throw fail(400, error.message); }
    const packed = JSON.stringify(project); if (Buffer.byteLength(packed) > PROJECT_LIMITS.manifest) throw fail(413, '项目过大');
    return packed;
  }
  const templateEnvelope = (row) => ({ ...row, project: JSON.parse(row.project) });
  function creationRequest(input, scope, name, packed) {
    if (input.requestId === undefined) return null;
    if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(input.requestId)) throw fail(400, '请求标识无效');
    const digest = hash(JSON.stringify({ name, project: JSON.parse(packed) }));
    const previous = db.prepare('SELECT * FROM requests WHERE scope=? AND id=?').get(scope, input.requestId);
    if (previous && previous.digest !== digest) throw fail(409, '请求标识已用于不同内容，请重新创建');
    return { scope, id: input.requestId, digest, previous: previous ? JSON.parse(previous.response) : null };
  }
  function rememberRequest(request, response) {
    if (request) db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(request.scope, request.id, request.digest, JSON.stringify(response));
  }
  const cookie = (value, age) => `picmake_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${allowInsecureCookies ? '' : '; Secure'}`;
  function newSession(res) {
    const id = random(), csrfToken = random();
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(id), csrfToken, Date.now() + 7 * 86400000);
    res.setHeader('Set-Cookie', cookie(id, 7 * 86400));
    return { authenticated: true, username: account().username, csrfToken, setupRequired: false };
  }
  function rateLimit(req) {
    const now = Date.now();
    for (const [key, entry] of rates) if (entry.until < now) rates.delete(key);
    for (const key of ['global', req.socket.remoteAddress]) {
      const entry = rates.get(key) || { count: 0, until: now + 15 * 60000 };
      if (++entry.count > (key === 'global' ? 100 : 15)) throw fail(429, '尝试过多，请稍后重试');
      rates.set(key, entry);
    }
    if (activeAuth >= 3) throw fail(429, '请稍后重试');
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    try {
      const url = new URL(req.url, origin), route = url.pathname, method = req.method;
      if (!route.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(method) || !publicDir) throw fail(404, '未找到');
        let relative;
        try { relative = decodeURIComponent(route).replace(/^\/+/, ''); } catch { throw fail(400, '路径无效'); }
        const root = path.resolve(publicDir), target = path.resolve(root, relative || 'index.html');
        if (!target.startsWith(`${root}${path.sep}`) || relative.split('/').some((part) => part.startsWith('.'))) throw fail(404, '未找到');
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon' };
        let bytes; try { bytes = await readFile(target); } catch { throw fail(404, '未找到'); }
        res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
        res.end(method === 'HEAD' ? undefined : bytes); return;
      }
      const writing = !['GET', 'HEAD'].includes(method);
      if (writing && req.headers.origin !== origin) throw fail(403, '请求来源无效');
      const sessionId = /(?:^|;\s*)picmake_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      const session = sessionId ? db.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').get(hash(sessionId), Date.now()) : null;
      if (route === '/api/session' && method === 'GET') { send(200, session ? { authenticated: true, username: account().username, csrfToken: session.csrf, setupRequired: false } : { authenticated: false, setupRequired: !account() }); return; }
      if (['/api/setup', '/api/login'].includes(route) && method === 'POST') {
        rateLimit(req);
        const input = await jsonBody(req, 8192);
        if (!input || typeof input.username !== 'string' || input.username.length < 1 || input.username.length > 64 || typeof input.password !== 'string' || input.password.length > 1024) throw fail(400, '账号或密码格式无效');
        if (route === '/api/setup' && (account() || !bootstrapToken || !equal(input.setupToken, bootstrapToken))) throw fail(403, '初始化不可用或令牌无效');
        if (route === '/api/setup' && input.password.length < 12) throw fail(400, '密码至少需要 12 个字符');
        activeAuth++;
        try {
          if (route === '/api/setup') {
            const salt = random(), password = (await scrypt(input.password, salt, 64)).toString('hex');
            if (account()) throw fail(409, '账号已创建');
            db.prepare('INSERT INTO account VALUES(?,?,?)').run(input.username, salt, password);
          } else {
            const user = account();
            const candidate = (await scrypt(input.password, user?.salt || 'missing-user', 64)).toString('hex');
            if (!user || !equal(candidate, user.password) || !equal(input.username, user.username)) throw fail(401, '账号或密码错误');
          }
          if (session) db.prepare('DELETE FROM sessions WHERE id=?').run(session.id);
          send(200, newSession(res)); return;
        } finally { activeAuth--; }
      }
      if (!session) throw fail(401, '请先登录');
      if (writing && !equal(req.headers['x-csrf-token'], session.csrf)) throw fail(403, '会话校验失败，请刷新重试');
      if (route === '/api/logout' && method === 'POST') {
        await jsonBody(req, 1024); db.prepare('DELETE FROM sessions WHERE id=?').run(session.id); res.setHeader('Set-Cookie', cookie('', 0)); send(200, { authenticated: false }); return;
      }
      if (route === '/api/storage' && method === 'GET') {
        send(200, { usedBytes: db.prepare('SELECT COALESCE(SUM(size),0) AS total FROM assets').get().total, limitBytes: 2 * 1024 ** 3 }); return;
      }
      if (route === '/api/templates' && method === 'GET') {
        send(200, { templates: db.prepare('SELECT id,name,revision,updatedAt FROM templates ORDER BY updatedAt DESC,id').all() }); return;
      }
      const templateRoute = /^\/api\/templates\/([a-f0-9-]{36}|[a-f0-9]{64})$/.exec(route);
      if (templateRoute && method === 'GET') {
        const row = db.prepare('SELECT * FROM templates WHERE id=?').get(templateRoute[1]);
        if (!row) throw fail(404, '模板不存在'); send(200, templateEnvelope(row)); return;
      }
      if ((route === '/api/templates' && method === 'POST') || (templateRoute && method === 'PUT')) {
        const input = await jsonBody(req), name = projectName(input?.name), packed = await checkedProject(input?.project);
        if (input.project.games.length) throw fail(400, '模板只保存外观，不能包含卡片');
        const pending = method === 'POST' ? creationRequest(input, 'templates', name, packed) : null;
        if (pending?.previous) { send(201, pending.previous); return; }
        if (method === 'PUT' && (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 1)) throw fail(400, '版本号无效');
        const id = templateRoute?.[1] || randomUUID(), now = new Date().toISOString();
        db.exec('BEGIN IMMEDIATE');
        try {
          const previous = db.prepare('SELECT * FROM templates WHERE id=?').get(id);
          if (method === 'PUT' && !previous) throw fail(404, '模板不存在');
          if (method === 'PUT' && previous.revision !== input.baseRevision) {
            db.exec('ROLLBACK'); send(409, { error: '模板已更新，请重新载入', revision: previous.revision }); return;
          }
          const revision = (previous?.revision || 0) + 1;
          db.prepare('INSERT OR REPLACE INTO templates VALUES(?,?,?,?,?)').run(id, name, revision, packed, now);
          const result = templateEnvelope(db.prepare('SELECT * FROM templates WHERE id=?').get(id));
          rememberRequest(pending, result);
          db.exec('COMMIT'); send(method === 'POST' ? 201 : 200, result); return;
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      const checkpointRoute = /^\/api\/projects\/(legacy|[a-f0-9-]{36})\/checkpoints$/.exec(route);
      if (checkpointRoute && method === 'POST') {
        const id = checkpointRoute[1], input = await jsonBody(req, 4096), name = projectName(input?.name);
        if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw fail(400, '版本号无效');
        if (!db.prepare('SELECT revision FROM project_versions WHERE projectId=? AND revision=?').get(id, input.revision)) throw fail(404, '版本不存在');
        db.prepare('INSERT OR REPLACE INTO checkpoints VALUES(?,?,?)').run(id, input.revision, name);
        send(200, { revision: input.revision, name }); return;
      }
      if (route === '/api/projects' && method === 'GET') {
        const rows = db.prepare(`SELECT p.id,p.name,p.createdAt,v.updatedAt,v.revision,
          json_array_length(v.project,'$.games') AS cardCount,json_extract(v.project,'$.theme') AS theme
          FROM projects p JOIN project_versions v ON v.projectId=p.id
          WHERE v.revision=(SELECT MAX(revision) FROM project_versions WHERE projectId=p.id)
          ORDER BY v.updatedAt DESC,p.id`).all();
        send(200, { projects: rows }); return;
      }
      if (route === '/api/projects' && method === 'POST') {
        const input = await jsonBody(req), name = projectName(input?.name), packed = await checkedProject(input?.project);
        const pending = creationRequest(input, 'projects', name, packed);
        if (pending?.previous) { send(201, pending.previous); return; }
        const id = randomUUID(), now = new Date().toISOString();
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('INSERT INTO projects VALUES(?,?,?)').run(id, name, now);
          db.prepare('INSERT INTO project_versions VALUES(?,?,?,?)').run(id, 1, packed, now);
          rememberRequest(pending, namedEnvelope(id));
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        send(201, namedEnvelope(id)); return;
      }
      const namedRoute = /^\/api\/projects\/(legacy|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\/(history)(?:\/(\d+))?)?$/.exec(route);
      const legacyHistory = /^\/api\/history(?:\/(\d+))?$/.exec(route);
      const legacyRoute = route === '/api/project' || Boolean(legacyHistory);
      if (namedRoute || legacyRoute) {
        const id = namedRoute?.[1] || 'legacy';
        const history = Boolean(namedRoute?.[2] || legacyHistory);
        const historicalRevision = namedRoute?.[3] || legacyHistory?.[1];
        if (!legacyRoute && !metadata(id)) throw fail(404, '项目不存在');
        if (method === 'GET' && history) {
          if (!historicalRevision) {
            send(200, { versions: db.prepare(`SELECT v.revision,v.updatedAt,c.name,CASE WHEN c.revision IS NULL THEN 0 ELSE 1 END AS pinned FROM project_versions v LEFT JOIN checkpoints c ON c.projectId=v.projectId AND c.revision=v.revision WHERE v.projectId=? ORDER BY v.revision DESC`).all(id).map((row) => ({ ...row, pinned: Boolean(row.pinned) })) }); return;
          }
          const row = db.prepare('SELECT * FROM project_versions WHERE projectId=? AND revision=?').get(id, Number(historicalRevision));
          if (!row) throw fail(404, '版本不存在');
          send(200, legacyRoute ? envelope(row) : namedEnvelope(id, row)); return;
        }
        if (method === 'GET' && !history) { send(200, legacyRoute ? envelope(current(id)) : namedEnvelope(id)); return; }
        if (method === 'PUT' && !history) {
          const input = await jsonBody(req);
          if (!Number.isSafeInteger(input?.baseRevision) || input.baseRevision < 0) throw fail(400, '版本号无效');
          const name = input.name === undefined ? undefined : projectName(input.name);
          const packed = await checkedProject(input.project);
          db.exec('BEGIN IMMEDIATE');
          try {
            const revision = current(id)?.revision || 0;
            if (revision !== input.baseRevision) { db.exec('ROLLBACK'); send(409, { error: '云端已有更新，请先载入或备份本机版本', revision }); return; }
            const updatedAt = new Date().toISOString();
            if (!metadata(id)) db.prepare('INSERT INTO projects VALUES(?,?,?)').run(id, name || 'State of Play（旧站导入）', updatedAt);
            else if (name !== undefined) db.prepare('UPDATE projects SET name=? WHERE id=?').run(name, id);
            db.prepare('INSERT INTO project_versions VALUES(?,?,?,?)').run(id, revision + 1, packed, updatedAt);
            db.prepare(`DELETE FROM project_versions WHERE projectId=? AND revision IN (SELECT v.revision FROM project_versions v LEFT JOIN checkpoints c ON c.projectId=v.projectId AND c.revision=v.revision WHERE v.projectId=? AND c.revision IS NULL ORDER BY v.revision DESC LIMIT -1 OFFSET 20)`).run(id, id);
            db.exec('COMMIT');
            send(200, legacyRoute ? { revision: revision + 1, updatedAt } : namedEnvelope(id)); return;
          } catch (error) { db.exec('ROLLBACK'); throw error; }
        }
      }
      if (route === '/api/assets/check' && method === 'POST') {
        const input = await jsonBody(req, 100000);
        if (!Array.isArray(input?.ids) || input.ids.length > 1000 || input.ids.some((id) => typeof id !== 'string' || !ASSET_ID.test(id))) throw fail(400, '素材列表无效');
        send(200, { missing: [...new Set(input.ids)].filter((id) => !db.prepare('SELECT id FROM assets WHERE id=?').get(id)) }); return;
      }
      const assetMatch = /^\/api\/assets\/([a-f0-9]{64})$/.exec(route);
      if (assetMatch && method === 'GET') {
        const id = assetMatch[1], asset = db.prepare('SELECT * FROM assets WHERE id=?').get(id); if (!asset) throw fail(404, '素材不存在');
        const bytes = await readFile(path.join(dataDir, 'assets', id));
        res.setHeader('Content-Type', asset.mime); res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
        res.setHeader('Content-Disposition', `inline; filename="${id}"`); res.end(bytes); return;
      }
      if (assetMatch && method === 'PUT') {
        if (activeUploads >= 4) throw fail(429, '上传繁忙，请稍后重试');
        activeUploads++;
        try {
        const id = assetMatch[1], mime = req.headers['content-type']; if (!IMAGE_TYPE.test(mime || '')) throw fail(415, '图片格式不支持');
        const bytes = await body(req, PROJECT_LIMITS.asset);
        if (hash(Buffer.concat([Buffer.from(`${mime}\0`), bytes])) !== id) throw fail(400, '素材校验失败');
        const operation = uploadQueue.then(async () => {
          if (db.prepare('SELECT id FROM assets WHERE id=?').get(id)) return;
          if (db.prepare('SELECT COALESCE(SUM(size),0) AS total FROM assets').get().total + bytes.length > 2 * 1024 ** 3) throw fail(413, '云端素材空间已满，请联系管理员');
          const target = path.join(dataDir, 'assets', id), temporary = `${target}.${random()}.tmp`;
          try { await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' }); await rename(temporary, target); db.prepare('INSERT INTO assets VALUES(?,?,?)').run(id, mime, bytes.length); }
          finally { await unlink(temporary).catch(() => {}); }
        });
        uploadQueue = operation.catch(() => {}); await operation; send(200, { id }); return;
        } finally { activeUploads--; }
      }
      throw fail(404, '接口不存在');
    } catch (error) { if (!res.headersSent) send(error.status || 500, { error: error.status ? error.message : '服务器暂时无法处理请求' }); else res.destroy(); }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 15000;
  return { server, close: async () => { await new Promise((resolve, reject) => server.close((error) => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve())); await uploadQueue; db.close(); } };
}

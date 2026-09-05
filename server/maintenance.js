import { DatabaseSync } from 'node:sqlite';
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { collectAssetIds, ASSET_ID } from '../src/utils/projectAssets.js';

export function requireOfflineService() {
  if (process.getuid?.() !== 0) throw new Error('Apply maintenance as root after stopping picmake.service');
  let state;
  try { state = execFileSync('systemctl', ['show', 'picmake.service', '--property=ActiveState', '--value'], { encoding: 'utf8' }).trim(); }
  catch { throw new Error('Cannot verify picmake.service is stopped; refusing maintenance'); }
  if (!['inactive', 'failed'].includes(state)) throw new Error('Stop picmake.service before applying maintenance');
}

export async function inspectGarbage(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'projects.sqlite'), { readOnly: true });
  try {
    const refs = new Set();
    for (const table of ['project_versions', 'templates', 'versions']) {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
      for (const row of db.prepare(`SELECT project FROM ${table}`).iterate()) collectAssetIds(JSON.parse(row.project), refs);
    }
    if (db.prepare("SELECT name FROM sqlite_master WHERE name='requests'").get()) {
      for (const row of db.prepare('SELECT response FROM requests').iterate()) collectAssetIds(JSON.parse(row.response), refs);
    }
    const assets = db.prepare('SELECT id,size FROM assets').all();
    const candidates = [];
    for (const filename of await readdir(path.join(dataDir, 'assets'))) {
      if ((!ASSET_ID.test(filename) && !/^[a-f0-9]{64}\.[a-f0-9]{64}\.tmp$/.test(filename)) || refs.has(filename)) continue;
      const info = await stat(path.join(dataDir, 'assets', filename));
      if (info.isFile()) candidates.push({ filename, size: info.size });
    }
    return { candidates, unreferencedRows: assets.filter((asset) => !refs.has(asset.id)).map((asset) => asset.id), reclaimableBytes: candidates.reduce((sum, file) => sum + file.size, 0), referencedAssets: refs.size };
  } finally { db.close(); }
}

export async function applyGarbage(dataDir) {
  requireOfflineService();
  const report = await inspectGarbage(dataDir);
  const db = new DatabaseSync(path.join(dataDir, 'projects.sqlite'));
  try {
    // Files first: if interrupted, only unreferenced metadata can remain; rerun is safe.
    for (const { filename } of report.candidates) await unlink(path.join(dataDir, 'assets', filename));
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const id of report.unreferencedRows) db.prepare('DELETE FROM assets WHERE id=?').run(id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
  return report;
}

export function replaceAccountPassword(db, password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('Password must contain 12–1024 characters');
  if (!db.prepare('SELECT username FROM account LIMIT 1').get()) throw new Error('No account exists; use initial setup instead');
  const salt = randomBytes(32).toString('hex'), derived = scryptSync(password, salt, 64).toString('hex');
  db.exec('BEGIN IMMEDIATE');
  try { db.prepare('UPDATE account SET salt=?,password=?').run(salt, derived); db.exec('DELETE FROM sessions; COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function resetPassword(dataDir, password) {
  requireOfflineService();
  const db = new DatabaseSync(path.join(dataDir, 'projects.sqlite'));
  try { replaceAccountPassword(db, password); } finally { db.close(); }
}

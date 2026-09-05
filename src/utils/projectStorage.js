import { collectAssetIds, packProject, unpackProject } from './projectAssets.js';

const DATABASE_NAME = 'gameshow-picmake-projects';
let pending = Promise.resolve();

function serial(operation) {
  const result = pending.then(operation);
  pending = result.catch(() => {});
  return result;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('projects');
      request.result.createObjectStore('assets');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('本地数据库被其他窗口占用，请关闭旧窗口后重试。'));
  });
}

function snapshot(db, scope = 'history') {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['projects', 'assets'], 'readonly');
    const projects = transaction.objectStore('projects');
    const draft = projects.get('draft');
    const history = projects.get('history');
    const assets = new Map();
    history.onsuccess = () => {
      const selected = scope === 'draft' ? draft.result : (history.result || []).map((item) => item.poster);
      for (const id of collectAssetIds(selected)) {
        const request = transaction.objectStore('assets').get(id);
        request.onsuccess = () => assets.set(id, request.result);
      }
    };
    transaction.oncomplete = () => resolve({
      draft: draft.result || null,
      history: history.result || [],
      assets,
    });
    transaction.onabort = () => reject(transaction.error || new Error('读取本地项目失败。'));
    transaction.onerror = () => {}; // onabort reports the transaction failure.
  });
}

function commit(db, packed, historyEntry, identity = null) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['projects', 'assets'], 'readwrite');
    const projects = transaction.objectStore('projects');
    const assets = transaction.objectStore('assets');
    const draftRequest = projects.get('draft');
    const historyRequest = projects.get('history');
    let resultHistory;
    // IDB request callbacks run inside the live transaction, including across tabs.
    historyRequest.onsuccess = () => {
      const draft = historyEntry ? draftRequest.result : packed.project;
      resultHistory = historyEntry
        ? [historyEntry, ...(historyRequest.result || [])].slice(0, 12)
        : (historyRequest.result || []);
      if (historyEntry) projects.put(resultHistory, 'history');
      else {
        projects.put(packed.project, 'draft');
        projects.put({ ...identity, savedAt: new Date().toISOString() }, 'draftIdentity');
      }
      for (const [id, blob] of packed.assets) assets.put(blob, id);
      const retained = collectAssetIds([draft, ...resultHistory.map((entry) => entry.poster)]);
      const cursor = assets.openKeyCursor();
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        if (!retained.has(cursor.result.key)) assets.delete(cursor.result.key);
        cursor.result.continue();
      };
    };
    transaction.oncomplete = () => resolve(resultHistory);
    transaction.onabort = () => reject(transaction.error || new Error('保存本地项目失败。'));
    transaction.onerror = () => {};
  });
}

export function saveProject(project, identity = null) {
  // Capture the caller's version immediately, before any asynchronous work.
  const captured = structuredClone(project);
  const capturedIdentity = structuredClone(identity);
  return serial(async () => {
    const packed = await packProject(captured);
    const db = await openDatabase();
    try { await commit(db, packed, null, capturedIdentity); } finally { db.close(); }
  });
}

export function loadProject() {
  return serial(async () => {
    const db = await openDatabase();
    try {
      const state = await snapshot(db, 'draft');
      return state.draft ? unpackProject(state.draft, state.assets) : null;
    } finally { db.close(); }
  });
}

export function saveProjectHistory(project, identity = null) {
  const captured = structuredClone(project);
  const capturedIdentity = structuredClone(identity);
  return serial(async () => {
    const packed = await packProject(captured);
    const entry = { id: crypto.randomUUID(), savedAt: new Date().toISOString(), poster: packed.project,
      projectId: capturedIdentity?.projectId || null, projectName: capturedIdentity?.projectName || '未命名本机草稿' };
    const db = await openDatabase();
    try {
      await commit(db, packed, entry);
      const state = await snapshot(db);
      return Promise.all(state.history.map(async (item) => ({
        ...item, poster: await unpackProject(item.poster, state.assets),
      })));
    } finally { db.close(); }
  });
}

export function loadProjectIdentity() {
  return serial(async () => {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('projects', 'readonly');
        const request = transaction.objectStore('projects').get('draftIdentity');
        transaction.oncomplete = () => resolve(request.result || null);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { db.close(); }
  });
}

export function loadProjectHistory() {
  return serial(async () => {
    const db = await openDatabase();
    try {
      const state = await snapshot(db);
      return Promise.all(state.history.map(async (item) => ({
        ...item, poster: await unpackProject(item.poster, state.assets),
      })));
    } finally { db.close(); }
  });
}

import {
  ASSET_ID, IMAGE_TYPE, PROJECT_LIMITS, hashBlob, packProject, unpackProject,
} from './projectAssets.js';

export async function exportProjectBackup(project) {
  const { default: JSZip } = await import('jszip');
  const packed = await packProject(project);
  const zip = new JSZip();
  const manifest = { format: 'gameshow-picmake', version: 2, project: packed.project, assets: {} };
  for (const [id, blob] of packed.assets) {
    const path = `assets/${id}`;
    manifest.assets[id] = { path, type: blob.type, size: blob.size };
    zip.file(path, await blob.arrayBuffer());
  }
  const manifestText = JSON.stringify(manifest);
  if (new Blob([manifestText]).size > PROJECT_LIMITS.manifest) {
    throw new Error('项目文字和设置不能超过 5 MB。');
  }
  zip.file('project.json', manifestText);
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

// Abort inflation as soon as a declared or actual limit is exceeded.
function readEntry(entry, limit) {
  const declared = entry._data?.uncompressedSize;
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > limit) {
    throw new Error('备份中的文件大小超过限制。');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const stream = entry.internalStream('uint8array');
    stream.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        stream.pause();
        reject(new Error('备份解压后超过大小限制。'));
      } else chunks.push(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => {
      if (size !== declared) { reject(new Error('备份文件大小校验失败。')); return; }
      const output = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
      resolve(output);
    });
    stream.resume();
  });
}

export async function importProjectBackup(file) {
  if (!file || typeof file.arrayBuffer !== 'function' || file.size > PROJECT_LIMITS.archive) {
    throw new Error('请选择不超过 150 MB 的项目备份。');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    // Old JSON exports contain a full poster. Packing validates data and image limits.
    const legacy = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const packed = await packProject(legacy);
    return unpackProject(packed.project, packed.assets);
  }
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files);
  if (entries.length > PROJECT_LIMITS.assetCount + 2) throw new Error('备份包含过多文件。');
  let declaredTotal = 0;
  for (const entry of entries) {
    if ((entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name)
        || !/^(?:project\.json|assets\/|assets\/[a-f0-9]{64})$/.test(entry.name)
        || (entry.dir && entry.name !== 'assets/')) throw new Error('备份包含非法资源路径。');
    if (!entry.dir) {
      const size = entry._data?.uncompressedSize;
      if (!Number.isSafeInteger(size) || size < 0) throw new Error('备份文件大小无效。');
      declaredTotal += size;
    }
  }
  if (declaredTotal > PROJECT_LIMITS.totalAssets + PROJECT_LIMITS.manifest) {
    throw new Error('备份解压后超过大小限制。');
  }
  const projectFile = zip.file('project.json');
  if (!projectFile) throw new Error('备份缺少 project.json。');
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
    await readEntry(projectFile, PROJECT_LIMITS.manifest),
  ));
  if (manifest.format !== 'gameshow-picmake' || manifest.version !== 2
      || !manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)) {
    throw new Error('不支持的项目备份格式。');
  }
  const assets = new Map();
  let assetBytes = 0;
  for (const [id, metadata] of Object.entries(manifest.assets)) {
    if (!ASSET_ID.test(id) || !metadata || metadata.path !== `assets/${id}`
        || !IMAGE_TYPE.test(metadata.type) || !Number.isSafeInteger(metadata.size)
        || metadata.size < 0 || metadata.size > PROJECT_LIMITS.asset) throw new Error('备份素材信息无效。');
    const entry = zip.file(metadata.path);
    if (!entry) throw new Error('备份图片缺失。');
    const content = await readEntry(entry, PROJECT_LIMITS.asset);
    assetBytes += content.length;
    if (assetBytes > PROJECT_LIMITS.totalAssets) throw new Error('项目素材总量超过 100 MB。');
    const blob = new Blob([content], { type: metadata.type });
    if (blob.size !== metadata.size || await hashBlob(blob) !== id) throw new Error('备份图片校验失败。');
    assets.set(id, blob);
  }
  const project = await unpackProject(manifest.project, assets);
  // Also validates any inline images in an imported manifest.
  await packProject(project);
  return project;
}

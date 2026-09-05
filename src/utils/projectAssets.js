// Shared, versioned representation used by IndexedDB and portable backups.
export const PROJECT_LIMITS = Object.freeze({
  archive: 150 * 1024 * 1024,
  manifest: 5 * 1024 * 1024,
  asset: 20 * 1024 * 1024,
  totalAssets: 100 * 1024 * 1024,
  assetCount: 1000,
});
export const ASSET_ID = /^[a-f0-9]{64}$/;
export const IMAGE_TYPE = /^image\/(?:png|jpeg|webp|gif|avif|svg\+xml|bmp|x-icon)$/;

export function validateProject(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)
      || !Array.isArray(project.games) || project.games.length > 1000
      || typeof project.theme !== 'string') {
    throw new Error('项目格式无效：需要主题和游戏列表。');
  }
  if (project.schemaVersion != null && ![1, 2].includes(project.schemaVersion)) {
    throw new Error('该项目版本暂不支持，请使用更新版本的编辑器。');
  }
  const stringFields = ['title', 'subtitle', 'eventLabel', 'footerLogoImage', 'footerCreditText',
    'posterFontFamily', 'headerFontFamily', 'gameTitleFontFamily', 'metadataFontFamily',
    'infoFontFamily', 'creditFontFamily'];
  if (stringFields.some((field) => project[field] != null && typeof project[field] !== 'string')) {
    throw new Error('项目文字或图片字段格式无效。');
  }
  for (const field of ['logoImages', 'themeText', 'logoPositions', 'logoScales', 'pageFillSettings']) {
    if (project[field] != null && (typeof project[field] !== 'object' || Array.isArray(project[field]))) {
      throw new Error('项目设置格式无效。');
    }
  }
  for (const source of Object.values(project.logoImages || {})) {
    if (typeof source !== 'string') throw new Error('项目图片字段格式无效。');
  }
  for (const text of Object.values(project.themeText || {})) {
    if (!text || typeof text !== 'object' || Array.isArray(text)
        || Object.values(text).some((value) => typeof value !== 'string')) {
      throw new Error('主题文字格式无效。');
    }
  }
  for (const game of project.games) {
    if (!game || typeof game !== 'object' || Array.isArray(game)
        || typeof game.title !== 'string'
        || ['id', 'date', 'info', 'image'].some((field) => game[field] != null && typeof game[field] !== 'string')
        || (game.platforms != null && (!Array.isArray(game.platforms)
          || game.platforms.some((platform) => typeof platform !== 'string')))) {
      throw new Error('项目中的游戏信息格式无效。');
    }
  }
  if (project.customThemes != null && (typeof project.customThemes !== 'object'
      || Array.isArray(project.customThemes))) throw new Error('自定义主题格式无效。');
  for (const [id, theme] of Object.entries(project.customThemes || {})) {
    if (!id.startsWith('custom_') || !theme || typeof theme !== 'object' || Array.isArray(theme)) {
      throw new Error('自定义主题格式无效。');
    }
    for (const [field, value] of Object.entries(theme)) {
      if (field === 'styleOverrides') {
        if (!Array.isArray(value) || value.length > 30 || value.some((key) => typeof key !== 'string' || !/^[a-zA-Z]+$/.test(key))) {
          throw new Error('自定义主题样式修改记录无效。');
        }
      } else if (value != null && !['string', 'number', 'boolean'].includes(typeof value)) {
        throw new Error('自定义主题字段格式无效。');
      }
    }
  }
  return { ...project, schemaVersion: 2, customThemes: project.customThemes || {} };
}

export async function mapProject(value, mapString, mapAsset, depth = 0) {
  if (depth > 30) throw new Error('项目结构过于复杂。');
  if (typeof value === 'string') return mapString(value);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) {
    const output = [];
    for (const child of value) output.push(await mapProject(child, mapString, mapAsset, depth + 1));
    return output;
  }
  if (value && typeof value === 'object') {
    if (Object.hasOwn(value, '$asset')) {
      if (Object.keys(value).length !== 1 || !ASSET_ID.test(value.$asset)) throw new Error('素材引用格式无效。');
      return mapAsset(value.$asset);
    }
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('项目包含无效字段。');
      if (child !== undefined) output[key] = await mapProject(child, mapString, mapAsset, depth + 1);
    }
    return output;
  }
  throw new Error('项目包含不支持的数据。');
}

export async function packProject(input) {
  const assets = new Map();
  const seen = new Map();
  let total = 0;
  const project = await mapProject(validateProject(input), async (value) => {
    if (value.startsWith('blob:')) throw new Error('临时图片尚未转换，无法保存项目。');
    if (!value.startsWith('data:image/')) return value;
    if (seen.has(value)) return { $asset: seen.get(value) };
    const match = /^data:(image\/[^;,]+)(;base64)?,([\s\S]*)$/.exec(value);
    if (!match || !IMAGE_TYPE.test(match[1])) throw new Error('不支持的内嵌图片格式。');
    if (value.length > PROJECT_LIMITS.asset * 1.5) throw new Error('单张图片不能超过 20 MB。');
    let bytes;
    try {
      bytes = match[2]
        ? Uint8Array.from(atob(match[3]), (character) => character.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(match[3]));
    } catch { throw new Error('内嵌图片数据损坏。'); }
    if (bytes.length > PROJECT_LIMITS.asset) throw new Error('单张图片不能超过 20 MB。');
    const blob = new Blob([bytes], { type: match[1] });
    const id = await hashBlob(blob);
    if (!assets.has(id)) {
      total += blob.size;
      if (total > PROJECT_LIMITS.totalAssets || assets.size >= PROJECT_LIMITS.assetCount) {
        throw new Error('项目素材总量超过限制（100 MB / 1000 张）。');
      }
      assets.set(id, blob);
    }
    seen.set(value, id);
    return { $asset: id };
  }, () => { throw new Error('项目包含尚未载入的素材。'); });
  if (new Blob([JSON.stringify(project)]).size > PROJECT_LIMITS.manifest) {
    throw new Error('项目文字和设置不能超过 5 MB。');
  }
  return { project, assets };
}

export async function hashBlob(blob) {
  // Include MIME type so identically encoded bytes cannot change type on deduplication.
  const bytes = await new Blob([blob.type, '\0', blob]).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function toDataURL(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  }
  return `data:${blob.type};base64,${btoa(chunks.join(''))}`;
}

export async function unpackProject(project, assets) {
  const cache = new Map();
  const restored = await mapProject(project, (value) => value, async (id) => {
    if (!cache.has(id)) {
      const blob = assets.get(id);
      if (!(blob instanceof Blob) || !IMAGE_TYPE.test(blob.type)) throw new Error('项目图片缺失或损坏。');
      cache.set(id, toDataURL(blob));
    }
    return cache.get(id);
  });
  return validateProject(restored);
}

export function collectAssetIds(value, ids = new Set()) {
  if (value && typeof value === 'object') {
    if (Object.hasOwn(value, '$asset')) ids.add(value.$asset);
    else for (const child of Object.values(value)) collectAssetIds(child, ids);
  }
  return ids;
}

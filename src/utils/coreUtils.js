import { withAbort } from "./asyncUtils.js";
import { blankGame, initialPoster } from "../data/sampleData.js";
import { themes } from "../data/themes.js";

export const platformOptions = ["PS5", "XBOX Series", "Switch", "Switch 2", "PC", "Mac", "移动端", "iOS", "Android"];
export const baseUrl = import.meta.env?.BASE_URL ?? "/";
export const templateStorageKey = "gameshow-pic-template-v1";
export const templateHistoryStorageKey = "gameshow-pic-template-history-v1";
export const githubTokenStorageKey = "gameshow-pic-github-token";
export const remoteTemplatePath = "template.json";
export const remoteTemplateUrl = `${baseUrl}${remoteTemplatePath}`.replace(/\/{2,}/g, "/");
export const githubRepo = {
  owner: "ZenoTzz",
  repo: "Gameshow-Picmake",
  branch: "gh-pages",
};
export const defaultSubtitle = "发售日期 / 登陆平台 / 关键信息速览";
export const defaultThemeText = {
  stateOfPlay: {
    eventLabel: "State of Play",
    title: "发布会重磅大作",
    subtitle: defaultSubtitle,
  },
  summerGameFest: {
    eventLabel: "Summer Game Fest",
    title: "发布会重磅大作",
    subtitle: defaultSubtitle,
  },
  gamescom2026: {
    eventLabel: "gamescom 2026",
    title: "ONL 重磅大作",
    subtitle: defaultSubtitle,
  },
  xbox: {
    eventLabel: "Xbox Showcase",
    title: "发布会重磅首曝",
    subtitle: defaultSubtitle,
  },
  nintendoDirect: {
    eventLabel: "Nintendo Direct",
    title: "发布会重磅直面会",
    subtitle: defaultSubtitle,
  },
  nintendoDirectSoft: {
    eventLabel: "Nintendo Direct",
    title: "发布会重点内容",
    subtitle: defaultSubtitle,
  },
  nintendoDirectWarm: {
    eventLabel: "Nintendo Direct",
    title: "发布会重磅直面会",
    subtitle: defaultSubtitle,
  },
};
export const defaultLogoPosition = { x: 72, y: 72 };
export const defaultLogoScale = 100;
export const minLogoScale = 50;
export const maxLogoScale = 250;
export const defaultInfoFontSize = 20;
export const defaultInfoFontWeight = 600;
export const maxHistoryItems = 12;
export const fontOptions = [
  "Microsoft YaHei",
  "SimHei",
  "SimSun",
  "KaiTi",
  "FangSong",
  "Noto Sans SC",
  "Arial",
];
export const platformColors = {
  PS5: { bg: "#1267e8", text: "#ffffff" },
  PS4: { bg: "#1267e8", text: "#ffffff" },
  "XBOX Series": { bg: "#107c10", text: "#ffffff" },
  "Xbox Series": { bg: "#107c10", text: "#ffffff" },
  Xbox: { bg: "#107c10", text: "#ffffff" },
  Switch: { bg: "#e60012", text: "#ffffff" },
  "Switch 2": { bg: "#e60012", text: "#ffffff" },
  PC: { bg: "#27272a", text: "#ffffff" },
  Mac: { bg: "#f5f5f7", text: "#111827" },
  移动端: { bg: "#ff9f1c", text: "#ffffff" },
  iOS: { bg: "#f5f5f7", text: "#111827" },
  Android: { bg: "#3ddc84", text: "#052e16" },
};

export function getPlatformColor(platform) {
  const normalizedPlatform = String(platform ?? "").trim().toLocaleLowerCase("en-US");
  const matchedPlatform = Object.keys(platformColors).find(
    (option) => option.toLocaleLowerCase("en-US") === normalizedPlatform,
  );
  return platformColors[matchedPlatform] ?? { bg: "#475569", text: "#ffffff" };
}

export function buildFontFamily(fontName, fallback) {
  const customFont = fontName?.trim();
  if (!customFont) return fallback;
  if (customFont.includes(",")) return customFont;
  return `"${customFont.replaceAll('"', "")}", ${fallback}`;
}

export function getPosterFonts(poster, theme) {
  const posterFont = buildFontFamily(poster.posterFontFamily, theme.fontFamily);
  return {
    poster: posterFont,
    header: buildFontFamily(poster.headerFontFamily, posterFont),
    gameTitle: buildFontFamily(poster.gameTitleFontFamily, posterFont),
    metadata: buildFontFamily(poster.metadataFontFamily, posterFont),
    info: buildFontFamily(poster.infoFontFamily, posterFont),
    credit: buildFontFamily(poster.creditFontFamily, posterFont),
  };
}

export function getPageFillSetting(poster, pageIndex) {
  const override = poster.pageFillOverrides?.[pageIndex];
  return typeof override === "boolean" ? override : poster.fillEmptySpace;
}

export function getThemeText(poster, themeId = poster.theme) {
  const fallback = defaultThemeText[themeId] ?? defaultThemeText.stateOfPlay;
  return {
    ...fallback,
    ...(poster.themeText?.[themeId] ?? {}),
  };
}

export function getAllThemeText(poster) {
  return Object.keys({ ...themes, ...(poster.customThemes ?? {}) }).reduce((themeText, themeId) => {
    themeText[themeId] = getThemeText(poster, themeId);
    return themeText;
  }, {});
}

export function getDefaultThemeText() {
  return Object.entries(defaultThemeText).reduce((themeText, [themeId, text]) => {
    themeText[themeId] = { ...text };
    return themeText;
  }, {});
}

export function getDefaultLogoPositions() {
  return Object.keys(themes).reduce((positions, themeId) => {
    positions[themeId] = { ...defaultLogoPosition };
    return positions;
  }, {});
}

export function getDefaultLogoScales() {
  return Object.keys(themes).reduce((scales, themeId) => {
    scales[themeId] = defaultLogoScale;
    return scales;
  }, {});
}

export function normalizePosterTemplate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("项目格式无效");
  if (input.schemaVersion && input.schemaVersion > 2) throw new Error("项目版本较新，请更新应用后导入");
  const poster = { ...initialPoster, ...input };
  if (!Array.isArray(poster.games) || poster.games.length > 1000) throw new Error("游戏列表无效或超过 1000 条");
  for (const field of ["theme", "footerCreditText", "footerLogoImage", "posterFontFamily", "headerFontFamily", "gameTitleFontFamily", "metadataFontFamily", "infoFontFamily", "creditFontFamily"]) {
    if (poster[field] != null && typeof poster[field] !== "string") throw new Error(`项目字段 ${field} 必须是文字`);
  }
  for (const field of ["themeText", "logoPositions", "logoScales", "logoImages", "pageFillOverrides", "customThemes"]) {
    if (poster[field] != null && (typeof poster[field] !== "object" || Array.isArray(poster[field]))) throw new Error(`项目字段 ${field} 无效`);
  }
  const customThemes = {};
  for (const [id, value] of Object.entries(poster.customThemes ?? {})) {
    if (!id.startsWith("custom_") || !value || typeof value !== "object") throw new Error("自定义主题无效");
    customThemes[id] = { ...themes.stateOfPlay, ...value, id };
    if (value.styleOverrides != null && (!Array.isArray(value.styleOverrides) || value.styleOverrides.length > 30 || value.styleOverrides.some((key) => typeof key !== "string" || !/^[a-zA-Z]+$/.test(key)))) throw new Error("自定义主题样式修改记录无效");
    for (const key of ["label", "bg", "panel", "card", "line", "glow", "accent", "chipBg", "chipText", "fontFamily"]) {
      if (typeof customThemes[id][key] !== "string") throw new Error("自定义主题字段无效");
    }
  }
  const ids = new Set();
  const games = poster.games.map((game) => {
    const next = cloneGame(game);
    if (ids.has(next.id)) next.id = crypto.randomUUID();
    ids.add(next.id);
    return next;
  });
  for (const value of Object.values(poster.logoImages ?? {})) {
    if (typeof value !== "string") throw new Error("Logo 图片地址无效");
  }
  for (const value of Object.values(poster.themeText ?? {})) {
    if (!value || typeof value !== "object" || Object.values(value).some((text) => typeof text !== "string")) throw new Error("主题文字无效");
  }
  const themeText = {
    ...getDefaultThemeText(),
    ...(poster.themeText ?? {}),
  };
  const storedGamescomText = poster.themeText?.gamescom2026;
  if (
    storedGamescomText?.eventLabel === defaultThemeText.stateOfPlay.eventLabel &&
    storedGamescomText?.title === defaultThemeText.stateOfPlay.title
  ) {
    themeText.gamescom2026 = {
      ...storedGamescomText,
      eventLabel: defaultThemeText.gamescom2026.eventLabel,
      title: defaultThemeText.gamescom2026.title,
    };
  }
  const logoPositions = {
    ...getDefaultLogoPositions(),
    ...(poster.logoPositions ?? {}),
  };
  const logoScales = Object.fromEntries(
    Object.entries({
      ...getDefaultLogoScales(),
      ...(poster.logoScales ?? {}),
    }).map(([themeId, scale]) => [
      themeId,
      Math.min(maxLogoScale, Math.max(minLogoScale, Number(scale) || defaultLogoScale)),
    ]),
  );

  if (!poster.themeText && (poster.eventLabel || poster.title || poster.subtitle)) {
    const themeId = poster.theme ?? initialPoster.theme;
    const fallback = themeText[themeId] ?? defaultThemeText.stateOfPlay;
    themeText[themeId] = {
      ...fallback,
      eventLabel: poster.eventLabel ?? fallback.eventLabel,
      title: poster.title ?? fallback.title,
      subtitle: poster.subtitle ?? fallback.subtitle,
    };
  }

  return {
    ...poster,
    schemaVersion: 2,
    games,
    customThemes,
    theme: Object.hasOwn({ ...themes, ...customThemes }, poster.theme) ? poster.theme : "stateOfPlay",
    themeText,
    logoPositions,
    logoScales,
    compactFollowupPages: poster.compactFollowupPages ?? false,
    showGameInfo: poster.showGameInfo ?? true,
    infoFontSize: Math.min(32, Math.max(14, Number(poster.infoFontSize) || defaultInfoFontSize)),
    infoFontWeight: poster.infoFontWeight ?? defaultInfoFontWeight,
    posterFontFamily: poster.posterFontFamily ?? "",
    headerFontFamily: poster.headerFontFamily ?? "",
    gameTitleFontFamily: poster.gameTitleFontFamily ?? "",
    metadataFontFamily: poster.metadataFontFamily ?? "",
    infoFontFamily: poster.infoFontFamily ?? "",
    creditFontFamily: poster.creditFontFamily ?? "",
  };
}

export async function waitForExportAssets(root, timeoutMs = 15000, signal) {
  async function bounded(promise, message) {
    let timer;
    try {
      await withAbort(Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })]), signal);
    } finally { clearTimeout(timer); }
  }
  signal?.throwIfAborted();
  if (document.fonts?.ready) await bounded(document.fonts.ready, "字体加载超时，请稍后重试");
  await Promise.all(Array.from(root.querySelectorAll("img")).map((image) => new Promise((resolve, reject) => {
    let timer;
    const finish = (error) => {
      clearTimeout(timer);
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      error ? reject(error) : resolve();
    };
    const onLoad = () => finish(image.naturalWidth > 0 ? null : new Error("图片加载失败，请替换图片后重试"));
    const onError = () => finish(new Error("图片加载失败，请替换图片后重试"));
    const onAbort = () => finish(signal.reason ?? new DOMException("已取消", "AbortError"));
    signal?.addEventListener("abort", onAbort, { once: true });
    image.addEventListener("load", onLoad);
    image.addEventListener("error", onError);
    timer = setTimeout(() => finish(new Error("图片加载超时，请检查网络或替换图片")), timeoutMs);
    if (signal?.aborted) onAbort();
    else if (image.complete) onLoad();
  })));
}

export function getTemplateFields(poster) {
  return {
    schemaVersion: 2,
    customThemes: poster.customThemes ?? {},
    theme: poster.theme,
    fillEmptySpace: poster.fillEmptySpace,
    compactFollowupPages: poster.compactFollowupPages ?? false,
    showGameInfo: poster.showGameInfo ?? true,
    pageFillOverrides: poster.pageFillOverrides,
    logoImages: poster.logoImages,
    logoPositions: poster.logoPositions,
    logoScales: poster.logoScales,
    footerLogoImage: poster.footerLogoImage,
    footerCreditText: poster.footerCreditText,
    infoFontSize: Math.min(32, Math.max(14, Number(poster.infoFontSize) || defaultInfoFontSize)),
    infoFontWeight: poster.infoFontWeight ?? defaultInfoFontWeight,
    posterFontFamily: poster.posterFontFamily ?? "",
    headerFontFamily: poster.headerFontFamily ?? "",
    gameTitleFontFamily: poster.gameTitleFontFamily ?? "",
    metadataFontFamily: poster.metadataFontFamily ?? "",
    infoFontFamily: poster.infoFontFamily ?? "",
    creditFontFamily: poster.creditFontFamily ?? "",
    themeText: getAllThemeText(poster),
    games: poster.games.map(cloneGame),
  };
}

export function isEmbeddedImage(source) {
  return typeof source === "string" && source.startsWith("data:image/");
}

export function sanitizeTemplateForLocalStorage(template) {
  return {
    ...template,
    logoImages: Object.fromEntries(
      Object.entries(template.logoImages ?? {}).map(([themeId, source]) => [
        themeId,
        isEmbeddedImage(source) ? "" : source,
      ]),
    ),
    footerLogoImage: isEmbeddedImage(template.footerLogoImage) ? "" : template.footerLogoImage,
    games: (template.games ?? []).map((game) => ({
      ...cloneGame(game),
      image: isEmbeddedImage(game.image) ? "" : game.image,
    })),
  };
}

export function countEmbeddedImages(poster) {
  return [
    ...Object.values(poster.logoImages ?? {}),
    poster.footerLogoImage,
    ...poster.games.map((game) => game.image),
  ].filter(isEmbeddedImage).length;
}

export function persistLocalTemplate(poster) {
  const localTemplate = sanitizeTemplateForLocalStorage(getTemplateFields(poster));
  window.localStorage.setItem(templateStorageKey, JSON.stringify(localTemplate));
  return localTemplate;
}

export function getInitialTemplateHistory() {
  if (typeof window === "undefined") return [];

  try {
    const savedHistory = window.localStorage.getItem(templateHistoryStorageKey);
    if (!savedHistory) return [];
    const parsedHistory = JSON.parse(savedHistory);
    return Array.isArray(parsedHistory) ? parsedHistory.slice(0, maxHistoryItems) : [];
  } catch {
    return [];
  }
}

export function createHistorySnapshot(poster) {
  const sanitizedTemplate = sanitizeTemplateForLocalStorage(getTemplateFields(poster));
  const { games, ...templateFields } = sanitizedTemplate;
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
    template: templateFields,
    games,
  };
}

export function saveTemplateHistory(poster) {
  if (typeof window === "undefined") return [];

  const sanitizedHistory = getInitialTemplateHistory().map((historyItem) => {
    const combinedTemplate = sanitizeTemplateForLocalStorage({
      ...(historyItem.template ?? historyItem),
      games: historyItem.games ?? historyItem.template?.games ?? [],
    });
    const { games, ...template } = combinedTemplate;
    return {
      ...historyItem,
      template,
      games,
    };
  });
  const nextHistory = [createHistorySnapshot(poster), ...sanitizedHistory].slice(0, maxHistoryItems);
  window.localStorage.setItem(templateHistoryStorageKey, JSON.stringify(nextHistory));
  return nextHistory;
}

export function formatHistoryTime(savedAt) {
  if (!savedAt) return "未知时间";

  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(savedAt));
  } catch {
    return savedAt;
  }
}

export function getInitialPoster() {
  const legacyThemes = Object.fromEntries(Object.entries(themes).filter(([id]) => id.startsWith("custom_")));
  const defaults = { ...initialPoster, customThemes: legacyThemes };
  if (typeof window === "undefined") return normalizePosterTemplate(defaults);

  try {
    const savedTemplate = window.localStorage.getItem(templateStorageKey);
    if (!savedTemplate) return normalizePosterTemplate(defaults);
    const parsedTemplate = JSON.parse(savedTemplate);
    return normalizePosterTemplate({
      ...defaults,
      ...parsedTemplate,
      games: (parsedTemplate.games ?? initialPoster.games).map(cloneGame),
    });
  } catch {
    return normalizePosterTemplate(defaults);
  }
}

export function getInitialGithubToken() {
  // Credentials are session-only. Remove the legacy persistent credential.
  try { window.localStorage.removeItem(githubTokenStorageKey); } catch {}
  return "";
}

export function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

export async function githubRequest(path, token, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers ?? {}),
    },
  });

  if (response.status === 404 && (!options.method || options.method === "GET")) return { ok: false, status: 404 };

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `GitHub 请求失败：${response.status}`);
  }
  return { ok: true, data };
}

export async function saveRemoteTemplate(template, token) {
  const apiPath = `/repos/${githubRepo.owner}/${githubRepo.repo}/contents/${remoteTemplatePath}`;
  const current = await githubRequest(`${apiPath}?ref=${githubRepo.branch}`, token);
  const body = {
    message: "Update saved poster template",
    branch: githubRepo.branch,
    content: encodeBase64(JSON.stringify(template, null, 2)),
    ...(current.ok && current.data?.sha ? { sha: current.data.sha } : {}),
  };

  await githubRequest(apiPath, token, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function parseImageDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:(image\/[^;,]+)(;base64)?,(.*)$/s);
  if (!match) return null;

  const [, mimeType, isBase64, payload] = match;
  const bytes = isBase64
    ? Uint8Array.from(window.atob(payload), (character) => character.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(payload));
  return { mimeType: mimeType.toLowerCase(), bytes };
}

export function getImageExtension(mimeType) {
  const extensions = {
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/webp": "webp",
  };
  return extensions[mimeType] ?? "png";
}

export function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

export async function hashBytes(bytes) {
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function uploadTemplateImage(dataUrl, token) {
  if (!dataUrl?.startsWith("data:image/")) return dataUrl;

  const image = parseImageDataUrl(dataUrl);
  if (!image) return dataUrl;

  const hash = await hashBytes(image.bytes);
  const repositoryPath = `template-assets/${hash}.${getImageExtension(image.mimeType)}`;
  const apiPath = `/repos/${githubRepo.owner}/${githubRepo.repo}/contents/${repositoryPath}`;
  const existing = await githubRequest(`${apiPath}?ref=${githubRepo.branch}`, token);

  if (!existing.ok) {
    await githubRequest(apiPath, token, {
      method: "PUT",
      body: JSON.stringify({
        message: `Upload template image ${hash.slice(0, 12)}`,
        branch: githubRepo.branch,
        content: bytesToBase64(image.bytes),
      }),
    });
  }

  return `/${repositoryPath}`;
}

export async function uploadPosterImages(poster, token, onProgress) {
  const imageSources = [
    ...Object.values(poster.logoImages ?? {}),
    poster.footerLogoImage,
    ...poster.games.map((game) => game.image),
  ];
  const dataUrls = [...new Set(imageSources.filter((source) => source?.startsWith("data:image/")))];
  const uploadedPaths = new Map();

  for (let index = 0; index < dataUrls.length; index += 1) {
    const dataUrl = dataUrls[index];
    onProgress?.(index + 1, dataUrls.length);
    uploadedPaths.set(dataUrl, await uploadTemplateImage(dataUrl, token));
  }

  const resolveUploadedPath = (source) => uploadedPaths.get(source) ?? source;
  return {
    ...poster,
    logoImages: Object.fromEntries(
      Object.entries(poster.logoImages ?? {}).map(([themeId, source]) => [themeId, resolveUploadedPath(source)]),
    ),
    footerLogoImage: resolveUploadedPath(poster.footerLogoImage),
    games: poster.games.map((game) => ({
      ...cloneGame(game),
      image: resolveUploadedPath(game.image),
    })),
  };
}

export function resolveLogoSrc(src) {
  if (!src) return "";
  if (src.startsWith("data:") || src.startsWith("http://") || src.startsWith("https://")) return src;
  return `${baseUrl}${src}`.replace(/\/{2,}/g, "/");
}

export function normalizeGamePlatforms(platforms) {
  const normalizePlatformName = (platform) => {
    const normalizedPlatform = String(platform).trim();
    if (/^xbox\s+series$/i.test(normalizedPlatform)) return "XBOX Series";
    if (/^(移动端|mobile)$/i.test(normalizedPlatform)) return "移动端";
    return normalizedPlatform;
  };

  if (Array.isArray(platforms)) {
    const normalizedPlatforms = [...new Set(platforms.map(normalizePlatformName).filter(Boolean))];
    return normalizedPlatforms;
  }

  if (typeof platforms === "string") {
    const normalizedPlatforms = platforms
      .split(/[，,/\n]/)
      .map(normalizePlatformName)
      .filter(Boolean);
    return normalizedPlatforms;
  }

  return [...blankGame.platforms];
}

export function cloneGame(game = blankGame) {
  if (!game || typeof game !== "object" || Array.isArray(game)) throw new Error("游戏条目格式无效");
  for (const key of ["showDate", "showPlatforms"]) {
    if (game[key] != null && typeof game[key] !== "boolean") throw new Error(`卡片字段 ${key} 必须是开关值`);
  }
  for (const key of ["title", "date", "info", "image", "id"]) {
    if (game[key] != null && typeof game[key] !== "string") throw new Error(`游戏字段 ${key} 必须是文字`);
  }
  const normalizedGame = {
    ...blankGame,
    ...(game ?? {}),
  };

  return {
    ...normalizedGame,
    id: normalizedGame.id || crypto.randomUUID(),
    showDate: normalizedGame.showDate ?? true,
    showPlatforms: normalizedGame.showPlatforms ?? true,
    title: normalizedGame.title ?? blankGame.title,
    date: normalizedGame.date ?? blankGame.date,
    info: normalizedGame.info ?? blankGame.info,
    image: normalizedGame.image ?? blankGame.image,
    platforms: normalizeGamePlatforms(normalizedGame.platforms),
  };
}

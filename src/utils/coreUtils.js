import { blankGame, initialPoster } from "../data/sampleData";
import { themes } from "../data/themes";

export const platformOptions = ["PS5", "Xbox Series", "Switch", "Switch 2", "PC", "Mac", "iOS", "Android"];
export const baseUrl = import.meta.env.BASE_URL ?? "/";
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
  nintendoDirectWarm: {
    eventLabel: "Nintendo Direct",
    title: "发布会重磅直面会",
    subtitle: defaultSubtitle,
  },
};
export const defaultLogoPosition = { x: 72, y: 72 };
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
  "Xbox Series": { bg: "#107c10", text: "#ffffff" },
  Xbox: { bg: "#107c10", text: "#ffffff" },
  Switch: { bg: "#e60012", text: "#ffffff" },
  "Switch 2": { bg: "#e60012", text: "#ffffff" },
  PC: { bg: "#27272a", text: "#ffffff" },
  Mac: { bg: "#f5f5f7", text: "#111827" },
  iOS: { bg: "#f5f5f7", text: "#111827" },
  Android: { bg: "#3ddc84", text: "#052e16" },
};

export function getPlatformColor(platform) {
  return platformColors[platform] ?? { bg: "#475569", text: "#ffffff" };
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
  return Object.keys(themes).reduce((themeText, themeId) => {
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

export function normalizePosterTemplate(poster) {
  const themeText = {
    ...getDefaultThemeText(),
    ...(poster.themeText ?? {}),
  };
  const logoPositions = {
    ...getDefaultLogoPositions(),
    ...(poster.logoPositions ?? {}),
  };

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
    themeText,
    logoPositions,
    compactFollowupPages: poster.compactFollowupPages ?? false,
    showGameInfo: poster.showGameInfo ?? true,
    infoFontSize: poster.infoFontSize ?? defaultInfoFontSize,
    infoFontWeight: poster.infoFontWeight ?? defaultInfoFontWeight,
    posterFontFamily: poster.posterFontFamily ?? "",
    headerFontFamily: poster.headerFontFamily ?? "",
    gameTitleFontFamily: poster.gameTitleFontFamily ?? "",
    metadataFontFamily: poster.metadataFontFamily ?? "",
    infoFontFamily: poster.infoFontFamily ?? "",
    creditFontFamily: poster.creditFontFamily ?? "",
  };
}

export async function waitForExportAssets(root) {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map((image) => {
      if (image.complete && image.naturalWidth > 0) return Promise.resolve();
      return new Promise((resolve) => {
        image.onload = resolve;
        image.onerror = resolve;
      });
    }),
  );
}

export function getTemplateFields(poster) {
  return {
    theme: poster.theme,
    fillEmptySpace: poster.fillEmptySpace,
    compactFollowupPages: poster.compactFollowupPages ?? false,
    showGameInfo: poster.showGameInfo ?? true,
    pageFillOverrides: poster.pageFillOverrides,
    logoImages: poster.logoImages,
    logoPositions: poster.logoPositions,
    footerLogoImage: poster.footerLogoImage,
    footerCreditText: poster.footerCreditText,
    infoFontSize: poster.infoFontSize ?? defaultInfoFontSize,
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
  if (typeof window === "undefined") return initialPoster;

  try {
    const savedTemplate = window.localStorage.getItem(templateStorageKey);
    if (!savedTemplate) return normalizePosterTemplate(initialPoster);
    const parsedTemplate = JSON.parse(savedTemplate);
    return normalizePosterTemplate({
      ...initialPoster,
      ...parsedTemplate,
      games: (parsedTemplate.games ?? initialPoster.games).map(cloneGame),
    });
  } catch {
    return normalizePosterTemplate(initialPoster);
  }
}

export function getInitialGithubToken() {
  if (typeof window === "undefined") return "";

  try {
    return window.localStorage.getItem(githubTokenStorageKey) ?? "";
  } catch {
    return "";
  }
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

  if (response.status === 404) return { ok: false, status: 404 };

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
  if (Array.isArray(platforms)) {
    const normalizedPlatforms = platforms.map((platform) => String(platform).trim()).filter(Boolean);
    return normalizedPlatforms.length ? normalizedPlatforms : [...blankGame.platforms];
  }

  if (typeof platforms === "string") {
    const normalizedPlatforms = platforms
      .split(/[，,/\n]/)
      .map((platform) => platform.trim())
      .filter(Boolean);
    return normalizedPlatforms.length ? normalizedPlatforms : [...blankGame.platforms];
  }

  return [...blankGame.platforms];
}

export function cloneGame(game = blankGame) {
  const normalizedGame = {
    ...blankGame,
    ...(game ?? {}),
  };

  return {
    ...normalizedGame,
    title: normalizedGame.title ?? blankGame.title,
    date: normalizedGame.date ?? blankGame.date,
    info: normalizedGame.info ?? blankGame.info,
    image: normalizedGame.image ?? blankGame.image,
    platforms: normalizeGamePlatforms(normalizedGame.platforms),
  };
}


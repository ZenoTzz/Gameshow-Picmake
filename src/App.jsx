import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Download,
  Gamepad2,
  Info,
  ImagePlus,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { blankGame, initialPoster } from "./data/sampleData";
import { logoLibrary } from "./data/logoLibrary";
import { themes } from "./data/themes";
import { paginateGames } from "./utils/paginate";
import { parseGamesFromText } from "./utils/parseGames";

const platformOptions = ["PS5", "Xbox Series", "Switch", "Switch 2", "PC", "Mac", "iOS", "Android"];
const baseUrl = import.meta.env.BASE_URL ?? "/";
const templateStorageKey = "gameshow-pic-template-v1";
const templateHistoryStorageKey = "gameshow-pic-template-history-v1";
const githubTokenStorageKey = "gameshow-pic-github-token";
const remoteTemplatePath = "template.json";
const remoteTemplateUrl = `${baseUrl}${remoteTemplatePath}`.replace(/\/{2,}/g, "/");
const githubRepo = {
  owner: "ZenoTzz",
  repo: "Gameshow-Picmake",
  branch: "gh-pages",
};
const defaultSubtitle = "发售日期 / 登陆平台 / 关键信息速览";
const defaultThemeText = {
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
};
const defaultLogoPosition = { x: 72, y: 72 };
const defaultInfoFontSize = 20;
const maxHistoryItems = 12;
const fontOptions = [
  "Microsoft YaHei",
  "SimHei",
  "SimSun",
  "KaiTi",
  "FangSong",
  "Noto Sans SC",
  "Arial",
];
const platformColors = {
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

function getPlatformColor(platform) {
  return platformColors[platform] ?? { bg: "#475569", text: "#ffffff" };
}

function buildFontFamily(fontName, fallback) {
  const customFont = fontName?.trim();
  if (!customFont) return fallback;
  if (customFont.includes(",")) return customFont;
  return `"${customFont.replaceAll('"', "")}", ${fallback}`;
}

function getPosterFonts(poster, theme) {
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

function getPageFillSetting(poster, pageIndex) {
  const override = poster.pageFillOverrides?.[pageIndex];
  return typeof override === "boolean" ? override : poster.fillEmptySpace;
}

function getThemeText(poster, themeId = poster.theme) {
  const fallback = defaultThemeText[themeId] ?? defaultThemeText.stateOfPlay;
  return {
    ...fallback,
    ...(poster.themeText?.[themeId] ?? {}),
  };
}

function getAllThemeText(poster) {
  return Object.keys(themes).reduce((themeText, themeId) => {
    themeText[themeId] = getThemeText(poster, themeId);
    return themeText;
  }, {});
}

function getDefaultThemeText() {
  return Object.entries(defaultThemeText).reduce((themeText, [themeId, text]) => {
    themeText[themeId] = { ...text };
    return themeText;
  }, {});
}

function getDefaultLogoPositions() {
  return Object.keys(themes).reduce((positions, themeId) => {
    positions[themeId] = { ...defaultLogoPosition };
    return positions;
  }, {});
}

function normalizePosterTemplate(poster) {
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
    infoFontSize: poster.infoFontSize ?? defaultInfoFontSize,
    posterFontFamily: poster.posterFontFamily ?? "",
    headerFontFamily: poster.headerFontFamily ?? "",
    gameTitleFontFamily: poster.gameTitleFontFamily ?? "",
    metadataFontFamily: poster.metadataFontFamily ?? "",
    infoFontFamily: poster.infoFontFamily ?? "",
    creditFontFamily: poster.creditFontFamily ?? "",
  };
}

async function waitForExportAssets(root) {
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

function getTemplateFields(poster) {
  return {
    theme: poster.theme,
    fillEmptySpace: poster.fillEmptySpace,
    compactFollowupPages: poster.compactFollowupPages ?? false,
    pageFillOverrides: poster.pageFillOverrides,
    logoImages: poster.logoImages,
    logoPositions: poster.logoPositions,
    footerLogoImage: poster.footerLogoImage,
    footerCreditText: poster.footerCreditText,
    infoFontSize: poster.infoFontSize ?? defaultInfoFontSize,
    posterFontFamily: poster.posterFontFamily ?? "",
    headerFontFamily: poster.headerFontFamily ?? "",
    gameTitleFontFamily: poster.gameTitleFontFamily ?? "",
    metadataFontFamily: poster.metadataFontFamily ?? "",
    infoFontFamily: poster.infoFontFamily ?? "",
    creditFontFamily: poster.creditFontFamily ?? "",
    themeText: getAllThemeText(poster),
  };
}

function getInitialTemplateHistory() {
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

function createHistorySnapshot(poster) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
    template: getTemplateFields(poster),
    games: poster.games.map(cloneGame),
  };
}

function saveTemplateHistory(poster) {
  if (typeof window === "undefined") return [];

  const nextHistory = [createHistorySnapshot(poster), ...getInitialTemplateHistory()].slice(0, maxHistoryItems);
  window.localStorage.setItem(templateHistoryStorageKey, JSON.stringify(nextHistory));
  return nextHistory;
}

function formatHistoryTime(savedAt) {
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

function getInitialPoster() {
  if (typeof window === "undefined") return initialPoster;

  try {
    const savedTemplate = window.localStorage.getItem(templateStorageKey);
    if (!savedTemplate) return normalizePosterTemplate(initialPoster);
    return normalizePosterTemplate({
      ...initialPoster,
      ...JSON.parse(savedTemplate),
      games: initialPoster.games,
    });
  } catch {
    return normalizePosterTemplate(initialPoster);
  }
}

function getInitialGithubToken() {
  if (typeof window === "undefined") return "";

  try {
    return window.localStorage.getItem(githubTokenStorageKey) ?? "";
  } catch {
    return "";
  }
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

async function githubRequest(path, token, options = {}) {
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

async function saveRemoteTemplate(template, token) {
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

function resolveLogoSrc(src) {
  if (!src) return "";
  if (src.startsWith("data:") || src.startsWith("http://") || src.startsWith("https://")) return src;
  return `${baseUrl}${src}`.replace(/\/{2,}/g, "/");
}

function cloneGame(game = blankGame) {
  return {
    ...game,
    platforms: [...game.platforms],
  };
}

function App() {
  const [poster, setPoster] = useState(getInitialPoster);
  const [githubToken, setGithubToken] = useState(getInitialGithubToken);
  const [pageIndex, setPageIndex] = useState(0);
  const [cardHeights, setCardHeights] = useState([]);
  const [bulkText, setBulkText] = useState("");
  const [parseMessage, setParseMessage] = useState("");
  const [templateMessage, setTemplateMessage] = useState("");
  const [templateHistory, setTemplateHistory] = useState(getInitialTemplateHistory);
  const posterRef = useRef(null);
  const measureRef = useRef(null);

  const theme = themes[poster.theme] ?? themes.stateOfPlay;
  const posterFonts = getPosterFonts(poster, theme);
  const currentThemeText = getThemeText(poster, poster.theme);
  const pages = useMemo(
    () =>
      paginateGames(poster.games, cardHeights, {
        compactFollowupPages: poster.compactFollowupPages,
      }),
    [poster.games, cardHeights, poster.compactFollowupPages],
  );
  const pageStartOffsets = useMemo(
    () =>
      pages.reduce((offsets, page, index) => {
        offsets[index] = index === 0 ? 0 : offsets[index - 1] + pages[index - 1].length;
        return offsets;
      }, []),
    [pages],
  );
  const currentPage = Math.min(pageIndex, pages.length - 1);
  const currentPageFill = getPageFillSetting(poster, currentPage);
  const isFullCardPage = poster.compactFollowupPages && currentPage > 0;

  useEffect(() => {
    let ignore = false;

    async function loadRemoteTemplate() {
      try {
        const response = await fetch(`${remoteTemplateUrl}?v=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) return;
        const remoteTemplate = await response.json();
        if (ignore) return;

        const normalizedTemplate = normalizePosterTemplate({
          ...initialPoster,
          ...remoteTemplate,
        });
        setPoster((current) => ({
          ...normalizedTemplate,
          games: current.games,
        }));
        window.localStorage.setItem(templateStorageKey, JSON.stringify(getTemplateFields(normalizedTemplate)));
        setTemplateMessage("已加载线上模板。");
      } catch {
        // Missing or unreachable remote templates should not block local editing.
      }
    }

    loadRemoteTemplate();
    return () => {
      ignore = true;
    };
  }, []);

  useLayoutEffect(() => {
    if (!measureRef.current) return undefined;

    let frameId = 0;
    const measureCards = () => {
      const heights = Array.from(measureRef.current.querySelectorAll(".game-card")).map((card) =>
        Math.ceil(card.getBoundingClientRect().height),
      );
      setCardHeights((current) => {
        const same =
          current.length === heights.length && current.every((height, index) => height === heights[index]);
        return same ? current : heights;
      });
    };

    const scheduleMeasure = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(measureCards);
    };

    scheduleMeasure();
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(measureRef.current);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [
    poster.games,
    poster.theme,
    poster.infoFontSize,
    poster.posterFontFamily,
    poster.headerFontFamily,
    poster.gameTitleFontFamily,
    poster.metadataFontFamily,
    poster.infoFontFamily,
    poster.creditFontFamily,
  ]);

  useLayoutEffect(() => {
    if (pageIndex > pages.length - 1) {
      setPageIndex(Math.max(0, pages.length - 1));
    }
  }, [pageIndex, pages.length]);

  function updatePoster(key, value) {
    setPoster((current) => ({ ...current, [key]: value }));
  }

  function updateThemeText(key, value) {
    setPoster((current) => {
      const themeText = getThemeText(current, current.theme);
      return {
        ...current,
        themeText: {
          ...(current.themeText ?? {}),
          [current.theme]: {
            ...themeText,
            [key]: value,
          },
        },
      };
    });
  }

  function updateLogoPosition(themeId, position) {
    setPoster((current) => ({
      ...current,
      logoPositions: {
        ...(current.logoPositions ?? {}),
        [themeId]: position,
      },
    }));
  }

  function updateCurrentPageFill(value) {
    setPoster((current) => ({
      ...current,
      pageFillOverrides: {
        ...(current.pageFillOverrides ?? {}),
        [currentPage]: value,
      },
    }));
  }

  function updateGame(index, key, value) {
    setPoster((current) => ({
      ...current,
      games: current.games.map((game, gameIndex) =>
        gameIndex === index ? { ...game, [key]: value } : game,
      ),
    }));
  }

  function updatePlatforms(index, value) {
    const platforms = value
      .split(/[，,/\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    updateGame(index, "platforms", platforms);
  }

  function addGame() {
    setPoster((current) => ({
      ...current,
      games: [...current.games, cloneGame()],
    }));
  }

  function removeGame(index) {
    setPoster((current) => ({
      ...current,
      games: current.games.filter((_, gameIndex) => gameIndex !== index),
    }));
    setPageIndex(0);
  }

  function moveGame(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= poster.games.length) return;

    setPoster((current) => {
      const games = [...current.games];
      [games[index], games[targetIndex]] = [games[targetIndex], games[index]];
      return {
        ...current,
        games,
      };
    });
  }

  function restoreHistory(historyItem) {
    const restoredPoster = normalizePosterTemplate({
      ...initialPoster,
      ...(historyItem.template ?? historyItem),
      games: (historyItem.games ?? initialPoster.games).map(cloneGame),
    });
    setPoster(restoredPoster);
    setPageIndex(0);
    setTemplateMessage("已恢复这条历史记录。");
  }

  function handleImage(index, file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateGame(index, "image", reader.result);
    reader.readAsDataURL(file);
  }

  function handleLogoImage(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () =>
      setPoster((current) => ({
        ...current,
        logoImages: {
          ...(current.logoImages ?? {}),
          [current.theme]: reader.result,
        },
      }));
    reader.readAsDataURL(file);
  }

  function handleFooterLogoImage(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updatePoster("footerLogoImage", reader.result);
    reader.readAsDataURL(file);
  }

  function chooseLibraryLogo(src) {
    setPoster((current) => ({
      ...current,
      logoImages: {
        ...(current.logoImages ?? {}),
        [current.theme]: src,
      },
    }));
  }

  function applyParsedGames(mode) {
    const parsedGames = parseGamesFromText(bulkText);
    if (!parsedGames.length) {
      setParseMessage("没有识别到可生成的游戏条目。");
      return;
    }

    setPoster((current) => ({
      ...current,
      games: mode === "replace" ? parsedGames : [...current.games, ...parsedGames],
    }));
    setPageIndex(0);
    setParseMessage(`已识别 ${parsedGames.length} 个游戏条目。`);
  }

  async function saveTemplate() {
    const template = getTemplateFields(poster);
    try {
      window.localStorage.setItem(templateStorageKey, JSON.stringify(template));
      window.localStorage.setItem(githubTokenStorageKey, githubToken);
      setTemplateHistory(saveTemplateHistory(poster));
    } catch {
      setTemplateMessage("保存失败，浏览器可能限制了本地存储。");
      return;
    }

    if (!githubToken.trim()) {
      setTemplateMessage("模板已保存在本机；填写 PAT 后可同步到线上。");
      return;
    }

    setTemplateMessage("正在同步线上模板...");
    try {
      await saveRemoteTemplate(template, githubToken.trim());
      setTemplateMessage("模板已保存到本机，并同步到线上。");
    } catch (error) {
      setTemplateMessage(`本机已保存，线上同步失败：${error.message}`);
    }
  }

  async function exportCurrentPage() {
    if (!posterRef.current) return;
    const stage = document.createElement("div");
    const clone = posterRef.current.cloneNode(true);

    stage.className = "export-stage";
    clone.style.setProperty("transform", "none", "important");
    clone.style.setProperty("position", "relative", "important");
    clone.style.setProperty("left", "auto", "important");
    clone.style.setProperty("top", "auto", "important");
    clone.style.setProperty("width", "1440px", "important");
    clone.style.setProperty("height", "1920px", "important");
    stage.appendChild(clone);
    document.body.appendChild(stage);

    try {
      await waitForExportAssets(clone);
      const dataUrl = await toPng(clone, {
        width: 1440,
        height: 1920,
        pixelRatio: 1,
        cacheBust: true,
        backgroundColor: "#020817",
      });
      const link = document.createElement("a");
      link.download = `${theme.label}-page-${currentPage + 1}.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      stage.remove();
    }
  }

  return (
    <main className="app-shell">
      <section className="editor-panel">
        <div className="editor-header">
          <div>
            <p className="eyebrow">Gameshow Pic</p>
            <h1>发布会一图流模板</h1>
          </div>
          <div className="header-actions">
            <button className="secondary-button" type="button" onClick={saveTemplate}>
              <Save size={18} />
              保存模板
            </button>
            <button className="primary-button" type="button" onClick={exportCurrentPage}>
              <Download size={18} />
              导出当前页
            </button>
          </div>
        </div>
        {templateMessage && <p className="template-message">{templateMessage}</p>}
        {templateHistory.length > 0 && (
          <div className="template-history">
            <div className="section-title">
              <span>历史记录</span>
            </div>
            <div className="history-list">
              {templateHistory.slice(0, 6).map((historyItem, index) => (
                <button
                  key={historyItem.id ?? `${historyItem.savedAt}-${index}`}
                  type="button"
                  onClick={() => restoreHistory(historyItem)}
                >
                  {formatHistoryTime(historyItem.savedAt)} · {themes[historyItem.template?.theme]?.label ?? "模板"}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field-grid">
          <label>
            展会主题
            <select value={poster.theme} onChange={(event) => updatePoster("theme", event.target.value)}>
              {Object.values(themes).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            顶部英文/标识
            <input value={currentThemeText.eventLabel} onChange={(event) => updateThemeText("eventLabel", event.target.value)} />
          </label>
          <label>
            主标题
            <input value={currentThemeText.title} onChange={(event) => updateThemeText("title", event.target.value)} />
          </label>
          <label>
            底部署名文字
            <input value={poster.footerCreditText} onChange={(event) => updatePoster("footerCreditText", event.target.value)} />
          </label>
          <label>
            关键信息字号
            <input
              max="32"
              min="14"
              type="number"
              value={poster.infoFontSize ?? defaultInfoFontSize}
              onChange={(event) =>
                updatePoster("infoFontSize", Number(event.target.value) || defaultInfoFontSize)
              }
            />
          </label>
          <label className="wide-field">
            海报文字字体
            <input
              list="poster-fonts"
              placeholder="留空使用主题默认字体，也可以输入本机字体名"
              value={poster.posterFontFamily ?? ""}
              onChange={(event) => updatePoster("posterFontFamily", event.target.value)}
            />
          </label>
          <label>
            顶部标题字体
            <input
              list="poster-fonts"
              placeholder="留空继承海报字体"
              value={poster.headerFontFamily ?? ""}
              onChange={(event) => updatePoster("headerFontFamily", event.target.value)}
            />
          </label>
          <label>
            游戏名称字体
            <input
              list="poster-fonts"
              placeholder="留空继承海报字体"
              value={poster.gameTitleFontFamily ?? ""}
              onChange={(event) => updatePoster("gameTitleFontFamily", event.target.value)}
            />
          </label>
          <label>
            日期与平台字体
            <input
              list="poster-fonts"
              placeholder="留空继承海报字体"
              value={poster.metadataFontFamily ?? ""}
              onChange={(event) => updatePoster("metadataFontFamily", event.target.value)}
            />
          </label>
          <label>
            关键信息字体
            <input
              list="poster-fonts"
              placeholder="留空继承海报字体"
              value={poster.infoFontFamily ?? ""}
              onChange={(event) => updatePoster("infoFontFamily", event.target.value)}
            />
          </label>
          <label>
            署名文字字体
            <input
              list="poster-fonts"
              placeholder="留空继承海报字体"
              value={poster.creditFontFamily ?? ""}
              onChange={(event) => updatePoster("creditFontFamily", event.target.value)}
            />
          </label>
          <label className="wide-field">
            GitHub PAT（本机）
            <input
              autoComplete="off"
              placeholder="github_pat_..."
              type="password"
              value={githubToken}
              onChange={(event) => setGithubToken(event.target.value)}
            />
          </label>
          <label className="toggle-field">
            <input
              checked={poster.fillEmptySpace}
              type="checkbox"
              onChange={(event) => updatePoster("fillEmptySpace", event.target.checked)}
            />
            默认补齐空白
          </label>
          <label className="toggle-field">
            <input
              checked={poster.compactFollowupPages ?? false}
              type="checkbox"
              onChange={(event) => {
                updatePoster("compactFollowupPages", event.target.checked);
                setPageIndex(0);
              }}
            />
            第二页起纯卡片页
          </label>
          <label>
            选择内置 Logo
            <select
              value={poster.logoImages?.[poster.theme] ?? ""}
              onChange={(event) => chooseLibraryLogo(event.target.value)}
            >
              {logoLibrary.map((logo) => (
                <option key={logo.id} value={logo.src}>
                  {logo.name}
                </option>
              ))}
            </select>
          </label>
          <label className="file-field logo-upload">
            <ImagePlus size={16} />
            上传当前主题 Logo
            <input accept="image/*" type="file" onChange={(event) => handleLogoImage(event.target.files[0])} />
          </label>
          <label className="file-field logo-upload">
            <ImagePlus size={16} />
            上传底部署名图标
            <input accept="image/*" type="file" onChange={(event) => handleFooterLogoImage(event.target.files[0])} />
          </label>
        </div>

        <div className="bulk-parser">
          <div className="section-title">
            <span>批量粘贴解析</span>
          </div>
          <textarea
            className="bulk-textarea"
            placeholder={
              "推荐格式：\n游戏名称：游戏名\n发售日期：2026年9月24日\n登陆平台：PS5 / PC\n关键信息：现已开启预购，Steam国区售价268元\n\n多个游戏可以连续粘贴，重新写“游戏名称：”会自动分成下一张卡片。"
            }
            value={bulkText}
            onChange={(event) => setBulkText(event.target.value)}
          />
          <div className="bulk-actions">
            <button type="button" onClick={() => applyParsedGames("replace")}>
              替换当前列表
            </button>
            <button type="button" onClick={() => applyParsedGames("append")}>
              追加到列表
            </button>
          </div>
          {parseMessage && <p className="parse-message">{parseMessage}</p>}
        </div>

        <div className="page-tabs">
          {pages.map((_, index) => (
            <button
              key={index}
              className={index === currentPage ? "active" : ""}
              type="button"
              onClick={() => setPageIndex(index)}
            >
              第 {index + 1} 页
            </button>
          ))}
        </div>
        <label className="toggle-field page-fill-toggle">
          <input
            checked={currentPageFill}
            type="checkbox"
            onChange={(event) => updateCurrentPageFill(event.target.checked)}
          />
          当前页补齐空白
        </label>

        <div className="games-editor">
          <div className="section-title">
            <span>游戏列表</span>
            <button type="button" onClick={addGame}>
              <Plus size={16} />
              添加游戏
            </button>
          </div>

          {poster.games.map((game, index) => (
            <article className="game-editor-card" key={`${index}-${game.title}`}>
              <div className="game-editor-top">
                <strong>{String(index + 1).padStart(2, "0")}</strong>
                <div className="game-editor-actions">
                  <button
                    aria-label="上移游戏"
                    className="icon-button order-button"
                    disabled={index === 0}
                    type="button"
                    onClick={() => moveGame(index, -1)}
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    aria-label="下移游戏"
                    className="icon-button order-button"
                    disabled={index === poster.games.length - 1}
                    type="button"
                    onClick={() => moveGame(index, 1)}
                  >
                    <ChevronDown size={16} />
                  </button>
                  <button
                    aria-label="删除游戏"
                    className="icon-button"
                    type="button"
                    onClick={() => removeGame(index)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <label>
                游戏名
                <input value={game.title} onChange={(event) => updateGame(index, "title", event.target.value)} />
              </label>
              <label>
                发售日期
                <input value={game.date} onChange={(event) => updateGame(index, "date", event.target.value)} />
              </label>
              <label>
                平台，用逗号或斜杠分隔
                <input
                  list="platforms"
                  value={game.platforms.join(", ")}
                  onChange={(event) => updatePlatforms(index, event.target.value)}
                />
              </label>
              <label>
                关键信息
                <textarea value={game.info} onChange={(event) => updateGame(index, "info", event.target.value)} />
              </label>
              <label className="file-field">
                <ImagePlus size={16} />
                上传 16:9 图片
                <input accept="image/*" type="file" onChange={(event) => handleImage(index, event.target.files[0])} />
              </label>
            </article>
          ))}
        </div>

        <datalist id="platforms">
          {platformOptions.map((platform) => (
            <option value={platform} key={platform} />
          ))}
        </datalist>
        <datalist id="poster-fonts">
          {fontOptions.map((font) => (
            <option value={font} key={font} />
          ))}
        </datalist>
      </section>

      <section className="preview-panel">
        <div className="preview-tools">
          <span>
            画布 {currentPage + 1}/{pages.length} · 1440 × 1920
          </span>
        </div>
        <div className="poster-scale-wrap">
          <PosterPage
            infoFontSize={poster.infoFontSize ?? defaultInfoFontSize}
            isFullCardPage={isFullCardPage}
            pageGames={pages[currentPage]}
            pageOffset={pageStartOffsets[currentPage] ?? 0}
            fillSpace={currentPageFill}
            onLogoPositionChange={updateLogoPosition}
            poster={poster}
            posterRef={posterRef}
            theme={theme}
          />
        </div>
        <MeasurementLayer
          fonts={posterFonts}
          games={poster.games}
          infoFontSize={poster.infoFontSize ?? defaultInfoFontSize}
          measureRef={measureRef}
          theme={theme}
        />
      </section>
    </main>
  );
}

function MeasurementLayer({ fonts, games, infoFontSize, measureRef, theme }) {
  return (
    <div
      aria-hidden="true"
      className={`measurement-layer theme-${theme.id}`}
      ref={measureRef}
      style={{
        "--card": theme.card,
        "--line": theme.line,
        "--glow": theme.glow,
        "--accent": theme.accent,
        "--chip-bg": theme.chipBg,
        "--chip-text": theme.chipText,
        "--poster-font": fonts.poster,
        "--header-font": fonts.header,
        "--game-title-font": fonts.gameTitle,
        "--metadata-font": fonts.metadata,
        "--info-font": fonts.info,
        "--credit-font": fonts.credit,
      }}
    >
      {games.map((game, index) => (
        <GameCard key={`measure-${index}-${game.title}`} game={game} infoFontSize={infoFontSize} number={index + 1} />
      ))}
    </div>
  );
}

function PosterPage({
  infoFontSize,
  isFullCardPage,
  poster,
  pageGames,
  pageOffset,
  fillSpace,
  onLogoPositionChange,
  posterRef,
  theme,
}) {
  const themeText = getThemeText(poster, poster.theme);
  const logoPosition = poster.logoPositions?.[poster.theme] ?? defaultLogoPosition;
  const fonts = getPosterFonts(poster, theme);

  return (
    <div
      className={`poster theme-${theme.id} ${isFullCardPage ? "full-card-page" : ""}`}
      ref={posterRef}
      style={{
        "--poster-bg": theme.bg,
        "--panel": theme.panel,
        "--card": theme.card,
        "--line": theme.line,
        "--glow": theme.glow,
        "--accent": theme.accent,
        "--chip-bg": theme.chipBg,
        "--chip-text": theme.chipText,
        "--title-shadow": theme.titleShadow,
        "--poster-font": fonts.poster,
        "--header-font": fonts.header,
        "--game-title-font": fonts.gameTitle,
        "--metadata-font": fonts.metadata,
        "--info-font": fonts.info,
        "--credit-font": fonts.credit,
      }}
    >
      <PosterDecor decor={theme.decor} />
      {!isFullCardPage && (
        <>
          <BrandMark
            logoImage={poster.logoImages?.[poster.theme]}
            logoPosition={logoPosition}
            onLogoPositionChange={(position) => onLogoPositionChange(poster.theme, position)}
            posterRef={posterRef}
          />
          <header className="poster-header">
            <div className="headline">
              <div className="event-label">{themeText.eventLabel}</div>
              <h2>{themeText.title}</h2>
              <div className="poster-credit header-credit">
                <span>{poster.footerCreditText}</span>
                {poster.footerLogoImage ? (
                  <img alt="" className="footer-logo" src={resolveLogoSrc(poster.footerLogoImage)} />
                ) : (
                  <div className="footer-logo-placeholder">上传底部署名图标</div>
                )}
              </div>
            </div>
          </header>
        </>
      )}

      <section className={`poster-list ${fillSpace ? "fill-space" : ""}`}>
        {pageGames.map((game, index) => (
          <GameCard
            key={`${game.title}-${index}`}
            game={game}
            infoFontSize={infoFontSize}
            number={pageOffset + index + 1}
          />
        ))}
      </section>
    </div>
  );
}

function BrandMark({ logoImage, logoPosition, onLogoPositionChange, posterRef }) {
  const markRef = useRef(null);
  const dragRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  function getCanvasPoint(event) {
    const posterRect = posterRef.current?.getBoundingClientRect();
    if (!posterRect) return null;

    const scale = posterRect.width / 1440;
    return {
      x: (event.clientX - posterRect.left) / scale,
      y: (event.clientY - posterRect.top) / scale,
    };
  }

  function clampLogoPosition(position) {
    const markRect = markRef.current?.getBoundingClientRect();
    const posterRect = posterRef.current?.getBoundingClientRect();
    const scale = posterRect ? posterRect.width / 1440 : 1;
    const logoWidth = markRect ? markRect.width / scale : 108;
    const logoHeight = markRect ? markRect.height / scale : 78;

    return {
      x: Math.max(0, Math.min(Math.round(position.x), Math.round(1440 - logoWidth))),
      y: Math.max(0, Math.min(Math.round(position.y), Math.round(1920 - logoHeight))),
    };
  }

  function handlePointerDown(event) {
    event.preventDefault();
    const point = getCanvasPoint(event);
    if (!point) return;

    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: point.x - logoPosition.x,
      offsetY: point.y - logoPosition.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  }

  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const point = getCanvasPoint(event);
    if (!point) return;

    onLogoPositionChange(
      clampLogoPosition({
        x: point.x - drag.offsetX,
        y: point.y - drag.offsetY,
      }),
    );
  }

  function finishDrag(event) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setIsDragging(false);
    }
  }

  return (
    <div
      aria-label="Logo"
      className={`brand-mark logo-slot ${isDragging ? "is-dragging" : ""}`}
      ref={markRef}
      role="button"
      style={{
        left: `${logoPosition.x}px`,
        top: `${logoPosition.y}px`,
      }}
      tabIndex={0}
      onPointerCancel={finishDrag}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
    >
      {logoImage && <img alt="" src={resolveLogoSrc(logoImage)} />}
    </div>
  );
}

function PosterDecor({ decor }) {
  return (
    <>
      {decor === "nintendoSwitchLogo" ? (
        <div className="decor-field decor-image decor-nintendo-switch-logo">
          <img alt="" src={resolveLogoSrc("/logos/Nintendo_Switch_2_logo.svg")} />
        </div>
      ) : null}
      {decor === "none" ? null : (
        decor === "nintendoSwitchLogo" ? null : (
          <div className={`decor-field decor-${decor}`}>
            <span />
            <span />
            <span />
            <span />
          </div>
        )
      )}
      <div className="light-line light-line-a" />
      <div className="light-line light-line-b" />
    </>
  );
}

function GameCard({ game, infoFontSize, number }) {
  return (
    <article className="game-card" style={{ "--info-font-size": `${infoFontSize}px` }}>
      <div className="card-number">{String(number).padStart(2, "0")}</div>
      <div className="game-image">
        {game.image ? <img alt="" src={game.image} /> : <span>16:9 图片位</span>}
      </div>
      <div className="game-copy">
        <h3>{game.title}</h3>
        <InfoRow icon={<CalendarDays />} label="发售日期：" value={game.date} />
        <div className="info-row platform-row">
          <Gamepad2 />
          <span className="row-label">登陆平台：</span>
          <div className="platforms">
            {game.platforms.map((platform) => (
              <span
                key={platform}
                style={{
                  "--platform-bg": getPlatformColor(platform).bg,
                  "--platform-text": getPlatformColor(platform).text,
                }}
              >
                {platform}
              </span>
            ))}
          </div>
        </div>
        <InfoRow className="detail-row" icon={<Info />} label="" value={game.info} />
      </div>
    </article>
  );
}

function InfoRow({ className = "", icon, label, value }) {
  return (
    <div className={`info-row ${className}`.trim()}>
      {icon}
      {label && <span className="row-label">{label}</span>}
      <span>{value}</span>
    </div>
  );
}

export default App;

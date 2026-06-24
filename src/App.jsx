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


import * as Core from "./utils/coreUtils";
import { MeasurementLayer, PosterPage } from "./components/PosterComponents";

const { 
  getInitialPoster, getInitialGithubToken, getThemeText, getPosterFonts, 
  getPageFillSetting, cloneGame, countEmbeddedImages, 
  uploadPosterImages, saveRemoteTemplate, persistLocalTemplate, saveTemplateHistory, 
  getTemplateFields, formatHistoryTime, defaultInfoFontSize, defaultInfoFontWeight,
  githubTokenStorageKey, normalizePosterTemplate, maxHistoryItems, defaultLogoPosition,
  defaultThemeText, getInitialTemplateHistory, waitForExportAssets, remoteTemplateUrl,
  fontOptions, platformOptions
} = Core;

function App() {
  const [poster, setPoster] = useState(getInitialPoster);
  const [githubToken, setGithubToken] = useState(getInitialGithubToken);
  const [pageIndex, setPageIndex] = useState(0);
  const [cardHeights, setCardHeights] = useState([]);
  const [bulkText, setBulkText] = useState("");
  const [parseMessage, setParseMessage] = useState("");
  const [templateMessage, setTemplateMessage] = useState("");
  const [templateHistory, setTemplateHistory] = useState(getInitialTemplateHistory);
  const [stitchPages, setStitchPages] = useState(false);
  const posterRef = useRef(null);
  const longPosterRef = useRef(null);
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
          games: (remoteTemplate.games ?? initialPoster.games).map(cloneGame),
        });
        setPoster(normalizedTemplate);
        persistLocalTemplate(normalizedTemplate);
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
    poster.showGameInfo,
    poster.infoFontSize,
    poster.infoFontWeight,
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
    try {
      window.localStorage.setItem(githubTokenStorageKey, githubToken);
    } catch {
      setTemplateMessage("无法保存 PAT，浏览器可能限制了本地存储。");
      return;
    }

    if (!githubToken.trim()) {
      try {
        const embeddedImageCount = countEmbeddedImages(poster);
        persistLocalTemplate(poster);
        setTemplateHistory(saveTemplateHistory(poster));
        setTemplateMessage(
          embeddedImageCount
            ? `文字和设置已保存在本机；${embeddedImageCount} 张本地图片需要填写 PAT 后同步到 GitHub。`
            : "模板已保存在本机。",
        );
      } catch {
        setTemplateMessage("本机存储空间不足，请填写 PAT 后直接保存到 GitHub。");
      }
      return;
    }

    setTemplateMessage("正在准备图片...");
    try {
      const embeddedImageCount = countEmbeddedImages(poster);
      const syncedPoster = await uploadPosterImages(poster, githubToken.trim(), (current, total) => {
        setTemplateMessage(`正在上传图片 ${current}/${total}...`);
      });
      const remainingEmbeddedImages = countEmbeddedImages(syncedPoster);
      if (remainingEmbeddedImages) {
        throw new Error(`仍有 ${remainingEmbeddedImages} 张图片未完成上传`);
      }
      const remoteTemplate = getTemplateFields(syncedPoster);

      setTemplateMessage("图片上传完成，正在保存完整模板...");
      await saveRemoteTemplate(remoteTemplate, githubToken.trim());
      setPoster(syncedPoster);

      let localSaveFailed = false;
      try {
        persistLocalTemplate(syncedPoster);
        setTemplateHistory(saveTemplateHistory(syncedPoster));
      } catch {
        localSaveFailed = true;
      }

      const imageMessage = embeddedImageCount
        ? `已上传 ${embeddedImageCount} 张图片`
        : "图片已使用现有 GitHub 路径";
      setTemplateMessage(
        localSaveFailed
          ? `${imageMessage}，线上模板保存成功；但浏览器本地历史空间不足。`
          : `${imageMessage}，完整模板已同步到 GitHub。`,
      );
    } catch (error) {
      setTemplateMessage(`线上同步失败：${error.message}`);
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
        backgroundColor: theme.bg,
      });
      const link = document.createElement("a");
      link.download = `${theme.label}-page-${currentPage + 1}.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      stage.remove();
    }
  }

  async function exportLongPoster() {
    if (!longPosterRef.current) return;
    const stage = document.createElement("div");
    const clone = longPosterRef.current.cloneNode(true);
    const exportHeight = Math.max(1, pages.length) * 1920;

    stage.className = "export-stage long-export-stage";
    stage.style.setProperty("height", `${exportHeight}px`);
    clone.style.setProperty("position", "relative", "important");
    clone.style.setProperty("left", "auto", "important");
    clone.style.setProperty("top", "auto", "important");
    clone.style.setProperty("width", "1440px", "important");
    clone.style.setProperty("height", `${exportHeight}px`, "important");
    stage.appendChild(clone);
    document.body.appendChild(stage);

    try {
      await waitForExportAssets(clone);
      const dataUrl = await toPng(clone, {
        width: 1440,
        height: exportHeight,
        pixelRatio: 1,
        cacheBust: true,
        backgroundColor: theme.bg,
      });
      const link = document.createElement("a");
      link.download = `${theme.label}-long-${pages.length}-pages.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      stage.remove();
    }
  }

  function exportPoster() {
    return stitchPages ? exportLongPoster() : exportCurrentPage();
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
            <label className="export-mode-toggle">
              <input
                checked={stitchPages}
                type="checkbox"
                onChange={(event) => setStitchPages(event.target.checked)}
              />
              竖向拼接全部页面
            </label>
            <button className="primary-button" type="button" onClick={exportPoster}>
              <Download size={18} />
              {stitchPages ? "导出长图" : "导出当前页"}
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
          <label>
            关键信息粗细
            <select
              value={poster.infoFontWeight ?? defaultInfoFontWeight}
              onChange={(event) => updatePoster("infoFontWeight", Number(event.target.value))}
            >
              <option value="400">常规 400</option>
              <option value="500">中等 500</option>
              <option value="600">半粗 600</option>
              <option value="700">粗体 700</option>
              <option value="800">特粗 800</option>
              <option value="900">黑体 900</option>
            </select>
          </label>
          <label className="toggle-field">
            <input
              checked={poster.showGameInfo ?? true}
              type="checkbox"
              onChange={(event) => {
                updatePoster("showGameInfo", event.target.checked);
                setPageIndex(0);
              }}
            />
            显示关键信息
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
          infoFontWeight={poster.infoFontWeight ?? defaultInfoFontWeight}
          measureRef={measureRef}
          showGameInfo={poster.showGameInfo ?? true}
          theme={theme}
        />
        <div aria-hidden="true" className="long-export-source" ref={longPosterRef}>
          {pages.map((pageGames, index) => (
            <PosterPage
              key={`long-page-${index}`}
              infoFontSize={poster.infoFontSize ?? defaultInfoFontSize}
              isFullCardPage={poster.compactFollowupPages && index > 0}
              pageGames={pageGames}
              pageOffset={pageStartOffsets[index] ?? 0}
              fillSpace={getPageFillSetting(poster, index)}
              onLogoPositionChange={() => {}}
              poster={poster}
              posterRef={null}
              theme={theme}
            />
          ))}
        </div>
      </section>
    </main>
  );
}


export default App;

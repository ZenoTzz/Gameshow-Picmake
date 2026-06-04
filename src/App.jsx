import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import {
  CalendarDays,
  Download,
  Gamepad2,
  Gift,
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
    logoImages: poster.logoImages,
    eventLabel: poster.eventLabel,
    title: poster.title,
    subtitle: poster.subtitle,
    note: poster.note,
  };
}

function getInitialPoster() {
  if (typeof window === "undefined") return initialPoster;

  try {
    const savedTemplate = window.localStorage.getItem(templateStorageKey);
    if (!savedTemplate) return initialPoster;
    return {
      ...initialPoster,
      ...JSON.parse(savedTemplate),
      games: initialPoster.games,
    };
  } catch {
    return initialPoster;
  }
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
  const [pageIndex, setPageIndex] = useState(0);
  const [cardHeights, setCardHeights] = useState([]);
  const [bulkText, setBulkText] = useState("");
  const [parseMessage, setParseMessage] = useState("");
  const [templateMessage, setTemplateMessage] = useState("");
  const posterRef = useRef(null);
  const measureRef = useRef(null);

  const theme = themes[poster.theme] ?? themes.stateOfPlay;
  const pages = useMemo(() => paginateGames(poster.games, cardHeights), [poster.games, cardHeights]);
  const pageStartOffsets = useMemo(
    () =>
      pages.reduce((offsets, page, index) => {
        offsets[index] = index === 0 ? 0 : offsets[index - 1] + pages[index - 1].length;
        return offsets;
      }, []),
    [pages],
  );
  const currentPage = Math.min(pageIndex, pages.length - 1);

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
  }, [poster.games, poster.theme]);

  useLayoutEffect(() => {
    if (pageIndex > pages.length - 1) {
      setPageIndex(Math.max(0, pages.length - 1));
    }
  }, [pageIndex, pages.length]);

  function updatePoster(key, value) {
    setPoster((current) => ({ ...current, [key]: value }));
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

  function saveTemplate() {
    try {
      window.localStorage.setItem(templateStorageKey, JSON.stringify(getTemplateFields(poster)));
      setTemplateMessage("模板已保存，下次打开会自动恢复。");
    } catch {
      setTemplateMessage("保存失败，浏览器可能限制了本地存储。");
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
            <input value={poster.eventLabel} onChange={(event) => updatePoster("eventLabel", event.target.value)} />
          </label>
          <label>
            主标题
            <input value={poster.title} onChange={(event) => updatePoster("title", event.target.value)} />
          </label>
          <label>
            副标题
            <input value={poster.subtitle} onChange={(event) => updatePoster("subtitle", event.target.value)} />
          </label>
          <label className="wide-field">
            底部注释
            <input value={poster.note} onChange={(event) => updatePoster("note", event.target.value)} />
          </label>
          <label className="toggle-field">
            <input
              checked={poster.fillEmptySpace}
              type="checkbox"
              onChange={(event) => updatePoster("fillEmptySpace", event.target.checked)}
            />
            自动补齐当前页空白
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
        </div>

        <div className="bulk-parser">
          <div className="section-title">
            <span>批量粘贴解析</span>
          </div>
          <textarea
            className="bulk-textarea"
            placeholder={"粘贴整段发布会信息，例如：\n《游戏名》\n发售日期：2026年9月24日\n登陆平台：PS5 / PC\n现已开启预购，Steam国区售价268元"}
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
                <button
                  aria-label="删除游戏"
                  className="icon-button"
                  type="button"
                  onClick={() => removeGame(index)}
                >
                  <Trash2 size={16} />
                </button>
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
      </section>

      <section className="preview-panel">
        <div className="preview-tools">
          <span>
            画布 {currentPage + 1}/{pages.length} · 1440 × 1920
          </span>
        </div>
        <div className="poster-scale-wrap">
          <PosterPage
            pageGames={pages[currentPage]}
            pageOffset={pageStartOffsets[currentPage] ?? 0}
            poster={poster}
            posterRef={posterRef}
            theme={theme}
          />
        </div>
        <MeasurementLayer games={poster.games} measureRef={measureRef} theme={theme} />
      </section>
    </main>
  );
}

function MeasurementLayer({ games, measureRef, theme }) {
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
        "--poster-font": theme.fontFamily,
      }}
    >
      {games.map((game, index) => (
        <GameCard key={`measure-${index}-${game.title}`} game={game} number={index + 1} />
      ))}
    </div>
  );
}

function PosterPage({ poster, pageGames, pageOffset, posterRef, theme }) {
  return (
    <div
      className={`poster theme-${theme.id}`}
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
        "--poster-font": theme.fontFamily,
      }}
    >
      <PosterDecor decor={theme.decor} />
      <header className="poster-header">
        <BrandMark logoImage={poster.logoImages?.[poster.theme]} />
        <div className="headline">
          <div className="event-label">{poster.eventLabel}</div>
          <h2>{poster.title}</h2>
          <p>{poster.subtitle}</p>
        </div>
      </header>

      <section className={`poster-list ${poster.fillEmptySpace ? "fill-space" : ""}`}>
        {pageGames.map((game, index) => (
          <GameCard key={`${game.title}-${index}`} game={game} number={pageOffset + index + 1} />
        ))}
      </section>

      <footer className="poster-note">{poster.note}</footer>
    </div>
  );
}

function BrandMark({ logoImage }) {
  return (
    <div className="brand-mark logo-slot" aria-label="Logo">
      {logoImage && <img alt="" src={resolveLogoSrc(logoImage)} />}
    </div>
  );
}

function PosterDecor({ decor }) {
  return (
    <>
      <div className={`decor-field decor-${decor}`}>
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="light-line light-line-a" />
      <div className="light-line light-line-b" />
    </>
  );
}

function GameCard({ game, number }) {
  return (
    <article className="game-card">
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
        <InfoRow icon={<Gift />} label="" value={game.info} />
      </div>
    </article>
  );
}

function InfoRow({ icon, label, value }) {
  return (
    <div className="info-row">
      {icon}
      {label && <span className="row-label">{label}</span>}
      <span>{value}</span>
    </div>
  );
}

export default App;

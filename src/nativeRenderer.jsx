import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { MeasurementLayer, PosterPage } from "./components/PosterComponents.jsx";
import { themes } from "./data/themes.js";
import { normalizePosterTemplate, getPosterFonts, getPageFillSetting, waitForExportAssets } from "./utils/coreUtils.js";
import { paginateGames } from "./utils/paginate.js";
import { renderPosterImage } from "./utils/exportPoster.jsx";
import "./styles.css";
import "./nativeRenderer.css";

const logos = __NATIVE_LOGOS__;
const root = createRoot(document.getElementById("native-root"));
let snapshot, selectedTheme, pages = [[]], pageIndex = 0, generation = 0, exporting = false;
const post = (message) => window.webkit?.messageHandlers?.picmake?.postMessage(message);
const report = (error) => post({ type: "error", message: error?.message || String(error) });

// WKWebView's file scheme cannot be fetched by html-to-image. All bundled logos
// are embedded here as well as copied to the bundle for ordinary <img> loading.
const originalFetch = window.fetch.bind(window);
window.fetch = (input, options) => {
  const source = typeof input === "string" ? input : input.url;
  const path = decodeURIComponent(new URL(source, location.href).pathname);
  const key = Object.keys(logos).find(key => path.endsWith(`/${key}`));
  if (key) return originalFetch(logos[key], options);
  if (source.startsWith("data:") || source.startsWith("blob:")) return originalFetch(input, options);
  return Promise.reject(new Error("离线预览不能读取外部资源，请先下载项目图片"));
};

function localImage(source) {
  if (!source || source.startsWith("data:image/")) return source;
  const key = decodeURIComponent(source).replace(/^\.?\//, "");
  if (logos[key]) return logos[key];
  throw new Error("项目图片尚未下载，请返回项目重新同步后预览");
}

function fitCanvas() {
  const canvas = document.querySelector(".native-canvas");
  const poster = canvas?.querySelector(".poster");
  if (!poster) return;
  const scale = Math.min(1, (document.documentElement.clientWidth - 16) / 1440);
  canvas.style.width = `${1440 * scale}px`;
  canvas.style.height = `${1920 * scale}px`;
  poster.style.transform = `scale(${scale})`;
}
new ResizeObserver(fitCanvas).observe(document.documentElement);

function propsForPage(index) {
  return {
    poster: snapshot, theme: selectedTheme, infoFontSize: snapshot.infoFontSize,
    pageGames: pages[index], pageOffset: pages.slice(0, index).reduce((sum, page) => sum + page.length, 0),
    fillSpace: getPageFillSetting(snapshot, index),
    isFullCardPage: snapshot.compactFollowupPages && index > 0,
    onLogoPositionChange: () => {},
  };
}

function showPage() {
  flushSync(() => root.render(<div className="native-canvas"><PosterPage {...propsForPage(pageIndex)} /></div>));
  fitCanvas();
  post({ type: "rendered", page: pageIndex, pageCount: pages.length });
}

window.picmakeRender = async (input) => {
  const current = ++generation;
  try {
    const next = normalizePosterTemplate(typeof input === "string" ? JSON.parse(input) : input);
    next.games = next.games.map(game => ({ ...game, image: localImage(game.image) }));
    next.logoImages = Object.fromEntries(Object.entries(next.logoImages ?? {}).map(([key, value]) => [key, localImage(value)]));
    next.footerLogoImage = localImage(next.footerLogoImage);
    const theme = { ...(next.customThemes?.[next.theme] || themes[next.theme]) };
    if (theme.defaultFooterLogo) theme.defaultFooterLogo = localImage(theme.defaultFooterLogo);
    const measurement = React.createRef();
    flushSync(() => root.render(<MeasurementLayer fonts={getPosterFonts(next, theme)} games={next.games} infoFontSize={next.infoFontSize} infoFontWeight={next.infoFontWeight} measureRef={measurement} showGameInfo={next.showGameInfo} theme={theme} />));
    await waitForExportAssets(measurement.current);
    if (current !== generation) return;
    const heights = [...measurement.current.querySelectorAll(".game-card")].map(node => Math.ceil(node.getBoundingClientRect().height));
    snapshot = next;
    selectedTheme = theme;
    pages = paginateGames(next.games, heights, { compactFollowupPages: next.compactFollowupPages });
    pageIndex = Math.min(pageIndex, pages.length - 1);
    showPage();
  } catch (error) { if (current === generation) report(error); }
};

window.picmakeSelectPage = (index) => {
  if (!snapshot) return;
  pageIndex = Math.max(0, Math.min(pages.length - 1, Math.floor(Number(index) || 0)));
  showPage();
};

window.picmakeExport = async () => {
  if (!snapshot || exporting) return;
  exporting = true;
  try {
    const page = pageIndex;
    if (/AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium/.test(navigator.userAgent)) {
      // WebKit's first foreignObject canvas pass can omit nested image pixels
      // even after img.decode(). Warm its image cache before the delivered pass.
      await renderPosterImage(propsForPage(page));
    }
    const blob = await renderPosterImage(propsForPage(page));
    const dataURL = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("无法读取导出图片"));
      reader.readAsDataURL(blob);
    });
    post({ type: "export", dataURL, filename: `海报-第${page + 1}页.png` });
  } catch (error) { report(error); }
  finally { exporting = false; }
};

post({ type: "ready" });

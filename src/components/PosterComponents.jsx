import React, { useRef, useState, useLayoutEffect } from "react";
import { CalendarDays, Gamepad2, Info } from "lucide-react";
import * as Core from "../utils/coreUtils";

const { getPlatformColor, resolveLogoSrc, getThemeText, getPosterFonts, defaultLogoPosition, defaultInfoFontWeight } = Core;

const builtinThemeIds = new Set([
  "stateOfPlay", "summerGameFest", "gamescom2026", "xbox", "nintendoDirect", "nintendoDirectWarm",
]);

function themeClassNames(theme) {
  const inherited = builtinThemeIds.has(theme.baseThemeId) && theme.baseThemeId !== theme.id
    ? ` theme-${theme.baseThemeId}`
    : "";
  return `theme-${theme.id}${inherited}`;
}

function themeOverrides(theme) {
  return Array.isArray(theme.styleOverrides) ? theme.styleOverrides.join(" ") : undefined;
}

function cardVariables(theme) {
  return {
    "--card-title": theme.cardTitle || "#ffffff",
    "--card-text": theme.cardText || "#ffffff",
    "--card-overlay": theme.cardOverlay ?? 0,
    "--card-border": theme.cardBorder || theme.line || "#ffffff",
    "--card-border-width": `${theme.cardBorderWidth ?? 2}px`,
    "--card-number-bg": theme.cardNumberBg || `linear-gradient(180deg, color-mix(in srgb, ${theme.chipBg}, #ffffff 8%), color-mix(in srgb, ${theme.chipBg}, #001b4d 28%))`,
  };
}

function MeasurementLayer({ fonts, games, infoFontSize, infoFontWeight, measureRef, showGameInfo, theme }) {
  return (
    <div
      aria-hidden="true"
      className={`measurement-layer ${themeClassNames(theme)}`}
      data-theme-overrides={themeOverrides(theme)}
      ref={measureRef}
      style={{
        ...cardVariables(theme),
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
        "--info-font-weight": infoFontWeight,
        "--credit-font": fonts.credit,
      }}
    >
      {games.map((game, index) => (
        <GameCard
          key={game.id}
          game={game}
          infoFontSize={infoFontSize}
          number={index + 1}
          showGameInfo={showGameInfo}
        />
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
  isLongPoster,
  selectedGameId,
  onGameSelect,
}) {
  const localPosterRef = useRef(null);
  useLayoutEffect(() => {
    const node = localPosterRef.current;
    const wrapper = node?.parentElement;
    if (!wrapper?.matches(".poster-scale-wrap, .long-poster-preview")) return;
    const container = wrapper.parentElement;
    const resize = () => {
      const scale = Math.min(0.5, container.clientWidth / 1440);
      const transform = `scale(${scale})`;
      const width = `${1440 * scale}px`;
      const height = `${node.offsetHeight * scale}px`;
      if (node.style.transform !== transform) node.style.transform = transform;
      if (wrapper.style.width !== width) wrapper.style.width = width;
      if (wrapper.style.height !== height) wrapper.style.height = height;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    observer.observe(node);
    resize();
    return () => observer.disconnect();
  }, []);
  const themeText = getThemeText(poster, poster.theme);
  const logoPosition = poster.logoPositions?.[poster.theme] ?? defaultLogoPosition;
  const logoScale = poster.logoScales?.[poster.theme] ?? Core.defaultLogoScale;
  const fonts = getPosterFonts(poster, theme);
  const footerLogoImage = poster.footerLogoImage || theme.defaultFooterLogo;

  return (
    <div
      className={`poster ${themeClassNames(theme)} ${isFullCardPage ? "full-card-page" : ""} ${isLongPoster ? "long-poster" : ""}`}
      data-theme-overrides={themeOverrides(theme)}
      ref={(node) => {
        localPosterRef.current = node;
        if (typeof posterRef === "function") posterRef(node);
        else if (posterRef) posterRef.current = node;
      }}
      style={{
        "--poster-bg": theme.bg,
        "--panel": theme.panel,
        ...cardVariables(theme),
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
        "--info-font-weight": poster.infoFontWeight ?? defaultInfoFontWeight,
        "--credit-font": fonts.credit,
      }}
    >
      <PosterDecor decor={theme.decor} />
      {!isFullCardPage && (
        <>
          <BrandMark
            logoImage={poster.logoImages?.[poster.theme]}
            logoPosition={logoPosition}
            logoScale={logoScale}
            onLogoPositionChange={(position) => onLogoPositionChange(poster.theme, position)}
            posterRef={posterRef}
          />
          <header className="poster-header">
            <div className="headline">
              <div className="event-label">{themeText.eventLabel}</div>
              <h2>{themeText.title}</h2>
              <div className="poster-credit header-credit">
                <span>{poster.footerCreditText}</span>
                {footerLogoImage ? (
                  <img alt="" className="footer-logo" src={resolveLogoSrc(footerLogoImage)} />
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
            key={game.id}
            game={game}
            infoFontSize={infoFontSize}
            number={pageOffset + index + 1}
            showGameInfo={poster.showGameInfo ?? true}
            isSelected={game.id === selectedGameId}
            onGameSelect={onGameSelect}
          />
        ))}
      </section>
    </div>
  );
}

function BrandMark({ logoImage, logoPosition, logoScale, onLogoPositionChange, posterRef }) {
  const interactive = Boolean(posterRef && onLogoPositionChange);
  const markRef = useRef(null);
  const dragRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  function getCanvasPoint(event) {
    const posterRect = posterRef?.current?.getBoundingClientRect();
    if (!posterRect || !posterRect.width) return null;

    const scale = posterRect.width / 1440;
    return {
      x: (event.clientX - posterRect.left) / scale,
      y: (event.clientY - posterRect.top) / scale,
    };
  }

  function clampLogoPosition(position) {
    const markRect = markRef.current?.getBoundingClientRect();
    const posterRect = posterRef?.current?.getBoundingClientRect();
    const scale = posterRect ? posterRect.width / 1440 : 1;
    const logoWidth = markRect ? markRect.width / scale : 108;
    const logoHeight = markRect ? markRect.height / scale : 78;

    return {
      x: Math.max(0, Math.min(Math.round(position.x), Math.round(1440 - logoWidth))),
      y: Math.max(0, Math.min(Math.round(position.y), Math.round(1920 - logoHeight))),
    };
  }

  function handlePointerDown(event) {
    if (!interactive) return;
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
      role={interactive ? "button" : undefined}
      style={{
        cursor: interactive ? "grab" : "default",
        pointerEvents: interactive ? "auto" : "none",
        left: `${logoPosition.x}px`,
        top: `${logoPosition.y}px`,
        width: `${108 * (logoScale / 100)}px`,
        height: `${78 * (logoScale / 100)}px`,
      }}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={(event) => {
        if (!interactive || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        onLogoPositionChange(clampLogoPosition({
          x: logoPosition.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
          y: logoPosition.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
        }));
      }}
      onPointerCancel={finishDrag}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
    >
      {logoImage && <img alt="" src={resolveLogoSrc(logoImage)} />}
    </div>
  );
}

function PlayStationSymbolsDecor() {
  return (
    <div aria-hidden="true" className="decor-field decor-symbols">
      <svg viewBox="0 0 260 240">
        <rect className="ps-symbol" height="72" rx="3" width="72" x="10" y="84" />
        <polygon className="ps-symbol" points="130,10 86,84 174,84" />
        <circle className="ps-symbol" cx="210" cy="120" r="36" />
        <g className="ps-symbol">
          <line x1="101" x2="159" y1="170" y2="228" />
          <line x1="159" x2="101" y1="170" y2="228" />
        </g>
      </svg>
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
      {decor === "symbols" ? <PlayStationSymbolsDecor /> : null}
      {decor === "none" || decor === "nintendoSwitchLogo" || decor === "symbols" ? null : (
        <div className={`decor-field decor-${decor}`}>
          <span />
          <span />
          <span />
          <span />
        </div>
      )}
      <div className="light-line light-line-a" />
      <div className="light-line light-line-b" />
    </>
  );
}

function GameCard({ game, infoFontSize, number, showGameInfo, isSelected, onGameSelect }) {
  const interactive = typeof onGameSelect === "function";
  const interactionProps = interactive ? {
    role: "button",
    tabIndex: 0,
    "aria-label": `编辑游戏：${game.title || "未命名游戏"}`,
    "aria-pressed": Boolean(isSelected),
    "data-game-id": game.id,
    onClick: () => onGameSelect(game.id),
    onKeyDown: (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onGameSelect(game.id);
      }
    },
  } : {};
  return (
    <article
      {...interactionProps}
      className={`game-card${interactive && isSelected ? " is-selected" : ""}`}
      style={{ "--info-font-size": `${infoFontSize}px` }}
    >
      <div className="card-number">{String(number).padStart(2, "0")}</div>
      <div className="game-image">
        {game.image ? <img alt="" src={resolveLogoSrc(game.image)} /> : <span>16:9 图片位</span>}
      </div>
      <div className="game-copy">
        <h3>{game.title}</h3>
        {game.showDate !== false && <InfoRow icon={<CalendarDays />} label="发售日期：" value={game.date} />}
        {game.showPlatforms !== false && <div className="info-row platform-row">
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
        </div>}
        {showGameInfo && <InfoRow className="detail-row" icon={<Info />} label="" value={game.info} />}
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
export { MeasurementLayer, PosterPage, BrandMark, PosterDecor, GameCard, InfoRow };

import React, { useRef, useState } from "react";
import { CalendarDays, Gamepad2, Info, ImagePlus } from "lucide-react";
import * as Core from "../utils/coreUtils";
import { themes } from "../data/themes";

const { getPlatformColor, resolveLogoSrc, getThemeText, getPosterFonts, defaultLogoPosition, defaultInfoFontWeight } = Core;

function MeasurementLayer({ fonts, games, infoFontSize, infoFontWeight, measureRef, showGameInfo, theme }) {
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
        "--info-font-weight": infoFontWeight,
        "--credit-font": fonts.credit,
      }}
    >
      {games.map((game, index) => (
        <GameCard
          key={`measure-${index}-${game.title}`}
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
}) {
  const themeText = getThemeText(poster, poster.theme);
  const logoPosition = poster.logoPositions?.[poster.theme] ?? defaultLogoPosition;
  const fonts = getPosterFonts(poster, theme);

  return (
    <div
      className={`poster theme-${theme.id} ${isFullCardPage ? "full-card-page" : ""} ${isLongPoster ? "long-poster" : ""}`}
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
        "--card-title": theme.cardTitle || "#ffffff",
        "--card-text": theme.cardText || "#ffffff",
        "--card-overlay": theme.cardOverlay ?? 0,
        "--card-border": theme.cardBorder || theme.line || "#ffffff",
        "--card-border-width": theme.cardBorderWidth !== undefined ? theme.cardBorderWidth + "px" : "2px",
        "--card-number-bg": theme.cardNumberBg || `linear-gradient(180deg, color-mix(in srgb, ${theme.chipBg}, #ffffff 8%), color-mix(in srgb, ${theme.chipBg}, #001b4d 28%))`,
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
            showGameInfo={poster.showGameInfo ?? true}
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

function GameCard({ game, infoFontSize, number, showGameInfo }) {
  return (
    <article className="game-card" style={{ "--info-font-size": `${infoFontSize}px` }}>
      <div className="card-number">{String(number).padStart(2, "0")}</div>
      <div className="game-image">
        {game.image ? <img alt="" src={resolveLogoSrc(game.image)} /> : <span>16:9 图片位</span>}
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

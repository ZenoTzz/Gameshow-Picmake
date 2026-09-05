import { useState } from "react";
import { createThemeCopy, saveThemeCopy } from "../utils/themeCopy.js";
import { ImagePlus, Palette, Plus, Trash2, Copy } from "lucide-react";
import { ThemeEditor } from "./ThemeEditor.jsx";
import { logoLibrary } from "../data/logoLibrary.js";
import * as Core from "../utils/coreUtils.js";
const { defaultInfoFontSize, defaultInfoFontWeight } = Core;

export function PosterSettings({ poster, themes, currentThemeText, currentLogoScale, updatePoster, updateThemeText, updateLogoScale, chooseLibraryLogo, handleLogoImage, handleFooterLogoImage, setPoster, setPageIndex, showThemeEditor, setShowThemeEditor, setPreviewTheme }) {
  const [themeCopy, setThemeCopy] = useState(null);
  function closeThemeEditor() {
    setPreviewTheme(null);
    setShowThemeEditor(false);
    setThemeCopy(null);
  }
  return <div className="poster-settings">
    <details className="settings-section"><summary>模板与排版 <span>{themes[poster.theme]?.label}</span></summary><div className="field-grid">
          <label>
            样式模板
            <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
              <select disabled={Boolean(showThemeEditor)} value={poster.theme} onChange={(event) => updatePoster("theme", event.target.value)} style={{flex: 1}}>
                {Object.values(themes).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <button className="secondary-button" disabled={Boolean(showThemeEditor)} onClick={() => { setThemeCopy(null); setShowThemeEditor("create"); }} style={{padding: '0 8px', minHeight: '38px'}} title="新建自定义主题"><Plus size={16}/></button>
              {poster.theme.startsWith("custom_") && (
                <>
                  <button
                    className="secondary-button"
                    disabled={Boolean(showThemeEditor)} onClick={() => { setThemeCopy(null); setShowThemeEditor("edit"); }}
                    style={{padding: '0 8px', minHeight: '38px'}}
                    title="编辑此自定义主题"
                  >
                    <Palette size={16} />
                  </button>
                  <button className="secondary-button" onClick={() => { setPoster((current) => { const customThemes = { ...current.customThemes }; delete customThemes[current.theme]; return { ...current, theme: "stateOfPlay", customThemes }; }); }} style={{padding: '0 8px', minHeight: '38px'}} title="删除此自定义主题" disabled={Boolean(showThemeEditor)}>
                    <Trash2 size={16} color="#ef4444" />
                  </button>
                </>
              )}
            </div>
          </label>
          <div className="wide-field">
            <button className="secondary-button" type="button" disabled={Boolean(showThemeEditor)} onClick={() => { setThemeCopy(createThemeCopy(poster, themes)); setShowThemeEditor("copy"); }}><Copy size={16}/>复制当前模板</button>
            <p className="field-hint">模板决定外观；项目保存本次的文字和图片。复制模板只创建样式副本。</p>
          </div>
          {showThemeEditor && (
            <div style={{ gridColumn: "1 / -1", background: "#1e293b", padding: "16px", borderRadius: "8px", border: "1px solid #334155" }}>
              <ThemeEditor
                key={themeCopy?.theme.id ?? `${showThemeEditor}-${poster.theme}`}
                initialTheme={showThemeEditor === "copy" ? themeCopy.theme : showThemeEditor === "edit" && poster.theme.startsWith("custom_") ? themes[poster.theme] : {}}
                existingThemes={themes}
                isCopy={showThemeEditor === "copy"}
                onPreview={setPreviewTheme}
                onSave={(t) => {
                  setPoster((current) => themeCopy ? saveThemeCopy(current, themeCopy, t) : ({ ...current, theme: t.id, customThemes: { ...current.customThemes, [t.id]: t } }));
                  closeThemeEditor();
                }}
                onCancel={closeThemeEditor}
              />
            </div>
          )}
          <label>
            顶部英文/标识
            <input disabled={showThemeEditor === "copy"} value={currentThemeText.eventLabel} onChange={(event) => updateThemeText("eventLabel", event.target.value)} />
          </label>
          <label>
            主标题
            <input disabled={showThemeEditor === "copy"} value={currentThemeText.title} onChange={(event) => updateThemeText("title", event.target.value)} />
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
    </div></details>
    <details className="settings-section"><summary>字体与署名</summary><div className="field-grid">
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
          <label>
            底部署名文字
            <input value={poster.footerCreditText} onChange={(event) => updatePoster("footerCreditText", event.target.value)} />
          </label>
    </div></details>
    <details className="settings-section"><summary>Logo 与图标</summary><div className="field-grid">
          <label>
            选择内置 Logo
            <select
              disabled={showThemeEditor === "copy"}
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
            <input accept="image/*" type="file" disabled={showThemeEditor === "copy"} onChange={(event) => handleLogoImage(event.target.files[0])} />
          </label>
          <div className="logo-size-field wide-field">
            <div className="logo-size-heading">
              <label htmlFor="logo-size">Logo 大小</label>
              <strong>{currentLogoScale}%</strong>
            </div>
            <div className="logo-size-controls">
              <input
                id="logo-size"
                disabled={showThemeEditor === "copy"}
                aria-label="Logo 大小"
                className="logo-size-range"
                min={Core.minLogoScale}
                max={Core.maxLogoScale}
                step="5"
                type="range"
                value={currentLogoScale}
                onInput={(event) => updateLogoScale(poster.theme, event.currentTarget.value)}
              />
              <button
                className="secondary-button logo-size-reset"
                type="button"
                disabled={showThemeEditor === "copy" || currentLogoScale === Core.defaultLogoScale}
                onClick={() => updateLogoScale(poster.theme, Core.defaultLogoScale)}
              >
                恢复默认
              </button>
            </div>
            <span className="field-hint">仅调整当前主题，保持图片比例；放大后仍可拖动定位。</span>
          </div>
          <label className="file-field logo-upload">
            <ImagePlus size={16} />
            上传底部署名图标
            <input accept="image/*" type="file" onChange={(event) => handleFooterLogoImage(event.target.files[0])} />
          </label>
    </div></details>
  </div>;
}

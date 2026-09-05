import React, { useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Crop, GripVertical, ImagePlus, Trash2, X } from "lucide-react";
import { DragHandle } from "./SortableGameList";
import { platformOptions, resolveLogoSrc } from "../utils/coreUtils";

export function GameEditor({ game, index, total, isExpanded, onSelect, onChange, onMove, onRemove, onImage, onRecrop }) {
  const detailsId = useId();
  const fileInput = useRef(null);
  const [customPlatform, setCustomPlatform] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [imageError, setImageError] = useState("");
  const platforms = game.platforms ?? [];
  const hasPlatform = (name) => platforms.some((platform) => platform.toLowerCase() === name.toLowerCase());
  const customPlatforms = platforms.filter((platform) => !platformOptions.some((option) => option.toLowerCase() === platform.toLowerCase()));
  const title = game.title || "未命名游戏";

  function togglePlatform(name) {
    onChange("platforms", hasPlatform(name)
      ? platforms.filter((platform) => platform.toLowerCase() !== name.toLowerCase())
      : [...platforms, name]);
  }

  function addCustomPlatforms() {
    const next = [...platforms];
    for (const entry of customPlatform.split(/[，,/\n]/)) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const name = platformOptions.find((option) => option.toLowerCase() === trimmed.toLowerCase()) ?? trimmed;
      if (!next.some((platform) => platform.toLowerCase() === name.toLowerCase())) next.push(name);
    }
    if (next.length !== platforms.length) onChange("platforms", next);
    setCustomPlatform("");
  }

  function receiveImage(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("请选择图片文件。");
      return;
    }
    setImageError("");
    onImage(file);
  }

  return (
    <article className={`game-editor-card${isExpanded ? " is-selected" : ""}`} id={`game-editor-${game.id}`}
      onPaste={(event) => {
        const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"));
        if (!file) return;
        event.preventDefault();
        event.stopPropagation();
        receiveImage(file);
      }}>
      <div className="game-summary">
        <DragHandle className="icon-button drag-handle" aria-label={`拖动排序：${title}`} title="拖动排序，也可聚焦后按空格和方向键排序">
          <GripVertical size={16} />
        </DragHandle>
        <button className="game-summary-toggle" type="button" aria-expanded={isExpanded} aria-controls={detailsId} onClick={onSelect}>
          <span className="game-summary-thumbnail">
            {game.image ? <img src={resolveLogoSrc(game.image)} alt="" loading="lazy" /> : <ImagePlus size={19} />}
          </span>
          <span className="game-summary-copy">
            <span className="game-summary-title"><span className="game-number">{String(index + 1).padStart(2, "0")}</span>{title}</span>
            <span className="game-summary-date">{game.showDate === false ? "不显示发售日期" : game.date || "发售日期待填写"}</span>
          </span>
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <div className="game-editor-actions">
          <button aria-label={`上移：${title}`} title="上移" className="icon-button order-button" disabled={index === 0} type="button" onClick={() => onMove(-1)}><ChevronUp size={16} /></button>
          <button aria-label={`下移：${title}`} title="下移" className="icon-button order-button" disabled={index === total - 1} type="button" onClick={() => onMove(1)}><ChevronDown size={16} /></button>
          <button aria-label={`删除游戏：${title}`} title="删除游戏" className="icon-button" type="button" onClick={onRemove}><Trash2 size={16} /></button>
        </div>
      </div>
      {isExpanded && <div className="game-details" id={detailsId}>
        <label>游戏名<input value={game.title} onChange={(event) => onChange("title", event.target.value)} /></label>
        <fieldset className="card-visibility">
          <legend>本卡片显示内容</legend>
          <div className="card-visibility-options">
            <label><input type="checkbox" checked={game.showDate !== false} onChange={(event) => onChange("showDate", event.target.checked)} />显示发售日期</label>
            <label><input type="checkbox" checked={game.showPlatforms !== false} onChange={(event) => onChange("showPlatforms", event.target.checked)} />显示平台</label>
          </div>
          <span className="field-hint">仅影响这张卡片。隐藏后保留已填写内容，预览和导出同步生效。</span>
        </fieldset>
        {game.showDate !== false && <label>发售日期<input value={game.date} placeholder="例如：2026 年 10 月 / 待定" onChange={(event) => onChange("date", event.target.value)} /></label>}
        {game.showPlatforms !== false && <fieldset className="platform-picker">
          <legend>登陆平台</legend>
          <div className="platform-options">
            {platformOptions.map((platform) => <button className="platform-option" type="button" key={platform} aria-pressed={hasPlatform(platform)} onClick={() => togglePlatform(platform)}>{platform}</button>)}
            {customPlatforms.map((platform) => <button className="platform-option" type="button" key={platform} aria-pressed="true" aria-label={`移除平台 ${platform}`} onClick={() => togglePlatform(platform)}>{platform}<X size={12} /></button>)}
          </div>
          <div className="platform-custom-input">
            <input aria-label="自定义平台" placeholder="其他平台，按 Enter 添加" value={customPlatform} onChange={(event) => setCustomPlatform(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                addCustomPlatforms();
              }
            }} />
            <button className="secondary-button" type="button" disabled={!customPlatform.trim()} onClick={addCustomPlatforms}>添加</button>
          </div>
        </fieldset>}
        <label>关键信息<textarea value={game.info} onChange={(event) => onChange("info", event.target.value)} /></label>
        <div className={`image-editor${isDragOver ? " is-drag-over" : ""}`} tabIndex={0} role="group" aria-label="游戏图片，可拖入图片或粘贴截图"
          onDragOver={(event) => {
            if (!Array.from(event.dataTransfer.types).includes("Files")) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setIsDragOver(true);
          }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsDragOver(false); }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setIsDragOver(false);
            const files = Array.from(event.dataTransfer.files);
            receiveImage(files.find((file) => file.type.startsWith("image/")) ?? files[0]);
          }}>
          {game.image && <img className="image-editor-preview" src={resolveLogoSrc(game.image)} alt={`${title}的海报图片`} />}
          <div className="image-editor-actions">
            <button className="secondary-button" type="button" onClick={() => fileInput.current?.click()}><ImagePlus size={16} />{game.image ? "替换图片" : "上传图片"}</button>
            {game.image && <>
              <button className="secondary-button" type="button" onClick={onRecrop}><Crop size={16} />重新裁剪</button>
              <button className="secondary-button" type="button" onClick={() => onChange("image", "")}><X size={16} />移除</button>
            </>}
          </div>
          <input ref={fileInput} aria-label="上传游戏图片" type="file" accept="image/*" hidden onChange={(event) => { receiveImage(event.target.files[0]); event.target.value = ""; }} />
          <span className="field-hint">可拖入图片，或点击此区域后粘贴截图。上传后可裁剪为 16:9。</span>
          {imageError && <span role="alert" className="field-hint">{imageError}</span>}
        </div>
      </div>}
    </article>
  );
}

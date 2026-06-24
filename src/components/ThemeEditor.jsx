import React, { useState, useEffect } from "react";
import { Check, X, Palette, Trash2 } from "lucide-react";
import { addCustomTheme } from "../data/themes";

export function ThemeEditor({ initialTheme, onSave, onCancel }) {
  const [theme, setTheme] = useState({
    id: `custom_${Date.now()}`,
    label: "自定义主题",
    logo: "CUSTOM",
    fontFamily: "'Noto Sans SC', 'Microsoft YaHei', Arial, sans-serif",
    bg: "#0f172a",
    panel: "rgba(15, 23, 42, 0.8)",
    card: "linear-gradient(90deg, #1e293b, #0f172a)",
    line: "#38bdf8",
    glow: "rgba(56, 189, 248, 0.5)",
    accent: "#7dd3fc",
    chipBg: "#0ea5e9",
    chipText: "#ffffff",
    titleShadow: "0 4px 12px rgba(0,0,0,0.5)",
    decor: "none",
    ...initialTheme,
  });

  const handleChange = (key, value) => setTheme((c) => ({ ...c, [key]: value }));

  return (
    <div className="theme-editor-panel">
      <div className="section-title">
        <span>自定义主题配置</span>
        <div style={{display: 'flex', gap: '8px'}}>
          <button className="secondary-button" onClick={onCancel} style={{padding: '0 8px', minHeight: '28px'}}><X size={14} /> 取消</button>
          <button className="primary-button" onClick={() => onSave(theme)} style={{padding: '0 8px', minHeight: '28px'}}><Check size={14} /> 保存</button>
        </div>
      </div>
      <div className="field-grid" style={{ paddingBottom: '16px' }}>
        <label>主题名称<input value={theme.label} onChange={(e) => handleChange("label", e.target.value)} /></label>
        <label>背景样式 (CSS)<input value={theme.bg} onChange={(e) => handleChange("bg", e.target.value)} /></label>
        <label>面板底色 (CSS)<input value={theme.panel} onChange={(e) => handleChange("panel", e.target.value)} /></label>
        <label>卡片渐变 (CSS)<input value={theme.card} onChange={(e) => handleChange("card", e.target.value)} /></label>
        <label>光晕颜色 (CSS)<input value={theme.glow} onChange={(e) => handleChange("glow", e.target.value)} /></label>
        <label>高亮线条色<input type="color" value={theme.line.length === 7 ? theme.line : "#ffffff"} onChange={(e) => handleChange("line", e.target.value)} /></label>
        <label>点缀强调色<input type="color" value={theme.accent.length === 7 ? theme.accent : "#ffffff"} onChange={(e) => handleChange("accent", e.target.value)} /></label>
        <label>标签背景色<input type="color" value={theme.chipBg.length === 7 ? theme.chipBg : "#ffffff"} onChange={(e) => handleChange("chipBg", e.target.value)} /></label>
        <label>标签文字色<input type="color" value={theme.chipText.length === 7 ? theme.chipText : "#ffffff"} onChange={(e) => handleChange("chipText", e.target.value)} /></label>
        <label>装饰元素
          <select value={theme.decor} onChange={(e) => handleChange("decor", e.target.value)}>
            <option value="none">无</option>
            <option value="symbols">PlayStation 符号</option>
            <option value="bubbles">SGF 气泡</option>
          </select>
        </label>
      </div>
    </div>
  );
}

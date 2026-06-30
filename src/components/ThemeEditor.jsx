import React, { useState, useEffect } from "react";
import { Check, X, ChevronDown, ChevronUp } from "lucide-react";
import { addCustomTheme } from "../data/themes";

/* ── 颜色工具函数 ── */

// hex → { r, g, b }
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0,
  };
}

// { r, g, b } → #rrggbb
function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
}

// "rgba(r,g,b,a)" → { hex, alpha }
function parseRgba(value) {
  const m = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (!m) return { hex: "#000000", alpha: 1 };
  return { hex: rgbToHex(+m[1], +m[2], +m[3]), alpha: m[4] !== undefined ? parseFloat(m[4]) : 1 };
}

// hex + alpha → "rgba(r,g,b,a)"
function buildRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// "linear-gradient(90deg, #aaa, #bbb)" → { color1, color2 }
function parseGradient(value) {
  const hexes = value.match(/#[0-9a-fA-F]{6}/g);
  if (hexes && hexes.length >= 2) return { color1: hexes[0], color2: hexes[1] };
  // 尝试匹配 rgba 颜色
  const rgbas = [...value.matchAll(/rgba?\([^)]+\)/g)];
  if (rgbas.length >= 2) return { color1: parseRgba(rgbas[0][0]).hex, color2: parseRgba(rgbas[1][0]).hex };
  return { color1: "#1e293b", color2: "#0f172a" };
}

function buildGradient(c1, c2) {
  return `linear-gradient(90deg, ${c1}, ${c2})`;
}

/* ── 可视化子控件 ── */

// 颜色 + 透明度滑条（用于 panel、glow）
function RgbaField({ label, value, onChange }) {
  const { hex, alpha } = parseRgba(value);
  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <div style={{ fontSize: "13px", color: "#94a3b8", marginBottom: "6px" }}>{label}</div>
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(buildRgba(e.target.value, alpha))}
          style={{ width: "48px", height: "38px", padding: 0, cursor: "pointer", border: "1px solid #334155", borderRadius: "6px", background: "transparent" }}
        />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#64748b" }}>
            <span>透明度</span>
            <span>{Math.round(alpha * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={alpha}
            onChange={(e) => onChange(buildRgba(hex, parseFloat(e.target.value)))}
            className="theme-editor-range"
          />
        </div>
      </div>
    </div>
  );
}

// 渐变控件（用于 card）
function GradientField({ label, value, onChange }) {
  const { color1, color2 } = parseGradient(value);
  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <div style={{ fontSize: "13px", color: "#94a3b8", marginBottom: "6px" }}>{label}</div>
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
          <input
            type="color"
            value={color1}
            onChange={(e) => onChange(buildGradient(e.target.value, color2))}
            style={{ width: "48px", height: "38px", padding: 0, cursor: "pointer", border: "1px solid #334155", borderRadius: "6px", background: "transparent" }}
          />
          <span style={{ fontSize: "10px", color: "#64748b" }}>起始色</span>
        </div>
        <span style={{ color: "#475569", fontSize: "18px" }}>→</span>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
          <input
            type="color"
            value={color2}
            onChange={(e) => onChange(buildGradient(color1, e.target.value))}
            style={{ width: "48px", height: "38px", padding: 0, cursor: "pointer", border: "1px solid #334155", borderRadius: "6px", background: "transparent" }}
          />
          <span style={{ fontSize: "10px", color: "#64748b" }}>结束色</span>
        </div>
        <div
          style={{
            flex: 1,
            height: "38px",
            borderRadius: "6px",
            background: buildGradient(color1, color2),
            border: "1px solid #334155",
          }}
          title="渐变预览"
        />
      </div>
    </div>
  );
}

// 背景色控件：色板 + 可展开的高级 CSS 输入
function BgField({ label, value, onChange }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isHex = /^#[0-9a-fA-F]{6}$/.test(value);
  // 对于非 hex 值，尝试提取第一个 hex 色作为色板默认值
  const displayHex = isHex ? value : (value.match(/#[0-9a-fA-F]{6}/)?.[0] ?? "#0f172a");

  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <div style={{ fontSize: "13px", color: "#94a3b8", marginBottom: "6px" }}>{label}</div>
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <input
          type="color"
          value={displayHex}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: "48px", height: "38px", padding: 0, cursor: "pointer", border: "1px solid #334155", borderRadius: "6px", background: "transparent" }}
        />
        <div
          style={{
            flex: 1,
            height: "38px",
            borderRadius: "6px",
            background: value,
            border: "1px solid #334155",
          }}
          title="背景预览"
        />
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            background: "none",
            border: "1px solid #334155",
            borderRadius: "6px",
            color: "#64748b",
            padding: "4px 8px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "11px",
          }}
          title="输入高级 CSS（如渐变）"
        >
          CSS
          {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>
      {showAdvanced && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="输入 CSS 背景值，如 linear-gradient(...)"
          style={{ marginTop: "8px", width: "100%", fontSize: "12px" }}
        />
      )}
    </div>
  );
}

/* ── 主编辑器组件 ── */

export function ThemeEditor({ initialTheme, onSave, onCancel, onPreview }) {
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
    cardTitle: "#ffffff",
    cardText: "#ffffff",
    ...initialTheme,
  });

  useEffect(() => {
    if (onPreview) onPreview(theme);
  }, []); // eslint-disable-next-line react-hooks/exhaustive-deps

  const handleChange = (key, value) => {
    setTheme((c) => {
      const updated = { ...c, [key]: value };
      if (onPreview) onPreview(updated);
      return updated;
    });
  };

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
        {/* 基本信息 */}
        <label>主题名称<input value={theme.label} onChange={(e) => handleChange("label", e.target.value)} /></label>

        {/* 可视化颜色控件 */}
        <BgField label="背景色" value={theme.bg} onChange={(v) => handleChange("bg", v)} />
        <RgbaField label="面板底色（颜色 + 透明度）" value={theme.panel} onChange={(v) => handleChange("panel", v)} />
        <GradientField label="卡片渐变（起始色 → 结束色）" value={theme.card} onChange={(v) => handleChange("card", v)} />
        <RgbaField label="光晕颜色（颜色 + 透明度）" value={theme.glow} onChange={(v) => handleChange("glow", v)} />

        {/* 原有的纯色选择器 */}
        <label>高亮线条色<input type="color" value={theme.line.length === 7 ? theme.line : "#ffffff"} onChange={(e) => handleChange("line", e.target.value)} /></label>
        <label>点缀强调色<input type="color" value={theme.accent.length === 7 ? theme.accent : "#ffffff"} onChange={(e) => handleChange("accent", e.target.value)} /></label>
        <label>标签背景色<input type="color" value={theme.chipBg.length === 7 ? theme.chipBg : "#ffffff"} onChange={(e) => handleChange("chipBg", e.target.value)} /></label>
        <label>标签文字色<input type="color" value={theme.chipText.length === 7 ? theme.chipText : "#ffffff"} onChange={(e) => handleChange("chipText", e.target.value)} /></label>
        <label>卡片标题色<input type="color" value={theme.cardTitle && theme.cardTitle.length === 7 ? theme.cardTitle : "#ffffff"} onChange={(e) => handleChange("cardTitle", e.target.value)} /></label>
        <label>卡片正文色<input type="color" value={theme.cardText && theme.cardText.length === 7 ? theme.cardText : "#ffffff"} onChange={(e) => handleChange("cardText", e.target.value)} /></label>
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

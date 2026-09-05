import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FolderArchive, Redo2, Save, Undo2 } from "lucide-react";

export function WorkspaceToolbar({ saveStatus, savedAt, canUndo, canRedo, undo, redo, onSave, busy, isSaving, isExporting, onExport, onCancelExport, onBackup, onImport, currentPage, pageCount, gameCount }) {
  const [menu, setMenu] = useState(null);
  const toolbarRef = useRef(null);
  const exportButton = useRef(null);
  const backupButton = useRef(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event) => {
      if (!toolbarRef.current?.contains(event.target)) setMenu(null);
    };
    const keyDown = (event) => {
      if (event.key === "Escape") {
        setMenu(null);
        (menu === "export" ? exportButton : backupButton).current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", keyDown);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", keyDown); };
  }, [menu]);
  const time = savedAt ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(savedAt) : "";
  const status = saveStatus === "error" ? "本机保存失败，请下载备份" : saveStatus === "saving" ? "正在保存到此浏览器…" : saveStatus === "saved" ? `已保存到此浏览器${time ? ` · ${time}` : ""}` : "本机项目";
  return (
    <header className="workspace-toolbar" ref={toolbarRef}>
      <div className="workspace-brand"><span className="brand-icon">G</span><div><h1>Gameshow Pic</h1><p>发布会一图流</p></div></div>
      <div className={`workspace-save-status ${saveStatus}`} role="status"><span className="status-dot" />{status}</div>
      <div className="workspace-actions">
        <div className="undo-actions">
          <button className="icon-button" type="button" onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)" aria-label="撤销"><Undo2 size={18} /></button>
          <button className="icon-button" type="button" onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)" aria-label="重做"><Redo2 size={18} /></button>
        </div>
        <button className="secondary-button save-button" type="button" onClick={onSave} disabled={busy}><Save size={16}/><span>{isSaving ? "保存中…" : "保存到本机"}</span></button>
        <div className="toolbar-popover-wrap">
          <button className="secondary-button" ref={backupButton} type="button" aria-expanded={menu === "backup"} aria-controls="backup-actions" onClick={() => setMenu(menu === "backup" ? null : "backup")} disabled={busy}><FolderArchive size={16}/>备份<ChevronDown size={14}/></button>
          {menu === "backup" && <div className="toolbar-popover" id="backup-actions" role="group" aria-label="项目备份操作">
            <p>换电脑或浏览器时，用项目包恢复。</p>
            <button type="button" onClick={() => { setMenu(null); onBackup(); }}><strong>下载项目备份</strong><small>ZIP · 包含本地图片与主题</small></button>
            <button type="button" onClick={() => { setMenu(null); onImport(); }}><strong>导入项目备份</strong><small>支持 ZIP 与旧版 JSON</small></button>
          </div>}
        </div>
        <div className="toolbar-popover-wrap">
          <button className="primary-button" ref={exportButton} type="button" aria-expanded={menu === "export"} aria-controls="export-actions" onClick={() => setMenu(menu === "export" ? null : "export")} disabled={isExporting}><Download size={16}/>{isExporting ? "导出中…" : "导出"}<ChevronDown size={14}/></button>
          {menu === "export" && <div className="toolbar-popover" id="export-actions" role="group" aria-label="导出选项">
            <p>{gameCount} 款游戏 · {pageCount} 页</p>
            <button type="button" onClick={() => { setMenu(null); onExport("current"); }}><strong>导出当前页</strong><small>第 {currentPage + 1} 页 · 1440 × 1920 PNG</small></button>
            <button type="button" onClick={() => { setMenu(null); onExport("all"); }}><strong>导出全部页面 (ZIP)</strong><small>{pageCount} 张独立 PNG，打包下载</small></button>
            <button type="button" onClick={() => { setMenu(null); onExport("long"); }}><strong>导出长图</strong><small>全部 {gameCount} 款游戏 · 1440 × 自动高度</small></button>
          </div>}
        </div>
        {isExporting && <button className="secondary-button" type="button" onClick={onCancelExport}>取消导出</button>}
      </div>
    </header>
  );
}

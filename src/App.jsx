import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { initialPoster } from "./data/sampleData";

import { themes as builtInThemes } from "./data/themes";
import { paginateGames } from "./utils/paginate";



import * as Core from "./utils/coreUtils";
import { MeasurementLayer, PosterPage } from "./components/PosterComponents";
import { useAutoSave } from "./hooks/useAutoSave";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { SortableGameList, SortableGameCard } from "./components/SortableGameList";
import { arrayMove } from "@dnd-kit/sortable";
import { PosterSettings } from "./components/PosterSettings.jsx";
import { WorkspaceToolbar } from "./components/WorkspaceToolbar.jsx";
import { CloudSync } from "./components/CloudSync.jsx";
import { TemplateLibrary } from "./components/TemplateLibrary.jsx";
import { createProjectFromTemplate } from "./utils/projectCreation.js";
import { GameEditor } from "./components/GameEditor.jsx";
import { BulkImport } from "./components/BulkImport.jsx";
import { ImageCropper } from "./components/ImageCropper";
import { loadProject, loadProjectIdentity, saveProject, loadProjectHistory, saveProjectHistory } from "./utils/projectStorage.js";
import { exportProjectBackup, importProjectBackup } from "./utils/projectBackup.js";

const {
  getInitialPoster, getInitialGithubToken, getThemeText, getPosterFonts,
  getPageFillSetting, cloneGame,
  uploadPosterImages, saveRemoteTemplate,
  getTemplateFields, formatHistoryTime, defaultInfoFontSize, defaultInfoFontWeight,
  normalizePosterTemplate,
  getInitialTemplateHistory, remoteTemplateUrl,
  fontOptions
} = Core;

function App() {
  const { state: poster, setState: setPoster, undo, redo, canUndo, canRedo, resetState } = useUndoRedo(getInitialPoster);
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isProjectBusy, setIsProjectBusy] = useState(false);
  const [projectEpoch, setProjectEpoch] = useState(0);
  const [projectIdentity, setProjectIdentity] = useState(null);
  const [hasLocalDraft, setHasLocalDraft] = useState(false);
  const [pendingExternal, setPendingExternal] = useState(null);
  const cloudController = useRef(null);
  const externalDialog = useRef(null);
  const initialContent = useRef(poster);
  const exportAbortRef = useRef(null);
  const busyRef = useRef(false);
  const latestPoster = useRef(poster);
  latestPoster.current = poster;
  const importRef = useRef(null);
  const { status: saveStatus, savedAt } = useAutoSave(poster, isReady && hasLocalDraft, 750, projectIdentity);
  const themes = useMemo(() => ({ ...Object.fromEntries(Object.entries(builtInThemes).filter(([id]) => !id.startsWith("custom_"))), ...(poster.customThemes ?? {}) }), [poster.customThemes]);
  const [githubToken, setGithubToken] = useState(getInitialGithubToken);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedGameId, setSelectedGameId] = useState(null);
  const [expandedGameId, setExpandedGameId] = useState(null);
  const [mobileView, setMobileView] = useState("editor");
  const editorPanelRef = useRef(null);
  const previewPanelRef = useRef(null);
  const [cardHeights, setCardHeights] = useState([]);
  const [templateMessage, setTemplateMessage] = useState("");
  const [templateHistory, setTemplateHistory] = useState(getInitialTemplateHistory);
  const [stitchPages, setStitchPages] = useState(false);
  const [showThemeEditor, setShowThemeEditor] = useState(false);
  const [cropState, setCropState] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [previewTheme, setPreviewTheme] = useState(null);
  const posterRef = useRef(null);
  const measureRef = useRef(null);

  const theme = previewTheme || themes[poster.theme] || themes.stateOfPlay;
  const posterFonts = getPosterFonts(poster, theme);
  const currentThemeText = getThemeText(poster, poster.theme);
  const currentLogoScale = poster.logoScales?.[poster.theme] ?? Core.defaultLogoScale;
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

  useEffect(() => {
    if (!selectedGameId || !poster.games.some((game) => game.id === selectedGameId)) {
      const id = poster.games[0]?.id ?? null;
      setSelectedGameId(id);
      setExpandedGameId(id);
    }
  }, [poster.games, selectedGameId]);

  useEffect(() => {
    if (!selectedGameId) return;
    const index = pages.findIndex((games) => games.some((game) => game.id === selectedGameId));
    if (index >= 0) setPageIndex(index);
  }, [pages, selectedGameId]);

  useEffect(() => {
    if (mobileView !== "preview" || !selectedGameId || !window.matchMedia("(max-width: 760px)").matches) return;
    let nextFrame;
    // The preview was hidden; let its ResizeObserver restore canvas scale first.
    const frame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(() => {
        const panel = previewPanelRef.current;
        const card = Array.from(panel?.querySelectorAll("[data-game-id]") ?? []).find((node) => node.dataset.gameId === selectedGameId);
        if (panel && card) panel.scrollTo({ top: panel.scrollTop + card.getBoundingClientRect().top - panel.getBoundingClientRect().top - 80 });
      });
    });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(nextFrame); };
  }, [mobileView, selectedGameId]);

  useEffect(() => {
    let ignore = false;
    let releaseLock;
    const lockRequest = new AbortController();
    let lockTimer;
    async function initialize() {
      try {
        const saved = await loadProject();
        if (ignore) return;
        if (saved) {
          const restored = normalizePosterTemplate(saved);
          initialContent.current = restored;
          resetState(restored);
          setHasLocalDraft(true);
          const identity = await loadProjectIdentity();
          if (ignore) return;
          setProjectIdentity(identity);
        } else if (localStorage.getItem(Core.templateStorageKey)) setHasLocalDraft(true);
        try {
          const history = await loadProjectHistory();
          if (!ignore && history.length) setTemplateHistory(history);
        } catch {
          if (!ignore) setTemplateMessage("当前草稿已恢复，但部分历史记录无法读取。请先下载项目备份。");
        }
        if (!ignore) setIsReady(true);
      } catch (error) {
        if (!ignore) setLoadError(`无法读取本机项目：${error.message}。请重试，原有草稿不会被覆盖。`);
      }
    }
    if (navigator.locks) {
      lockTimer = setTimeout(() => lockRequest.abort(), 500);
      navigator.locks.request("gameshow-picmake-editor", { signal: lockRequest.signal }, async () => {
        clearTimeout(lockTimer);
        if (ignore) return;
        const held = new Promise((resolve) => { releaseLock = resolve; });
        initialize();
        await held;
      }).catch((error) => {
        clearTimeout(lockTimer);
        if (!ignore) setLoadError(error.name === "AbortError"
          ? "项目已在另一个标签页打开。请关闭另一个编辑页面，再点击重新读取，避免草稿互相覆盖。"
          : `无法锁定本机项目：${error.message}`);
      });
    } else {
      setLoadError("当前浏览器不支持安全的多标签页保存，请使用新版 Chrome、Edge、Firefox 或 Safari。");
    }
    return () => { ignore = true; clearTimeout(lockTimer); lockRequest.abort(); releaseLock?.(); };
  }, [resetState]);

  useEffect(() => {
    if (isReady && poster !== initialContent.current) setHasLocalDraft(true);
  }, [poster, isReady]);

  useEffect(() => {
    if (pendingExternal && !externalDialog.current?.open) externalDialog.current?.showModal();
  }, [pendingExternal]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable=true]")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

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
    isReady,
    poster.games,
    theme,
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
    if (showThemeEditor === "copy") return;
    setPoster((current) => ({
      ...current,
      logoPositions: {
        ...(current.logoPositions ?? {}),
        [themeId]: position,
      },
    }));
  }

  function updateLogoScale(themeId, scale) {
    setPoster((current) => ({
      ...current,
      logoScales: {
        ...(current.logoScales ?? {}),
        [themeId]: Math.min(Core.maxLogoScale, Math.max(Core.minLogoScale, Number(scale))),
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

  function addGame() {
    if (poster.games.length >= 1000) { setTemplateMessage("每个项目最多 1000 款游戏，请新建项目备份后分开编辑。"); return; }
    const game = cloneGame();
    selectGame(game.id, "preview");
    setPoster((current) => ({
      ...current,
      games: [...current.games, game],
    }));
  }

  function removeGame(index) {
    setPoster((current) => ({
      ...current,
      games: current.games.filter((_, gameIndex) => gameIndex !== index),
    }));
    setPageIndex(0);
    setTemplateMessage("游戏已删除，可点击撤销恢复。");
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

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setPoster((current) => {
      const oldIndex = current.games.findIndex((g) => g.id === active.id);
      const newIndex = current.games.findIndex((g) => g.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return current;
      return {
        ...current,
        games: arrayMove(current.games, oldIndex, newIndex),
      };
    });
  }

  function restoreHistory(historyItem) {
    try {
      const restored = historyItem.poster ?? { ...initialPoster, ...(historyItem.template ?? historyItem), games: historyItem.games ?? initialPoster.games };
      setPendingExternal({ poster: normalizePosterTemplate(restored), title: `历史记录：${historyItem.projectName || '旧版未标记项目'}`, target: cloudController.current?.getIdentity() });
    } catch (error) { setTemplateMessage(`恢复失败：${error.message}`); }
  }

  async function applyExternal(mode) {
    if (!pendingExternal || busyRef.current) return;
    if (cloudController.current?.isBusy?.()) {
      setTemplateMessage('云端操作正在进行，请稍后再试。');
      return;
    }
    busyRef.current = true;
    setIsProjectBusy(true);
    const original = latestPoster.current;
    const identity = cloudController.current?.getIdentity();
    try {
      if (mode === 'replace' && (!identity?.projectId || identity.projectId !== pendingExternal.target?.projectId)) throw new Error('当前项目已变化，请取消并重新选择目标。');
      setTemplateHistory(await saveProjectHistory(original, identity));
      if (latestPoster.current !== original) throw new Error('备份期间内容已修改，请重试。');
      if (mode === 'new' && cloudController.current?.detach() === false) throw new Error('请等待云端操作完成后再试。');
      const restored = pendingExternal.poster;
      if (mode === 'new') {
        setProjectIdentity(null);
        resetState(restored);
        setProjectEpoch((value) => value + 1);
      } else setPoster(restored);
      setHasLocalDraft(true);
      setPreviewTheme(null);
      setShowThemeEditor(false);
      setSelectedGameId(null);
      setExpandedGameId(null);
      setPageIndex(0);
      setPendingExternal(null);
      setTemplateMessage(mode === 'new' ? '已载入独立草稿，原云端项目未被替换。请在“历史项目”填写名称并保存为新项目。' : `已明确替换“${identity.projectName}”，原内容已备份到本机历史。`);
    } catch (error) { setTemplateMessage(error.message); }
    finally { busyRef.current = false; setIsProjectBusy(false); }
  }

  function readImage(file, onLoad) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) {
      setTemplateMessage("请选择 20 MB 以内的图片。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onLoad(reader.result);
    reader.onerror = () => setTemplateMessage("图片读取失败，请重新选择。");
    reader.readAsDataURL(file);
  }

  function handleImage(index, file) {
    const gameId = poster.games[index].id;
    readImage(file, (imageSrc) => setCropState({ gameId, imageSrc }));
  }

  function handleCropComplete(dataUrl) {
    if (!cropState) return;
    setPoster((current) => ({ ...current, games: current.games.map((game) => game.id === cropState.gameId ? { ...game, image: dataUrl } : game) }));
    setCropState(null);
  }

  function handleLogoImage(file) {
    const themeId = poster.theme;
    readImage(file, (source) => setPoster((current) => ({ ...current, logoImages: { ...current.logoImages, [themeId]: source } })));
  }

  function handleFooterLogoImage(file) {
    readImage(file, (source) => updatePoster("footerLogoImage", source));
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

  function applyParsedGames(games, mode) {
    const parsedGames = games.map(cloneGame);
    if (!parsedGames.length || parsedGames.length + (mode === "append" ? poster.games.length : 0) > 1000) return;
    setPoster((current) => ({ ...current, games: mode === "replace" ? parsedGames : [...current.games, ...parsedGames] }));
    selectGame(parsedGames[0].id, "preview");
    setTemplateMessage(`已${mode === "replace" ? "替换" : "追加"} ${parsedGames.length} 款游戏，可撤销本次导入。`);
  }

  function selectGame(gameId, source = "editor") {
    setSelectedGameId(gameId);
    setExpandedGameId(gameId);
    const page = pages.findIndex((games) => games.some((game) => game.id === gameId));
    if (page >= 0) setPageIndex(page);
    if (source === "preview") setMobileView("editor");
    requestAnimationFrame(() => {
      const panel = source === "preview" ? editorPanelRef.current : previewPanelRef.current;
      const selector = source === "preview" ? "[data-editor-game-id]" : "[data-game-id]";
      const card = Array.from(panel?.querySelectorAll(selector) ?? []).find((node) => (source === "preview" ? node.dataset.editorGameId : node.dataset.gameId) === gameId);
      if (panel && card && panel.getClientRects().length) {
        const panelRect = panel.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        panel.scrollTo({ top: panel.scrollTop + cardRect.top - panelRect.top - 80, behavior: "smooth" });
        if (source === "preview") card.querySelector(".game-summary-toggle")?.focus({ preventScroll: true });
      }
    });
  }

  function recropGame(game) {
    if (game.image) setCropState({ gameId: game.id, imageSrc: Core.resolveLogoSrc(game.image) });
  }

  async function saveTemplate() {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsSaving(true);
    try {
      const snapshot = latestPoster.current;
      await saveProject(snapshot, cloudController.current?.getIdentity());
      setTemplateHistory(await saveProjectHistory(snapshot, cloudController.current?.getIdentity()));
      setTemplateMessage("项目、图片和主题已完整保存在本机。建议定期下载项目备份。");
    } catch (error) { setTemplateMessage(`本机保存失败：${error.message}。请下载项目备份。`); }
    finally { busyRef.current = false; setIsSaving(false); }
  }

  async function publishTemplate() {
    if (busyRef.current || !githubToken.trim()) return;
    busyRef.current = true;
    setIsSyncing(true);
    const snapshot = latestPoster.current;
    try {
      await saveProject(snapshot, cloudController.current?.getIdentity());
      const synced = await uploadPosterImages(snapshot, githubToken.trim(), (current, total) => setTemplateMessage(`正在发布图片 ${current}/${total}…`));
      await saveRemoteTemplate(getTemplateFields(synced), githubToken.trim());
      setTemplateMessage("已将点击发布时的版本发布到公开 GitHub 页面；当前本地编辑已保留。");
    } catch (error) { setTemplateMessage(`发布失败：${error.message}`); }
    finally { busyRef.current = false; setIsSyncing(false); }
  }

  async function loadPublishedTemplate() {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsProjectBusy(true);
    const original = latestPoster.current;
    try {
      const response = await fetch(`${remoteTemplateUrl}?v=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(response.status === 404 ? "还没有线上模板" : `请求失败 ${response.status}`);
      const restored = normalizePosterTemplate(await response.json());
      if (latestPoster.current !== original) throw new Error("下载期间项目已修改，请再次点击载入");
      setPendingExternal({ poster: restored, title: '线上发布内容', target: cloudController.current?.getIdentity() });
    } catch (error) { setTemplateMessage(`载入失败：${error.message}`); }
    finally { busyRef.current = false; setIsProjectBusy(false); }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function backupProject() {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsProjectBusy(true);
    try {
      const snapshot = latestPoster.current;
      downloadBlob(await exportProjectBackup(snapshot), `Gameshow-项目-${new Date().toISOString().slice(0, 10)}.zip`);
      setTemplateMessage("项目备份已下载，包含本地图片和自定义主题，可在另一浏览器导入。");
    } catch (error) { setTemplateMessage(`备份失败：${error.message}`); }
    finally { busyRef.current = false; setIsProjectBusy(false); }
  }

  async function importProject(file) {
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setIsProjectBusy(true);
    const original = latestPoster.current;
    try {
      const restored = normalizePosterTemplate(await importProjectBackup(file));
      if (latestPoster.current !== original) throw new Error("导入期间项目已修改，请重新导入");
      setPendingExternal({ poster: restored, title: file.name, target: cloudController.current?.getIdentity() });
    } catch (error) { setTemplateMessage(`导入失败：${error.message}`); }
    finally { busyRef.current = false; setIsProjectBusy(false); }
  }

  async function exportImages(mode = "current") {
    const allPages = mode === "all";
    const long = mode === "long";
    if (exportAbortRef.current) return;
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setIsExporting(true);
    const snapshot = poster;
    const snapshotTheme = theme;
    const common = { poster: snapshot, theme: snapshotTheme, infoFontSize: snapshot.infoFontSize ?? defaultInfoFontSize };
    try {
      const { renderPosterImage } = await import("./utils/exportPoster.jsx");
      if (allPages) {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        for (let index = 0; index < pages.length; index += 1) {
          setTemplateMessage(`正在导出第 ${index + 1}/${pages.length} 页…`);
          const blob = await renderPosterImage({ ...common, pageGames: pages[index], pageOffset: pageStartOffsets[index], fillSpace: getPageFillSetting(snapshot, index), isFullCardPage: snapshot.compactFollowupPages && index > 0 }, controller.signal);
          zip.file(`page-${index + 1}.png`, blob);
        }
        const archive = await zip.generateAsync({ type: "blob" });
        controller.signal.throwIfAborted();
        downloadBlob(archive, `${snapshotTheme.label}-全部${pages.length}页.zip`);
      } else {
        setTemplateMessage("正在生成图片…");
        const blob = await renderPosterImage({ ...common, pageGames: long ? snapshot.games : pages[currentPage], pageOffset: long ? 0 : pageStartOffsets[currentPage], fillSpace: long ? false : getPageFillSetting(snapshot, currentPage), isFullCardPage: !long && snapshot.compactFollowupPages && currentPage > 0, isLongPoster: long }, controller.signal);
        downloadBlob(blob, `${snapshotTheme.label}-${long ? "long" : `page-${currentPage + 1}`}.png`);
      }
      setTemplateMessage("导出完成。");
    } catch (error) {
      setTemplateMessage(controller.signal.aborted ? "已取消导出。" : `导出失败：${error.message}`);
    } finally {
      exportAbortRef.current = null;
      setIsExporting(false);
    }
  }

  if (!isReady) return <main style={{ padding: 24 }}><p role="status">{loadError || "正在读取本机项目…"}</p>{loadError && <button onClick={() => window.location.reload()}>重新读取</button>}</main>;

  return (
    <main className={`app-shell mobile-${mobileView}`}>
      {pendingExternal && <dialog className="external-project-dialog" ref={externalDialog} onCancel={(event) => { event.preventDefault(); if (!isProjectBusy) setPendingExternal(null); }}>
        <h2>载入项目内容</h2>
        <p>{pendingExternal.title} · {pendingExternal.poster.games.length} 张卡片</p>
        <p>默认作为独立草稿载入，不会替换现有云端项目。原本机内容会先备份。</p>
        <div className="bulk-actions">
          <button className="primary-button" disabled={isProjectBusy} onClick={() => applyExternal('new')}>载入为独立项目</button>
          {pendingExternal.target?.projectId && <button className="secondary-button" disabled={isProjectBusy} onClick={() => applyExternal('replace')}>替换当前项目：{pendingExternal.target.projectName}</button>}
          <button className="secondary-button" disabled={isProjectBusy} onClick={() => setPendingExternal(null)}>取消</button>
        </div>
      </dialog>}
      <WorkspaceToolbar saveStatus={saveStatus} savedAt={savedAt} canUndo={canUndo} canRedo={canRedo} undo={undo} redo={redo} onSave={saveTemplate} busy={isSaving || isSyncing || isProjectBusy} isSaving={isSaving} isExporting={isExporting} onExport={exportImages} onCancelExport={() => exportAbortRef.current?.abort()} onBackup={backupProject} onImport={() => importRef.current?.click()} currentPage={currentPage} pageCount={pages.length} gameCount={poster.games.length}/>
      <input ref={importRef} hidden type="file" accept=".zip,.json" onChange={(event) => { const file = event.target.files[0]; event.target.value = ""; importProject(file); }} />
      <nav className="mobile-workspace-tabs" aria-label="工作区视图">
        <button type="button" aria-pressed={mobileView === "editor"} onClick={() => setMobileView("editor")}>编辑内容</button>
        <button type="button" aria-pressed={mobileView === "preview"} onClick={() => setMobileView("preview")}>查看预览</button>
      </nav>
      <section className="editor-panel" ref={editorPanelRef} aria-label="项目编辑">
        <CloudSync controllerRef={cloudController} hasLocalDraft={hasLocalDraft} localIdentity={projectIdentity} onIdentityChange={setProjectIdentity} poster={poster} enabled={isReady && !isProjectBusy && !showThemeEditor && !cropState} onNewProject={() => createProjectFromTemplate(latestPoster.current)} onLoad={(project, options) => {
          const normalized = normalizePosterTemplate(project);
          setHasLocalDraft(true);
          if (options?.resetHistory) {
            resetState(normalized);
            setProjectEpoch((value) => value + 1);
            setSelectedGameId(null);
            setExpandedGameId(null);
          } else setPoster(normalized);
          setPreviewTheme(null);
          setPageIndex(0);
        }} onPreserve={async (project, identity) => { setTemplateHistory(await saveProjectHistory(project, identity)); }} />
        <div className="project-heading"><h2>编辑内容</h2><span>{poster.games.length} 款游戏</span></div>
        <PosterSettings {...{ poster, themes, currentThemeText, currentLogoScale, updatePoster, updateThemeText, updateLogoScale, chooseLibraryLogo, handleLogoImage, handleFooterLogoImage, setPoster, setPageIndex, showThemeEditor, setShowThemeEditor, setPreviewTheme }} />
        <TemplateLibrary poster={poster} onApply={setPoster} enabled={isReady && !isProjectBusy && !showThemeEditor && !cropState} />
        <BulkImport key={projectEpoch} currentCount={poster.games.length} onApply={applyParsedGames}/>
        <div className="games-editor">
          <div className="section-title"><span>游戏列表</span><div className="list-actions">
            {expandedGameId && <button type="button" className="text-button" onClick={() => setExpandedGameId(null)}>收起编辑</button>}
            <button type="button" onClick={addGame}><Plus size={16}/>添加游戏</button>
          </div></div>
          <p className="field-hint">点击游戏编辑，也可以直接点击右侧预览卡片。</p>
          {poster.games.length === 0 && <div className="empty-games"><p>还没有游戏内容</p><span>添加一款游戏，或展开“批量导入”粘贴发布会信息。</span><button className="secondary-button" type="button" onClick={addGame}>添加第一款游戏</button></div>}
          <SortableGameList items={poster.games.map(game => game.id)} onDragStart={() => setIsDragging(true)} onDragCancel={() => setIsDragging(false)} onDragEnd={(event) => { setIsDragging(false); handleDragEnd(event); }}>
            {poster.games.map((game, index) => <SortableGameCard id={game.id} key={game.id}>
              <div data-editor-game-id={game.id} className={selectedGameId === game.id ? "selected-editor-game" : ""}>
                <GameEditor game={game} index={index} total={poster.games.length} isExpanded={!isDragging && expandedGameId === game.id} onSelect={() => { if (expandedGameId === game.id) setExpandedGameId(null); else selectGame(game.id); }} onChange={(key, value) => updateGame(index, key, value)} onMove={(direction) => moveGame(index, direction)} onRemove={() => removeGame(index)} onImage={(file) => handleImage(index, file)} onRecrop={() => recropGame(game)}/>
              </div>
            </SortableGameCard>)}
          </SortableGameList>
        </div>
        <details className="settings-section history-section"><summary>本机历史记录 <span>{templateHistory.length} 条</span></summary>
          <div className="history-list">{templateHistory.map((item, index) => <button key={item.id ?? `${item.savedAt}-${index}`} type="button" onClick={() => restoreHistory(item)}>{item.projectName || "旧版未标记项目"} · {formatHistoryTime(item.savedAt)} · {themes[item.poster?.theme ?? item.template?.theme]?.label ?? "模板"}</button>)}{!templateHistory.length && <p className="field-hint">点击“保存到本机”可保留完整历史版本。</p>}</div>
        </details>
          <details className="wide-field">
            <summary>线上发布（可选）</summary>
            <p>发布会把文字和图片写入公开 GitHub 仓库。日常本机保存无需 PAT。</p>
            <label>GitHub PAT（仅本次会话）
              <input autoComplete="off" placeholder="github_pat_..." type="password" value={githubToken} onChange={(event) => setGithubToken(event.target.value)} />
            </label>
            <div className="bulk-actions">
              <button type="button" onClick={publishTemplate} disabled={!githubToken.trim() || isSyncing || isSaving || isProjectBusy}>{isSyncing ? "发布中…" : "发布到公开 GitHub"}</button>
              <button type="button" onClick={() => setGithubToken("")}>清除凭证</button>
              <button type="button" onClick={loadPublishedTemplate} disabled={isSyncing || isSaving || isProjectBusy}>载入线上版本</button>
            </div>
          </details>

        <datalist id="poster-fonts">{fontOptions.map((font) => <option value={font} key={font}/>)}</datalist>
      </section>
      <section className="preview-panel" ref={previewPanelRef} aria-label="海报预览">
        <div className="preview-tools">
          <div className="preview-mode" role="group" aria-label="预览模式"><button type="button" aria-pressed={!stitchPages} onClick={() => setStitchPages(false)}>分页预览</button><button type="button" aria-pressed={stitchPages} onClick={() => setStitchPages(true)}>长图预览</button></div>
          <span>{stitchPages ? "1440 × 自动高度" : `1440 × 1920 · 共 ${pages.length} 页`}</span>
        </div>
        {!stitchPages && <div className="preview-pagination"><div className="page-tabs">{pages.map((_, index) => <button key={index} className={index === currentPage ? "active" : ""} aria-current={index === currentPage ? "page" : undefined} type="button" onClick={() => { setPageIndex(index); previewPanelRef.current?.querySelector(`[data-preview-page="${index}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>第 {index + 1} 页</button>)}</div><label className="toggle-field page-fill-toggle"><input checked={currentPageFill} type="checkbox" onChange={(event) => updateCurrentPageFill(event.target.checked)}/>当前页补齐空白</label></div>}
        <div className="preview-pages">
          {stitchPages ? <div className="long-poster-preview"><PosterPage infoFontSize={poster.infoFontSize ?? defaultInfoFontSize} isFullCardPage={false} pageGames={poster.games} pageOffset={0} fillSpace={false} onLogoPositionChange={updateLogoPosition} poster={poster} posterRef={posterRef} theme={theme} isLongPoster={true} selectedGameId={selectedGameId} onGameSelect={(id) => selectGame(id, "preview")}/></div> : pages.map((pageGames, index) => <div key={`preview-page-${index}`} data-preview-page={index} className="poster-scale-wrap"><PosterPage infoFontSize={poster.infoFontSize ?? defaultInfoFontSize} isFullCardPage={poster.compactFollowupPages && index > 0} pageGames={pageGames} pageOffset={pageStartOffsets[index] ?? 0} fillSpace={getPageFillSetting(poster, index)} onLogoPositionChange={index === currentPage ? updateLogoPosition : () => {}} poster={poster} posterRef={index === currentPage ? posterRef : null} theme={theme} selectedGameId={selectedGameId} onGameSelect={(id) => selectGame(id, "preview")}/></div>)}
        </div>
      </section>
      <MeasurementLayer fonts={posterFonts} games={poster.games} infoFontSize={poster.infoFontSize ?? defaultInfoFontSize} infoFontWeight={poster.infoFontWeight ?? defaultInfoFontWeight} measureRef={measureRef} showGameInfo={poster.showGameInfo ?? true} theme={theme}/>
      {templateMessage && <div className="workspace-message" role="status"><span>{templateMessage}</span><button type="button" aria-label="关闭提示" onClick={() => setTemplateMessage("")}>×</button></div>}
      {cropState && <ImageCropper imageSrc={cropState.imageSrc} onCropComplete={handleCropComplete} onCancel={() => setCropState(null)}/>}
    </main>
  );
}

export default App;

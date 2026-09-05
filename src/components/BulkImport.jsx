import { useId, useState } from "react";
import { parseGamesFromText } from "../utils/parseGames";

const MAX_GAMES = 1000;
const isUnannounced = (value) => !String(value || "").trim() || /待公布|未公布|待定|未定|未知|TBA|TBD|Coming Soon|即将推出/i.test(value);

export function BulkImport({ onApply, currentCount = 0 }) {
  const id = useId();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [mode, setMode] = useState("append");
  const [message, setMessage] = useState("");
  const [applying, setApplying] = useState(false);
  const resultingCount = (preview?.length || 0) + (mode === "append" ? currentCount : 0);
  const exceedsLimit = resultingCount > MAX_GAMES;

  function changeText(event) {
    setText(event.target.value);
    if (preview !== null) setMessage("内容已修改，请重新识别后导入。");
    setPreview(null);
  }

  function recognize() {
    const games = parseGamesFromText(text);
    setPreview(games);
    setMessage(games.length ? `识别到 ${games.length} 款游戏，请核对后确认导入。` : "没有识别到游戏，请填写内容后重试。");
  }

  async function apply() {
    if (!preview?.length || exceedsLimit || applying) return;
    setApplying(true);
    try {
      await onApply(preview, mode);
      setMessage(`已${mode === "append" ? "追加" : "替换为"} ${preview.length} 款游戏，可使用撤销恢复。`);
      setPreview(null);
      setText("");
    } catch (error) {
      setMessage(`导入失败：${error instanceof Error ? error.message : "请重试"}`);
    } finally {
      setApplying(false);
    }
  }

  return (
    <details className="bulk-import">
      <summary>批量导入</summary>
      <label htmlFor={`${id}-text`}>粘贴游戏信息</label>
      <p className="field-hint" id={`${id}-help`}>每款游戏以《游戏名称》开头，填写发售日期、登陆平台和关键信息；也可用空行分隔游戏。最多导入 {MAX_GAMES} 款。</p>
      <textarea
        id={`${id}-text`}
        className="bulk-textarea"
        rows={7}
        value={text}
        onChange={changeText}
        disabled={applying}
        aria-describedby={`${id}-help`}
        placeholder={"《游戏名称》\n发售日期：2026年9月5日\n登陆平台：PC、PS5\n关键信息：支持中文"}
      />
      <button className="secondary-button" type="button" onClick={recognize} disabled={!text.trim() || applying}>预览识别结果</button>
      <p className="field-hint" role="status" aria-live="polite">{message}</p>
      {preview !== null && preview.length > 0 && (
        <div className="import-preview">
          <h3 id={`${id}-preview-title`}>识别结果 · {preview.length} 款游戏</h3>
          <div className="import-preview-list" role="region" aria-labelledby={`${id}-preview-title`} tabIndex={0} style={{ maxHeight: "360px", overflowY: "auto" }}>
            {preview.slice(0, MAX_GAMES).map((game, index) => {
              const missingDate = isUnannounced(game.date);
              const missingPlatforms = !game.platforms?.length || game.platforms.some(isUnannounced);
              return (
                <article className="import-entry" key={index}>
                  <h4>{index + 1}. {game.title}</h4>
                  <dl>
                    <dt>日期</dt><dd>{game.date || "待公布"}</dd>
                    <dt>平台</dt><dd>{game.platforms?.join("、") || "待公布"}</dd>
                    <dt>关键信息</dt><dd>{game.info || "未填写"}</dd>
                  </dl>
                  {(missingDate || missingPlatforms) && <p className="field-hint">待核对：{[missingDate && "日期缺失或待公布", missingPlatforms && "平台缺失或待公布"].filter(Boolean).join("；")}。可导入后补充。</p>}
                </article>
              );
            })}
          </div>
          {preview.length > MAX_GAMES && <p className="field-hint">仅展示前 {MAX_GAMES} 款，请减少内容后重新识别。</p>}
          <fieldset disabled={applying}>
            <legend>导入方式</legend>
            <label htmlFor={`${id}-append`}><input id={`${id}-append`} type="radio" name={`${id}-mode`} value="append" checked={mode === "append"} onChange={() => setMode("append")} />追加到现有游戏</label>
            <label htmlFor={`${id}-replace`}><input id={`${id}-replace`} type="radio" name={`${id}-mode`} value="replace" checked={mode === "replace"} onChange={() => setMode("replace")} />替换全部游戏</label>
          </fieldset>
          <p className="field-hint">{mode === "replace" ? `当前 ${currentCount} 款游戏将被替换，可使用撤销恢复。` : `导入后共 ${resultingCount} 款游戏。`}</p>
          {exceedsLimit && <p className="field-hint" role="alert">项目最多保存 {MAX_GAMES} 款游戏，当前导入后将有 {resultingCount} 款。请减少导入内容或调整导入方式。</p>}
          <button className="primary-button" type="button" onClick={apply} disabled={!preview.length || exceedsLimit || applying}>{applying ? "正在导入…" : `确认${mode === "append" ? "追加" : "替换"} ${preview.length} 款游戏`}</button>
        </div>
      )}
    </details>
  );
}

export default BulkImport;

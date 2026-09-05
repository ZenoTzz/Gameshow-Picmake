import { withAbort } from "./asyncUtils.js";
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { toBlob } from "html-to-image";
import { PosterPage } from "../components/PosterComponents.jsx";
import { waitForExportAssets } from "./coreUtils.js";

export async function renderPosterImage(props, signal) {
  signal?.throwIfAborted();
  const stage = document.createElement("div");
  stage.className = "export-stage";
  stage.setAttribute("aria-hidden", "true");
  stage.inert = true;
  document.body.append(stage);
  const root = createRoot(stage);
  try {
    flushSync(() => root.render(<PosterPage {...props} posterRef={null} onLogoPositionChange={() => {}} />));
    const node = stage.querySelector(".poster");
    await waitForExportAssets(node, 15000, signal);
    signal?.throwIfAborted();
    const height = props.isLongPoster ? Math.ceil(node.scrollHeight) : 1920;
    if (height > 16000) throw new Error("长图超过 16000 像素，请使用“导出全部页面 (ZIP)”分段下载");
    const list = node.querySelector(".poster-list");
    if (!props.isLongPoster && list.scrollHeight > list.clientHeight + 1) {
      throw new Error("本页文字超出画布，请缩短内容、减小字号，或切换长图导出");
    }
    stage.style.height = `${height}px`;
    let timer;
    const blob = await withAbort(Promise.race([
      toBlob(node, { width: 1440, height, pixelRatio: 1, cacheBust: false }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("导出超时，请减少图片数量后重试")), 60000); }),
    ]), signal).finally(() => clearTimeout(timer));
    signal?.throwIfAborted();
    if (!blob) throw new Error("浏览器无法生成图片，请尝试分页导出");
    return blob;
  } finally {
    root.unmount();
    stage.remove();
  }
}

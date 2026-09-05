import React, { useState, useCallback, useEffect, useRef } from "react";
import Cropper from "react-easy-crop";

export function ImageCropper({ imageSrc, onCropComplete, onCancel }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef(null);
  const cancelRef = useRef(onCancel);
  const activeRef = useRef(true);
  const busyRef = useRef(false);
  useEffect(() => { cancelRef.current = onCancel; }, [onCancel]);
  useEffect(() => {
    activeRef.current = true;
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelRef.current();
      }
      if (event.key === "Tab") {
        const controls = Array.from(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]') || []);
        const first = controls[0];
        const last = controls.at(-1);
        if (!controls.length) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      activeRef.current = false;
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const onCropCompleteHandler = useCallback((_, area) => setCroppedAreaPixels(area), []);

  const createCroppedImage = async () => {
    if (busyRef.current || !croppedAreaPixels?.width || !croppedAreaPixels?.height) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const image = await createImage(imageSrc);
      if (!activeRef.current) return;
      const canvas = document.createElement("canvas");
      const area = croppedAreaPixels;
      const scale = Math.min(1, 1472 / area.width, 828 / area.height);
      canvas.width = Math.max(1, Math.round(area.width * scale));
      canvas.height = Math.max(1, Math.round(area.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("浏览器无法创建图片画布");
      ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
      await onCropComplete(canvas.toDataURL("image/jpeg", 0.9));
    } catch (e) {
      if (activeRef.current) setError(e.message || "图片裁剪失败，请重试或选择其他图片。");
    } finally {
      busyRef.current = false;
      if (activeRef.current) setBusy(false);
    }
  };

  return (
    <div className="crop-modal-overlay">
      <div className="crop-modal" role="dialog" aria-modal="true" aria-label="裁剪游戏图片" tabIndex={-1} ref={dialogRef}>
        <div className="crop-container" style={{ position: "relative", width: "100%", height: "min(400px, 60vh)", background: "#333" }}>
          <Cropper image={imageSrc} crop={crop} zoom={zoom} aspect={16 / 9}
            onCropChange={setCrop} onCropComplete={onCropCompleteHandler} onZoomChange={setZoom}
            onMediaLoad={() => setError("")}
            mediaProps={{ onError: () => { setCroppedAreaPixels(null); setError("图片加载失败，请取消并重新选择图片。"); } }}
          />
        </div>
        <label style={{ padding: "12px 16px" }}>缩放
          <input aria-label="图片缩放" type="range" min="1" max="3" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        </label>
        {error && <p role="alert" style={{ margin: "0 16px 12px", color: "#fca5a5" }}>{error}</p>}
        <div className="crop-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "12px", padding: "16px", background: "#1e293b" }}>
          <button className="secondary-button" onClick={onCancel}>取消</button>
          <button className="primary-button" disabled={busy || !croppedAreaPixels} onClick={createCroppedImage}>{busy ? "正在裁剪…" : "确认裁剪"}</button>
        </div>
      </div>
    </div>
  );
}

const createImage = (url) => new Promise((resolve, reject) => {
  const image = new Image();
  const finish = (error) => {
    clearTimeout(timeout);
    image.onload = null;
    image.onerror = null;
    if (error) reject(error);
    else resolve(image);
  };
  const timeout = setTimeout(() => finish(new Error("图片加载超时，请重试。")), 15000);
  image.onload = () => finish(image.naturalWidth ? null : new Error("图片尺寸无效。"));
  image.onerror = () => finish(new Error("无法读取图片，请重新选择图片。"));
  image.crossOrigin = "anonymous";
  image.src = url;
});

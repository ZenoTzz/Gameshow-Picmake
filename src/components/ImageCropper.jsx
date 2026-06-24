import React, { useState, useCallback } from "react";
import Cropper from "react-easy-crop";

export function ImageCropper({ imageSrc, onCropComplete, onCancel }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);

  const onCropCompleteHandler = useCallback((croppedArea, croppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const createCroppedImage = async () => {
    try {
      const image = await createImage(imageSrc);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      canvas.width = croppedAreaPixels.width;
      canvas.height = croppedAreaPixels.height;

      ctx.drawImage(
        image,
        croppedAreaPixels.x,
        croppedAreaPixels.y,
        croppedAreaPixels.width,
        croppedAreaPixels.height,
        0,
        0,
        croppedAreaPixels.width,
        croppedAreaPixels.height
      );

      const base64Image = canvas.toDataURL("image/jpeg", 0.9);
      onCropComplete(base64Image);
    } catch (e) {
      console.error(e);
      onCancel();
    }
  };

  return (
    <div className="crop-modal-overlay">
      <div className="crop-modal">
        <div className="crop-container" style={{ position: "relative", width: "100%", height: "400px", background: "#333" }}>
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={16 / 9}
            onCropChange={setCrop}
            onCropComplete={onCropCompleteHandler}
            onZoomChange={setZoom}
          />
        </div>
        <div className="crop-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "12px", padding: "16px", background: "#1e293b" }}>
          <button className="secondary-button" onClick={onCancel}>取消</button>
          <button className="primary-button" onClick={createCroppedImage}>确认裁剪</button>
        </div>
      </div>
    </div>
  );
}

const createImage = (url) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (error) => reject(error));
    image.setAttribute("crossOrigin", "anonymous");
    image.src = url;
  });

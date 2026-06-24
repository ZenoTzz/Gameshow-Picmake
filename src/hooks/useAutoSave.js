import { useEffect, useRef, useState } from "react";
import { persistLocalTemplate } from "../utils/coreUtils";

export function useAutoSave(poster, delay = 1500) {
  const [saveStatus, setSaveStatus] = useState("idle"); // "idle" | "saving" | "saved" | "error"
  const timerRef = useRef(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // 跳过首次渲染（页面加载时不触发自动保存）
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    
    setSaveStatus("saving");
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        persistLocalTemplate(poster);
        setSaveStatus("saved");
        // 2 秒后隐藏"已保存"提示
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("error");
      }
    }, delay);

    return () => clearTimeout(timerRef.current);
  }, [poster, delay]);

  return saveStatus;
}

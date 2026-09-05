import { useEffect, useRef, useState } from "react";
import { saveProject } from "../utils/projectStorage.js";

export function useAutoSave(poster, enabled = true, delay = 750, identity = null) {
  const [saveStatus, setSaveStatus] = useState("idle");
  const pending = useRef(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    pending.current = true;
    setSaveStatus("saving");
    const timer = setTimeout(async () => {
      try {
        await saveProject(poster, identity);
        if (!cancelled) {
          pending.current = false;
          setSaveStatus("saved");
          setSavedAt(new Date());
        }
      } catch {
        if (!cancelled) setSaveStatus("error");
      }
    }, delay);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [poster, enabled, delay, identity]);

  useEffect(() => {
    const onBeforeUnload = (event) => {
      if (pending.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
  return { status: saveStatus, savedAt };
}

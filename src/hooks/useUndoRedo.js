import { useCallback, useRef, useState } from "react";

export function useUndoRedo(initialState, maxHistory = 50) {
  const [state, setStateInternal] = useState(initialState);
  const pastRef = useRef([]);
  const futureRef = useRef([]);

  const setState = useCallback((updater) => {
    setStateInternal((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      // 将当前状态推入 past 栈
      pastRef.current = [...pastRef.current.slice(-(maxHistory - 1)), current];
      // 清空 future 栈（新操作会打断重做链）
      futureRef.current = [];
      return next;
    });
  }, [maxHistory]);

  const undo = useCallback(() => {
    setStateInternal((current) => {
      if (pastRef.current.length === 0) return current;
      const previous = pastRef.current[pastRef.current.length - 1];
      pastRef.current = pastRef.current.slice(0, -1);
      futureRef.current = [...futureRef.current, current];
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    setStateInternal((current) => {
      if (futureRef.current.length === 0) return current;
      const next = futureRef.current[futureRef.current.length - 1];
      futureRef.current = futureRef.current.slice(0, -1);
      pastRef.current = [...pastRef.current, current];
      return next;
    });
  }, []);

  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  return { state, setState, undo, redo, canUndo, canRedo };
}

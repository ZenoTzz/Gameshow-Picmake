import { useCallback, useReducer } from "react";
import { createHistory, historyReducer } from "../utils/historyReducer";

export function useUndoRedo(initialState, maxHistory = 50) {
  const [history, dispatch] = useReducer(historyReducer, initialState, createHistory);
  const setState = useCallback((updater) => dispatch({ type: "set", updater, maxHistory }), [maxHistory]);
  const resetState = useCallback((updater) => dispatch({ type: "reset", updater }), []);
  const undo = useCallback(() => dispatch({ type: "undo", maxHistory }), [maxHistory]);
  const redo = useCallback(() => dispatch({ type: "redo", maxHistory }), [maxHistory]);
  return {
    state: history.present, setState, resetState, undo, redo,
    canUndo: history.past.length > 0, canRedo: history.future.length > 0,
  };
}

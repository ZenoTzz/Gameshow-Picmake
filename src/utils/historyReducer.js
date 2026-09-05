export function createHistory(initialState) {
  return { past: [], present: typeof initialState === "function" ? initialState() : initialState, future: [] };
}

export function historyReducer(history, action) {
  const capacity = Number.isFinite(action.maxHistory) ? Math.max(0, Math.floor(action.maxHistory)) : 50;
  const append = (items, value) => capacity ? [...items, value].slice(-capacity) : [];
  switch (action.type) {
    case "set": {
      const next = typeof action.updater === "function" ? action.updater(history.present) : action.updater;
      if (Object.is(next, history.present)) return history;
      return { past: append(history.past, history.present), present: next, future: [] };
    }
    case "reset":
      return createHistory(action.updater);
    case "undo":
      if (!history.past.length) return history;
      return { past: history.past.slice(0, -1), present: history.past.at(-1), future: append(history.future, history.present) };
    case "redo":
      if (!history.future.length) return history;
      return { past: append(history.past, history.present), present: history.future.at(-1), future: history.future.slice(0, -1) };
    default:
      return history;
  }
}

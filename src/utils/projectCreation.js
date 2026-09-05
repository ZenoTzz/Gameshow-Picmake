// A new project reuses the chosen template and its presentation settings,
// while its cards and per-page adjustments start independently.
export function createProjectFromTemplate(poster) {
  return {
    ...structuredClone(poster),
    games: [],
    pageFillOverrides: {},
    pageFillSettings: {},
  };
}

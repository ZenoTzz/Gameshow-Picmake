import { defaultLogoPosition, defaultLogoScale, getThemeText } from "./coreUtils.js";

export function createThemeCopy(poster, themes) {
  const source = themes[poster.theme];
  if (!source) throw new Error("找不到要复制的模板");
  const names = new Set(Object.values(themes).map((theme) => theme.label));
  const baseLabel = `${source.label} 副本`;
  let label = baseLabel;
  for (let index = 2; names.has(label); index += 1) label = `${baseLabel} ${index}`;
  return {
    theme: {
      ...structuredClone(source),
      id: `custom_${crypto.randomUUID()}`,
      label,
      ...(!source.id.startsWith("custom_") ? { baseThemeId: source.id } : {}),
    },
    themeText: { ...getThemeText(poster) },
    logoImage: poster.logoImages?.[poster.theme] ?? "",
    logoPosition: { ...(poster.logoPositions?.[poster.theme] ?? defaultLogoPosition) },
    logoScale: poster.logoScales?.[poster.theme] ?? defaultLogoScale,
  };
}

export function saveThemeCopy(poster, copy, editedTheme) {
  // Only the new theme's scoped settings change; the source and card content remain intact.
  const id = copy.theme.id;
  return {
    ...poster,
    theme: id,
    customThemes: { ...poster.customThemes, [id]: { ...editedTheme, id } },
    themeText: { ...poster.themeText, [id]: { ...copy.themeText } },
    logoImages: { ...poster.logoImages, [id]: copy.logoImage },
    logoPositions: { ...poster.logoPositions, [id]: { ...copy.logoPosition } },
    logoScales: { ...poster.logoScales, [id]: copy.logoScale },
  };
}

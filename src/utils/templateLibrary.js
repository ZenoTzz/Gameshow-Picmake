import { themes } from '../data/themes.js';
import { createThemeCopy, saveThemeCopy } from './themeCopy.js';
import { getThemeText } from './coreUtils.js';

const appearanceFields = [
  'fillEmptySpace', 'compactFollowupPages', 'infoFontSize', 'infoFontWeight',
  'posterFontFamily', 'headerFontFamily', 'gameTitleFontFamily',
  'metadataFontFamily', 'infoFontFamily', 'creditFontFamily', 'footerLogoImage',
];

function projectThemes(poster) {
  // A project's embedded definitions take precedence; never import other local projects.
  const builtins = Object.fromEntries(Object.entries(themes).filter(([id]) => !id.startsWith('custom_')));
  return { ...builtins, ...poster.customThemes };
}

function appearanceOf(poster) {
  return Object.fromEntries(appearanceFields.filter((field) => poster[field] !== undefined)
    .map((field) => [field, structuredClone(poster[field])]));
}

export function buildTemplateSnapshot(poster, name) {
  const copy = createThemeCopy(poster, projectThemes(poster));
  copy.theme.label = name?.trim() || projectThemes(poster)[poster.theme].label;
  const snapshot = saveThemeCopy({ schemaVersion: 2, games: [], ...appearanceOf(poster) }, copy, copy.theme);
  // Header defaults travel with the template, but applying a style preserves project text.
  return snapshot;
}

export function applyTemplateSnapshot(poster, snapshot) {
  const copy = createThemeCopy(snapshot, projectThemes(snapshot));
  copy.theme.label = projectThemes(snapshot)[snapshot.theme].label;
  copy.themeText = { ...getThemeText(poster) };
  return saveThemeCopy({ ...poster, ...appearanceOf(snapshot) }, copy, copy.theme);
}

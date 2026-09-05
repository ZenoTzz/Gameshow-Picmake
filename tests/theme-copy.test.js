import test from 'node:test';
import assert from 'node:assert/strict';
import { createThemeCopy, saveThemeCopy } from '../src/utils/themeCopy.js';
import { normalizePosterTemplate, getTemplateFields } from '../src/utils/coreUtils.js';
import { themes } from '../src/data/themes.js';

test('copy preserves style, title, logo geometry and shared project settings without changing source', () => {
  const project = normalizePosterTemplate({ theme: 'summerGameFest', games: [], posterFontFamily: 'Arial', logoImages: { summerGameFest: 'data:image/png;base64,AA==' }, logoPositions: { summerGameFest: { x: 150, y: 120 } }, logoScales: { summerGameFest: 175 }, themeText: { summerGameFest: { title: '我的发布会', eventLabel: 'TEST', subtitle: '' } } });
  const original = structuredClone(project);
  const copy = createThemeCopy(project, themes);
  assert.equal(copy.theme.baseThemeId, 'summerGameFest');
  assert.equal(copy.theme.card, themes.summerGameFest.card);
  assert.notEqual(copy.theme.id, project.theme);
  const saved = saveThemeCopy(project, copy, { ...copy.theme, card: '#abcdef', styleOverrides: ['card'] });
  assert.equal(saved.themeText[saved.theme].title, '我的发布会');
  assert.equal(saved.logoImages[saved.theme], project.logoImages.summerGameFest);
  assert.deepEqual(saved.logoPositions[saved.theme], { x: 150, y: 120 });
  assert.equal(saved.logoScales[saved.theme], 175);
  assert.equal(saved.posterFontFamily, 'Arial');
  assert.deepEqual(project, original);
  assert.deepEqual(normalizePosterTemplate(getTemplateFields(saved)).customThemes, saved.customThemes);
});

test('copying custom copies keeps layout inheritance and produces distinct IDs and names', () => {
  const project = normalizePosterTemplate({ theme: 'xbox', games: [] });
  const first = createThemeCopy(project, themes);
  const saved = saveThemeCopy(project, first, first.theme);
  const available = { ...themes, ...saved.customThemes };
  const another = createThemeCopy(project, available);
  assert.equal(another.theme.label, 'Xbox Showcase 副本 2');
  assert.notEqual(another.theme.id, first.theme.id);
  const nested = createThemeCopy(saved, available);
  assert.equal(nested.theme.baseThemeId, 'xbox');
  assert.notEqual(nested.theme.id, saved.theme);
  nested.logoPosition.x = 999;
  assert.notEqual(saved.logoPositions[saved.theme].x, 999);
});

test('edited copy metadata survives image storage packing and portable backup', async () => {
  const { packProject, unpackProject } = await import('../src/utils/projectAssets.js');
  const { exportProjectBackup, importProjectBackup } = await import('../src/utils/projectBackup.js');
  const project = normalizePosterTemplate({ theme: 'summerGameFest', games: [] });
  const copy = createThemeCopy(project, themes);
  const saved = saveThemeCopy(project, copy, { ...copy.theme, card: '#11aa33', cardNumberBg: undefined, styleOverrides: ['card'] });
  const packed = await packProject(saved);
  const local = await unpackProject(packed.project, packed.assets);
  const portable = await importProjectBackup(await exportProjectBackup(saved));
  for (const restored of [local, portable]) {
    assert.deepEqual(restored.customThemes[restored.theme].styleOverrides, ['card']);
    assert.equal(restored.customThemes[restored.theme].baseThemeId, 'summerGameFest');
    assert.equal(restored.customThemes[restored.theme].card, '#11aa33');
  }
});

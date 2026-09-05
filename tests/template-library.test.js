import test from 'node:test';
import assert from 'node:assert/strict';
import { initialPoster } from '../src/data/sampleData.js';
import { themes } from '../src/data/themes.js';
import { buildTemplateSnapshot, applyTemplateSnapshot } from '../src/utils/templateLibrary.js';
import { validateProject } from '../src/utils/projectAssets.js';

test('library snapshot contains selected appearance, no cards or unrelated private themes', () => {
  const source = structuredClone(initialPoster);
  source.theme = 'summerGameFest';
  source.customThemes = { custom_private: { ...themes.xbox, id: 'custom_private' } };
  source.logoImages.summerGameFest = 'data:image/png;base64,YQ==';
  source.logoImages.xbox = 'private unrelated image';
  source.themeText = { summerGameFest: { title: 'Source title' }, xbox: { title: 'Private title' } };
  const snapshot = buildTemplateSnapshot(source, 'Weekly style');
  assert.deepEqual(snapshot.games, []);
  assert.equal(Object.keys(snapshot.customThemes).length, 1);
  assert.equal(snapshot.customThemes[snapshot.theme].baseThemeId, 'summerGameFest');
  assert.equal(snapshot.customThemes[snapshot.theme].label, 'Weekly style');
  assert.deepEqual(Object.keys(snapshot.logoImages), [snapshot.theme]);
  assert.deepEqual(Object.keys(snapshot.themeText), [snapshot.theme]);
  assert.equal(snapshot.logoImages[snapshot.theme], source.logoImages.summerGameFest);
  validateProject(snapshot);
});

test('applying shared style preserves content and isolates its definition from all other projects', () => {
  const source = { ...structuredClone(initialPoster), infoFontSize: 28, footerCreditText: 'Source credit' };
  const snapshot = buildTemplateSnapshot(source);
  const target = { ...structuredClone(initialPoster), themeText: { stateOfPlay: { title: 'My title', eventLabel: 'My event', subtitle: 'My subtitle' } }, footerCreditText: 'My credit' };
  const before = structuredClone(target);
  const result = applyTemplateSnapshot(target, snapshot);
  const other = applyTemplateSnapshot(target, snapshot);
  assert.strictEqual(result.games, target.games);
  assert.deepEqual(result.themeText[result.theme], target.themeText.stateOfPlay);
  assert.equal(result.footerCreditText, 'My credit');
  assert.equal(result.infoFontSize, 28);
  assert.notEqual(result.theme, snapshot.theme);
  assert.notEqual(result.theme, other.theme);
  result.customThemes[result.theme].bg = '#000000';
  assert.notEqual(snapshot.customThemes[snapshot.theme].bg, '#000000');
  assert.notEqual(other.customThemes[other.theme].bg, '#000000');
  assert.deepEqual(target, before);
});

test('embedded custom theme wins over all global state and repeated saves retain source layout', () => {
  const source = { ...structuredClone(initialPoster), theme: 'custom_shared', customThemes: { custom_shared: { ...themes.nintendoDirect, id: 'custom_shared', baseThemeId: 'nintendoDirect', label: 'My custom', bg: '#abcdef', styleOverrides: ['bg'] } } };
  const snapshot = buildTemplateSnapshot(source);
  assert.equal(snapshot.customThemes[snapshot.theme].label, 'My custom');
  assert.equal(snapshot.customThemes[snapshot.theme].bg, '#abcdef');
  const applied = applyTemplateSnapshot(initialPoster, snapshot);
  const savedAgain = buildTemplateSnapshot(applied);
  assert.equal(savedAgain.customThemes[savedAgain.theme].baseThemeId, 'nintendoDirect');
  assert.deepEqual(savedAgain.customThemes[savedAgain.theme].styleOverrides, ['bg']);
});

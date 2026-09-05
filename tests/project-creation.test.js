import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectFromTemplate } from '../src/utils/projectCreation.js';
import { normalizePosterTemplate } from '../src/utils/coreUtils.js';
import { initialPoster } from '../src/data/sampleData.js';
import { packProject, unpackProject } from '../src/utils/projectAssets.js';

test('a new project retains reusable appearance and round-trips empty without modifying its source', async () => {
  const original = normalizePosterTemplate({ ...initialPoster, pageFillOverrides: { 2: false } });
  const snapshot = structuredClone(original);
  const created = normalizePosterTemplate(createProjectFromTemplate(original));
  const packed = await packProject(created);
  const restored = await unpackProject(packed.project, packed.assets);
  assert.equal(restored.games.length, 0);
  assert.equal(restored.theme, original.theme);
  assert.deepEqual(restored.pageFillOverrides, {});
  assert.deepEqual(restored.themeText, original.themeText);
  created.themeText.stateOfPlay.title = 'Next event';
  assert.deepEqual(original, snapshot);
});

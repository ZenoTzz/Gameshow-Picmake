import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePosterTemplate, getTemplateFields } from '../src/utils/coreUtils.js';
import { exportProjectBackup, importProjectBackup } from '../src/utils/projectBackup.js';
import { packProject, unpackProject } from '../src/utils/projectAssets.js';

test('selected IGDB image and provenance survive website normalization, cloud packing and portable backup', async () => {
  const source = { provider: 'igdb', gameId: 7346, gameName: 'The Legend of Zelda: Breath of the Wild', imageId: 'sc_example', kind: 'screenshot', url: 'https://www.igdb.com/games/the-legend-of-zelda-breath-of-the-wild' };
  const image = 'data:image/jpeg;base64,aW1hZ2UtYnl0ZXM=';
  const input = { theme: 'nintendoDirectSoft', games: [{ id: 'chosen-card', title: '我的中文标题', date: '自定义日期', platforms: ['Switch'], image, imageSource: source }] };
  const normalized = normalizePosterTemplate(input);
  const fields = getTemplateFields(normalized);
  const { project, assets } = await packProject(fields);
  assert.equal(assets.size, 1);
  assert.equal(typeof project.games[0].image.$asset, 'string');
  assert.deepEqual(project.games[0].imageSource, source);
  const restored = normalizePosterTemplate(await unpackProject(project, assets));
  const portable = normalizePosterTemplate(await importProjectBackup(await exportProjectBackup(restored)));
  assert.deepEqual(portable.games[0].imageSource, source);
  assert.equal(portable.games[0].image, image);
  assert.equal(portable.games[0].title, '我的中文标题');
  assert.equal(portable.games[0].date, '自定义日期');
  assert.deepEqual(portable.games[0].platforms, ['Switch']);
});

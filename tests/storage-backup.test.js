import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { exportProjectBackup, importProjectBackup } from '../src/utils/projectBackup.js';
import { packProject, PROJECT_LIMITS } from '../src/utils/projectAssets.js';

const image = 'data:image/png;base64,aGVsbG8=';
const project = {
  theme: 'custom_example',
  title: '备份测试',
  games: [{ id: 'game-1', title: '游戏', image, platforms: ['PC'] }],
  footerLogoImage: image,
  customThemes: { custom_example: { label: '我的主题', background: '#222' } },
};

test('portable ZIP round-trips images, themes and text, deduplicating assets', async () => {
  const backup = await exportProjectBackup(project);
  const zip = await JSZip.loadAsync(await backup.arrayBuffer());
  assert.equal(Object.keys(zip.files).filter((path) => path.startsWith('assets/') && !path.endsWith('/')).length, 1);
  const manifest = JSON.parse(await zip.file('project.json').async('string'));
  assert.equal(typeof manifest.project.games[0].image.$asset, 'string');
  assert.equal(manifest.project.games[0].image.$asset, manifest.project.footerLogoImage.$asset);
  assert.deepEqual(await importProjectBackup(backup), { ...project, schemaVersion: 2 });
});

test('legacy JSON import preserves embedded and remote images without networking', async () => {
  const remote = { ...project, footerLogoImage: 'https://example.invalid/image.png' };
  const restored = await importProjectBackup(new Blob([JSON.stringify(remote)]));
  assert.equal(restored.footerLogoImage, remote.footerLogoImage);
  assert.equal(restored.games[0].image, image);
});

test('rejects corrupt or missing ZIP image data', async () => {
  const zip = await JSZip.loadAsync(await (await exportProjectBackup(project)).arrayBuffer());
  const path = Object.keys(zip.files).find((key) => key.startsWith('assets/') && !key.endsWith('/'));
  zip.file(path, 'changed');
  await assert.rejects(importProjectBackup(await zip.generateAsync({ type: 'blob' })), /校验失败/);
  zip.remove(path);
  await assert.rejects(importProjectBackup(await zip.generateAsync({ type: 'blob' })), /缺失/);
});

test('rejects unsafe archive paths and invalid project structures', async () => {
  const zip = new JSZip();
  zip.file('../project.json', '{}');
  await assert.rejects(importProjectBackup(await zip.generateAsync({ type: 'blob' })), /非法资源路径/);
  await assert.rejects(importProjectBackup(new Blob(['{"theme":"x","games":{}}'])), /格式无效/);
  await assert.rejects(importProjectBackup(new Blob(['{"theme":"x","games":[],"__proto__":{}}'])), /无效字段/);
  await assert.rejects(packProject({ ...project, games: [{ title: 'bad', platforms: [1] }] }), /格式无效/);
});

test('rejects oversized files and compressed oversized manifests before expanding', async () => {
  await assert.rejects(importProjectBackup({ size: PROJECT_LIMITS.archive + 1, arrayBuffer() { throw Error('must not read'); } }), /150 MB/);
  const zip = new JSZip();
  zip.file('project.json', ' '.repeat(PROJECT_LIMITS.manifest + 1));
  const backup = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  await assert.rejects(importProjectBackup(backup), /大小超过限制/);
});

test('rejects unresolved blob URLs, unsupported versions and malformed image data', async () => {
  await assert.rejects(packProject({ ...project, footerLogoImage: 'blob:temporary' }), /临时图片/);
  await assert.rejects(packProject({ ...project, schemaVersion: 99 }), /版本/);
  await assert.rejects(packProject({ ...project, footerLogoImage: 'data:image/png;base64,%%%' }), /损坏/);
});

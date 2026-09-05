import path from 'node:path';
import { inspectGarbage, applyGarbage } from './maintenance.js';
try {
  if (process.argv.slice(2).some((arg) => arg !== '--apply')) throw new Error('Usage: DATA_DIR=/var/lib/picmake node server/gc.js [--apply]');
  const dataDir = path.resolve(process.env.DATA_DIR || '/var/lib/picmake');
  const apply = process.argv.includes('--apply');
  const report = await (apply ? applyGarbage(dataDir) : inspectGarbage(dataDir));
  console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', files: report.candidates.length, reclaimableBytes: report.reclaimableBytes, referencedAssets: report.referencedAssets }));
} catch (error) { console.error(error.message); process.exitCode = 1; }

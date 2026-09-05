import path from 'node:path';
import { requireOfflineService, resetPassword } from './maintenance.js';
try {
  requireOfflineService();
  if (process.argv.length > 2 || process.stdin.isTTY) throw new Error('Supply the new password on stdin only; never as a command argument');
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 8192) throw new Error('Password input too long'); }
  resetPassword(path.resolve(process.env.DATA_DIR || '/var/lib/picmake'), input.replace(/\r?\n$/, ''));
  console.log('Password updated. All sessions revoked. Projects and images preserved.');
} catch (error) { console.error(error.message); process.exitCode = 1; }

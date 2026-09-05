import { createApp } from './app.js';
import path from 'node:path';
const app = await createApp({
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  publicDir: path.resolve(process.env.PUBLIC_DIR || './dist'),
  origin: process.env.PUBLIC_ORIGIN,
  bootstrapToken: process.env.BOOTSTRAP_TOKEN,
  allowInsecureCookies: process.env.ALLOW_INSECURE_COOKIES === 'true',
});
app.server.listen(Number(process.env.PORT || 8790), process.env.HOST || '127.0.0.1', () => console.log('Picmake server ready'));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await app.close(); process.exit(0); });

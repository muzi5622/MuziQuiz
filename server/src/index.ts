import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
const dataDir = resolve(process.env.DATA_DIR ?? './data');
mkdirSync(dataDir, { recursive: true });
const { app } = await createApp({ databasePath: resolve(dataDir, 'localmenti.sqlite'), clientPath: fileURLToPath(new URL('../../client/dist/', import.meta.url)), logger: true });
await app.listen({ host: '0.0.0.0', port });
console.log(`MuziQuiz: http://localhost:${port}`);
for (const addresses of Object.values(networkInterfaces())) for (const address of addresses ?? []) {
  if (address.family === 'IPv4' && !address.internal) console.log(`Possible LAN address (verify adapter): http://${address.address}:${port}`);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().catch(error => { console.error(error); process.exitCode = 1; }); });

// Collects everything the desktop app ships into desktop/app/:
// the bundled server, the built player/host screens and the Electron main process.
// Run after `npm run build` at the project root.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(desktop, '..');
const out = resolve(desktop, 'app');
for (const required of ['client/dist/index.html', 'shared/dist/index.js']) {
  if (!existsSync(resolve(root, required))) throw new Error(`Missing ${required}. Run "npm run build" in the project root first.`);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await build({
  input: resolve(root, 'server/src/embedded.ts'),
  platform: 'node',
  // The database ships its own Windows binary; optional ws speed-ups are not installed.
  external: ['better-sqlite3', 'bufferutil', 'utf-8-validate'],
  output: { file: resolve(out, 'server.cjs'), format: 'cjs' },
  logLevel: 'warn'
});
cpSync(resolve(root, 'client/dist'), resolve(out, 'client'), { recursive: true });
cpSync(resolve(desktop, 'src/main.cjs'), resolve(out, 'main.cjs'));
cpSync(resolve(desktop, 'build/icon.png'), resolve(out, 'icon.png'));
console.log('Staged desktop app in', out);

import { emitKeypressEvents } from 'node:readline';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from './database.js';
import { setHostPassword } from './auth.js';

async function hiddenPrompt(label: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Run setup:host in an interactive terminal. Passwords are never accepted as command-line arguments.');
  process.stdout.write(label);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolvePassword, reject) => {
    let password = '';
    const cleanup = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.removeListener('keypress', listener); process.stdout.write('\n'); };
    const listener = (text: string | undefined, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') { cleanup(); reject(new Error('Cancelled.')); }
      else if (key.name === 'return') { cleanup(); resolvePassword(password); }
      else if (key.name === 'backspace') password = password.slice(0, -1);
      else if (text && !key.ctrl && !text.includes('\u001b')) password += text;
    };
    process.stdin.on('keypress', listener);
  });
}
try {
  console.log('Set the local host password (12–128 characters). Existing host sessions will be signed out.');
  const password = await hiddenPrompt('New password: ');
  const confirmation = await hiddenPrompt('Confirm password: ');
  if (password !== confirmation) throw new Error('Passwords did not match. Nothing changed.');
  const directory = resolve(process.env.DATA_DIR ?? './data');
  mkdirSync(directory, { recursive: true });
  const db = openDatabase(resolve(directory, 'localmenti.sqlite'));
  try { await setHostPassword(db, password); } finally { db.close(); }
  console.log('Host password saved as a salted hash. Open /host/login to sign in.');
} catch (error) { console.error(error instanceof Error ? error.message : 'Setup failed.'); process.exitCode = 1; }

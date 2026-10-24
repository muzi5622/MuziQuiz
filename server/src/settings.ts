import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

const PRIVATE_CODE_KEY = 'reserved_code_hash';
// Built-in creator code (SHA-256 only; the code itself is not in the source). Works with no setup;
// a code saved in the host space or RESERVED_JOIN_CODE_HASH in .env replaces it.
const BUILT_IN_PRIVATE_CODE_HASH = 'b0a08af84212c221b0de58aad34b35e4face0b691783363e3fc764b3c4d50ab0';
const isHash = (value: string | undefined): value is string => Boolean(value && /^[a-f0-9]{64}$/.test(value));

/** Where the private creator code comes from: set in the app, from .env, or the built-in default. */
export function privateCodeSource(db: Database.Database): 'app' | 'env' | 'built-in' {
  const stored = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(PRIVATE_CODE_KEY) as { value: string } | undefined;
  if (isHash(stored?.value)) return 'app';
  return isHash(process.env.RESERVED_JOIN_CODE_HASH) ? 'env' : 'built-in';
}
/** The SHA-256 hash joins are checked against: app setting, then .env, then the built-in code. */
export function privateCodeHash(db: Database.Database) {
  const stored = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(PRIVATE_CODE_KEY) as { value: string } | undefined;
  if (isHash(stored?.value)) return stored.value;
  return isHash(process.env.RESERVED_JOIN_CODE_HASH) ? process.env.RESERVED_JOIN_CODE_HASH : BUILT_IN_PRIVATE_CODE_HASH;
}
/** Stores only the hash of the code; `null` removes the in-app code. */
export function setPrivateCode(db: Database.Database, code: string | null) {
  if (code === null) { db.prepare('DELETE FROM app_settings WHERE key = ?').run(PRIVATE_CODE_KEY); return; }
  const hash = createHash('sha256').update(code).digest('hex');
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(PRIVATE_CODE_KEY, hash);
}

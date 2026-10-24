import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type Database from 'better-sqlite3';

const derive = promisify(scrypt);
export const SESSION_MS = 12 * 60 * 60 * 1000;
export const COOKIE_NAME = 'localmenti_host';
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function setHostPassword(db: Database.Database, password: string) {
  if (password.length < 12 || password.length > 128) throw new Error('Use a password of 12–128 characters.');
  const salt = randomBytes(32).toString('hex');
  const hash = (await derive(password, salt, 64) as Buffer).toString('hex');
  db.transaction(() => {
    db.prepare('INSERT INTO host_credentials (id, salt, password_hash) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET salt = excluded.salt, password_hash = excluded.password_hash').run(salt, hash);
    db.prepare('DELETE FROM host_sessions').run();
  })();
}

export function configured(db: Database.Database) {
  return Boolean(db.prepare('SELECT id FROM host_credentials WHERE id = 1').get());
}

export async function verifyPassword(db: Database.Database, password: string) {
  const record = db.prepare('SELECT salt, password_hash FROM host_credentials WHERE id = 1').get() as { salt: string; password_hash: string } | undefined;
  if (!record) return false;
  const result = await derive(password, record.salt, 64) as Buffer;
  // Password changes during scrypt must invalidate an in-flight login, too.
  const current = db.prepare('SELECT password_hash FROM host_credentials WHERE id = 1').get() as { password_hash: string } | undefined;
  return current?.password_hash === record.password_hash && timingSafeEqual(result, Buffer.from(record.password_hash, 'hex'));
}

export function cookieToken(header?: string) {
  const value = header?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}
export function authenticated(db: Database.Database, header?: string) {
  const token = cookieToken(header);
  return Boolean(token && db.prepare('SELECT token_hash FROM host_sessions WHERE token_hash = ? AND expires_at > ?').get(hashToken(token), Date.now()));
}
export function sessionCookie(token: string, maxAge = SESSION_MS / 1000) {
  // Deliberately HTTP-compatible for the isolated LAN deployment.
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

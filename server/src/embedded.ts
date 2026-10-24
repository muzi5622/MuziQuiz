// Entry point for the Windows desktop app: the same server, started in-process.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { createApp } from './app.js';
import { openDatabase } from './database.js';

export type EmbeddedServer = { port: number; close: () => Promise<void> };

const databasePath = (dataDir: string) => resolve(dataDir, 'localmenti.sqlite');

/** Starts on the first free port in `ports`, listening on every adapter so phones can join. */
export async function startServer({ dataDir, clientPath, ports }: { dataDir: string; clientPath: string; ports: number[] }): Promise<EmbeddedServer> {
  mkdirSync(dataDir, { recursive: true });
  for (const port of ports) {
    const { app } = await createApp({ databasePath: databasePath(dataDir), clientPath, logger: false });
    try {
      await app.listen({ host: '0.0.0.0', port });
      return { port, close: () => app.close() };
    } catch (error) {
      await app.close();
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error(`Ports ${ports[0]}–${ports.at(-1)} are all in use. Close the other MuziQuiz window or program using them.`);
}

/** Forgets the host password (quizzes and results stay). The next visit shows first-run setup. */
export function resetHostPassword(dataDir: string) {
  const db = openDatabase(databasePath(dataDir));
  try { db.transaction(() => { db.prepare('DELETE FROM host_sessions').run(); db.prepare('DELETE FROM host_credentials').run(); })(); }
  finally { db.close(); }
}

/** True while a session is open or being played, so quitting would disconnect players. */
export function hasLiveSession(dataDir: string) {
  const db = openDatabase(databasePath(dataDir));
  try { return Boolean(db.prepare("SELECT 1 FROM sessions WHERE state <> 'FINISHED' LIMIT 1").get()); }
  finally { db.close(); }
}

export function lanUrls(port: number) {
  return Object.values(networkInterfaces()).flatMap(addresses => addresses ?? [])
    .filter(address => address.family === 'IPv4' && !address.internal).map(address => `http://${address.address}:${port}`);
}

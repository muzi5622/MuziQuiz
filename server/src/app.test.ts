import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { io } from 'socket.io-client';
import { createApp } from './app.js';
import { openDatabase } from './database.js';

describe('offline foundation', () => {
  it('migrates old quiz times to one value without touching active session snapshots', () => {
    const dir = mkdtempSync(resolve(tmpdir(),'localmenti-timing-migration-'));
    try {
      const filename = resolve(dir,'quiz.sqlite'); const db = openDatabase(filename);
      db.exec(`INSERT INTO quizzes (id,title,description,created_at,updated_at) VALUES ('quiz','Legacy','',0,0);
        INSERT INTO questions (id,quiz_id,order_index,type,text,options_json,correct_option_id,duration_seconds,base_points,explanation)
          VALUES ('q1','quiz',0,'quiz_mcq','First?','[]','a',15,1000,''),('q2','quiz',1,'quiz_mcq','Second?','[]','a',60,1000,'');
        INSERT INTO sessions (id,quiz_id,six_digit_pin,state,created_at,quiz_title,lan_address,port) VALUES ('session','quiz','123456','QUESTION_OPEN',0,'Legacy','127.0.0.1',3000);
        INSERT INTO session_questions (id,session_id,order_index,type,text,options_json,correct_option_id,duration_seconds,base_points,started_at,ends_at)
          VALUES ('live','session',0,'quiz_mcq','Live?','[]','a',60,1000,1000,61000);
        ALTER TABLE quizzes DROP COLUMN duration_seconds;
        DELETE FROM schema_migrations WHERE version = 8;`);
      db.close(); const migrated = openDatabase(filename);
      try {
        expect(migrated.prepare('SELECT duration_seconds FROM quizzes').get()).toEqual({ duration_seconds:15 });
        expect(migrated.prepare('SELECT duration_seconds FROM questions').all()).toEqual([{ duration_seconds:15 },{ duration_seconds:15 }]);
        expect(migrated.prepare('SELECT duration_seconds,started_at,ends_at FROM session_questions').get()).toEqual({ duration_seconds:60,started_at:1000,ends_at:61000 });
      } finally { migrated.close(); }
    } finally { rmSync(dir,{ recursive:true,force:true }); }
  });
  it('persists its migration once across database reopen', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'localmenti-db-'));
    try {
      const filename = resolve(dir, 'test.sqlite');
      const first = openDatabase(filename);
      expect(first.pragma('journal_mode', { simple: true })).toBe('wal');
      first.close();
      const second = openDatabase(filename);
      expect(second.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({ count: 14 });
      second.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('serves health, deep links and socket state from one port', async () => {
    const { app } = await createApp({ databasePath: ':memory:', clientPath: resolve('client/dist') });
    try {
      await app.listen({ host: '127.0.0.1', port: 0 });
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new Error('Missing address');
      const origin = `http://127.0.0.1:${address.port}`;
      expect((await app.inject('/health')).json()).toEqual({ status: 'ok', version: '0.1.0' });
      for (const path of ['/', '/join', '/host', '/host/login', '/s/123456', '/present/123456']) {
        const response = await app.inject(path);
        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('<div id="root">');
      }
      expect((await app.inject('/api/unknown')).statusCode).toBe(404);
      expect((await app.inject('/assets/missing.js')).statusCode).toBe(404);
      const socket = io(origin, { autoConnect: false, timeout: 2000 });
      try {
        await new Promise<void>((resolveReady, reject) => {
          const timer = setTimeout(() => reject(new Error('Socket ready timeout')), 4000);
          socket.once('server:ready', data => { clearTimeout(timer); expect(data.serverTime).toBeGreaterThan(0); resolveReady(); });
          socket.once('connect_error', error => { clearTimeout(timer); reject(error); });
          socket.connect();
        });
      } finally { socket.disconnect(); }
      const rejected = io(origin, { transports: ['websocket'], extraHeaders: { Origin: 'http://untrusted.example' }, reconnection: false, autoConnect: false });
      try {
        await new Promise<void>((resolveRejected, reject) => {
          const timer = setTimeout(() => reject(new Error('Origin check timeout')), 4000);
          rejected.once('connect_error', () => { clearTimeout(timer); resolveRejected(); });
          rejected.once('connect', () => { clearTimeout(timer); reject(new Error('Cross-origin connection accepted')); });
          rejected.connect();
        });
      } finally { rejected.disconnect(); }
    } finally { await app.close(); }
  });
});

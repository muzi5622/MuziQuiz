import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { NicknameSchema } from '@localmenti/shared';

describe('phase 5 migration', () => {
  it('normalizes legacy names without changing identities or reconnect hashes and gives unique persistent characters', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'localmenti-upgrade-')); const filename = resolve(dir, 'upgrade.sqlite');
    try {
      const before = openDatabase(filename);
      before.prepare("INSERT INTO sessions (id, quiz_id, six_digit_pin, state, created_at, quiz_title, lan_address, port) VALUES ('session','quiz','123456','LOBBY',0,'Legacy','127.0.0.1',3000)").run();
      before.prepare("INSERT INTO participants (id, session_id, nickname, nickname_key, reconnect_token_hash, joined_at, last_seen_at, avatar_index) VALUES ('one','session','Alex (2)','old-one','hash-one',1,1,0), ('two','session','Alex2','old-two','hash-two',2,2,1)").run();
      before.exec('DROP TRIGGER participants_reserved_insert; DROP TRIGGER participants_reserved_update; DROP INDEX participants_avatar; ALTER TABLE participants DROP COLUMN avatar_index; DELETE FROM schema_migrations WHERE version IN (5,9);'); before.close();
      const after = openDatabase(filename);
      const records = after.prepare('SELECT id, nickname, reconnect_token_hash, avatar_index FROM participants ORDER BY joined_at').all() as { id: string; nickname: string; reconnect_token_hash: string; avatar_index: number }[];
      expect(records.map(record => record.id)).toEqual(['one','two']); expect(records.map(record => record.reconnect_token_hash)).toEqual(['hash-one','hash-two']);
      expect(records.map(record => record.nickname)).toEqual(['Alex2','Alex22']); expect(records.every(record => NicknameSchema.safeParse(record.nickname).success)).toBe(true);
      expect(records.map(record => record.avatar_index)).toEqual([0,1]); after.close();
      const reopened = openDatabase(filename); expect(reopened.prepare('SELECT id, nickname, reconnect_token_hash, avatar_index FROM participants ORDER BY joined_at').all()).toEqual(records); reopened.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('upgrades the 10-second minimum to 5 seconds without losing saved quizzes', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'localmenti-upgrade-')); const filename = resolve(dir, 'upgrade.sqlite');
    try {
      // Rebuild the pre-v11 shape: duration_seconds limited to 10–120.
      const before = openDatabase(filename);
      for (const table of ['quizzes', 'questions']) before.exec(`ALTER TABLE ${table} ADD COLUMN old_duration INTEGER NOT NULL DEFAULT 20 CHECK(old_duration BETWEEN 10 AND 120);
        ALTER TABLE ${table} DROP COLUMN duration_seconds; ALTER TABLE ${table} RENAME COLUMN old_duration TO duration_seconds;`);
      before.exec('DELETE FROM schema_migrations WHERE version = 11');
      before.prepare("INSERT INTO quizzes (id, title, description, duration_seconds, created_at, updated_at) VALUES ('quiz','Saved','',30,1,1)").run();
      before.prepare(`INSERT INTO questions (id, quiz_id, order_index, type, text, options_json, correct_option_id, duration_seconds, base_points, explanation) VALUES ('q1','quiz',0,'quiz_mcq','Kept?','[{"id":"a","text":"Yes"},{"id":"b","text":"No"}]','a',30,1000,'')`).run();
      expect(() => before.prepare("UPDATE quizzes SET duration_seconds = 5 WHERE id = 'quiz'").run()).toThrow();
      before.close();
      const after = openDatabase(filename);
      expect(after.prepare("SELECT title, duration_seconds FROM quizzes WHERE id = 'quiz'").get()).toEqual({ title:'Saved', duration_seconds:30 });
      expect(after.prepare("SELECT text, duration_seconds FROM questions WHERE id = 'q1'").get()).toEqual({ text:'Kept?', duration_seconds:30 });
      after.prepare("UPDATE quizzes SET duration_seconds = 5 WHERE id = 'quiz'").run();
      after.prepare("UPDATE questions SET duration_seconds = 5 WHERE id = 'q1'").run();
      expect(() => after.prepare("UPDATE quizzes SET duration_seconds = 4 WHERE id = 'quiz'").run()).toThrow();
      expect(() => after.prepare("UPDATE questions SET duration_seconds = 121 WHERE id = 'q1'").run()).toThrow();
      after.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

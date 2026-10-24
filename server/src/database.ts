import Database from 'better-sqlite3';
import { nicknameWithSuffix, RESERVED_AVATAR_INDEX } from '@localmenti/shared';
import { randomInt } from 'node:crypto';
export function openDatabase(filename: string) {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
    if (!db.prepare('SELECT version FROM schema_migrations WHERE version = 1').get()) {
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(1, Date.now());
    }
    if (!db.prepare('SELECT version FROM schema_migrations WHERE version = 2').get()) {
      db.exec(`
        CREATE TABLE host_credentials (id INTEGER PRIMARY KEY CHECK(id = 1), salt TEXT NOT NULL, password_hash TEXT NOT NULL);
        CREATE TABLE host_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
        CREATE INDEX host_sessions_expiry ON host_sessions(expires_at);
        CREATE TABLE quizzes (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE questions (
          id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
          order_index INTEGER NOT NULL, type TEXT NOT NULL CHECK(type IN ('quiz_mcq', 'poll_mcq')),
          text TEXT NOT NULL, options_json TEXT NOT NULL, correct_option_id TEXT,
          duration_seconds INTEGER NOT NULL CHECK(duration_seconds BETWEEN 10 AND 120),
          base_points INTEGER NOT NULL CHECK(base_points BETWEEN 1 AND 10000), explanation TEXT,
          UNIQUE(quiz_id, order_index)
        );
        CREATE INDEX quizzes_updated ON quizzes(updated_at DESC);
      `);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(2, Date.now());
    }
    if (!db.prepare('SELECT version FROM schema_migrations WHERE version = 3').get()) {
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL, six_digit_pin TEXT NOT NULL UNIQUE,
          state TEXT NOT NULL CHECK(state IN ('LOBBY', 'QUESTION_OPEN', 'QUESTION_REVEAL', 'LEADERBOARD', 'FINISHED')),
          current_question_index INTEGER NOT NULL DEFAULT -1, question_started_at INTEGER, question_ends_at INTEGER,
          created_at INTEGER NOT NULL, ended_at INTEGER, quiz_title TEXT NOT NULL,
          lan_address TEXT NOT NULL, port INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX sessions_one_active ON sessions((1)) WHERE state <> 'FINISHED';
        CREATE TABLE session_questions (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), order_index INTEGER NOT NULL,
          type TEXT NOT NULL, text TEXT NOT NULL, options_json TEXT NOT NULL, correct_option_id TEXT,
          duration_seconds INTEGER NOT NULL, base_points INTEGER NOT NULL, explanation TEXT,
          UNIQUE(session_id, order_index)
        );
        CREATE TABLE participants (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), nickname TEXT NOT NULL,
          nickname_key TEXT NOT NULL, reconnect_token_hash TEXT NOT NULL UNIQUE,
          joined_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, removed_at INTEGER,
          UNIQUE(session_id, nickname_key)
        );
        CREATE INDEX participants_session ON participants(session_id, removed_at);
      `);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(3, Date.now());
    }
    if (!db.prepare('SELECT version FROM schema_migrations WHERE version = 4').get()) {
      db.exec(`
        ALTER TABLE sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE participants ADD COLUMN last_disconnect_at INTEGER;
        ALTER TABLE participants ADD COLUMN last_disconnect_reason TEXT;
        ALTER TABLE session_questions ADD COLUMN started_at INTEGER;
        ALTER TABLE session_questions ADD COLUMN ends_at INTEGER;
        ALTER TABLE session_questions ADD COLUMN closed_at INTEGER;
        ALTER TABLE session_questions ADD COLUMN revealed_at INTEGER;
        CREATE UNIQUE INDEX session_question_identity ON session_questions(session_id, id);
        CREATE UNIQUE INDEX participant_identity ON participants(session_id, id);
        CREATE TABLE submissions (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, participant_id TEXT NOT NULL, question_id TEXT NOT NULL,
          option_id TEXT NOT NULL, received_at INTEGER NOT NULL, response_ms INTEGER NOT NULL CHECK(response_ms >= 0),
          awarded_points INTEGER NOT NULL CHECK(awarded_points >= 0), is_correct INTEGER NOT NULL CHECK(is_correct IN (0, 1)),
          UNIQUE(session_id, question_id, participant_id),
          FOREIGN KEY(session_id, participant_id) REFERENCES participants(session_id, id),
          FOREIGN KEY(session_id, question_id) REFERENCES session_questions(session_id, id)
        );
        CREATE INDEX submissions_participant ON submissions(session_id, participant_id);
        CREATE TRIGGER submissions_immutable BEFORE UPDATE ON submissions BEGIN SELECT RAISE(ABORT, 'Accepted submissions are immutable'); END;
        CREATE TRIGGER submissions_no_delete BEFORE DELETE ON submissions BEGIN SELECT RAISE(ABORT, 'Accepted submissions are immutable'); END;
      `);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(4, Date.now());
    }
    if (!db.prepare('SELECT version FROM schema_migrations WHERE version = 5').get()) {
      db.exec(`
        ALTER TABLE questions RENAME TO questions_v4;
        CREATE TABLE questions (
          id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
          order_index INTEGER NOT NULL, type TEXT NOT NULL CHECK(type IN ('quiz_mcq', 'poll_mcq')),
          text TEXT NOT NULL, options_json TEXT NOT NULL, correct_option_id TEXT,
          duration_seconds INTEGER NOT NULL CHECK(duration_seconds BETWEEN 10 AND 120),
          base_points INTEGER NOT NULL CHECK(base_points BETWEEN 0 AND 10000), explanation TEXT,
          CHECK((type = 'poll_mcq' AND correct_option_id IS NULL AND base_points = 0) OR (type = 'quiz_mcq' AND correct_option_id IS NOT NULL AND base_points >= 1)),
          UNIQUE(quiz_id, order_index)
        );
        INSERT INTO questions SELECT * FROM questions_v4;
        DROP TABLE questions_v4;
        ALTER TABLE participants ADD COLUMN avatar_index INTEGER NOT NULL DEFAULT 0;
      `);
      const players = db.prepare('SELECT id, session_id, nickname FROM participants ORDER BY session_id, joined_at, id').all() as { id: string; session_id: string; nickname: string }[];
      // Preserve identity/tokens/answers while bringing legacy display names into the new rule.
      db.prepare("UPDATE participants SET nickname_key = 'migration:' || id").run();
      const counters = new Map<string, number>();
      const used = new Map<string, Set<string>>();
      for (const player of players) {
        const index = counters.get(player.session_id) ?? 0; counters.set(player.session_id, index + 1);
        const names = used.get(player.session_id) ?? new Set<string>(); used.set(player.session_id, names);
        const base = nicknameWithSuffix(player.nickname.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '')) || 'Player';
        let display = base; let suffix = 2;
        while (names.has(display.toLowerCase())) display = nicknameWithSuffix(base, String(suffix++));
        names.add(display.toLowerCase());
        db.prepare('UPDATE participants SET nickname = ?, nickname_key = ?, avatar_index = ? WHERE id = ?').run(display, display.toLowerCase(), index, player.id);
      }
      db.exec('CREATE UNIQUE INDEX participants_avatar ON participants(session_id, avatar_index)');
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(5, Date.now());
    }
    if (!db.prepare('SELECT version FROM schema_migrations WHERE version = 6').get()) {
      db.exec(`
        ALTER TABLE sessions ADD COLUMN preview_seconds INTEGER NOT NULL DEFAULT 3 CHECK(preview_seconds BETWEEN 3 AND 5);
        ALTER TABLE session_questions ADD COLUMN preview_started_at INTEGER;
        UPDATE session_questions SET preview_started_at = started_at WHERE started_at IS NOT NULL;
      `);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(6, Date.now());
    }
    if (!db.prepare('SELECT version FROM schema_migrations WHERE version = 7').get()) {
      db.exec(`
        ALTER TABLE session_questions ADD COLUMN score_published_at INTEGER;
        ALTER TABLE sessions ADD COLUMN standings_revision INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE sessions ADD COLUMN previous_standings_json TEXT NOT NULL DEFAULT '[]';
        UPDATE session_questions SET score_published_at = revealed_at WHERE revealed_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM sessions s WHERE s.id = session_questions.session_id
            AND (s.state IN ('LEADERBOARD','FINISHED') OR session_questions.order_index < s.current_question_index));
      `);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(7, Date.now());
    }
    if (!db.prepare('SELECT version FROM schema_migrations WHERE version = 8').get()) {
      db.exec(`ALTER TABLE quizzes ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 20 CHECK(duration_seconds BETWEEN 10 AND 120);
        UPDATE quizzes SET duration_seconds = COALESCE((SELECT duration_seconds FROM questions WHERE quiz_id = quizzes.id ORDER BY order_index LIMIT 1),20);
        UPDATE questions SET duration_seconds = (SELECT duration_seconds FROM quizzes WHERE id = questions.quiz_id);`);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(8,Date.now());
    }
    if (!db.prepare('SELECT version FROM schema_migrations WHERE version = 9').get()) {
      const legacy = db.prepare("SELECT id,session_id FROM participants WHERE lower(nickname_key) = 'muzi' AND avatar_index <> ?").all(RESERVED_AVATAR_INDEX) as { id:string;session_id:string }[];
      const used = db.prepare('SELECT 1 FROM participants WHERE session_id = ? AND nickname_key = ?');
      for (const participant of legacy) {
        let nickname:string;
        do { nickname = `Player${randomInt(100000,100000000)}`; } while (used.get(participant.session_id,nickname.toLowerCase()));
        db.prepare('UPDATE participants SET nickname = ?, nickname_key = ? WHERE id = ?').run(nickname,nickname.toLowerCase(),participant.id);
      }
      const invalid = `(lower(NEW.nickname_key) = 'muzi' AND (NEW.nickname <> 'MUZI' OR NEW.avatar_index <> ${RESERVED_AVATAR_INDEX})) OR (NEW.avatar_index = ${RESERVED_AVATAR_INDEX} AND (NEW.nickname <> 'MUZI' OR NEW.nickname_key <> 'muzi'))`;
      db.exec(`CREATE TRIGGER participants_reserved_insert BEFORE INSERT ON participants WHEN ${invalid} BEGIN SELECT RAISE(ABORT,'Reserved identity mismatch'); END;
        CREATE TRIGGER participants_reserved_update BEFORE UPDATE OF nickname,nickname_key,avatar_index ON participants WHEN ${invalid} BEGIN SELECT RAISE(ABORT,'Reserved identity mismatch'); END;`);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(9,Date.now());
    }
    if (!db.prepare('SELECT version FROM schema_migrations WHERE version = 10').get()) {
      db.exec(`DROP TRIGGER submissions_no_delete;
        CREATE TRIGGER submissions_no_delete BEFORE DELETE ON submissions
        WHEN EXISTS (SELECT 1 FROM sessions WHERE id = OLD.session_id AND state <> 'FINISHED')
        BEGIN SELECT RAISE(ABORT, 'Accepted submissions are immutable'); END;`);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(10,Date.now());
    }
    if (!db.prepare('SELECT version FROM schema_migrations WHERE version = 11').get()) {
      // Allow 5-second answer windows. The old 10–120 rule is a column CHECK,
      // so swap the column instead of rebuilding tables (a rebuild would
      // cascade-delete questions while foreign keys are on).
      for (const table of ['quizzes', 'questions']) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN duration_seconds_v11 INTEGER NOT NULL DEFAULT 20 CHECK(duration_seconds_v11 BETWEEN 5 AND 120);
          UPDATE ${table} SET duration_seconds_v11 = duration_seconds;
          ALTER TABLE ${table} DROP COLUMN duration_seconds;
          ALTER TABLE ${table} RENAME COLUMN duration_seconds_v11 TO duration_seconds;`);
      }
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(11,Date.now());
    }
    if (!db.prepare('SELECT version FROM schema_migrations WHERE version = 12').get()) {
      // Remember which device (hashed IP) created each identity, for the per-device join cap.
      db.exec(`ALTER TABLE participants ADD COLUMN join_device TEXT;
        CREATE INDEX participants_device ON participants(session_id, join_device);`);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(12,Date.now());
    }
    if (!db.prepare('SELECT version FROM schema_migrations WHERE version = 13').get()) {
      db.exec("ALTER TABLE sessions ADD COLUMN event_name TEXT NOT NULL DEFAULT ''");
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(13,Date.now());
    }
    if (!db.prepare('SELECT version FROM schema_migrations WHERE version = 14').get()) {
      // Small key/value settings the host changes in the app (e.g. the private creator code hash).
      db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(14,Date.now());
    }
  })();
  return db;
}

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { csv, csvCell, questionStatsCsv, rankings, resultsCsv } from './results.js';

function dataset() {
  const db = openDatabase(':memory:'); const sessionId = randomUUID();
  db.prepare("INSERT INTO sessions (id, quiz_id, six_digit_pin, state, created_at, quiz_title, lan_address, port) VALUES (?, 'quiz', '123456', 'LOBBY', 0, 'Results', '127.0.0.1', 3000)").run(sessionId);
  const questionIds = [randomUUID(), randomUUID(), randomUUID()];
  const insertQuestion = db.prepare('INSERT INTO session_questions (id, session_id, order_index, type, text, options_json, correct_option_id, duration_seconds, base_points, explanation, started_at, ends_at, revealed_at) VALUES (?, ?, ?, ?, ?, ?, ?, 20, ?, ?, 0, 20000, 20001)');
  questionIds.forEach((id, index) => insertQuestion.run(id, sessionId, index, index === 2 ? 'poll_mcq' : 'quiz_mcq', index === 2 ? '=HYPERLINK("bad")' : 'Question, with "quotes"\nand newline', JSON.stringify([{ id: 'a', text: '@formula' }, { id: 'b', text: 'Plain' }]), index === 2 ? null : 'a', index === 2 ? 0 : 1000, ''));
  db.prepare('UPDATE session_questions SET score_published_at = revealed_at').run();
  const players = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((nickname, index) => {
    const id = randomUUID(); db.prepare('INSERT INTO participants (id, session_id, nickname, nickname_key, reconnect_token_hash, joined_at, last_seen_at, avatar_index) VALUES (?, ?, ?, ?, ?, ?, 0, ?)').run(id, sessionId, nickname, nickname.toLowerCase(), `secret-${index}`, index, index); return id;
  });
  const submit = (player: number, question: number, points: number, elapsed: number, correct = 1) => db.prepare('INSERT INTO submissions (id, session_id, participant_id, question_id, option_id, received_at, response_ms, awarded_points, is_correct) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), sessionId, players[player], questionIds[question], correct ? 'a' : 'b', elapsed, elapsed, points, correct);
  submit(0, 0, 500, 20000); submit(0, 1, 500, 20000); submit(1, 0, 1000, 0); submit(2, 0, 1000, 4); submit(3, 0, 1000, 0);
  return { db, sessionId, players, questionIds, submit };
}
describe('rankings and safe local exports', () => {
  it('tags the lowest average time where wrong or missing answers count as the full timer', () => {
    const f = dataset();
    try {
      f.submit(1,1,900,100); f.submit(2,1,900,100); f.submit(3,1,900,100);
      const winners = () => rankings(f.db,f.sessionId).filter(player => player.fastestResponseMs !== undefined).sort((a,b) => a.nickname.localeCompare(b.nickname)).map(player => [player.nickname,player.fastestResponseMs]);
      expect(winners()).toEqual([['Bravo',50],['Delta',50]]);
      f.db.prepare('UPDATE session_questions SET score_published_at = NULL WHERE id = ?').run(f.questionIds[1]);
      expect(winners()).toEqual([['Bravo',0],['Delta',0]]);
      f.db.prepare('UPDATE session_questions SET score_published_at = 100 WHERE id = ?').run(f.questionIds[1]);
      f.db.prepare("UPDATE session_questions SET type = 'quiz_mcq', score_published_at = 101 WHERE id = ?").run(f.questionIds[2]);
      f.submit(1,2,0,1,0);
      // Bravo's fast wrong answer and Delta's missing answer both cost the full 20s.
      expect(winners()).toEqual([['Bravo',6700],['Delta',6700]]);
      f.db.prepare('UPDATE participants SET removed_at = 1').run();
      expect(winners()).toEqual([]);
    } finally { f.db.close(); }
  });
  it('never gives fastest to a player who skips or answers wrong after one quick hit', () => {
    const f = dataset();
    try {
      // Bravo and Delta answered Q1 instantly, then Bravo skipped Q2 and Delta got it wrong in 1ms.
      f.submit(2,1,900,3000); f.submit(3,1,0,1,0);
      const winners = rankings(f.db,f.sessionId).filter(player => player.fastestResponseMs !== undefined).map(player => [player.nickname,player.fastestResponseMs]);
      expect(winners).toEqual([['Charlie',1502]]);
    } finally { f.db.close(); }
    const none = dataset();
    try {
      // Only Q3 is published and nobody answered it correctly: no badge at all.
      none.db.prepare('UPDATE session_questions SET score_published_at = NULL WHERE id != ?').run(none.questionIds[2]);
      none.db.prepare("UPDATE session_questions SET type = 'quiz_mcq' WHERE id = ?").run(none.questionIds[2]);
      none.submit(3,2,0,1,0);
      expect(rankings(none.db,none.sessionId)).not.toEqual([]);
      expect(rankings(none.db,none.sessionId).some(player => player.fastestResponseMs !== undefined)).toBe(false);
    } finally { none.db.close(); }
  });
  it('orders score/correct/time and assigns equal visible competition ranks', () => {
    const f = dataset();
    try {
      const first = rankings(f.db, f.sessionId);
      expect(first.map(player => [player.nickname, player.rank])).toEqual([['Alpha', 1], ['Bravo', 2], ['Delta', 2], ['Charlie', 4]]);
      f.submit(1, 2, 0, 15000, 0); f.submit(3, 2, 0, 1, 0);
      expect(rankings(f.db, f.sessionId)).toEqual(first);
      f.db.prepare('UPDATE participants SET removed_at = 1 WHERE id = ?').run(f.players[0]);
      expect(rankings(f.db, f.sessionId).map(player => player.nickname)).not.toContain('Alpha');
    } finally { f.db.close(); }
  });
  it('breaks equal points by answer time where wrong and skipped answers both count as the full timer', () => {
    const f = dataset();
    try {
      // Q1 (index 1): Bravo answers wrong after 3s, Delta skips it. Both have 1,000 points and 1 correct answer.
      f.submit(1, 1, 0, 3000, 0);
      const order = () => rankings(f.db, f.sessionId).map(player => [player.nickname, player.rank]);
      // Skipping must not beat answering: Bravo and Delta stay tied (both 0s + 20s).
      expect(order()).toEqual([['Alpha', 1], ['Bravo', 2], ['Delta', 2], ['Charlie', 4]]);
    } finally { f.db.close(); }
  });
  it('lets players with no correct answers share one rank instead of rewarding fast wrong answers', () => {
    const f = dataset();
    try {
      f.db.prepare('UPDATE session_questions SET score_published_at = NULL WHERE order_index = 0').run();
      // Only Q1 counts now. Alpha got it right; Bravo was wrong fast, Charlie wrong slow, Delta skipped.
      f.submit(1, 1, 0, 100, 0); f.submit(2, 1, 0, 19000, 0);
      expect(rankings(f.db, f.sessionId).map(player => [player.nickname, player.rank])).toEqual([['Alpha', 1], ['Bravo', 2], ['Charlie', 2], ['Delta', 2]]);
    } finally { f.db.close(); }
  });
  it('does not expose ranks or unrevealed points before a scored reveal', () => {
    const f = dataset();
    try {
      f.db.prepare('UPDATE session_questions SET revealed_at = NULL WHERE type = ?').run('quiz_mcq');
      expect(rankings(f.db, f.sessionId)).toEqual([]);
      const exported = resultsCsv(f.db, f.sessionId);
      expect(exported).not.toContain('"1000"'); expect(exported).not.toContain('secret-');
    } finally { f.db.close(); }
  });
  it.each(['=1+1', '+SUM(1,2)', '-1+2', '@SUM(1)', '  =formula', '\t=cmd', '\r=cmd', '\n@formula', '\u0001=cmd'])('prefixes a spreadsheet formula in %j', value => {
    expect(csvCell(value)).toBe(`"'${value}"`);
  });
  it('escapes commas, quotes, line breaks, Unicode and blank values', () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvCell(null)).toBe('""'); expect(csvCell('🐼')).toBe('"🐼"');
    expect(csv([['a', 'b'], ['x', 'y']])).toBe('\ufeff"a","b"\r\n"x","y"\r\n');
    const f = dataset();
    try {
      const stats = questionStatsCsv(f.db, f.sessionId);
      expect(stats).toContain('"\'=HYPERLINK(""bad"")"'); expect(stats).toContain('"\'@formula"');
      expect(stats).not.toMatch(/token|password|secret-/);
      const participants = resultsCsv(f.db, f.sessionId);
      expect(participants).toContain('"Alpha"'); expect(participants).not.toMatch(/secret-|reconnect_token_hash|password_hash/);
    } finally { f.db.close(); }
  });
});

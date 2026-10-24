import type Database from 'better-sqlite3';
import { avatarFor, type RankEntry } from '@localmenti/shared';

export function rankings(db: Database.Database, sessionId: string): RankEntry[] {
  const scored = db.prepare("SELECT COUNT(*) AS count FROM session_questions WHERE session_id = ? AND type = 'quiz_mcq' AND revealed_at IS NOT NULL AND score_published_at IS NOT NULL").get(sessionId) as { count: number };
  if (!scored.count) return [];
  // Average speed over every published scored question. A wrong or missing
  // answer counts as the full timer, so skipping rounds can never help, and a
  // player needs at least one correct answer to qualify.
  const fastest = db.prepare(`SELECT p.id AS participant_id,
    AVG(CASE WHEN s.is_correct = 1 THEN s.response_ms ELSE q.duration_seconds * 1000 END) AS response_ms,
    SUM(COALESCE(s.is_correct, 0)) AS correct
    FROM participants p
    JOIN session_questions q ON q.session_id = p.session_id
    LEFT JOIN submissions s ON s.question_id = q.id AND s.participant_id = p.id
    WHERE p.session_id = ? AND p.removed_at IS NULL AND q.type = 'quiz_mcq' AND q.revealed_at IS NOT NULL AND q.score_published_at IS NOT NULL
    GROUP BY p.id HAVING correct > 0`).all(sessionId) as { participant_id:string;response_ms:number }[];
  const fastestMs = Math.min(...fastest.map(answer => answer.response_ms));
  const fastestIds = new Set(fastest.filter(answer => answer.response_ms === fastestMs).map(answer => answer.participant_id));
  const rows = db.prepare(`
    WITH totals AS (
      SELECT s.participant_id, SUM(s.awarded_points) AS score, SUM(s.is_correct) AS correctAnswers, SUM(s.response_ms) AS responseMs
      FROM submissions s JOIN session_questions q ON q.id = s.question_id
      WHERE s.session_id = ? AND q.type = 'quiz_mcq' AND q.revealed_at IS NOT NULL AND score_published_at IS NOT NULL GROUP BY s.participant_id
    )
    SELECT p.id, p.nickname, p.avatar_index AS avatarIndex, COALESCE(t.score, 0) AS score,
      COALESCE(t.correctAnswers, 0) AS correctAnswers, COALESCE(t.responseMs, 0) AS responseMs
    FROM participants p LEFT JOIN totals t ON t.participant_id = p.id
    WHERE p.session_id = ? AND p.removed_at IS NULL
    ORDER BY score DESC, correctAnswers DESC, responseMs ASC, p.joined_at ASC, p.id ASC
  `).all(sessionId, sessionId) as Omit<RankEntry, 'rank'>[];
  const snapshot = db.prepare('SELECT previous_standings_json FROM sessions WHERE id = ?').get(sessionId) as { previous_standings_json: string };
  const previousRanks = new Map((JSON.parse(snapshot.previous_standings_json) as RankEntry[]).map(entry => [entry.id,entry]));
  let rank = 0;
  return rows.map((row, index) => {
    const previous = rows[index - 1];
    if (!previous || previous.score !== row.score || previous.correctAnswers !== row.correctAnswers || previous.responseMs !== row.responseMs) rank = index + 1;
    return { ...row, rank, ...(fastestIds.has(row.id) ? { fastestResponseMs:fastestMs } : {}), previousPosition: [...previousRanks.keys()].indexOf(row.id), previousScore: previousRanks.get(row.id)?.score ?? 0, previousRank: previousRanks.get(row.id)?.rank ?? null };
  });
}
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value);
  // Spreadsheet importers may ignore leading control bytes before a formula.
  // eslint-disable-next-line no-control-regex
  if (/^[\s\u0000-\u001f\u007f-\u009f]*[=+@-]/u.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function csv(rows: unknown[][]) { return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
export function resultsCsv(db: Database.Database, sessionId: string) {
  const ranked = new Map(rankings(db, sessionId).map(entry => [entry.id, entry]));
  const players = db.prepare(`SELECT p.id, p.nickname, p.avatar_index, p.removed_at, p.last_disconnect_at, p.last_disconnect_reason,
    COALESCE(SUM(CASE WHEN q.type = 'quiz_mcq' THEN s.awarded_points ELSE 0 END),0) AS points,
    COALESCE(SUM(CASE WHEN q.type = 'quiz_mcq' THEN s.is_correct ELSE 0 END),0) AS correct,
    COUNT(CASE WHEN q.type = 'quiz_mcq' THEN s.id END) AS answers,
    COUNT(CASE WHEN q.type = 'poll_mcq' THEN s.id END) AS polls,
    COALESCE(SUM(CASE WHEN q.type = 'quiz_mcq' THEN s.response_ms ELSE 0 END),0) AS response_ms
    FROM participants p LEFT JOIN submissions s ON s.participant_id = p.id AND s.question_id IN (SELECT id FROM session_questions WHERE session_id = ? AND revealed_at IS NOT NULL AND score_published_at IS NOT NULL)
    LEFT JOIN session_questions q ON q.id = s.question_id WHERE p.session_id = ? GROUP BY p.id ORDER BY p.joined_at, p.id
  `).all(sessionId, sessionId) as { id: string; nickname: string; avatar_index: number; removed_at: number | null; last_disconnect_at: number | null; last_disconnect_reason: string | null; points: number; correct: number; answers: number; polls: number; response_ms: number }[];
  return csv([['nickname','avatar','rank','total_points','correct_answers','scored_answers','poll_votes','valid_response_ms','removed','last_disconnect_at','last_disconnect_reason'],
    ...players.map(player => [player.nickname, avatarFor(player.avatar_index).icon, ranked.get(player.id)?.rank ?? '', player.points, player.correct, player.answers, player.polls, player.response_ms, player.removed_at !== null, player.last_disconnect_at, player.last_disconnect_reason])]);
}
export function questionStatsCsv(db: Database.Database, sessionId: string) {
  const rows = db.prepare(`SELECT q.order_index, q.type, q.text, q.options_json, q.revealed_at,
    COUNT(s.id) AS answers, COALESCE(SUM(s.is_correct),0) AS correct, AVG(s.response_ms) AS average_ms
    FROM session_questions q LEFT JOIN submissions s ON s.question_id = q.id WHERE q.session_id = ? GROUP BY q.id ORDER BY q.order_index
  `).all(sessionId) as { order_index: number; type: string; text: string; options_json: string; revealed_at: number | null; answers: number; correct: number; average_ms: number | null }[];
  const output: unknown[][] = [['question','type','text','revealed','answers','correct_answers','average_response_ms','option_id','option_text','option_count','option_percent']];
  for (const row of rows) {
    const counts = db.prepare('SELECT option_id, COUNT(*) AS count FROM submissions WHERE session_id = ? AND question_id = (SELECT id FROM session_questions WHERE session_id = ? AND order_index = ?) GROUP BY option_id').all(sessionId, sessionId, row.order_index) as { option_id: string; count: number }[];
    for (const option of JSON.parse(row.options_json) as { id: string; text: string }[]) {
      const count = counts.find(item => item.option_id === option.id)?.count ?? 0;
      output.push([row.order_index + 1, row.type, row.text, row.revealed_at !== null, row.answers, row.type === 'quiz_mcq' ? row.correct : '', row.average_ms === null ? '' : Math.round(row.average_ms), option.id, option.text, count, row.answers ? Math.round(count / row.answers * 100) : 0]);
    }
  }
  return csv(output);
}

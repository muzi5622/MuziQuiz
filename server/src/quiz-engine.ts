import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { LiveQuestion, ScoreHistoryEntry, SessionState, SubmissionReceipt, TransitionSchema } from '@localmenti/shared';
import type { z } from 'zod';
import { LobbyError } from './errors.js';
import { rankings } from './results.js';

type EngineSession = { id: string; state: SessionState; current_question_index: number; revision: number; preview_seconds: number };
type QuestionRow = {
  id: string; session_id: string; order_index: number; text: string; options_json: string; correct_option_id: string | null;
  duration_seconds: number; base_points: number; type: 'quiz_mcq' | 'poll_mcq'; explanation: string | null;
  started_at: number | null; ends_at: number | null; closed_at: number | null; revealed_at: number | null;
  preview_started_at: number | null;
  score_published_at: number | null;
};
type SubmissionRow = { question_id: string; option_id: string; received_at: number; response_ms: number; awarded_points: number; is_correct: number };
export function speedPoints(basePoints: number, responseMs: number, durationMs: number, correct: boolean) {
  if (!correct) return 0;
  const elapsed = Math.min(durationMs, Math.max(0, responseMs));
  return Math.round(basePoints * (0.5 + 0.5 * Math.max(0, 1 - elapsed / durationMs)));
}
export class QuizEngine {
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private histories = new Map<string, { revision: number; entries: ScoreHistoryEntry[] }>();
  constructor(private db: Database.Database, public now: () => number, private changed: (id: string) => void) {
    const active = db.prepare("SELECT id FROM sessions WHERE state = 'QUESTION_OPEN'").get() as { id: string } | undefined;
    if (active) { this.expire(active.id); this.arm(active.id); }
  }
  private session(id: string) {
    const row = this.db.prepare('SELECT id, state, current_question_index, revision, preview_seconds FROM sessions WHERE id = ?').get(id) as EngineSession | undefined;
    if (!row) throw new LobbyError('Session not found.', 404, 'NOT_FOUND'); return row;
  }
  private question(session: EngineSession) {
    return this.db.prepare('SELECT * FROM session_questions WHERE session_id = ? AND order_index = ?').get(session.id, session.current_question_index) as QuestionRow | undefined;
  }
  expire(id: string) {
    const session = this.session(id); const question = this.question(session);
    if (session.state === 'QUESTION_OPEN' && question?.ends_at !== null && question?.ends_at !== undefined && this.now() > question.ends_at && question.closed_at === null) {
      this.db.prepare('UPDATE session_questions SET closed_at = ends_at WHERE id = ? AND closed_at IS NULL').run(question.id);
      return true;
    }
    return false;
  }
  private arm(id: string) {
    clearTimeout(this.deadline);
    const session = this.session(id); const question = this.question(session);
    if (session.state !== 'QUESTION_OPEN' || !question || question.closed_at !== null || question.ends_at === null) return;
    const preview = question.started_at !== null && this.now() < question.started_at;
    // The exact end millisecond remains eligible. No auto-reveal or auto-advance.
    this.deadline = setTimeout(() => {
      if (preview || this.expire(id)) this.changed(id);
      this.arm(id);
    }, Math.max(1, (preview ? question.started_at! : question.ends_at + 1) - this.now()));
    this.deadline.unref();
  }
  current(id: string): LiveQuestion | null {
    this.expire(id);
    const row = this.question(this.session(id));
    if (!row || row.started_at === null || row.ends_at === null) return null;
    const options = JSON.parse(row.options_json) as { id: string; text: string }[];
    const optionsReleased = this.now() >= row.started_at && (row.closed_at === null || row.closed_at >= row.started_at);
    const result: LiveQuestion = { id: row.id, index: row.order_index, type: row.type, text: row.text, options: optionsReleased ? options.map(option => ({ id: option.id, text: option.text })) : [],
      durationSeconds: row.duration_seconds, basePoints: row.base_points, startedAt: row.started_at, endsAt: row.ends_at,
      closed: row.closed_at !== null, reveal: null, previewStartedAt: row.preview_started_at ?? row.started_at,
      phase: row.closed_at !== null ? 'CLOSED' : optionsReleased ? 'ANSWERING' : 'PREVIEW' };
    if (row.revealed_at !== null) {
      const counts = this.db.prepare('SELECT option_id, COUNT(*) AS count FROM submissions WHERE session_id = ? AND question_id = ? GROUP BY option_id').all(id, row.id) as { option_id: string; count: number }[];
      result.reveal = { correctOptionId: row.correct_option_id, explanation: row.explanation ?? '',
        counts: options.map(option => ({ optionId: option.id, count: counts.find(value => value.option_id === option.id)?.count ?? 0 })), totalAnswers: counts.reduce((sum, value) => sum + value.count, 0) };
    }
    return result;
  }
  transition(command: z.infer<typeof TransitionSchema>) {
    const { sessionId: id, expectedRevision, action } = command;
    this.expire(id);
    this.db.transaction(() => {
      const session = this.session(id);
      if (session.revision !== expectedRevision) throw new LobbyError('Session changed. Refresh its state before another action.', 409, 'STALE_STATE');
      const question = this.question(session); const now = this.now();
      let state: SessionState = session.state;
      if (action === 'start' || action === 'next') {
        if ((action === 'start' && session.state !== 'LOBBY') || (action === 'next' && session.state !== 'LEADERBOARD' && session.state !== 'QUESTION_REVEAL')) throw new LobbyError('That question transition is not allowed.', 409, 'INVALID_TRANSITION');
        const index = session.current_question_index + 1;
        const next = this.db.prepare('SELECT * FROM session_questions WHERE session_id = ? AND order_index = ?').get(id, index) as QuestionRow | undefined;
        if (!next || next.started_at !== null) throw new LobbyError('There is no unplayed next question. End the session.', 409, 'NO_NEXT_QUESTION');
        const optionsAt = now + session.preview_seconds * 1000;
        const endsAt = optionsAt + next.duration_seconds * 1000;
        this.db.prepare('UPDATE session_questions SET preview_started_at = ?, started_at = ?, ends_at = ? WHERE id = ?').run(now, optionsAt, endsAt, next.id);
        this.db.prepare('UPDATE sessions SET current_question_index = ?, question_started_at = ?, question_ends_at = ? WHERE id = ?').run(index, optionsAt, endsAt, id);
        state = 'QUESTION_OPEN';
      } else if (action === 'close') {
        if (session.state !== 'QUESTION_OPEN' || !question || question.closed_at !== null || question.started_at === null || now < question.started_at) throw new LobbyError('Answering must be open before it can be closed early.', 409, 'INVALID_TRANSITION');
        this.db.prepare('UPDATE session_questions SET closed_at = ? WHERE id = ?').run(now, question.id);
      } else if (action === 'reveal') {
        if (session.state !== 'QUESTION_OPEN' || !question || question.closed_at === null) throw new LobbyError('Close answering before revealing the answer.', 409, 'INVALID_TRANSITION');
        this.db.prepare('UPDATE session_questions SET revealed_at = ? WHERE id = ?').run(now, question.id); state = 'QUESTION_REVEAL';
      } else if (action === 'between') {
        if (session.state !== 'QUESTION_REVEAL') throw new LobbyError('Reveal the current answer first.', 409, 'INVALID_TRANSITION');
        this.publishScores(id,now);
        state = 'LEADERBOARD';
      }
      this.db.prepare('UPDATE sessions SET state = ?, revision = revision + 1 WHERE id = ?').run(state, id);
    })();
    this.arm(id); this.changed(id);
  }
  private publishScores(id: string, now: number) {
    const pending = this.db.prepare("SELECT id FROM session_questions WHERE session_id = ? AND type = 'quiz_mcq' AND revealed_at IS NOT NULL AND score_published_at IS NULL LIMIT 1").get(id);
    this.db.prepare("UPDATE session_questions SET score_published_at = ? WHERE session_id = ? AND type = 'poll_mcq' AND revealed_at IS NOT NULL AND score_published_at IS NULL").run(now,id);
    if (!pending) return;
    const previous = rankings(this.db,id);
    this.db.prepare('UPDATE sessions SET previous_standings_json = ?, standings_revision = standings_revision + 1 WHERE id = ?').run(JSON.stringify(previous),id);
    this.db.prepare('UPDATE session_questions SET score_published_at = ? WHERE session_id = ? AND revealed_at IS NOT NULL AND score_published_at IS NULL').run(now,id);
  }
  end(id: string) {
    this.db.transaction(() => {
      const session = this.session(id);
      if (session.state === 'FINISHED') return;
      const question = this.question(session); const now = this.now();
      if (question?.started_at !== null && question?.started_at !== undefined && question.closed_at === null) {
        this.db.prepare('UPDATE session_questions SET closed_at = ? WHERE id = ?').run(Math.min(now, question.ends_at ?? now), question.id);
      }
      if (question?.started_at !== null && question?.started_at !== undefined && now >= question.started_at) {
        this.db.prepare('UPDATE session_questions SET revealed_at = COALESCE(revealed_at, ?) WHERE id = ?').run(now,question.id);
      }
      this.publishScores(id,now);
      this.db.prepare("UPDATE sessions SET state = 'FINISHED', ended_at = ?, revision = revision + 1 WHERE id = ?").run(now, id);
    })();
    this.arm(id); this.changed(id);
  }
  private receipt(row: SubmissionRow, revealed: boolean, scored = true, published = revealed): SubmissionReceipt {
    const result: SubmissionReceipt = { questionId: row.question_id, optionId: row.option_id, receivedAt: row.received_at, responseMs: row.response_ms };
    if (published) result.awardedPoints = row.awarded_points;
    if (revealed && scored) result.correct = Boolean(row.is_correct);
    return result;
  }
  submit(sessionId: string, participantId: string, questionId: string, optionId: string, receivedAt: number) {
    const receipt = this.db.transaction(() => {
      const participant = this.db.prepare('SELECT id FROM participants WHERE id = ? AND session_id = ? AND removed_at IS NULL').get(participantId, sessionId);
      if (!participant) throw new LobbyError('Participant identity is no longer valid.', 401, 'UNAUTHORIZED');
      const requested = this.db.prepare('SELECT * FROM session_questions WHERE id = ? AND session_id = ?').get(questionId, sessionId) as QuestionRow | undefined;
      if (!requested) throw new LobbyError('Question not found in your session.', 400, 'INVALID_QUESTION');
      const existing = this.db.prepare('SELECT * FROM submissions WHERE session_id = ? AND participant_id = ? AND question_id = ?').get(sessionId, participantId, questionId) as SubmissionRow | undefined;
      // Retry after a lost ack, closure, reveal, or advance returns the immutable receipt.
      if (existing) return this.receipt(existing, requested.revealed_at !== null, requested.type === 'quiz_mcq', requested.score_published_at !== null);
      const session = this.session(sessionId);
      if (session.state !== 'QUESTION_OPEN' || requested.order_index !== session.current_question_index || requested.started_at === null || requested.ends_at === null) throw new LobbyError('This question is not accepting answers.', 409, 'QUESTION_CLOSED');
      if (receivedAt < requested.started_at) throw new LobbyError('Read the question first. Options are not open yet.', 409, 'PREVIEW_ACTIVE');
      if (requested.closed_at !== null || receivedAt > requested.ends_at) throw new LobbyError('Your answer arrived after answering closed.', 409, 'QUESTION_CLOSED');
      const options = JSON.parse(requested.options_json) as { id: string }[];
      if (!options.some(option => option.id === optionId)) throw new LobbyError('Choose an option from this question.', 400, 'INVALID_OPTION');
      const durationMs = requested.duration_seconds * 1000;
      const responseMs = Math.min(durationMs, Math.max(0, receivedAt - requested.started_at));
      const correct = requested.type === 'quiz_mcq' && optionId === requested.correct_option_id;
      const points = speedPoints(requested.base_points, responseMs, durationMs, correct);
      this.db.prepare('INSERT INTO submissions (id, session_id, participant_id, question_id, option_id, received_at, response_ms, awarded_points, is_correct) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), sessionId, participantId, questionId, optionId, receivedAt, responseMs, points, Number(correct));
      return this.receipt({ question_id: questionId, option_id: optionId, received_at: receivedAt, response_ms: responseMs, awarded_points: points, is_correct: Number(correct) }, false);
    })();
    this.changed(sessionId); return receipt;
  }
  privateState(sessionId: string, participantId: string, question: LiveQuestion | null) {
    const revision = this.session(sessionId).revision;
    let cached = this.histories.get(participantId);
    if (!cached || cached.revision !== revision) {
      const rows = this.db.prepare(`SELECT q.order_index AS questionIndex, COALESCE(s.awarded_points,0) AS points, s.response_ms AS responseMs, s.id AS submissionId
        FROM session_questions q LEFT JOIN submissions s ON s.question_id = q.id AND s.participant_id = ?
        WHERE q.session_id = ? AND q.type = 'quiz_mcq' AND q.score_published_at IS NOT NULL ORDER BY q.order_index`).all(participantId, sessionId) as { questionIndex: number; points: number; responseMs: number | null; submissionId: string | null }[];
      let total = 0;
      cached = { revision, entries: rows.map(row => { total += row.points; return { questionIndex: row.questionIndex, points: row.points, total, responseMs: row.responseMs, answered: row.submissionId !== null }; }) };
      if (this.histories.size >= 400 && !this.histories.has(participantId)) this.histories.delete(this.histories.keys().next().value!);
      this.histories.set(participantId, cached);
    }
    const row = question ? this.db.prepare('SELECT * FROM submissions WHERE session_id = ? AND participant_id = ? AND question_id = ?').get(sessionId, participantId, question.id) as SubmissionRow | undefined : undefined;
    const published = question ? this.db.prepare('SELECT score_published_at FROM session_questions WHERE id = ?').get(question.id) as { score_published_at: number | null } : undefined;
    return { score: cached.entries.at(-1)?.total ?? 0, history: cached.entries, submission: row ? this.receipt(row, Boolean(question?.reveal), question?.type === 'quiz_mcq', published?.score_published_at !== null && published !== undefined) : null };
  }
  answered(id: string, questionId?: string) {
    if (!questionId) return new Set<string>();
    const rows = this.db.prepare('SELECT participant_id FROM submissions WHERE session_id = ? AND question_id = ?').all(id, questionId) as { participant_id: string }[];
    return new Set(rows.map(row => row.participant_id));
  }
  close() { clearTimeout(this.deadline); }
}

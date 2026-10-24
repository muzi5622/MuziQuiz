import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Question, Quiz, QuizDraft, QuizSummary } from '@localmenti/shared';

type QuizRow = { id: string; title: string; description: string; duration_seconds: number; created_at: number; updated_at: number };
type QuestionRow = { type: 'quiz_mcq' | 'poll_mcq'; text: string; options_json: string; correct_option_id: string | null; duration_seconds: number; base_points: number; explanation: string };

export function listQuizzes(db: Database.Database): QuizSummary[] {
  const rows = db.prepare('SELECT q.*, (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS question_count FROM quizzes q ORDER BY updated_at DESC, id').all() as (QuizRow & { question_count: number })[];
  return rows.map(row => ({ id: row.id, title: row.title, description: row.description, durationSeconds: row.duration_seconds, createdAt: row.created_at, updatedAt: row.updated_at, questionCount: row.question_count }));
}
export function getQuiz(db: Database.Database, id: string): Quiz | undefined {
  const row = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(id) as QuizRow | undefined;
  if (!row) return undefined;
  const questions = (db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY order_index').all(id) as QuestionRow[]).map(question => ({
    type: question.type, text: question.text, options: JSON.parse(question.options_json), correctOptionId: question.correct_option_id,
    basePoints: question.base_points, explanation: question.explanation ?? ''
  }));
  return { id: row.id, title: row.title, durationSeconds: row.duration_seconds, description: row.description, createdAt: row.created_at, updatedAt: row.updated_at, questions };
}
function writeQuestions(db: Database.Database, quizId: string, questions: Question[], durationSeconds: number) {
  db.prepare('DELETE FROM questions WHERE quiz_id = ?').run(quizId);
  const insert = db.prepare('INSERT INTO questions (id, quiz_id, order_index, type, text, options_json, correct_option_id, duration_seconds, base_points, explanation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  questions.forEach((question, index) => insert.run(randomUUID(), quizId, index, question.type, question.text, JSON.stringify(question.options), question.correctOptionId, durationSeconds, question.basePoints, question.explanation));
}
export function createQuiz(db: Database.Database, draft: QuizDraft): Quiz {
  return db.transaction(() => {
    const id = randomUUID();
    const now = Date.now();
    db.prepare('INSERT INTO quizzes (id, title, description, duration_seconds, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, draft.title, draft.description, draft.durationSeconds, now, now);
    writeQuestions(db, id, draft.questions, draft.durationSeconds);
    return getQuiz(db, id)!;
  })();
}
export function updateQuiz(db: Database.Database, id: string, draft: QuizDraft, expectedUpdatedAt: number): Quiz | 'missing' | 'conflict' {
  return db.transaction(() => {
    const existing = getQuiz(db, id);
    if (!existing) return 'missing';
    if (existing.updatedAt !== expectedUpdatedAt) return 'conflict';
    const now = Math.max(Date.now(), existing.updatedAt + 1);
    db.prepare('UPDATE quizzes SET title = ?, description = ?, duration_seconds = ?, updated_at = ? WHERE id = ?').run(draft.title, draft.description, draft.durationSeconds, now, id);
    writeQuestions(db, id, draft.questions, draft.durationSeconds);
    return getQuiz(db, id)!;
  })();
}

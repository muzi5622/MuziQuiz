import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openDatabase } from './database.js';
import { QuizEngine, speedPoints } from './quiz-engine.js';

afterEach(() => vi.useRealTimers());
describe('speed scoring and deadline scheduling', () => {
  it.each([[0, 1000], [5000, 875], [10000, 750], [15000, 625], [20000, 500]])('scores a correct answer at %d ms as %d points', (elapsed, expected) => {
    expect(speedPoints(1000, elapsed, 20000, true)).toBe(expected);
    expect(speedPoints(1000, elapsed, 20000, false)).toBe(0);
  });
  it('clamps elapsed time and rounds configured points', () => {
    expect(speedPoints(1000, -100, 20000, true)).toBe(1000);
    expect(speedPoints(1000, 22000, 20000, true)).toBe(500);
    expect(speedPoints(999, 10000, 20000, true)).toBe(749);
  });
  it('closes only after the exact deadline, never reveals or advances automatically', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_700_000_000_000);
    const db = openDatabase(':memory:');
    const id = randomUUID(); const questionId = randomUUID();
    db.prepare("INSERT INTO sessions (id, quiz_id, six_digit_pin, state, created_at, quiz_title, lan_address, port) VALUES (?, 'quiz', '123456', 'LOBBY', ?, 'Test', '127.0.0.1', 3000)").run(id, Date.now());
    db.prepare("INSERT INTO session_questions (id, session_id, order_index, type, text, options_json, correct_option_id, duration_seconds, base_points, explanation) VALUES (?, ?, 0, 'quiz_mcq', 'Test?', ?, 'a', 20, 1000, 'Hidden')").run(questionId, id, JSON.stringify([{ id: 'a', text: 'One' }, { id: 'b', text: 'Two' }]));
    const changed = vi.fn(); const engine = new QuizEngine(db, Date.now, changed);
    try {
      engine.transition({ sessionId: id, expectedRevision: 0, action: 'start' });
      expect(engine.current(id)?.options).toEqual([]);
      await vi.advanceTimersByTimeAsync(3000);
      expect(engine.current(id)?.phase).toBe('ANSWERING');
      await vi.advanceTimersByTimeAsync(20000);
      expect(engine.current(id)?.closed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(engine.current(id)?.closed).toBe(true); expect(engine.current(id)?.reveal).toBeNull();
      await vi.advanceTimersByTimeAsync(120000);
      expect(db.prepare('SELECT state, current_question_index FROM sessions WHERE id = ?').get(id)).toEqual({ state: 'QUESTION_OPEN', current_question_index: 0 });
      expect(changed).toHaveBeenCalledTimes(3);
    } finally { engine.close(); db.close(); }
  });
});

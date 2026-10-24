import { describe, expect, it } from 'vitest';
import { QuestionSchema, QuizDraftSchema, QuizFileSchema } from './index.js';

const question = { type: 'quiz_mcq', text: 'Which one?', options: [{ id: 'a', text: 'One' }, { id: 'b', text: 'Two' }], correctOptionId: 'a', basePoints: 1000, explanation: '' };
describe('quiz authoring contracts', () => {
  it('requires one quiz-wide time in v2 and rejects per-question time overrides', () => {
    const quiz = { title:'Global time', durationSeconds:15, questions:[question] };
    expect(QuizFileSchema.parse({ version:2,quiz }).quiz.durationSeconds).toBe(15);
    expect(QuizDraftSchema.safeParse({ ...quiz,questions:[{ ...question,durationSeconds:30 }] }).success).toBe(false);
    expect(QuizFileSchema.safeParse({ version:2,quiz:{ title:'Missing time',questions:[question] } }).success).toBe(false);
  });
  it('rejects retired version-1 files and keeps only the current global-time format', () => {
    expect(QuizFileSchema.safeParse({ version:1,quiz:{ title:'Old quiz',questions:[{ ...question,durationSeconds:15 }] } }).success).toBe(false);
  });
  it('trims text, defaults points and accepts empty quiz drafts', () => {
    expect(QuizDraftSchema.parse({ title: '  My quiz  ', questions: [] })).toEqual({ title: 'My quiz', description: '', durationSeconds: 20, questions: [] });
    const { basePoints: _points, ...withoutPoints } = question;
    expect(_points).toBe(1000);
    expect(QuestionSchema.parse(withoutPoints).basePoints).toBe(1000);
  });
  it.each([4, 121, 10.5, '20', null])('rejects invalid duration %s', durationSeconds => {
    expect(QuizDraftSchema.safeParse({ title: 'Timed quiz', questions: [question], durationSeconds }).success).toBe(false);
  });
  it.each([5, 10, 120])('accepts answer time %s seconds', durationSeconds => {
    expect(QuizDraftSchema.safeParse({ title: 'Timed quiz', questions: [question], durationSeconds }).success).toBe(true);
  });
  it.each([0, -1, 10001, 1.5])('rejects invalid maximum points %s', basePoints => {
    expect(QuestionSchema.safeParse({ ...question, basePoints }).success).toBe(false);
  });
  it('requires 2–6 options with unique IDs and one existing correct answer', () => {
    for (const invalid of [
      { ...question, options: question.options.slice(0, 1) },
      { ...question, options: Array.from({ length: 7 }, (_, index) => ({ id: `${index}`, text: 'Answer' })) },
      { ...question, options: [question.options[0], question.options[0]] },
      { ...question, correctOptionId: 'missing' },
      { ...question, text: '  ' },
      { ...question, options: [{ id: 'a', text: '' }, question.options[1]] }
    ]) expect(QuestionSchema.safeParse(invalid).success).toBe(false);
  });
  it('rejects oversized fields, too many questions, alternate modes, invalid polls and unknown versions', () => {
    const quiz = { title: 'My quiz', durationSeconds: 20, questions: [question] };
    expect(QuizDraftSchema.safeParse({ ...quiz, title: 'x'.repeat(121) }).success).toBe(false);
    expect(QuizDraftSchema.safeParse({ ...quiz, questions: Array(101).fill(question) }).success).toBe(false);
    expect(QuizDraftSchema.safeParse({ ...quiz, scoringMode: 'fixed' }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...question, type: 'poll_mcq' }).success).toBe(false);
    expect(QuestionSchema.parse({ ...question, type: 'poll_mcq', correctOptionId: null, basePoints: 0 }).type).toBe('poll_mcq');
    expect(QuestionSchema.safeParse({ ...question, options: [{ id: 'a', text: 'x'.repeat(301) }, question.options[1]] }).success).toBe(false);
    expect(QuizFileSchema.safeParse({ version: 3, quiz }).success).toBe(false);
    expect(QuizFileSchema.safeParse({ version: 2, quiz }).success).toBe(true);
  });
  it('keeps exported UTF-8 quizzes within the import cap', () => {
    const largeQuestion = { ...question, text: '界'.repeat(2000), explanation: '界'.repeat(2000) };
    expect(QuizDraftSchema.safeParse({ title: 'Large quiz', questions: Array(100).fill(largeQuestion) }).success).toBe(false);
  });
});

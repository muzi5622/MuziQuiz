import { expect, it } from 'vitest';
import { MAX_IMPORT_BYTES } from '@localmenti/shared';
import { importExample } from './import-guide.js';
import { parseQuizImport } from './import-json.js';

it('accepts pasted quiz JSON and UTF-8 BOM files through the same validator', () => {
  const json = JSON.stringify(importExample);
  expect(parseQuizImport(`\n${json}\n`)).toEqual(importExample);
  expect(parseQuizImport(`\uFEFF${json}`)).toEqual(importExample);
  // Straight from an AI chat: one ```json code block.
  expect(parseQuizImport('```json\n'+JSON.stringify(importExample,null,2)+'\n```')).toEqual(importExample);
  expect(parseQuizImport('```\r\n'+json+'\r\n```\r\n')).toEqual(importExample);
});
it('explains blank, malformed and fenced pasted content', () => {
  expect(() => parseQuizImport('  ')).toThrow('Add your quiz JSON');
  expect(() => parseQuizImport('{')).toThrow('Invalid JSON');
  expect(() => parseQuizImport('```json\n```')).toThrow('Add your quiz JSON first.');
  expect(() => parseQuizImport('```json\n{}\n```\n```json\n{}\n```')).toThrow('only one JSON code block');
});
it('reports schema field paths and rejects additional fields', () => {
  const quiz = structuredClone(importExample); quiz.quiz.questions[0].correctOptionId = 'missing';
  expect(() => parseQuizImport(JSON.stringify(quiz))).toThrow('quiz.questions.0.correctOptionId');
  expect(() => parseQuizImport(JSON.stringify({ ...importExample, isAdmin: true }))).toThrow('Invalid quiz JSON');
});
it('enforces UTF-8 byte size, including multibyte pasted characters', () => {
  expect(() => parseQuizImport('x'.repeat(MAX_IMPORT_BYTES+1))).toThrow('512 KiB');
  expect(() => parseQuizImport('界'.repeat(Math.ceil(MAX_IMPORT_BYTES/3)))).toThrow('512 KiB');
});

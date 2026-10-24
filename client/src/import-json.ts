import { MAX_IMPORT_BYTES, QuizFileSchema } from '@localmenti/shared';

/** Both pasted text and uploaded files follow the same import contract. */
export function parseQuizImport(text: string) {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) throw new Error('Quiz JSON must be 512 KiB or smaller.');
  let content = text.replace(/^\uFEFF/,'').trim();
  // AI answers arrive in a ```json code block; accept one wrapping block.
  const fenced = /^```[\w-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(content);
  if (fenced) content = fenced[1].trim();
  if (!content) throw new Error('Add your quiz JSON first.');
  if (content.includes('```')) throw new Error('Paste only one JSON code block. Remove any extra ``` lines.');
  let value: unknown;
  try { value = JSON.parse(content); }
  catch { throw new Error('Invalid JSON. Check double quotes, commas and closing brackets.'); }
  const result = QuizFileSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Invalid quiz JSON at ${issue.path.join('.') || 'root'}: ${issue.message}`);
  }
  return result.data;
}

import { useEffect, useRef, useState } from 'react';
import { MAX_IMPORT_BYTES, MIN_ANSWER_SECONDS, QuizFileSchema } from '@localmenti/shared';

export const importExample = {
  version: 2,
  quiz: { title: 'Space basics', description: 'A short warm-up round', durationSeconds: 20, questions: [
    { type: 'quiz_mcq', text: 'Which planet is called the Red Planet?', options: [{ id: 'a', text: 'Venus' },{ id: 'b', text: 'Earth' },{ id: 'c', text: 'Mars' },{ id: 'd', text: 'Jupiter' }], correctOptionId: 'c', basePoints: 1000, explanation: 'Iron oxide gives Mars its red appearance.' }
  ] }
};
export const quizPrompt = `Create a quiz about [TOPIC] for [AUDIENCE], with [NUMBER, up to 100] multiple-choice questions.

First design and fact-check the quiz, then convert it into the exact MuziQuiz JSON format below.

Output rules:
- Put the complete final JSON inside ONE Markdown code block that starts with \`\`\`json and ends with \`\`\`, so it can be copied in one click.
- Do not split the JSON across several code blocks, and do not put any other text inside the code block.
- Keep any commentary outside the code block, and keep it to one short line at most.

Writing rules:
- Keep questions clear and concise, with exactly one unambiguous correct answer.
- Use four plausible answer choices with IDs a, b, c, d. Keep answers short and similar in length and detail. Do not make the correct answer noticeably longer or more specific; that gives away the answer.
- Shuffle the answer positions independently across questions. Vary correctOptionId across a, b, c and d without a predictable pattern. After shuffling, verify that correctOptionId still matches the correct option ID.
- Avoid joke distractors, answer clues, and “all/none of the above.” Add a short factual explanation for each answer.

Format rules:
- Top level has only version (the number 2) and quiz. quiz has only title, description, durationSeconds and questions.
- title: 1–120 characters; description: at most 2000 characters; questions: at most 100.
- Each question has only type, text, options, correctOptionId, basePoints and explanation.
- Use type "quiz_mcq"; text: 1–2000 characters; options: 2–6 objects, each containing only a unique id and nonempty text (at most 300 characters). Use four choices for this request.
- correctOptionId must exactly match one of that question's option IDs. It is an ID, not the answer text or a numeric index.
- quiz.durationSeconds is the single global answer time for ALL questions; do not put durationSeconds on individual questions. Use an integer ${MIN_ANSWER_SECONDS}–120 (default 20); basePoints: integer 1–10000 (default 1000); explanation: at most 2000 characters.
- Use JSON numbers, double-quoted strings, no comments/trailing commas, and no extra fields such as scoreMode or correct flags on options. The complete UTF-8 file must be at most ${MAX_IMPORT_BYTES / 1024} KiB.

Example structure (replace its content with the requested quiz):
${JSON.stringify(importExample,null,2)}`;

export function ImportGuide({ busy, error, onChoose, onClose, onPaste }: { busy: boolean; error: string; onChoose: () => void; onClose: () => void; onPaste?: (text: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const prompt = useRef<HTMLTextAreaElement>(null);
  const [notice,setNotice] = useState('');
  const [method,setMethod] = useState<'file' | 'paste'>('file');
  const [json,setJson] = useState('');
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); },[]);
  async function copy() {
    try { if (!navigator.clipboard) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(quizPrompt); setNotice('Prompt copied. Replace TOPIC, AUDIENCE and NUMBER before using it.'); }
    catch { prompt.current?.focus(); prompt.current?.select(); const copied = document.execCommand?.('copy'); setNotice(copied ? 'Quiz-writing prompt copied.' : 'Prompt selected. Press Ctrl+C (or use your device’s Copy command).'); }
  }
  function example() {
    const validated = QuizFileSchema.parse(importExample);
    const url = URL.createObjectURL(new Blob([JSON.stringify(validated,null,2)],{ type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'localmenti-example.json'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  return <dialog ref={dialog} className="import-dialog" aria-labelledby="import-title" onClose={onClose}><div className="import-top"><span className="kicker">BRING YOUR QUESTIONS</span><button onClick={onClose} aria-label="Close import instructions">Close</button></div><h2 id="import-title">A little structure.<br/><em>A whole quiz.</em></h2><p className="import-intro">Read the format, then upload a file or paste your JSON below. Import creates a new saved quiz.</p><ol className="import-steps"><li><strong>01 / Write</strong><span>Short, clear MCQs with plausible answers of similar length.</span></li><li><strong>02 / Format</strong><span>Version 2 JSON, up to 100 questions and 512 KiB.</span></li><li><strong>03 / Review</strong><span>Check facts and correct answers before hosting.</span></li></ol><details className="format-example"><summary>Required JSON structure</summary><pre><code>{JSON.stringify(importExample,null,2)}</code></pre><p className="hint">2–6 choices per question. Correct answer must match an option ID. Quiz-wide time: {MIN_ANSWER_SECONDS}–120 seconds. Maximum points: 1–10,000. No extra fields or trailing commas.</p><p className="hint">For an unscored poll use type <code>poll_mcq</code>, <code>correctOptionId: null</code> and <code>basePoints: 0</code>.</p><p className="hint">Use version 2 only, with one quiz-wide durationSeconds value. Older formats are no longer imported.</p><button onClick={example}>Download example JSON</button></details><section className="ai-prompt"><div className="section-heading"><h3>Need help preparing the file?</h3><button onClick={() => void copy()}>Copy AI prompt</button></div><p className="hint">Optional: paste this into an AI tool you choose. MuziQuiz makes no AI requests. Replace the bracketed topic, audience and question count, and review the generated answers.</p><label htmlFor="quiz-ai-prompt">Copyable quiz-writing and conversion prompt</label><textarea id="quiz-ai-prompt" ref={prompt} readOnly rows={10} value={quizPrompt}/><p className="hint" role="status">{notice}</p></section><section className="import-source" aria-labelledby="import-source-title"><h3 id="import-source-title">How would you like to import?</h3><div className="import-methods" role="group" aria-label="Import method"><button aria-pressed={method === 'file'} disabled={busy} onClick={() => setMethod('file')}>Upload a file</button><button aria-pressed={method === 'paste'} disabled={busy} onClick={() => setMethod('paste')}>Paste JSON</button></div>{method === 'file' ? <p className="hint">Choose a .json file from your device. It will be checked before a new quiz is saved.</p> : <div className="paste-json-panel"><label htmlFor="pasted-quiz-json">Your quiz JSON</label><textarea id="pasted-quiz-json" value={json} disabled={busy} maxLength={MAX_IMPORT_BYTES} rows={12} spellCheck={false} autoCapitalize="off" autoCorrect="off" placeholder={'{ "version": 2, "quiz": { ... } }'} aria-describedby="paste-json-help" aria-invalid={Boolean(error)} onChange={event => setJson(event.target.value)}/><div className="paste-json-meta"><p id="paste-json-help" className="hint">Paste the complete JSON object, without Markdown fences. Maximum 512 KiB; the same validation applies to files and pasted text.</p><button disabled={busy || !json} onClick={() => setJson('')}>Clear text</button></div></div>}</section>{error && <p className="error" role="alert">{error}</p>}<div className="import-footer"><span className="hint">Your existing quizzes stay saved.</span>{method === 'paste' && <button className="button" disabled={busy || !json.trim()} onClick={() => onPaste?.(json)}>{busy ? 'Importing quiz...' : 'Import pasted JSON'}</button>}{method === 'file' && <button className="button" disabled={busy} onClick={onChoose}>{busy ? 'Checking your file…' : 'Choose JSON file'}</button>}</div></dialog>;
}

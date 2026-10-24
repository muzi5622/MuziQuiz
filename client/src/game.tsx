import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { ActionResult, ClientToServerEvents, LiveQuestion, PublicLobby, ServerToClientEvents, SubmissionReceipt, TransitionSchema } from '@localmenti/shared';
import type { z } from 'zod';
import './game.css';
import { Standings } from './players.js';

export const ClockOffset = createContext(0);
export function useRemaining(question: LiveQuestion | null) {
  const offset = useContext(ClockOffset);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 100); return () => window.clearInterval(timer); }, []);
  return question && !question.closed ? Math.max(0, (question.phase === 'PREVIEW' ? question.startedAt : question.endsAt) - (now + offset)) : 0;
}
function TimingStrip({ question, remaining }: { question: LiveQuestion; remaining: number }) {
  const preview = question.phase === 'PREVIEW';
  const duration = preview ? question.startedAt - question.previewStartedAt : question.durationSeconds * 1000;
  return <div className={`timing-strip ${preview ? 'timing-preview' : ''}`}><div><span>{preview ? 'Read the question first' : question.closed || remaining === 0 ? 'Answering closed' : 'Tap one option to answer'}</span><strong role="timer">{Math.ceil(remaining / 1000)}s</strong></div><progress max={Math.max(1,duration)} value={Math.min(duration,Math.max(0,duration - remaining))} aria-label={preview ? 'Reading time elapsed' : 'Answer time elapsed'}/>{preview && <p>Options appear next. Your answer timer has not started.</p>}</div>;
}
export function AnswerDistribution({ question }: { question: LiveQuestion }) {
  const reveal = question.reveal;
  if (!reveal) return null;
  const highest = Math.max(1,...reveal.counts.map(option => option.count));
  return <section className="answer-distribution" aria-label="Revealed answer distribution"><div className="distribution-heading"><h3>{question.type === 'poll_mcq' ? 'What the room thinks.' : 'Here is how the room answered.'}</h3><span>{reveal.totalAnswers} responses</span></div><div className="distribution-chart" style={{ gridTemplateColumns: `repeat(${question.options.length}, minmax(0, 1fr))` }}>{question.options.map((option,index) => {
    const count = reveal.counts.find(value => value.optionId === option.id)?.count ?? 0;
    const correct = reveal.correctOptionId === option.id;
    return <div className={`distribution-column distribution-color-${index} ${correct ? 'distribution-correct' : ''}`} key={option.id}><div className="distribution-tower"><strong className="distribution-count">{count}{correct && <span aria-label="Correct answer"> ✓</span>}</strong><div className="distribution-bar" style={{ height: `${Math.max(2,count/highest*75)}%` }}/></div><div className="distribution-label"><span className="distribution-letter">{String.fromCharCode(65+index)}</span><strong>{option.text}</strong></div><span className="distribution-percent">{reveal.totalAnswers ? Math.round(count/reveal.totalAnswers*100) : 0}%{correct ? ' / Correct' : ''}</span></div>;
  })}</div>{reveal.explanation && <p className="explanation">{reveal.explanation}</p>}</section>;
}

export function AnswerFeedback({ question, submission }: { question: LiveQuestion; submission: SubmissionReceipt | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [dismissed,setDismissed] = useState(false);
  const key = `localmenti:feedback:${question.id}`;
  const revealed = question.type === 'quiz_mcq' && question.reveal !== null;
  useEffect(() => {
    if (!revealed) return;
    try { if (sessionStorage.getItem(key)) { setDismissed(true); return; } } catch { /* Feedback also works without storage. */ }
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => { element.close(); };
  },[key,revealed]);
  if (!revealed || dismissed) return null;
  const correct = Boolean(submission && submission.optionId === question.reveal!.correctOptionId);
  const correctText = question.options.find(option => option.id === question.reveal!.correctOptionId)?.text;
  function dismiss() {
    try { sessionStorage.setItem(key,'seen'); } catch { /* No storage required. */ }
    setDismissed(true);
  }
  return <dialog ref={dialog} className={`answer-feedback ${correct ? 'feedback-correct' : submission ? 'feedback-incorrect' : 'feedback-missing'}`} aria-labelledby="feedback-title" onCancel={dismiss}><div className="feedback-symbol" aria-hidden="true">{correct ? '✓' : submission ? '×' : '—'}</div><p className="kicker">THE HOST REVEALED THE ANSWER</p><h2 id="feedback-title">{correct ? 'You got it right!' : submission ? 'Not this time.' : 'No answer this round.'}</h2>{correctText && <p className="feedback-answer"><span>Correct answer</span><strong>{correctText}</strong></p>}{submission && <p className="hint">Your answer reached the server in {(submission.responseMs/1000).toFixed(2)}s.</p>}<p className="hint">Points stay sealed until the host reveals the leaderboard.</p><button className="button" onClick={dismiss}>Continue</button></dialog>;
}
export function QuestionView({ session }: { session: PublicLobby }) {
  const question = session.question;
  const remaining = useRemaining(question);
  if (!question) return null;
  return <section className={`live-question quiz-stage ${question.phase === 'PREVIEW' ? 'quiz-reading' : ''}`}><div className="question-meta"><span className="kicker">Question {question.index + 1} of {session.questionCount}</span><span className={`question-timer ${remaining === 0 ? 'timer-closed' : ''}`} role="timer" aria-label={remaining > 0 ? `${Math.ceil(remaining / 1000)} seconds remaining` : 'Answering closed'}>{question.phase === 'PREVIEW' ? 'Read first' : question.closed || remaining === 0 ? 'Answering closed' : `${Math.ceil(remaining / 1000)}s`}</span></div><h2>{question.text}</h2>{!question.reveal && <TimingStrip question={question} remaining={remaining}/>}{!question.reveal && <div className="question-options">{question.options.map((option, index) => <div className={`display-option ${question.reveal?.correctOptionId === option.id ? 'revealed-correct' : ''}`} key={option.id}><span className="option-letter">{String.fromCharCode(65 + index)}</span><span>{option.text}</span>{question.reveal?.correctOptionId === option.id && <strong className="correct-label">Correct</strong>}</div>)}</div>}{question.reveal && <AnswerDistribution question={question}/>}<p className="hint">{session.answeredCount} answers received · {question.type === 'poll_mcq' ? 'Unscored poll' : `maximum ${question.basePoints.toLocaleString()} points`}</p>{session.state === 'LEADERBOARD' && <p className="stage-message">Round complete. Waiting for the host to continue.</p>}</section>;
}
export function ParticipantQuestion({ session, submission, socket, connected, onAccepted }: {
  session: PublicLobby; submission: SubmissionReceipt | null; socket?: Socket<ServerToClientEvents, ClientToServerEvents>;
  connected: boolean; onAccepted: (receipt: SubmissionReceipt) => void;
}) {
  const question = session.question!;
  const remaining = useRemaining(question);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  useEffect(() => { if (submission) { inFlight.current = false; setBusy(false); setError(''); } }, [submission]);
  const allowed = session.state === 'QUESTION_OPEN' && question.phase === 'ANSWERING' && !question.closed && remaining > 0 && connected && !submission && !busy;
  function submit(optionId: string) {
    if (!allowed || !optionId || !socket || inFlight.current) return;
    inFlight.current = true; setSelected(optionId); setBusy(true); setError('');
    socket.volatile.timeout(5000).emit('answer:submit', { questionId: question.id, optionId }, (timeout: Error | null, result: ActionResult<SubmissionReceipt>) => {
      inFlight.current = false;
      setBusy(false);
      if (timeout) { setError('No receipt yet. Reconnect to check, or retry this answer while answering is open.'); return; }
      if (!result.ok) { setError(result.error); return; }
      onAccepted(result.data); setError('');
    });
  }
  const correct = Boolean(submission && question.reveal?.correctOptionId === submission.optionId);
  return <section className={`participant-question quiz-stage ${question.phase === 'PREVIEW' ? 'quiz-reading' : ''}`}>
    <div className="question-meta"><span className="kicker">Question {question.index+1} of {session.questionCount}</span><span className="question-timer" role="timer">{question.phase === 'PREVIEW' ? 'Read first' : question.closed || remaining === 0 ? 'Closed' : Math.ceil(remaining/1000)+'s'}</span></div>
    <h2>{question.text}</h2>
    {!question.reveal && !submission && <TimingStrip question={question} remaining={remaining}/>}
    {question.phase !== 'PREVIEW' && !submission && !question.reveal && <fieldset className="answer-card-list" disabled={!allowed}><legend>{question.type === 'poll_mcq' ? 'Your opinion' : 'Tap one answer'}</legend>{question.options.map((option,index) => <label key={option.id} className={`answer-option ${selected === option.id ? 'answer-selected' : ''}`}><input type="radio" name={`answer-${question.id}`} checked={selected === option.id} value={option.id} onChange={() => submit(option.id)}/><span className="option-letter">{String.fromCharCode(65+index)}</span><span className="answer-card-text">{option.text}</span><span className="answer-card-check" aria-hidden="true">{selected === option.id ? String.fromCharCode(10003) : ''}</span></label>)}</fieldset>}
    {busy && <p role="status">Sending answer...</p>}
    {submission && !question.reveal && <div className="answer-receipt" role="status"><div className="response-stamp"><span>Answer locked</span><strong>{(submission.responseMs/1000).toFixed(2)}s</strong></div><p>{question.options.find(option => option.id === submission.optionId)?.text}</p><p>Your selection is locked. Waiting for the host to reveal.</p></div>}
    {question.reveal && <><AnswerFeedback question={question} submission={submission}/><div className={`own-answer-result ${correct ? 'own-answer-correct' : ''}`} role="status"><h3>{question.type === 'poll_mcq' ? submission ? 'Vote recorded' : 'No vote received' : !submission ? 'No answer received' : correct ? 'Correct answer!' : 'Not this time.'}</h3>{question.type === 'quiz_mcq' && <p>Correct answer: <strong>{question.options.find(option => option.id === question.reveal!.correctOptionId)?.text}</strong></p>}<p>Wait for the host to continue.</p></div></>}
    {!submission && !question.reveal && question.phase !== 'PREVIEW' && question.closed && <p className="stage-message">Answering closed. Waiting for the host.</p>}
    {error && !submission && <div className="error" role="alert">{error}{allowed && selected && <button onClick={() => submit(selected)}>Retry selected answer</button>}</div>}
  </section>;
}

export function HostQuestionControls({ session, connected, busy, onAction, onEnd }: {
  session:PublicLobby; connected:boolean; busy:boolean; onAction:(action:z.infer<typeof TransitionSchema>['action']) => void; onEnd:() => void;
}) {
  const nextExists = (session.question?.index ?? -1)+1 < session.questionCount;
  const board = session.state === 'LEADERBOARD' || session.state === 'FINISHED';
  if (session.state === 'LOBBY') return <section className="presentation-controls lobby-controls"><span>Reading time: {session.previewSeconds}s before answers open</span><button className="button" disabled={!connected || busy} onClick={() => onAction('start')}>Next: first question</button></section>;
  return <section className="presentation-stage" data-view={board ? 'leaderboard' : 'question'}><div className="presentation-surface">{board ? <Standings session={session}/> : session.question && <QuestionView session={session}/>}</div><div className="presentation-controls">
    <span className="presentation-progress">Question {(session.question?.index ?? 0)+1} / {session.questionCount} / {session.answeredCount} answered{!board ? ' / Points sealed' : ''}</span>
    {session.state === 'QUESTION_OPEN' && session.question?.phase === 'PREVIEW' && <span>Read first. Answers open next.</span>}
    {session.state === 'QUESTION_OPEN' && session.question?.phase === 'ANSWERING' && <button className="button" disabled={!connected || busy} onClick={() => onAction('reveal')}>Next: close &amp; reveal answer</button>}
    {session.state === 'QUESTION_OPEN' && session.question?.closed && <button className="button" disabled={!connected || busy} onClick={() => onAction('reveal')}>Next: reveal answer</button>}
    {session.state === 'QUESTION_REVEAL' && <button className="button" disabled={!connected || busy} onClick={() => onAction('between')}>Show leaderboard</button>}
    {(session.state === 'LEADERBOARD' || session.state === 'QUESTION_REVEAL') && nextExists && <button className="button" disabled={!connected || busy} onClick={() => onAction('next')}>Next question</button>}
    {(session.state === 'LEADERBOARD' || session.state === 'QUESTION_REVEAL') && !nextExists && <button className="button" disabled={!connected || busy} onClick={onEnd}>Finish quiz</button>}
    {session.state === 'FINISHED' && <span>Session finished</span>}
  </div></section>;
}

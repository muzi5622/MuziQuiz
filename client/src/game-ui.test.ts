import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { PublicLobby } from '@localmenti/shared';
import { AnswerDistribution, AnswerFeedback, HostQuestionControls, ParticipantQuestion, QuestionView } from './game.js';
import { Standings, WelcomeLobby } from './players.js';
import { PersonalStanding } from './lobby.js';

function session(): PublicLobby {
  const now = Date.now();
  return { id: 'session', pin: '123456', state: 'QUESTION_OPEN', title: 'Quiz', questionCount: 2, joinedCount: 1, connectedCount: 1, joinUrl: '/s/123456', lanAddress: '127.0.0.1', revision: 1, eventName:'',standingsRevision: 0, serverTime: now, answeredCount: 0, players: [], leaderboard: [], podium: [], previewSeconds: 3,
    question: { id: 'question', index: 0, type: 'quiz_mcq', text: 'Ready?', options: [], durationSeconds: 20, basePoints: 1000, startedAt: now+3000, endsAt: now+23000, previewStartedAt: now, phase: 'PREVIEW', closed: false, reveal: null } };
}
it('shows reading instructions without answer controls during preview', () => {
  const html = renderToStaticMarkup(createElement(ParticipantQuestion,{ session: session(), submission: null, connected: true, onAccepted: () => {} }));
  expect(html).toContain('Your answer timer has not started.');
  expect(html).not.toContain('type="radio"'); expect(html).not.toContain('No answer received');
});
it('shows response time without a point award on the answer receipt', () => {
  const current = session(); current.question!.phase = 'ANSWERING';
  const html = renderToStaticMarkup(createElement(ParticipantQuestion,{ session: current, submission: { questionId: 'question', optionId: 'a', receivedAt: Date.now(), responseMs: 1250 }, connected: true, onAccepted: () => {} }));
  expect(html).toContain('1.25s'); expect(html).toContain('Your selection is locked.');
  expect(html).not.toContain('1,000'); expect(html).not.toContain('Submit answer');
});
it('offers both a standings reveal and next question after the answer reveal', () => {
  const current = session(); current.state = 'QUESTION_REVEAL'; current.question!.closed = true;
  const html = renderToStaticMarkup(createElement(HostQuestionControls,{ session: current, connected: true, busy: false, onAction: () => {}, onEnd: () => {} }));
  expect(html).toContain('Show leaderboard'); expect(html).toContain('Next question'); expect(html).toContain('sealed');
});
it('renders no standings before the host authorizes their release', () => {
  const current = session(); current.state = 'QUESTION_REVEAL';
  current.leaderboard = [{ id: 'one', nickname: 'SecretWinner', avatarIndex: 0, rank: 1, score: 997, correctAnswers: 1, responseMs: 120 }];
  expect(renderToStaticMarkup(createElement(Standings,{ session: current }))).toBe('');
});
function revealedQuestion() {
  const q = session().question!;
  q.phase = 'CLOSED'; q.closed = true;
  q.options = [{ id:'a',text:'First choice' },{ id:'b',text:'Second choice' }];
  q.reveal = { correctOptionId:'b',explanation:'A factual explanation.',counts:[{ optionId:'a',count:2 },{ optionId:'b',count:3 }],totalAnswers:5 };
  return q;
}
it('withholds distribution and feedback until the host reveals the answer', () => {
  const q = revealedQuestion(); q.reveal = null;
  expect(renderToStaticMarkup(createElement(AnswerDistribution,{ question:q }))).toBe('');
  expect(renderToStaticMarkup(createElement(AnswerFeedback,{ question:q,submission:null }))).toBe('');
});
it('shows per-option counts, percentages and the correct marker on reveal', () => {
  const current = session(); current.question = revealedQuestion(); current.state = 'QUESTION_REVEAL';
  const html = renderToStaticMarkup(createElement(QuestionView,{ session:current }));
  expect(html).toContain('5 responses'); expect(html).toContain('40%'); expect(html).toContain('60%');
  expect(html).toContain('First choice'); expect(html).toContain('Second choice'); expect(html).toContain('aria-label="Correct answer"');
});
it('gives correct, incorrect and unanswered feedback without leaking a point award', () => {
  const q = revealedQuestion();
  const receipt = { questionId:q.id,optionId:'b',receivedAt:Date.now(),responseMs:1250 };
  const correct = renderToStaticMarkup(createElement(AnswerFeedback,{ question:q,submission:receipt }));
  expect(correct).toContain('You got it right!'); expect(correct).toContain('1.25s'); expect(correct).not.toContain('1,000');
  const incorrect = renderToStaticMarkup(createElement(AnswerFeedback,{ question:q,submission:{ ...receipt,optionId:'a' } }));
  expect(incorrect).toContain('Not this time.'); expect(incorrect).toContain('Second choice');
  expect(renderToStaticMarkup(createElement(AnswerFeedback,{ question:q,submission:null }))).toContain('No answer this round.');
});
it('never marks poll choices as correct or opens a correctness popup', () => {
  const q = revealedQuestion(); q.type = 'poll_mcq'; q.reveal!.correctOptionId = null;
  expect(renderToStaticMarkup(createElement(AnswerFeedback,{ question:q,submission:null }))).toBe('');
  expect(renderToStaticMarkup(createElement(AnswerDistribution,{ question:q }))).not.toContain('aria-label="Correct answer"');
});
it('shows only a participant outcome instead of the room chart on reveal', () => {
  const current = session(); current.question = revealedQuestion(); current.state = 'QUESTION_REVEAL';
  const html = renderToStaticMarkup(createElement(ParticipantQuestion,{ session:current,connected:true,submission:{ questionId:'question',optionId:'b',receivedAt:Date.now(),responseMs:1000 },onAccepted:() => {} }));
  expect(html).toContain('Correct answer!');
  expect(html).not.toContain('Revealed answer distribution'); expect(html).not.toContain('5 responses');
});
it('limits the personal standings screen to the player rank and points', () => {
  const html = renderToStaticMarkup(createElement(PersonalStanding,{ participant:{ id:'one',nickname:'Player',avatarIndex:0,score:875,rank:3 },finished:false }));
  expect(html).toContain('#3'); expect(html).toContain('875'); expect(html).toContain('Your own standings');
  expect(html).not.toContain('Top ten'); expect(html).not.toContain('podium');
});
it('places creator attribution on the QR lobby and final results, not live questions or intermediate standings', () => {
  const current=session();
  expect(renderToStaticMarkup(createElement(WelcomeLobby,{ session:current }))).toContain('Made by');
  expect(renderToStaticMarkup(createElement(QuestionView,{ session:current }))).not.toContain('Made by');
  current.state='LEADERBOARD';
  expect(renderToStaticMarkup(createElement(Standings,{ session:current }))).not.toContain('Made by');
  current.state='FINISHED';
  expect(renderToStaticMarkup(createElement(Standings,{ session:current }))).toContain('Made by');
  const participant={ id:'one',nickname:'Player',avatarIndex:0,score:875,rank:3 };
  expect(renderToStaticMarkup(createElement(PersonalStanding,{ participant,finished:true }))).toContain('Made by');
  expect(renderToStaticMarkup(createElement(PersonalStanding,{ participant,finished:false }))).not.toContain('Made by');
});

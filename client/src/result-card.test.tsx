// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { ParticipantLobby } from '@localmenti/shared';
import { PodiumCardButton, podiumCardModel, ResultCardButton, resultCardModel } from './result-card.js';

const lobby = (rank: number | null, joinedCount = 19, eventName = 'Friday Science Night'): ParticipantLobby => ({
  participant: { id:'me', nickname:'Salman', avatarIndex:3, score:1798, rank },
  submission:null,
  history:[{ questionIndex:0,points:900,total:900,responseMs:2100,answered:true },{ questionIndex:1,points:0,total:900,responseMs:null,answered:false },{ questionIndex:2,points:898,total:1798,responseMs:1800,answered:true }],
  session:{ id:'s',pin:'123456',state:'FINISHED',title:'Space basics',eventName,questionCount:3,joinedCount,connectedCount:joinedCount,joinUrl:'/s/123456',lanAddress:'127.0.0.1',revision:9,standingsRevision:3,serverTime:0,question:null,answeredCount:0,players:[],leaderboard:[],podium:[],previewSeconds:3 }
});

it('builds the card from the phone’s own result, with medals only for the top three', () => {
  const second = resultCardModel(lobby(2))!;
  expect(second).toMatchObject({ eventName:'Friday Science Night', quizTitle:'Space basics', nickname:'Salman', rank:2, players:19, points:1798, correct:2, questions:3, tagline:'On the podium' });
  expect(second.medal?.place).toBe('2nd place');
  expect(resultCardModel(lobby(1))!.tagline).toBe('Champion of the room');
  expect(resultCardModel(lobby(4, 100))).toMatchObject({ medal:null, tagline:'Top 10% of the room' });
  expect(resultCardModel(lobby(20, 100))!.tagline).toBe('Top 25% of the room');
  expect(resultCardModel(lobby(60, 100))!.tagline).toBe('Thanks for playing');
  expect(resultCardModel(lobby(null))).toBeNull();
  // Never claims more players than the rank implies.
  expect(resultCardModel(lobby(5, 3))!.players).toBe(5);
});
it('offers the share button only when the player has a rank', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(ResultCardButton, { lobby:lobby(1) })));
  expect(container.querySelector('button.result-card-open')?.textContent).toBe('Share my result');
  await act(async () => root.render(createElement(ResultCardButton, { lobby:lobby(null) })));
  expect(container.querySelector('button.result-card-open')).toBeNull();
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});

const entry = (nickname: string, rank: number, score: number) => ({ id:nickname, nickname, avatarIndex:rank, rank, score, correctAnswers:2, responseMs:1000 });
it('builds the host podium image from the final top three only', () => {
  const session = { eventName:'Friday Science Night', title:'Space basics', joinedCount:19, podium:[entry('Bilal',1,1809), entry('Salman',2,1798), entry('Fahad',3,1764), entry('Extra',4,10)] };
  const model = podiumCardModel(session)!;
  expect(model).toMatchObject({ eventName:'Friday Science Night', quizTitle:'Space basics', players:19 });
  expect(model.winners).toEqual([{ nickname:'Bilal',avatarIndex:1,rank:1,points:1809 },{ nickname:'Salman',avatarIndex:2,rank:2,points:1798 },{ nickname:'Fahad',avatarIndex:3,rank:3,points:1764 }]);
  // Tied ranks are kept as the server ranked them.
  expect(podiumCardModel({ ...session, podium:[entry('A',1,900), entry('B',1,900)] })!.winners.map(winner => winner.rank)).toEqual([1,1]);
  expect(podiumCardModel({ ...session, podium:[] })).toBeNull();
});
it('shows Share top 3 only when there is a podium', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  const session = { eventName:'', title:'Quiz', joinedCount:2, podium:[entry('Bilal',1,1809)] };
  await act(async () => root.render(createElement(PodiumCardButton, { session })));
  expect(container.querySelector('button')?.textContent).toBe('Share top 3');
  await act(async () => root.render(createElement(PodiumCardButton, { session:{ ...session, podium:[] } })));
  expect(container.querySelector('button')).toBeNull();
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});

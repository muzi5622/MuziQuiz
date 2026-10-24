// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QuizFileSchema, type Quiz, type HostLobby } from '@localmenti/shared';
import { HostArea } from './host.js';
import { importExample } from './import-guide.js';
import { PresenterPage } from './lobby.js';
const socketTest = vi.hoisted(() => ({ error:'',options:[] as unknown[],loggedIn:true,reveal:null as (() => void) | null,finish:null as (() => void) | null,arrive:null as (() => void) | null,history:[] as { id:string;title:string;pin:string;endedAt:number }[] }));

vi.mock('socket.io-client',() => ({ io:(_namespace: string,options:unknown) => {
  socketTest.options.push(options);
  const listeners = new Map<string,(data?:unknown) => void>();
  let room: HostLobby = { id:'room-one',pin:'123456',title:'Saved workshop',state:'LOBBY',revision:0,question:null,questionCount:1,previewSeconds:3,eventName:'',standingsRevision:0,joinedCount:0,connectedCount:0,answeredCount:0,removedCount:0,participants:[],players:[],leaderboard:[],podium:[],lanAddress:'192.168.1.5',joinUrl:'http://192.168.1.5:3000/s/123456',serverTime:Date.now() };
  const socket = {
    on(event: string,listener: (data?:unknown) => void) { listeners.set(event,listener); return socket; },
    off(event: string) { listeners.delete(event); return socket; },
    timeout() { return socket; },
    emit(event: string,_payload: unknown,ack: (error:null,result:unknown) => void) { if (event === 'host:end') room = { ...room,state:'FINISHED' }; ack(null,{ ok:true,data:room }); return socket; },
    async emitWithAck(_event: string,command: { action:string }) {
      if (command.action === 'start') {
        const now = Date.now();
        room = { ...room,state:'QUESTION_OPEN',revision:1,question:{ id:'question-one',index:0,text:'Ready for the first question?',type:'quiz_mcq',options:[],phase:'PREVIEW',closed:false,reveal:null,durationSeconds:20,basePoints:1000,previewStartedAt:now,startedAt:now+3000,endsAt:now+23000 } };
      }
      if (command.action === 'between') room = { ...room,state:'LEADERBOARD',revision:room.revision+1,eventName:'',standingsRevision:1,leaderboard:[{ id:'player',nickname:'PlayerOne',avatarIndex:0,score:875,rank:1,correctAnswers:1,responseMs:5000 }] };
      return { ok:true,data:room };
    },
    connect() { if (socketTest.error) listeners.get('connect_error')?.(new Error(socketTest.error)); else { listeners.get('connect')?.(); if (_namespace === '/present') listeners.get('lobby:update')?.(room); } return socket; },
    disconnect() { return socket; },
    get volatile() { return socket; }
  };
  socketTest.reveal = () => { const now = Date.now(); room = { ...room,state:'QUESTION_REVEAL',revision:2,question:{ id:'question-one',index:0,text:'Ready for the first question?',type:'quiz_mcq',options:[{ id:'a',text:'First' },{ id:'b',text:'Second' }],phase:'CLOSED',closed:true,durationSeconds:20,basePoints:1000,previewStartedAt:now-23000,startedAt:now-20000,endsAt:now,reveal:{ correctOptionId:'a',explanation:'',counts:[{ optionId:'a',count:1 },{ optionId:'b',count:0 }],totalAnswers:1 } } }; listeners.get('host:lobby')?.(room); };
  socketTest.finish = () => { room = { ...room,state:'FINISHED' }; listeners.get('host:lobby')?.(room); };
  socketTest.arrive = () => { room = { ...room,connectedCount:1,joinedCount:1,players:[{ id:'new-player',nickname:'NewPlayer',avatarIndex:240,connected:true }] }; listeners.get('host:lobby')?.(room); };
  return socket;
} }));

let container: HTMLDivElement;
let root: Root;
let quizzes: Quiz[];
let writes: { method: string; path: string; body: Record<string,unknown> }[];
beforeEach(() => {
  socketTest.error = ''; socketTest.options = []; socketTest.loggedIn = true; socketTest.finish = null; socketTest.reveal = null; socketTest.arrive = null; socketTest.history = [];
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  window.confirm = vi.fn(() => false);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  quizzes = [{ ...QuizFileSchema.parse(importExample).quiz, id:'quiz-one', createdAt:1,updatedAt:1 }]; writes = [];
  vi.stubGlobal('fetch',vi.fn(async (input,options) => {
    const path = String(input); const method = options?.method ?? 'GET';
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    if (method !== 'GET') writes.push({ method,path,body });
    const response = (value: unknown,status = 200) => new Response(JSON.stringify(value),{ status,headers:{ 'Content-Type':'application/json' } });
    if (path.endsWith('/auth')) return response({ configured:true,authenticated:socketTest.loggedIn });
    if (path.endsWith('/login')) { socketTest.loggedIn = true; return response({ authenticated:true }); }
    if (path.endsWith('/network')) return response({ addresses:[{ address:'192.168.1.5',label:'LAN' }] });
    if (path.endsWith('/sessions/active')) return response(null);
    if (path.endsWith('/sessions/history')) return response(socketTest.history);
    if (path.endsWith('/sessions/room-one/end')) return response({ state:'FINISHED' });
    if (path === '/api/sessions/123456' || path === '/api/host/sessions/room-one') return response({ id:'room-one',pin:'123456',title:'Saved workshop',state:'LOBBY',revision:0,question:null,questionCount:1,previewSeconds:3,eventName:'',standingsRevision:0,joinedCount:0,connectedCount:0,answeredCount:0,removedCount:0,participants:[],players:[],leaderboard:[],podium:[],lanAddress:'192.168.1.5',joinUrl:'http://192.168.1.5:3000/s/123456',serverTime:Date.now() });
    if (path === '/api/host/sessions' && method === 'POST') return response({ id:'room-one',pin:'123456',title:quizzes[0].title,state:'LOBBY',question:null },201);
    if (path.endsWith('/quizzes/import')) {
      const quiz = { ...body.quiz,id:'imported-quiz',createdAt:2,updatedAt:2 } as Quiz; quizzes.push(quiz); return response(quiz,201);
    }
    if (path === '/api/host/quizzes') return response(quizzes.map(quiz => ({ ...quiz,questionCount:quiz.questions.length })));
    const quiz = quizzes.find(quiz => path === `/api/host/quizzes/${quiz.id}`);
    if (quiz && method === 'PUT') { const { expectedUpdatedAt, ...draft } = body; expect(expectedUpdatedAt).toBe(quiz.updatedAt); Object.assign(quiz,draft,{ updatedAt:quiz.updatedAt+1 }); }
    if (quiz) return response(quiz);
    throw new Error(`Unexpected request ${method} ${path}`);
  }));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function LocationProbe() { return createElement('output',{ 'data-route':true },useLocation().pathname); }
async function mount(path = '/host') {
  await act(async () => root.render(createElement(MemoryRouter,{ initialEntries:[path] },createElement(Routes,null,createElement(Route,{ path:'/host/*',element:createElement(HostArea) }),createElement(Route,{ path:'/present/:pin',element:createElement(PresenterPage) })),createElement(LocationProbe))));
}
const route = () => container.querySelector('[data-route]')?.textContent;
function button(text: string) {
  const result = [...container.querySelectorAll('button')].find(button => button.textContent?.includes(text));
  if (!result) throw new Error(`Button missing: ${text}`); return result;
}
async function click(text: string) { await act(async () => button(text).click()); }
async function enter(element: HTMLInputElement | HTMLTextAreaElement,value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(element,value);
    element.dispatchEvent(new Event('input',{ bubbles:true }));
  });
}
it('imports pasted JSON, confirms it is saved, and lets Save return without edits', async () => {
  await mount(); await click('Import JSON'); await click('Paste JSON');
  await enter(container.querySelector<HTMLTextAreaElement>('#pasted-quiz-json')!,JSON.stringify(importExample));
  await click('Import pasted JSON');
  expect(route()).toBe('/host/quizzes/imported-quiz');
  expect(container.textContent).toContain('Import complete. Your quiz and all its questions are saved.');
  expect(button('Save quiz & return').disabled).toBe(false);
  await click('Save quiz & return'); expect(route()).toBe('/host');
  expect(quizzes.find(quiz => quiz.id === 'imported-quiz')?.questions).toEqual(importExample.quiz.questions);
  expect(writes.filter(write => write.path.endsWith('/quizzes/import'))).toHaveLength(1);
  expect(writes.filter(write => write.method === 'PUT')).toHaveLength(1);
});
it('saves changed quiz fields and all questions before returning to the library', async () => {
  await mount('/host/quizzes/quiz-one');
  await enter(container.querySelector<HTMLInputElement>('.quiz-details input')!,'Saved workshop');
  await click('Save quiz & return');
  expect(route()).toBe('/host'); expect(quizzes[0].title).toBe('Saved workshop');
  expect(writes.find(write => write.method === 'PUT')?.body.questions).toEqual(importExample.quiz.questions);
  expect(writes.find(write => write.method === 'PUT')?.body.durationSeconds).toBe(20);
});
it('starts a waiting session without redirecting and provides a separate lobby link', async () => {
  await mount();
  await act(async () => { const select = container.querySelector('.session-launch select') as HTMLSelectElement; select.value = 'quiz-one'; select.dispatchEvent(new Event('change',{ bubbles:true })); });
  await click('Start session');
  expect(route()).toBe('/host'); expect(container.textContent).toContain('PIN 123456');
  const link = [...container.querySelectorAll('a')].find(link => link.textContent?.includes('Open session / Return to lobby'));
  expect(link?.getAttribute('href')).toBe('/present/123456');
  expect(writes.filter(write => write.path === '/api/host/sessions')).toHaveLength(1);
});
it('keeps recent finished sessions collapsed until the host opens the toggle', async () => {
  socketTest.history = [{ id:'finished',title:'Earlier quiz',pin:'123456',endedAt:1 }];
  await mount();
  const details = container.querySelector<HTMLDetailsElement>('.completed-sessions')!;
  expect(details.open).toBe(false);
  await act(async () => details.querySelector('summary')!.click()); expect(details.open).toBe(true);
  await act(async () => details.querySelector('summary')!.click()); expect(details.open).toBe(false);
});
it('updates the waiting lobby avatar and connected counter when a player arrives', async () => {
  await mount('/present/123456');
  expect(container.querySelector('.welcome-counter strong')?.textContent).toBe('0');
  await act(async () => socketTest.arrive?.());
  expect(container.querySelector('.welcome-lobby')?.textContent).toContain('NewPlayer');
  expect(container.querySelector('.welcome-counter strong')?.textContent).toBe('1');
  expect(container.querySelector('.welcome-counter')?.textContent).toContain('connected now');
  expect(container.querySelector('.welcome-address strong')?.textContent).toBe('192.168.1.5:3000');
});
it('uses one presentation canvas and replaces the question with the published leaderboard', async () => {
  await mount('/present/123456');
  expect(container.querySelector('.host-session')).toBeNull();
  await act(async () => socketTest.reveal?.());
  expect(container.querySelector('.presentation-stage')?.getAttribute('data-view')).toBe('question');
  expect(container.querySelector('.presentation-surface .live-question')).not.toBeNull();
  expect(container.querySelector('.host-live-standings')).toBeNull();
  await click('Show leaderboard');
  expect(container.querySelector('.presentation-stage')?.getAttribute('data-view')).toBe('leaderboard');
  expect(container.querySelector('.presentation-surface .live-question')).toBeNull();
  expect(container.querySelector('.presentation-surface .ranking-list')?.textContent).toContain('PlayerOne');
});
it('stops the session from the projector and shows final results', async () => {
  vi.spyOn(window,'confirm').mockReturnValue(true);
  await mount('/present/123456'); await click('Stop session');
  expect(container.querySelector('a[href$="/export"]')).not.toBeNull();
  expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Stop session')).toBe(false);
});
it('can stop the active session from the library without opening the projector', async () => {
  vi.spyOn(window,'confirm').mockReturnValue(true);
  await mount();
  await act(async () => { const select = container.querySelector('.session-launch select') as HTMLSelectElement; select.value = 'quiz-one'; select.dispatchEvent(new Event('change',{ bubbles:true })); });
  await click('Start session'); await click('Stop session');
  expect(route()).toBe('/host'); expect(container.querySelector('.active-lobby')).toBeNull();
  expect(writes.find(write => write.path.endsWith('/room-one/end'))?.body).toEqual({});
});
it('offers projector controls to hosts and one all-player download only after finish', async () => {
  await mount('/present/123456');
  expect(button('Next: first question').disabled).toBe(false);
  expect(container.querySelector('.host-room-details')).toBeNull();
  expect(container.querySelector('a[href$="/export"]')).toBeNull();
  await act(async () => socketTest.finish?.());
  expect(container.querySelector('a[href$="/export"]')?.textContent).toContain('all player ranks and points');
  expect(container.querySelector('a[href$="/export"]')?.getAttribute('href')).toBe('/api/host/sessions/room-one/export');
  expect(container.textContent).not.toContain('Download question statistics');
});
it('keeps the projector read-only for viewers who are not signed-in hosts', async () => {
  socketTest.loggedIn = false;
  await mount('/present/123456');
  expect(route()).toBe('/present/123456');
  expect(container.textContent).toContain('Saved workshop');
  expect(container.querySelector('.host-projection')).toBeNull();
  expect(container.querySelector('a[href="/host/login"]')?.textContent).toBe('Host controls');
  expect([...container.querySelectorAll('button')].some(button => button.textContent?.includes('Next'))).toBe(false);
  expect(container.querySelector('a[href$="/export"]')).toBeNull();
});
it('opens the QR/PIN lobby separately and waits for Next before showing question one', async () => {
  await mount();
  await act(async () => { const select = container.querySelector('.session-launch select') as HTMLSelectElement; select.value = 'quiz-one'; select.dispatchEvent(new Event('change',{ bubbles:true })); });
  await click('Start session');
  const link = container.querySelector<HTMLAnchorElement>('a[href="/present/123456"]')!;
  await act(async () => link.click());
  expect(route()).toBe('/present/123456');
  expect(container.querySelector('img.host-qr')?.getAttribute('src')).toContain('/api/sessions/123456/qr');
  expect(container.querySelector('.host-pin')?.textContent).toBe('123456');
  expect(container.querySelector('.live-question')).toBeNull();
  expect(socketTest.options[0]).toMatchObject({ forceNew:true,transports:['websocket'],withCredentials:true });
  await click('Next: first question');
  expect(container.querySelector('.live-question')?.textContent).toContain('Ready for the first question?');
  expect(container.querySelector('.live-question')?.textContent).toContain('Your answer timer has not started.');
});
it('keeps authenticated host controls visible instead of redirecting on socket rejection', async () => {
  socketTest.error = 'Host sign-in required.';
  await mount('/host/session/room-one');
  expect(route()).toBe('/present/123456');
  expect(container.textContent).toContain('Your host login is active');
  expect(container.querySelector('.host-pin')?.textContent).toBe('123456');
  expect(button('Next: first question').disabled).toBe(true);
});
it('returns to the requested host session after a genuinely expired login is renewed', async () => {
  socketTest.loggedIn = false;
  await mount('/host/session/room-one');
  expect(route()).toBe('/host/login');
  await enter(container.querySelector<HTMLInputElement>('#host-password')!,'local-test-password');
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit',{ bubbles:true,cancelable:true })));
  expect(route()).toBe('/present/123456');
  expect(container.querySelector('.host-pin')?.textContent).toBe('123456');
  expect(button('Next: first question').disabled).toBe(false);
});
it('imports an uploaded JSON file and keeps the already-saved Save action usable', async () => {
  await mount(); await click('Import JSON');
  const file = new File([JSON.stringify(importExample)],'quiz.json',{ type:'application/json' });
  const transfer = new DataTransfer(); transfer.items.add(file);
  const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
  await act(async () => { input.files = transfer.files; input.dispatchEvent(new Event('change',{ bubbles:true })); });
  expect(route()).toBe('/host/quizzes/imported-quiz');
  expect(button('Save quiz & return').disabled).toBe(false);
  await click('Save quiz & return'); expect(route()).toBe('/host');
});
it('keeps invalid pasted JSON in the import window without creating a quiz', async () => {
  await mount(); await click('Import JSON'); await click('Paste JSON');
  await enter(container.querySelector<HTMLTextAreaElement>('#pasted-quiz-json')!,'{invalid');
  await click('Import pasted JSON');
  expect(route()).toBe('/host'); expect(container.querySelector('dialog')?.textContent).toContain('Invalid JSON');
  expect(writes).toHaveLength(0); expect(quizzes).toHaveLength(1);
});
it('does not leave the editor or claim success when saving fails', async () => {
  const originalFetch = fetch;
  vi.stubGlobal('fetch',vi.fn((input,options) => options?.method === 'PUT' ? Promise.resolve(new Response(JSON.stringify({ error:'This quiz changed in another tab.' }),{ status:409 })) : originalFetch(input,options)));
  await mount('/host/quizzes/quiz-one');
  await enter(container.querySelector<HTMLInputElement>('.quiz-details input')!,'Unsaved workshop');
  await click('Save quiz & return');
  expect(route()).toBe('/host/quizzes/quiz-one'); expect(container.textContent).toContain('This quiz changed in another tab.');
  expect(quizzes[0].title).not.toBe('Unsaved workshop');
});

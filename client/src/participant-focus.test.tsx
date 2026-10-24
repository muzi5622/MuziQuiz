// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ParticipantLobby } from '@localmenti/shared';
import { JoinPage, ParticipantPage } from './lobby.js';

const channel = vi.hoisted(() => ({ payload:null as ParticipantLobby | null,update:null as ((data:ParticipantLobby) => void) | null,answer:null as unknown }));
vi.mock('socket.io-client',() => ({ io:() => {
  let ready:((data:ParticipantLobby) => void) | null = null;
  const socket = {
    on(event:string,listener:(data:ParticipantLobby) => void) { if (event === 'participant:state') channel.update = listener; if (event === 'participant:ready') ready = listener; return socket; },
    off() { return socket; }, timeout() { return socket; },
    connect() { ready?.(channel.payload!); return socket; }, disconnect() { return socket; },
    emit(_event:string,payload:{ questionId:string;optionId:string },ack:(error:null,value:unknown) => void) { channel.answer = payload; ack(null,{ ok:true,data:{ ...payload,responseMs:1250,receivedAt:Date.now() } }); return socket; },
    get volatile() { return socket; }
  }; return socket;
} }));
let container:HTMLDivElement; let root:Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true); localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('localmenti:participant:123456','a'.repeat(64));
  const now = Date.now(); channel.answer = null;
  channel.payload = { participant:{ id:'me',nickname:'MyName',avatarIndex:0,rank:null,score:0 },submission:null,history:[],session:{ id:'session',pin:'123456',state:'QUESTION_OPEN',title:'Quiz',questionCount:1,joinedCount:20,connectedCount:20,answeredCount:5,revision:1,eventName:'',standingsRevision:0,serverTime:now,lanAddress:'127.0.0.1',joinUrl:'/s/123456',previewSeconds:3,players:[],leaderboard:[],podium:[],question:{ id:'question',index:0,type:'quiz_mcq',text:'Pick the correct choice.',options:Array.from({ length:6 },(_,index) => ({ id:String.fromCharCode(97+index),text:`Choice ${index+1}` })),durationSeconds:20,basePoints:1000,previewStartedAt:now-4000,startedAt:now-1000,endsAt:now+19000,phase:'ANSWERING',closed:false,reveal:null } } };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => root.render(createElement(MemoryRouter,{ initialEntries:['/s/123456'] },createElement(Routes,null,createElement(Route,{ path:'/s/:pin',element:createElement(ParticipantPage) }))))); }
it('presents all six choices without room charts, long help sections or extra navigation', async () => {
  await mount(); expect(container.querySelectorAll('input[type=radio]')).toHaveLength(6);
  expect(container.textContent).not.toContain('Correctness + speed. Every time.');
  expect(container.textContent).not.toContain('Back to join page'); expect(container.querySelector('.answer-distribution')).toBeNull();
});
it('resumes a saved identity from the join page without requiring another nickname', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch',fetch);
  await act(async () => root.render(createElement(MemoryRouter,{ initialEntries:['/join'] },createElement(Routes,null,createElement(Route,{ path:'/join',element:createElement(JoinPage) }),createElement(Route,{ path:'/s/:pin',element:createElement(ParticipantPage) })))));
  const input = container.querySelector<HTMLInputElement>('#join-pin')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'123456'); input.dispatchEvent(new Event('input',{ bubbles:true })); });
  expect(container.querySelector('#join-nickname')).toBeNull(); expect(container.textContent).toContain('Resume current question');
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit',{ bubbles:true,cancelable:true })));
  expect(container.textContent).toContain('Pick the correct choice.'); expect(fetch).not.toHaveBeenCalled();
});
it('accepts a single choice click and replaces choices with the personal receipt', async () => {
  await mount(); await act(async () => (container.querySelector('input[type=radio]') as HTMLInputElement).click());
  expect(channel.answer).toEqual({ questionId:'question',optionId:'a' });
  expect(container.textContent).toContain('1.25s'); expect(container.textContent).toContain('Answer locked');
  expect(container.querySelector('fieldset')).toBeNull();
});
it('shows only personal rank and points when the host publishes standings', async () => {
  await mount(); const next = structuredClone(channel.payload!);
  next.session.state = 'LEADERBOARD'; next.participant.score = 875; next.participant.rank = 2;
  next.session.leaderboard = [{ id:'other',nickname:'AnotherPlayer',rank:1,score:1000,avatarIndex:1,correctAnswers:1,responseMs:0 }];
  await act(async () => channel.update?.(next));
  expect(container.textContent).toContain('#2'); expect(container.textContent).toContain('875');
  expect(container.textContent).not.toContain('AnotherPlayer'); expect(container.querySelector('.ranking-list')).toBeNull();
});
it('lets a QR-link visitor change the pre-filled PIN and joins that room instead', async () => {
  localStorage.clear();
  const requests: { pin:string;nickname:string }[] = [];
  vi.stubGlobal('fetch',vi.fn(async (_url:string,init:{ body:string }) => { requests.push(JSON.parse(init.body)); return { ok:true,json:async () => ({ token:'b'.repeat(64),pin:'654321',participant:{ id:'me',nickname:'Sam',avatarIndex:0 } }) }; }));
  await mount();
  const pinField = container.querySelector<HTMLInputElement>('#join-pin')!;
  expect(pinField.value).toBe('123456'); expect(pinField.readOnly).toBe(false);
  const type = async (field:HTMLInputElement,value:string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,value); field.dispatchEvent(new Event('input',{ bubbles:true })); });
  await type(pinField,'654321'); await type(container.querySelector<HTMLInputElement>('#join-nickname')!,'Sam');
  // happy-dom cannot evaluate the nickname's Unicode pattern, so submit directly.
  await act(async () => { container.querySelector<HTMLFormElement>('form.join-card')!.dispatchEvent(new Event('submit',{ bubbles:true,cancelable:true })); });
  expect(requests).toEqual([{ pin:'654321',nickname:'Sam' }]);
  expect(localStorage.getItem('localmenti:participant:654321')).toBe('b'.repeat(64));
  expect(localStorage.getItem('localmenti:participant:123456')).toBeNull();
});

// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RESERVED_AVATAR_INDEX, type PublicLobby } from '@localmenti/shared';
import { Standings } from './players.js';

let root:Root; let container:HTMLDivElement; let tick:FrameRequestCallback; let begin:number;
let session:PublicLobby;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.spyOn(performance,'now').mockReturnValue(0);
  vi.stubGlobal('requestAnimationFrame',vi.fn((callback:FrameRequestCallback) => { tick=callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame',vi.fn());
  vi.spyOn(window,'matchMedia').mockReturnValue({ matches:false } as MediaQueryList);
  sessionStorage.clear();
  session = { id:'motion',pin:'123456',state:'LEADERBOARD',title:'Quiz',questionCount:2,joinedCount:2,connectedCount:2,joinUrl:'/join',lanAddress:'127.0.0.1',revision:2,eventName:'',standingsRevision:2,serverTime:0,answeredCount:2,players:[],podium:[],question:null,previewSeconds:3,
    leaderboard:[{ id:'creator',nickname:'MUZI',avatarIndex:RESERVED_AVATAR_INDEX,rank:1,score:1800,correctAnswers:2,responseMs:1000,previousScore:800,previousRank:2,previousPosition:1,fastestResponseMs:250 },{ id:'other',nickname:'Alex',avatarIndex:1,rank:2,score:1500,correctAnswers:2,responseMs:2000,previousScore:1000,previousRank:1,previousPosition:0 }] };
  container=document.createElement('div'); document.body.append(container); root=createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });
async function mount() { begin=performance.now(); await act(async () => root.render(createElement(Standings,{ session }))); }
async function advance(ms:number) { await act(async () => tick(begin+ms)); }
it('grows points and graph before moving players, then avoids replay on refresh',async () => {
  await mount();
  const row=container.querySelector<HTMLElement>('.ranking-reserved')!;
  const bar=row.querySelector<HTMLElement>('.rank-score-fill')!;
  const oldPosition=row.style.transform; const oldWidth=parseFloat(bar.style.width);
  expect(row.textContent).toContain('800'); expect(row.textContent).toContain('Creator'); expect(row.textContent).toContain('Fastest · 0.25s');
  await advance(1500);
  expect(parseFloat(bar.style.width)).toBeGreaterThan(oldWidth); expect(row.style.transform).toBe(oldPosition);
  await advance(3300);
  expect(row.textContent).toContain('1,800'); expect(row.textContent).toContain('+1,000'); expect(row.style.transform).toBe(oldPosition);
  await advance(3700);
  expect(row.style.transform).not.toBe(oldPosition); expect(row.textContent).toContain('Up 1');
  await act(async () => root.render(null)); await mount();
  expect(container.querySelector('.standings-settled')).not.toBeNull(); expect(container.textContent).toContain('1,800');
});
it('restarts an interrupted reveal and supports replay after completion',async () => {
  await mount(); await advance(1400);
  expect(sessionStorage.getItem('localmenti:standings:motion')).toBeNull();
  await act(async () => root.render(null)); await mount();
  expect(container.querySelector('.standings-counting')).not.toBeNull();
  await advance(3700);
  expect(container.querySelector('.standings-settled')).not.toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>('.replay-standings')!.click());
  expect(container.querySelector('.standings-counting')).not.toBeNull();
  expect(container.querySelector('.rank-points')!.textContent).toContain('800');
});
it('still animates when the OS reports reduced motion and hides all standings before publication',async () => {
  vi.mocked(window.matchMedia).mockReturnValue({ matches:true } as MediaQueryList);
  await mount(); expect(container.querySelector('.standings-counting')).not.toBeNull(); expect(container.querySelector('.rank-points')!.textContent).toContain('800');
  session={ ...session,state:'QUESTION_REVEAL' };
  await act(async () => root.render(createElement(Standings,{ session })));
  expect(container.textContent).toBe('');
});
it('shows ten places per page and pages through the rest of the ranking',async () => {
  session={ ...session,leaderboard:Array.from({ length:25 },(_,index) => ({ id:`p${index}`,nickname:`Player${index}`,avatarIndex:index,rank:index+1,score:2500-index*10,correctAnswers:1,responseMs:1000,previousScore:2500-index*10,previousRank:index+1,previousPosition:index })) };
  sessionStorage.setItem('localmenti:standings:motion','2'); await mount();
  const ranks = () => [...container.querySelectorAll('.visible-rank')].map(rank => rank.textContent);
  expect(ranks()).toHaveLength(10); expect(ranks()[0]).toBe('1');
  expect(container.querySelector('.rank-pager')!.textContent).toContain('Places 1–10 of 25');
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.rank-pager-page')].find(button => button.textContent === '2')!.click());
  expect(ranks()).toEqual(['11','12','13','14','15','16','17','18','19','20']);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown',{ key:'ArrowRight' })));
  expect(ranks()).toEqual(['21','22','23','24','25']);
  expect(container.querySelector<HTMLButtonElement>('.rank-pager-step[aria-label="Next ten places"]')!.disabled).toBe(true);
});
it('reveals third, second, then the winner when the quiz finishes, once per session',async () => {
  vi.useFakeTimers();
  try {
    sessionStorage.setItem('localmenti:standings:motion','2');
    session={ ...session,state:'FINISHED',podium:session.leaderboard };
    await mount();
    const stage = () => container.querySelector('.winners-stage');
    const shown = () => [...container.querySelectorAll('.winners-shown .winners-name')].map(name => name.textContent);
    expect(stage()).not.toBeNull(); expect(shown()).toEqual([]);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(shown()).toEqual([]); // no third place with two players
    await act(async () => { vi.advanceTimersByTime(1700); });
    expect(shown()).toEqual(['Alex']); expect(stage()!.textContent).not.toContain('MUZI wins!');
    await act(async () => { vi.advanceTimersByTime(2300); });
    expect(shown()).toEqual(['Alex','MUZI']); expect(stage()!.textContent).toContain('MUZI wins!');
    await act(async () => { vi.advanceTimersByTime(1400); });
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'See full leaderboard')!.click());
    expect(stage()).toBeNull();
    await act(async () => root.render(null)); await mount();
    expect(stage()).toBeNull();
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Replay winners')!.click());
    expect(stage()).not.toBeNull();
  } finally { vi.useRealTimers(); }
});
it('links the creator credit to LinkedIn in a new tab',async () => {
  const { MadeBy } = await import('./players.js');
  await act(async () => root.render(createElement(MadeBy)));
  const link = container.querySelector<HTMLAnchorElement>('.made-by a')!;
  expect(link.href).toBe('https://www.linkedin.com/in/m-muzammal-muzi5622/');
  expect(link.target).toBe('_blank'); expect(link.rel).toBe('noopener noreferrer');
  expect(container.textContent).toBe('Made by MUZI');
});

import { expect, it, vi } from 'vitest';
import type { HostLobby } from '@localmenti/shared';
import { advanceHost } from './host-transition.js';

const answering = { id:'session',revision:4,state:'QUESTION_OPEN',question:{ phase:'ANSWERING',closed:false } } as HostLobby;
it('Next closes answering before revealing with the server-acknowledged revision', async () => {
  const closed = { ...answering,revision:5,question:{ ...answering.question!,phase:'CLOSED',closed:true } } as HostLobby;
  const send = vi.fn().mockResolvedValueOnce({ ok:true,data:closed }).mockResolvedValueOnce({ ok:true,data:{ ...closed,revision:6,state:'QUESTION_REVEAL' } });
  await advanceHost(answering,'reveal',send);
  expect(send.mock.calls.map(([packet]) => packet)).toEqual([{ sessionId:'session',expectedRevision:4,action:'close' },{ sessionId:'session',expectedRevision:5,action:'reveal' }]);
});
it('stops after an unsuccessful close instead of sending a reveal', async () => {
  const rejected = { ok:false,error:'Session changed.',code:'STALE_STATE' };
  const send = vi.fn().mockResolvedValue(rejected);
  expect(await advanceHost(answering,'reveal',send)).toEqual(rejected);
  expect(send).toHaveBeenCalledTimes(1);
});
it('does not automatically close again after timeout or publish standings on Next question', async () => {
  const current = { ...answering,state:'QUESTION_REVEAL' } as HostLobby;
  const send = vi.fn().mockResolvedValue({ ok:true,data:current });
  await advanceHost(current,'next',send);
  expect(send).toHaveBeenCalledExactlyOnceWith({ sessionId:'session',expectedRevision:4,action:'next' });
});

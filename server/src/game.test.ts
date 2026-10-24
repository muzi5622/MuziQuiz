import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, HostLobby, ParticipantLobby, PublicLobby, ServerToClientEvents, TransitionSchema } from '@localmenti/shared';
import { MAX_PARTICIPANTS, RESERVED_AVATAR_INDEX } from '@localmenti/shared';
import type { z } from 'zod';
import { createApp } from './app.js';
import { openDatabase } from './database.js';
import { setHostPassword } from './auth.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const question = { type: 'quiz_mcq', text: 'First question?', options: [{ id: 'a', text: 'First choice' }, { id: 'b', text: 'Second choice' }], correctOptionId: 'a', basePoints: 1000, explanation: 'Do not send this before reveal.' };
async function fixture(questions: unknown[] = [question, { ...question, text: 'Second question?', correctOptionId: 'b' }], durationSeconds = 20) {
  let now = 1_700_000_000_000;
  const directory = mkdtempSync(resolve(tmpdir(), 'localmenti-game-')); const databasePath = resolve(directory, 'game.sqlite');
  const db = openDatabase(databasePath); await setHostPassword(db, 'test-game-password'); db.close();
  const make = () => createApp({ databasePath, clientPath: resolve('client/dist'), lanAddresses: () => [{ address: '127.0.0.1', label: 'Test' }], clock: () => now });
  let app = (await make()).app; let origin = '';
  async function listen() { await app.listen({ host: '127.0.0.1', port: 0 }); const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('No listener'); origin = `http://127.0.0.1:${address.port}`; }
  await listen(); const sockets: Client[] = [];
  cleanups.push(async () => { for (const socket of sockets) socket.disconnect(); await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const headers = () => ({ host: new URL(origin).host, origin });
  const login = await app.inject({ method: 'POST', url: '/api/host/login', headers: headers(), payload: { password: 'test-game-password' } });
  const cookie = (login.headers['set-cookie'] as string[])[0].split(';')[0];
  const quiz = (await app.inject({ method: 'POST', url: '/api/host/quizzes', headers: { ...headers(), cookie }, payload: { title: 'Game test', description: '', durationSeconds, questions } })).json();
  const lobby = (await app.inject({ method: 'POST', url: '/api/host/sessions', headers: { ...headers(), cookie }, payload: { quizId: quiz.id, lanAddress: '127.0.0.1' } })).json<HostLobby>();
  function client(namespace: string, auth = {}, isHost = false): Client {
    const socket: Client = io(`${origin}${namespace}`, { autoConnect: false, forceNew: true, reconnection: false, transports: ['websocket'], auth, extraHeaders: { Origin: origin, ...(isHost ? { Cookie: cookie } : {}) } }); sockets.push(socket); return socket;
  }
  async function host() { const socket = client('/host', {}, true); await connect(socket); const result = await socket.timeout(3000).emitWithAck('host:watch', { sessionId: lobby.id }); expect(result.ok).toBe(true); return socket; }
  async function join(name = 'Player') { const response = await app.inject({ method: 'POST', url: '/api/join', headers: headers(), payload: { pin: lobby.pin, nickname: name } }); expect(response.statusCode).toBe(201); return response.json() as { token: string; participant: { id: string; nickname: string } }; }
  async function state() { return (await app.inject(`/api/sessions/${lobby.pin}`)).json<PublicLobby>(); }
  async function transition(socket: Client, action: z.infer<typeof TransitionSchema>['action']) {
    const current = await state();
    const result = await socket.timeout(3000).emitWithAck('host:transition', { sessionId: lobby.id, expectedRevision: current.revision, action });
    if (!result.ok) throw new Error(result.error);
    // Existing gameplay tests explicitly move the test clock through the preview.
    if (action === 'start' || action === 'next') { now = result.data.question!.startedAt; return (await app.inject({ url: `/api/host/sessions/${lobby.id}`, headers: { ...headers(), cookie } })).json<HostLobby>(); }
    return result.data;
  }
  function rows() { const db = openDatabase(databasePath); try { return db.prepare('SELECT * FROM submissions ORDER BY received_at, id').all() as { participant_id: string; awarded_points: number; response_ms: number; option_id: string; received_at: number; question_id: string }[]; } finally { db.close(); } }
  return { get app() { return app; }, lobby, quiz, cookie, headers, databasePath, client, host, join, state, transition, rows, time(value: number) { now = value; }, advance(ms: number) { now += ms; },
    async restart() { await app.close(); app = (await make()).app; await listen(); },
    participant(token: string) { return client('/participant', { pin: lobby.pin, token }); }
  };
}
function connect(socket: Client) {
  return new Promise<void>((resolveReady, reject) => { const timer = setTimeout(() => reject(new Error('Connect timeout')), 3000); socket.once('connect', () => { clearTimeout(timer); resolveReady(); }); socket.once('connect_error', error => { clearTimeout(timer); reject(error); }); socket.connect(); });
}
function ready(socket: Client) {
  return new Promise<ParticipantLobby>((resolveReady, reject) => { const timer = setTimeout(() => reject(new Error('Ready timeout')), 3000); socket.once('participant:ready', data => { clearTimeout(timer); resolveReady(data); }); socket.once('connect_error', error => { clearTimeout(timer); reject(error); }); socket.connect(); });
}
async function answer(socket: Client, questionId: string, optionId = 'a') { return socket.timeout(3000).emitWithAck('answer:submit', { questionId, optionId }); }

describe('authoritative quiz engine', () => {
  it('renames an unverified legacy MUZI while preserving its token and score on migration', async () => {
    const f = await fixture([question]); const host = await f.host(); const player = await f.join('Legacy'); const socket = f.participant(player.token); const original = await ready(socket);
    const q = (await f.transition(host,'start')).question!; await answer(socket,q.id);
    await f.transition(host,'close'); await f.transition(host,'reveal'); await f.transition(host,'between');
    const db = openDatabase(f.databasePath);
    db.exec('DROP TRIGGER participants_reserved_insert; DROP TRIGGER participants_reserved_update; DELETE FROM schema_migrations WHERE version = 9;');
    db.prepare("UPDATE participants SET nickname = 'MuZi',nickname_key = 'muzi' WHERE id = ?").run(player.participant.id); db.close();
    await f.restart(); const restored = await ready(f.participant(player.token));
    expect(restored.participant.id).toBe(player.participant.id); expect(restored.participant.nickname).toMatch(/^Player\d+$/);
    expect(restored.participant.score).toBe(1000); expect(restored.participant.avatarIndex).toBe(original.participant.avatarIndex); expect(f.rows()).toHaveLength(1);
  });
  it.each([false,true])('restores the current fourth question after disconnect, preserving old points and zero missed rounds (answered first: %s)', async answeredFirst => {
    const f = await fixture(Array.from({ length:4 },(_,index) => ({ ...question,text:`Round ${index+1}` })));
    const host = await f.host(); const player = await f.join(); const original = f.participant(player.token); await ready(original);
    if (!answeredFirst) original.disconnect();
    for (let index = 0; index < 3; index++) {
      const q = (await f.transition(host,index === 0 ? 'start' : 'next')).question!;
      if (index === 0 && answeredFirst) { await answer(original,q.id); original.disconnect(); }
      await f.transition(host,'close'); await f.transition(host,'reveal'); await f.transition(host,'between');
    }
    const current = (await f.transition(host,'next')).question!; f.advance(5000);
    const resumed = f.participant(player.token); const restored = await ready(resumed);
    expect(restored.participant.id).toBe(player.participant.id); expect(restored.session.question?.index).toBe(3);
    expect(restored.session.question?.endsAt).toBe(current.endsAt); expect(restored.participant.score).toBe(answeredFirst ? 1000 : 0);
    expect(restored.history.map(round => round.points)).toEqual([answeredFirst ? 1000 : 0,0,0]);
    expect(restored.history.slice(1).every(round => !round.answered)).toBe(true);
    expect((await answer(resumed,current.id)).ok).toBe(true);
    await f.transition(host,'close'); await f.transition(host,'reveal'); await f.transition(host,'between');
    const result = await ready(f.participant(player.token));
    expect(result.participant.score).toBe((answeredFirst ? 1000 : 0)+875);
    expect(f.rows()).toHaveLength(answeredFirst ? 2 : 1); expect(result.submission?.responseMs).toBe(5000);
  });
  it('exports every final player rank and score rather than just the top ten', async () => {
    const f = await fixture([question]); const host = await f.host(); const players = [];
    for (let index = 0; index < 12; index++) players.push(await f.join(`Player${index}`));
    const socket = f.participant(players[0].token); await ready(socket);
    const q = (await f.transition(host,'start')).question!; await answer(socket,q.id);
    await host.timeout(3000).emitWithAck('host:end',{ sessionId:f.lobby.id });
    const response = await f.app.inject({ url:`/api/host/sessions/${f.lobby.id}/export`,headers:{ ...f.headers(),cookie:f.cookie } });
    expect(response.statusCode).toBe(200); expect(response.body).toContain('"rank","total_points"');
    expect(response.body.split('\r\n').filter(Boolean)).toHaveLength(13);
    for (let index = 0; index < 12; index++) expect(response.body).toContain(`"Player${index}"`);
    expect((await f.state()).leaderboard).toHaveLength(12);
  });
  it('keeps room counts and standings on host payloads while participants get only their own result', async () => {
    const f = await fixture([question]); const host = await f.host(); const a = await f.join('Alpha'); const b = await f.join('Bravo');
    const socket = f.participant(a.token); await ready(socket);
    const q = (await f.transition(host,'start')).question!; await answer(socket,q.id);
    await f.transition(host,'close'); const revealed = await f.transition(host,'reveal');
    expect(revealed.question?.reveal?.counts.find(option => option.optionId === 'a')?.count).toBe(1);
    let own = await ready(f.participant(a.token));
    expect(own.session.question?.reveal?.counts).toEqual([]); expect(own.session.question?.reveal?.totalAnswers).toBe(0);
    expect(own.session.players).toEqual([]);
    const published = await f.transition(host,'between'); expect(published.leaderboard).toHaveLength(2);
    own = await ready(f.participant(a.token));
    expect(own.participant.score).toBe(1000); expect(own.participant.rank).toBe(1);
    expect(own.session.leaderboard).toEqual([]); expect(own.session.podium).toEqual([]);
    expect(JSON.stringify(own)).not.toContain(b.participant.id); expect(JSON.stringify(own)).not.toContain('Bravo');
  });
  it('uses the quiz-wide time on every MCQ and poll after the reading period', async () => {
    const f = await fixture([question,{ ...question,type:'poll_mcq',correctOptionId:null,basePoints:0 }],15);
    const host = await f.host(); const player = await f.join(); const socket = f.participant(player.token); await ready(socket);
    const first = (await f.transition(host,'start')).question!;
    expect(first.durationSeconds).toBe(15); expect(first.endsAt-first.startedAt).toBe(15000);
    expect(first.startedAt-first.previewStartedAt).toBe(3000);
    f.advance(7500); await answer(socket,first.id); expect(f.rows()[0].awarded_points).toBe(750);
    await f.transition(host,'close'); await f.transition(host,'reveal');
    const second = (await f.transition(host,'next')).question!;
    expect(second.durationSeconds).toBe(15); expect(second.endsAt-second.startedAt).toBe(15000);
  });
  it('keeps the final leaderboard in recent finished sessions after quiz deletion and restart', async () => {
    const f = await fixture([question]); const host = await f.host(); const player = await f.join('Winner'); const socket = f.participant(player.token); await ready(socket);
    const q = (await f.transition(host,'start')).question!; f.advance(5000); await answer(socket,q.id);
    await f.transition(host,'close'); await f.transition(host,'reveal');
    const ended = await host.timeout(3000).emitWithAck('host:end',{ sessionId: f.lobby.id });
    if (!ended.ok) throw new Error(ended.error);
    const final = ended.data.leaderboard; expect(final[0]).toMatchObject({ nickname: 'Winner', score: 875, rank: 1 });
    const headers = { ...f.headers(),cookie:f.cookie };
    await f.app.inject({ method:'DELETE',url:`/api/host/quizzes/${f.quiz.id}`,headers });
    await f.restart();
    const restoredHeaders = { ...f.headers(),cookie:f.cookie };
    const recent = (await f.app.inject({ url:'/api/host/sessions/history',headers:restoredHeaders })).json();
    expect(recent[0].id).toBe(f.lobby.id);
    const saved = (await f.app.inject({ url:`/api/host/sessions/${recent[0].id}`,headers:restoredHeaders })).json<HostLobby>();
    expect(saved.state).toBe('FINISHED'); expect(saved.leaderboard).toEqual(final);
    expect((await f.app.inject(`/api/host/sessions/${recent[0].id}`)).statusCode).toBe(401);
  });
  it('recovers an orphan room left by an older quiz deletion', async () => {
    const f = await fixture(); const host = await f.host(); const player = await f.join(); const socket = f.participant(player.token); await ready(socket);
    const q = (await f.transition(host,'start')).question!; await answer(socket,q.id);
    const db = openDatabase(f.databasePath); db.prepare('DELETE FROM quizzes WHERE id = ?').run(f.quiz.id); db.close();
    const headers = { ...f.headers(), cookie: f.cookie };
    expect((await f.app.inject({ url: '/api/host/sessions/active', headers })).json()).toBeNull();
    expect((await f.state()).state).toBe('FINISHED'); expect(f.rows()).toHaveLength(1);
    const restored = await ready(f.participant(player.token)); expect(restored.participant.score).toBe(1000);
  });
  it('ends a deleted quiz room, preserves its results and allows the next room to open', async () => {
    const f = await fixture(); const host = await f.host(); const player = await f.join(); const socket = f.participant(player.token); await ready(socket);
    const q = (await f.transition(host,'start')).question!; await answer(socket,q.id);
    const headers = { ...f.headers(), cookie: f.cookie };
    const other = (await f.app.inject({ method: 'POST', url: '/api/host/quizzes', headers, payload: { title: 'Other quiz', description: '', questions: [question] } })).json();
    expect((await f.app.inject({ method: 'DELETE', url: `/api/host/quizzes/${other.id}`, headers })).statusCode).toBe(204);
    expect((await f.state()).state).toBe('QUESTION_OPEN');
    expect((await f.app.inject({ method: 'DELETE', url: `/api/host/quizzes/${f.quiz.id}`, headers: f.headers() })).statusCode).toBe(401);
    expect((await f.app.inject({ method: 'DELETE', url: `/api/host/quizzes/${f.quiz.id}`, headers, payload: { sessionId: 'forged' } })).statusCode).toBe(400);
    expect((await f.state()).state).toBe('QUESTION_OPEN');
    expect((await f.app.inject({ method: 'DELETE', url: `/api/host/quizzes/${f.quiz.id}`, headers })).statusCode).toBe(204);
    expect((await f.app.inject({ url: '/api/host/sessions/active', headers })).json()).toBeNull();
    expect((await f.state()).state).toBe('FINISHED'); expect(f.rows()).toHaveLength(1);
    const restored = await ready(f.participant(player.token)); expect(restored.participant.score).toBe(1000);
    const finished = await host.timeout(3000).emitWithAck('host:watch',{ sessionId: f.lobby.id }); expect(finished.ok).toBe(true);
    const next = (await f.app.inject({ method: 'POST', url: '/api/host/quizzes', headers, payload: { title: 'Next quiz', description: '', questions: [question] } })).json();
    expect((await f.app.inject({ method: 'POST', url: '/api/host/sessions', headers, payload: { quizId: next.id, lanAddress: '127.0.0.1' } })).statusCode).toBe(201);
    await f.restart(); expect((await f.state()).state).toBe('FINISHED'); expect(f.rows()).toHaveLength(1);
  });
  it('holds skipped-round scores until the host publishes them or finishes', async () => {
    const f = await fixture(); const host = await f.host(); const player = await f.join(); const socket = f.participant(player.token); await ready(socket);
    const first = (await f.transition(host,'start')).question!; await answer(socket,first.id);
    await f.transition(host,'close'); await f.transition(host,'reveal');
    await f.transition(host,'next');
    let restored = await ready(f.participant(player.token));
    expect(restored.participant.score).toBe(0); expect(restored.participant.rank).toBeNull(); expect(restored.history).toEqual([]);
    expect(restored.session.leaderboard).toEqual([]);
    expect((await answer(socket,first.id)).ok).toBe(true);
    const sealed = await answer(socket,first.id); if (sealed.ok) expect(sealed.data).not.toHaveProperty('awardedPoints');
    await answer(socket,restored.session.question!.id,'b');
    await host.timeout(3000).emitWithAck('host:end',{ sessionId: f.lobby.id });
    restored = await ready(f.participant(player.token));
    expect(restored.participant.score).toBe(2000); expect(restored.history).toHaveLength(2); expect(restored.session.standingsRevision).toBe(1);
    expect(restored.participant.previousScore).toBe(0); expect(restored.session.leaderboard).toEqual([]);
  });
  it('persists the previous published totals and positions for a genuine leaderboard reversal', async () => {
    const f = await fixture(); const host = await f.host(); const a = await f.join('Alpha'); const b = await f.join('Bravo');
    const sa = f.participant(a.token); const sb = f.participant(b.token); await Promise.all([ready(sa),ready(sb)]);
    let q = (await f.transition(host,'start')).question!; await answer(sa,q.id); f.advance(5000); await answer(sb,q.id);
    await f.transition(host,'close'); await f.transition(host,'reveal'); await f.transition(host,'between');
    q = (await f.transition(host,'next')).question!; await answer(sa,q.id,'a'); await answer(sb,q.id,'b');
    await f.transition(host,'close'); await f.transition(host,'reveal');
    const sealed = await ready(f.participant(b.token)); expect(sealed.participant.score).toBe(875); expect(sealed.history).toHaveLength(1); expect(sealed.submission).not.toHaveProperty('awardedPoints');
    const published = await f.transition(host,'between');
    expect(published.leaderboard.map(entry => [entry.nickname,entry.score,entry.rank,entry.previousScore,entry.previousRank])).toEqual([['Bravo',1875,1,875,2],['Alpha',1000,2,1000,1]]);
    await f.restart(); const restored = await ready(f.participant(b.token));
    expect((await f.state()).leaderboard).toEqual(published.leaderboard); expect(restored.session.leaderboard).toEqual([]); expect(restored.session.standingsRevision).toBe(2);
  });
  it('withholds options for the configured preview and starts response timing only on release', async () => {
    const f = await fixture(); const host = await f.host(); const player = await f.join();
    const socket = f.participant(player.token); await ready(socket);
    expect((await host.timeout(3000).emitWithAck('host:preview', { sessionId: f.lobby.id, previewSeconds: 2 })).ok).toBe(false);
    expect((await host.timeout(3000).emitWithAck('host:preview', { sessionId: f.lobby.id, previewSeconds: 5, score: 1000 })).ok).toBe(false);
    expect((await host.timeout(3000).emitWithAck('host:preview', { sessionId: f.lobby.id, previewSeconds: 5 })).ok).toBe(true);
    const start = await host.timeout(3000).emitWithAck('host:transition', { sessionId: f.lobby.id, expectedRevision: 0, action: 'start' });
    expect(start.ok).toBe(true); if (!start.ok) throw new Error(start.error);
    const q = start.data.question!;
    expect(q.phase).toBe('PREVIEW'); expect(q.options).toEqual([]);
    expect(q.startedAt - q.previewStartedAt).toBe(5000); expect(q.endsAt - q.startedAt).toBe(20000);
    f.time(q.startedAt - 1); expect((await answer(socket,q.id)).ok).toBe(false); expect(f.rows()).toHaveLength(0);
    expect((await host.timeout(3000).emitWithAck('host:preview', { sessionId: f.lobby.id, previewSeconds: 3 })).ok).toBe(false);
    f.time(q.startedAt); expect((await f.state()).question?.options).toHaveLength(2);
    expect((await answer(socket,q.id)).ok).toBe(true); expect(f.rows()[0].response_ms).toBe(0);
    const pending = await ready(f.participant(player.token)); expect(pending.history).toEqual([]);
    expect(pending.submission?.responseMs).toBe(0); expect(pending.submission).not.toHaveProperty('awardedPoints');
    await f.transition(host,'close'); await f.transition(host,'reveal');
    const sealed = await ready(f.participant(player.token)); expect(sealed.history).toEqual([]); expect(sealed.submission).not.toHaveProperty('awardedPoints');
    await f.transition(host,'between');
    const revealed = await ready(f.participant(player.token));
    expect(revealed.history).toEqual([{ questionIndex: 0, points: 1000, total: 1000, responseMs: 0, answered: true }]);
  });
  it('restores a preview after restart without moving the options release timestamp', async () => {
    const f = await fixture(); const host = await f.host(); const player = await f.join();
    const start = await host.timeout(3000).emitWithAck('host:transition', { sessionId: f.lobby.id, expectedRevision: 0, action: 'start' });
    if (!start.ok) throw new Error(start.error); const q = start.data.question!;
    f.time(q.startedAt - 1000); await f.restart();
    const restored = await ready(f.participant(player.token));
    expect(restored.session.question?.startedAt).toBe(q.startedAt); expect(restored.session.question?.options).toEqual([]);
    f.time(q.startedAt + 250); const socket = f.participant(player.token); const released = await ready(socket);
    expect(released.session.question?.phase).toBe('ANSWERING');
    const result = await answer(socket,q.id); expect(result.ok).toBe(true); if (result.ok) expect(result.data.responseMs).toBe(250);
  });
  it('scores exact 0/25/50/75/100% receipt times and rejects late answers', async () => {
    const f = await fixture(); const host = await f.host();
    const players = await Promise.all(Array.from({ length: 7 }, (_, index) => f.join(`Player${index}`)));
    const sockets = players.map(player => f.participant(player.token)); await Promise.all(sockets.map(ready));
    const opened = await f.transition(host, 'start'); const q = opened.question!;
    for (const [index, elapsed] of [0, 5000, 10000, 15000, 20000].entries()) {
      f.time(q.startedAt + elapsed); const result = await answer(sockets[index], q.id);
      expect(result.ok).toBe(true); if (result.ok) expect(result.data).not.toHaveProperty('awardedPoints');
    }
    f.time(q.endsAt + 1); expect((await answer(sockets[5], q.id)).ok).toBe(false);
    expect(f.rows().map(row => row.awarded_points)).toEqual([1000, 875, 750, 625, 500]);
    expect(f.rows().map(row => row.response_ms)).toEqual([0, 5000, 10000, 15000, 20000]);
    const closed = await f.state(); expect(closed.state).toBe('QUESTION_OPEN'); expect(closed.question?.closed).toBe(true); expect(closed.question?.reveal).toBeNull();
  });
  it('locks concurrent duplicates and returns the original receipt after reveal/advance', async () => {
    const f = await fixture(); const host = await f.host(); const player = await f.join(); const socket = f.participant(player.token); await ready(socket);
    const secondTab = f.participant(player.token); await ready(secondTab);
    const opened = await f.transition(host, 'start'); const q = opened.question!; f.advance(5000);
    const attempts = await Promise.all(Array.from({ length: 20 }, (_, index) => answer(index % 2 ? socket : secondTab, q.id)));
    expect(f.rows()).toHaveLength(1); for (const attempt of attempts) expect(attempt).toEqual(attempts[0]);
    const first = attempts[0]; if (!first.ok) throw new Error(first.error);
    await f.transition(host, 'close'); await f.transition(host, 'reveal');
    const sealedRetry = await answer(socket,q.id,'b'); expect(sealedRetry.ok && sealedRetry.data).not.toHaveProperty('awardedPoints');
    await f.transition(host,'between');
    const retried = await answer(socket, q.id, 'b'); expect(retried.ok && retried.data).toMatchObject(first.data);
    expect(retried.ok && retried.data.awardedPoints).toBe(875);
    await f.transition(host, 'next');
    expect((await answer(socket, q.id, 'b'))).toEqual(retried); expect(f.rows()).toHaveLength(1);
    const db = openDatabase(f.databasePath);
    try { expect(() => db.prepare('UPDATE submissions SET awarded_points = 9999').run()).toThrow('immutable'); expect(() => db.prepare('DELETE FROM submissions').run()).toThrow('immutable'); } finally { db.close(); }
  });
  it('restores accepted answer and current stage on refresh, including reveal, next question and finish', async () => {
    const f = await fixture(); const host = await f.host(); const player = await f.join(); const socket = f.participant(player.token); await ready(socket);
    const opened = await f.transition(host, 'start'); f.advance(10000);
    const accepted = await answer(socket, opened.question!.id); expect(accepted.ok).toBe(true); socket.disconnect();
    let replacement = f.participant(player.token); let restored = await ready(replacement);
    expect(restored.participant.id).toBe(player.participant.id); expect(restored.participant.score).toBe(0); expect(restored.submission).toEqual(accepted.ok ? accepted.data : null); expect(restored.session.question?.endsAt).toBe(opened.question!.endsAt);
    await f.transition(host, 'close'); await f.transition(host, 'reveal'); replacement.disconnect();
    replacement = f.participant(player.token); restored = await ready(replacement);
    expect(restored.session.state).toBe('QUESTION_REVEAL'); expect(restored.submission).not.toHaveProperty('awardedPoints'); expect(restored.participant.score).toBe(0);
    await f.transition(host, 'between'); await f.transition(host, 'next'); replacement.disconnect();
    replacement = f.participant(player.token); restored = await ready(replacement);
    expect(restored.session.question?.index).toBe(1); expect(restored.submission).toBeNull(); expect(restored.participant.score).toBe(750);
    await host.timeout(3000).emitWithAck('host:end', { sessionId: f.lobby.id }); replacement.disconnect();
    restored = await ready(f.participant(player.token)); expect(restored.session.state).toBe('FINISHED'); expect(restored.participant.score).toBe(750);
  });
  it('restores unexpired and expired questions across server restart without restarting time', async () => {
    const f = await fixture(); let host = await f.host(); const player = await f.join(); let participant = f.participant(player.token); await ready(participant);
    const opened = await f.transition(host, 'start'); f.advance(5000); await answer(participant, opened.question!.id);
    await f.restart(); participant = f.participant(player.token); let restored = await ready(participant);
    expect(restored.session.question?.startedAt).toBe(opened.question!.startedAt); expect(restored.session.question?.closed).toBe(false); expect(restored.submission?.optionId).toBe('a');
    f.advance(20000); await f.restart(); restored = await ready(f.participant(player.token));
    expect(restored.session.state).toBe('QUESTION_OPEN'); expect(restored.session.question?.closed).toBe(true); expect(restored.session.question?.reveal).toBeNull();
    // Even a backward clock after persisted closure must not reopen the question.
    f.time(opened.question!.startedAt + 1000); expect((await f.state()).question?.closed).toBe(true);
    host = await f.host(); await f.transition(host, 'reveal'); await f.transition(host,'between'); expect((await ready(f.participant(player.token))).participant.score).toBe(875);
  });
  it('never sends correctness, points, other private answers or future questions before reveal', async () => {
    const f = await fixture(); const host = await f.host(); const a = await f.join('One'); const b = await f.join('Two'); const first = f.participant(a.token); const second = f.participant(b.token); await ready(first); await ready(second);
    const publicUpdates: PublicLobby[] = []; const personalUpdates: ParticipantLobby[] = [];
    const projector = f.client('/present', { pin: f.lobby.pin }); projector.on('lobby:update', data => publicUpdates.push(data)); await connect(projector); second.on('participant:state', data => personalUpdates.push(data));
    const opened = await f.transition(host, 'start'); f.advance(1000); const ack = await answer(first, opened.question!.id);
    await expect.poll(() => personalUpdates.at(-1)?.session.answeredCount).toBe(1);
    const publicJson = JSON.stringify(await f.state()); const personal = personalUpdates.at(-1)!;
    for (const secret of ['correctOptionId', 'awardedPoints', 'is_correct', 'Do not send this before reveal', 'Second question?']) { expect(publicJson).not.toContain(secret); expect(JSON.stringify(ack)).not.toContain(secret); }
    expect(personal.submission).toBeNull(); expect(personal.participant.id).toBe(b.participant.id); expect(personal.participant.score).toBe(0);
    expect(JSON.stringify(publicUpdates)).not.toContain('"participant"');
    const revealed = await f.transition(host, 'close').then(() => f.transition(host, 'reveal'));
    expect(revealed.question?.reveal?.correctOptionId).toBe('a'); expect(revealed.question?.reveal?.counts).toEqual([{ optionId: 'a', count: 1 }, { optionId: 'b', count: 0 }]);
  });
  it('rejects forged fields and prototype keys instead of mass assigning them', async () => {
    const f = await fixture(); const host = await f.host(); const player = await f.join(); const socket = f.participant(player.token); await ready(socket); const q = (await f.transition(host, 'start')).question!;
    const malicious: Record<string, unknown>[] = [
      { score: 999999 }, { awardedPoints: 999999 }, { responseMs: 0 }, { receivedAt: q.startedAt }, { participantId: player.participant.id }, { sessionId: f.lobby.id }, { correct: true }, { state: 'FINISHED' }, { isAdmin: true },
      JSON.parse('{"__proto__":{"isAdmin":true}}'), { constructor: { prototype: { isAdmin: true } } }
    ];
    for (const extra of malicious) {
      const payload = { questionId: q.id, optionId: 'a', ...extra };
      const result = await socket.timeout(3000).emitWithAck('answer:submit', payload);
      expect(result.ok).toBe(false); if (!result.ok) expect(result.code).toBe('INVALID_REQUEST');
    }
    expect(f.rows()).toHaveLength(0);
    const current = await f.state();
    const transition = await host.timeout(3000).emitWithAck('host:transition', { sessionId: f.lobby.id, expectedRevision: current.revision, action: 'close', state: 'FINISHED' } as z.infer<typeof TransitionSchema>);
    expect(transition.ok).toBe(false); expect((await f.state()).state).toBe('QUESTION_OPEN');
    expect((await answer(socket, q.id, 'does-not-exist')).ok).toBe(false);
    expect((await answer(socket, q.id)).ok).toBe(true); expect(f.rows()[0].awarded_points).toBe(1000);
  });
  it('requires legal manual transitions and rejects duplicate/delayed host advances', async () => {
    const f = await fixture(); const host = await f.host(); const player = await f.join(); await ready(f.participant(player.token));
    const opened = await f.transition(host, 'start');
    let result = await host.timeout(3000).emitWithAck('host:transition', { sessionId: f.lobby.id, expectedRevision: opened.revision, action: 'next' }); expect(result.ok).toBe(false);
    result = await host.timeout(3000).emitWithAck('host:transition', { sessionId: f.lobby.id, expectedRevision: opened.revision, action: 'reveal' }); expect(result.ok).toBe(false);
    f.advance(60000); const closed = await f.state(); expect(closed.state).toBe('QUESTION_OPEN'); expect(closed.question?.index).toBe(0);
    await f.transition(host, 'reveal'); const between = await f.transition(host, 'between');
    const command = { sessionId: f.lobby.id, expectedRevision: between.revision, action: 'next' as const };
    const attempts = await Promise.all([host.timeout(3000).emitWithAck('host:transition', command), host.timeout(3000).emitWithAck('host:transition', command)]);
    expect(attempts.filter(value => value.ok)).toHaveLength(1); expect(attempts.find(value => !value.ok)).toMatchObject({ code: 'STALE_STATE' });
    expect((await f.state()).question?.index).toBe(1);
    f.time((await f.state()).question!.startedAt);
    await f.transition(host, 'close'); await f.transition(host, 'reveal'); await f.transition(host, 'between');
    result = await host.timeout(3000).emitWithAck('host:transition', { sessionId: f.lobby.id, expectedRevision: (await f.state()).revision, action: 'next' }); expect(result.ok).toBe(false);
  });
  it('keeps early-close scoring based on the original duration, and wrong answers earn zero', async () => {
    const f = await fixture(); const host = await f.host(); const one = await f.join('Right'); const two = await f.join('Wrong'); const late = await f.join('Closed');
    const sockets = [one, two, late].map(player => f.participant(player.token)); await Promise.all(sockets.map(ready)); const q = (await f.transition(host, 'start')).question!;
    f.advance(5000); await answer(sockets[0], q.id); await answer(sockets[1], q.id, 'b'); await f.transition(host, 'close');
    expect((await answer(sockets[2], q.id)).ok).toBe(false);
    expect(f.rows().find(row => row.participant_id === one.participant.id)?.awarded_points).toBe(875);
    expect(f.rows().find(row => row.participant_id === two.participant.id)?.awarded_points).toBe(0);
    expect((await f.state()).question?.endsAt).toBe(q.endsAt);
  });
  it('rate-limits repeated invalid submissions without altering accepted data', async () => {
    const f = await fixture(); const host = await f.host(); const player = await f.join(); const socket = f.participant(player.token); await ready(socket); const q = (await f.transition(host, 'start')).question!;
    for (let index = 0; index < 30; index++) expect((await answer(socket, q.id, 'absent')).ok).toBe(false);
    const result = await answer(socket, q.id); expect(result).toMatchObject({ ok: false, code: 'RATE_LIMITED' }); expect(f.rows()).toHaveLength(0);
  });
  it('denies mass assignment on existing HTTP endpoints and rejects prototype JSON', async () => {
    const f = await fixture(); const headers = { ...f.headers(), cookie: f.cookie };
    const requests = [
      { url: '/api/host/sessions', payload: { quizId: f.quiz.id, lanAddress: '127.0.0.1', state: 'FINISHED' } },
      { url: '/api/join', payload: { pin: f.lobby.pin, nickname: 'Attack', score: 9999 } },
      { url: '/api/host/quizzes', payload: { title: 'Attack', questions: [], createdAt: 0, isAdmin: true } },
      { url: `/api/host/quizzes/${f.quiz.id}/duplicate`, payload: { id: 'other' } },
      { url: '/api/host/logout', payload: { allUsers: true } }
    ];
    for (const request of requests) expect((await f.app.inject({ method: 'POST', headers, ...request })).statusCode).toBe(400);
    const prototype = await f.app.inject({ method: 'POST', url: '/api/join', headers: { ...headers, 'content-type': 'application/json' }, payload: '{"pin":"123456","nickname":"Attack","__proto__":{"isAdmin":true}}' }); expect(prototype.statusCode).toBe(400);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });
  it('rejects participant/projector/root host actions and revokes a logged-out host mid-game', async () => {
    const f = await fixture(); const host = await f.host(); const player = await f.join(); const participant = f.participant(player.token); await ready(participant);
    const projector = f.client('/present', { pin: f.lobby.pin }); const root = f.client('/'); await connect(projector); await connect(root);
    const opened = await f.transition(host, 'start');
    const payload = { sessionId: f.lobby.id, expectedRevision: opened.revision, action: 'close' as const };
    for (const socket of [participant, projector, root]) await expect(socket.timeout(150).emitWithAck('host:transition', payload)).rejects.toThrow();
    expect((await f.state()).question?.closed).toBe(false);
    await f.app.inject({ method: 'POST', url: '/api/host/logout', headers: { ...f.headers(), cookie: f.cookie }, payload: {} });
    expect(await host.timeout(3000).emitWithAck('host:transition', payload)).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    expect((await f.state()).question?.closed).toBe(false);
  });
  it('rejects future and cross-session question IDs and cannot create another player’s answer', async () => {
    const f = await fixture(); const host = await f.host(); const player = await f.join(); const socket = f.participant(player.token); await ready(socket); const q = (await f.transition(host, 'start')).question!;
    const db = openDatabase(f.databasePath);
    let futureId: string;
    try { futureId = (db.prepare('SELECT id FROM session_questions WHERE session_id = ? AND order_index = 1').get(f.lobby.id) as { id: string }).id; } finally { db.close(); }
    expect(await answer(socket, futureId)).toMatchObject({ ok: false, code: 'QUESTION_CLOSED' });
    await host.timeout(3000).emitWithAck('host:end', { sessionId: f.lobby.id });
    const next = (await f.app.inject({ method: 'POST', url: '/api/host/sessions', headers: { ...f.headers(), cookie: f.cookie }, payload: { quizId: f.quiz.id, lanAddress: '127.0.0.1' } })).json<HostLobby>();
    const joined = (await f.app.inject({ method: 'POST', url: '/api/join', headers: f.headers(), payload: { pin: next.pin, nickname: 'Newplayer' } })).json();
    const nextSocket = f.client('/participant', { pin: next.pin, token: joined.token }); await ready(nextSocket);
    expect(await answer(nextSocket, q.id)).toMatchObject({ ok: false, code: 'INVALID_QUESTION' });
    expect(f.rows()).toHaveLength(0);
  });
  it('runs an unscored poll without changing rank, score, correctness count or tie-break time', async () => {
    const poll = { ...question, type: 'poll_mcq', text: 'Your opinion?', correctOptionId: null, basePoints: 0 };
    const f = await fixture([question, poll]); const host = await f.host();
    const a = await f.join('Alpha'); const b = await f.join('Bravo'); const first = f.participant(a.token); const second = f.participant(b.token); await ready(first); await ready(second);
    const q = (await f.transition(host, 'start')).question!; await answer(first, q.id); f.advance(5000); await answer(second, q.id);
    await f.transition(host, 'close'); await f.transition(host, 'reveal'); const before = (await f.transition(host, 'between')).leaderboard;
    expect(before.map(player => player.score)).toEqual([1000,875]);
    const current = (await f.transition(host, 'next')).question!;
    expect(current.type).toBe('poll_mcq'); expect(current.basePoints).toBe(0); expect(current.reveal).toBeNull();
    await answer(second, current.id, 'b'); f.advance(10000); await answer(first, current.id, 'a');
    expect(f.rows().filter(row => row.question_id === current.id).map(row => row.awarded_points)).toEqual([0,0]);
    await f.transition(host, 'close'); const revealed = await f.transition(host, 'reveal');
    expect(revealed.question?.reveal?.correctOptionId).toBeNull(); expect(revealed.question?.reveal?.counts).toEqual([{ optionId: 'a', count: 1 }, { optionId: 'b', count: 1 }]);
    expect((await f.transition(host, 'between')).leaderboard).toEqual(before);
    const restored = await ready(f.participant(a.token)); expect(restored.participant.score).toBe(1000); expect(restored.participant.rank).toBe(1); expect(restored.submission?.awardedPoints).toBe(0); expect(restored.submission).not.toHaveProperty('correct');
    await host.timeout(3000).emitWithAck('host:end', { sessionId: f.lobby.id });
    expect((await f.state()).podium).toEqual(before); await f.restart();
    const after = await ready(f.participant(a.token)); expect(after.participant.avatarIndex).toBe(restored.participant.avatarIndex); expect(after.participant.rank).toBe(1); expect(after.participant.score).toBe(1000);
  });
  it('caps identities per device so one person cannot run an army of alts', async () => {
    const f = await fixture([question]);
    const joinFrom = (ip: string, nickname: string) => f.app.inject({ method:'POST', url:'/api/join', remoteAddress:ip, headers:f.headers(), payload:{ pin:f.lobby.pin, nickname } });
    for (let index = 0; index < 2; index++) expect((await joinFrom('10.0.0.5', `Alt${index}`)).statusCode).toBe(201);
    const blocked = await joinFrom('10.0.0.5', 'Alt2');
    expect(blocked.statusCode).toBe(429); expect(blocked.json().code).toBe('DEVICE_LIMIT');
    expect((await joinFrom('::ffff:10.0.0.5', 'Alt4')).statusCode).toBe(429);
    expect((await joinFrom('10.0.0.6', 'Neighbour')).statusCode).toBe(201);
    // A kicked identity still counts for its device, so kicking cannot be dodged by rejoining.
    const host = await f.host(); const alt = (await f.state()).players.find(player => player.nickname === 'Alt0')!;
    expect((await host.timeout(3000).emitWithAck('host:kick', { sessionId:f.lobby.id, participantId:alt.id })).ok).toBe(true);
    expect((await joinFrom('10.0.0.5', 'Alt5')).statusCode).toBe(429);
  });
  it('frees room space when the host kicks fake players', async () => {
    const f = await fixture([question]);
    const joinFrom = (ip: string, nickname: string) => f.app.inject({ method:'POST', url:'/api/join', remoteAddress:ip, headers:f.headers(), payload:{ pin:f.lobby.pin, nickname } });
    for (let index = 0; index < MAX_PARTICIPANTS; index++) expect((await joinFrom(`10.1.${Math.floor(index/250)}.${index%250+1}`, `Bot${index}`)).statusCode).toBe(201);
    expect((await joinFrom('10.2.0.1', 'RealPerson')).json().code).toBe('SESSION_FULL');
    const host = await f.host(); const bot = (await f.state()).players[0];
    expect((await host.timeout(3000).emitWithAck('host:kick', { sessionId:f.lobby.id, participantId:bot.id })).ok).toBe(true);
    expect((await joinFrom('10.2.0.1', 'RealPerson')).statusCode).toBe(201);
  });
  it('accepts the built-in creator code with no setup, and lets the host replace it in the app', async () => {
    const f = await fixture([question]);
    const saved = process.env.RESERVED_JOIN_CODE_HASH; delete process.env.RESERVED_JOIN_CODE_HASH;
    try {
      const hostApi = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) => f.app.inject({ method, url, headers:{ ...f.headers(), cookie:f.cookie }, ...(payload ? { payload } : {}) });
      const joinAs = (nickname: string) => f.app.inject({ method:'POST', url:'/api/join', headers:f.headers(), payload:{ pin:f.lobby.pin, nickname } });
      expect((await hostApi('GET', '/api/host/settings')).json()).toEqual({ privateCode:'built-in' });
      expect((await joinAs('MUZI_0022')).json().participant).toMatchObject({ nickname:'MUZI', avatarIndex:RESERVED_AVATAR_INDEX });
      expect((await hostApi('POST', '/api/host/settings/private-code', { code:'bad code' })).statusCode).toBe(400);
      expect((await f.app.inject({ method:'POST', url:'/api/host/settings/private-code', headers:f.headers(), payload:{ code:'OWNER_abcd1234' } })).statusCode).toBe(401);
      const set = await hostApi('POST', '/api/host/settings/private-code', { code:'OWNER_abcd1234' });
      expect(set.json()).toEqual({ privateCode:'app' }); expect(set.body).not.toContain('OWNER_abcd1234');
      // The replaced built-in code no longer works; the new one does (MUZI is already taken in this lobby).
      expect((await joinAs('MUZI_0022')).statusCode).toBe(400);
      expect((await joinAs('OWNER_abcd1234')).json().code).toBe('RESERVED_ALREADY_JOINED');
      expect((await hostApi('DELETE', '/api/host/settings/private-code')).json()).toEqual({ privateCode:'built-in' });
      process.env.RESERVED_JOIN_CODE_HASH = 'a'.repeat(64);
      expect((await hostApi('GET', '/api/host/settings')).json()).toEqual({ privateCode:'env' });
    } finally { if (saved === undefined) delete process.env.RESERVED_JOIN_CODE_HASH; else process.env.RESERVED_JOIN_CODE_HASH = saved; }
  });
  it('rejects look-alike names that imitate the creator or other players', async () => {
    const f = await fixture([question]);
    for (const name of ['\u041cUZI', '\u039cuzi', 'Ay\u0435sha']) {
      const response = await f.app.inject({ method:'POST', url:'/api/join', headers:f.headers(), payload:{ pin:f.lobby.pin, nickname:name } });
      expect(response.statusCode).toBe(400); expect(response.json().error).toContain('one alphabet');
    }
    for (const name of ['MUZl', 'MUZ1', '\uff2d\uff35\uff3a\uff29']) expect((await f.join(name)).participant.nickname).toMatch(/^Player\d+$/);
    expect((await f.join('\u0410\u0439\u0448\u0430')).participant.nickname).toBe('\u0410\u0439\u0448\u0430');
  });
  it('shows the full paged ranking, a final podium and personal ranks with stable exact ties', async () => {
    const f = await fixture([question]); const host = await f.host();
    const players = []; for (let index = 0; index < 12; index++) players.push(await f.join(`Player${index}`));
    const sockets = players.map(player => f.participant(player.token)); await Promise.all(sockets.map(ready));
    const q = (await f.transition(host, 'start')).question!; await Promise.all(sockets.map(socket => answer(socket, q.id)));
    await f.transition(host, 'close'); await f.transition(host, 'reveal'); const between = await f.transition(host, 'between');
    expect(between.leaderboard).toHaveLength(12); expect(between.leaderboard.every(player => player.rank === 1)).toBe(true);
    const own = await ready(f.participant(players[11].token)); expect(own.participant.rank).toBe(1); expect(own.participant.score).toBe(1000);
    await host.timeout(3000).emitWithAck('host:end', { sessionId: f.lobby.id }); const final = await f.state(); expect(final.podium).toHaveLength(3); expect(final.podium).toEqual(between.leaderboard.slice(0,3));
  });
  it('restricts symbols/whitespace on joins and persists distinct automatic icons in the public lobby', async () => {
    const f = await fixture();
    for (const nickname of ['Ali Khan','Alex!','_Alex','a-b','@a','a\n','Alex🐼']) {
      const response = await f.app.inject({ method: 'POST', url: '/api/join', headers: f.headers(), payload: { pin: f.lobby.pin, nickname } }); expect(response.statusCode).toBe(400);
    }
    const first = await f.join('Alex1'); const second = await f.join('Alex1');
    expect(second.participant.nickname).toBe('Alex12');
    const lobby = await f.state(); expect(lobby.players).toHaveLength(2); expect(new Set(lobby.players.map(player => player.avatarIndex)).size).toBe(2);
    const own = await ready(f.participant(first.token)); await f.restart(); const restored = await ready(f.participant(first.token));
    expect(restored.participant.avatarIndex).toBe(own.participant.avatarIndex); expect(restored.participant.nickname).toBe('Alex1');
    const assigned = await f.app.inject({ method: 'POST', url: '/api/join', headers: f.headers(), payload: { pin: f.lobby.pin, nickname: 'Attack', avatarIndex: 100, rank: 1 } }); expect(assigned.statusCode).toBe(400);
  });
  it('exports protected CSV results/statistics and exposes completed sessions to the host only', async () => {
    const f = await fixture([question]); const host = await f.host(); const player = await f.join(); const socket = f.participant(player.token); await ready(socket); const q = (await f.transition(host, 'start')).question!;
    await answer(socket,q.id); await f.transition(host,'close'); await f.transition(host,'reveal'); await host.timeout(3000).emitWithAck('host:end',{ sessionId: f.lobby.id });
    for (const suffix of ['export','questions.csv']) {
      const url = `/api/host/sessions/${f.lobby.id}/${suffix}`;
      expect((await f.app.inject(url)).statusCode).toBe(401);
      expect((await f.app.inject({url, headers:{ ...f.headers(), cookie:f.cookie, origin:'http://evil.test' }})).statusCode).toBe(403);
      const response = await f.app.inject({ url, headers:{ ...f.headers(), cookie:f.cookie }});
      expect(response.statusCode).toBe(200); expect(response.headers['content-type']).toContain('text/csv'); expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.body).not.toContain(player.token); expect(response.body).not.toMatch(/reconnect_token_hash|password_hash/);
    }
    const result = await f.app.inject({ url:`/api/host/sessions/${f.lobby.id}/export`, headers:{ ...f.headers(),cookie:f.cookie }}); expect(result.body).toContain('"1000"');
    expect((await f.app.inject('/api/host/sessions/history')).statusCode).toBe(401);
    expect((await f.app.inject({ url:'/api/host/sessions/history',headers:{ ...f.headers(),cookie:f.cookie }})).json()[0].id).toBe(f.lobby.id);
  });
});

import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { AVATAR_VARIANTS, RESERVED_AVATAR_INDEX, type ClientToServerEvents, type HostLobby, type ParticipantLobby, type PublicLobby, type ServerToClientEvents } from '@localmenti/shared';
import { createApp } from './app.js';
import { openDatabase } from './database.js';
import { hashToken, setHostPassword } from './auth.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const cleanups: (() => Promise<void>)[] = [];
const question = { type: 'quiz_mcq', text: 'Private question?', options: [{ id: 'a', text: 'Private option' }, { id: 'b', text: 'Other option' }], correctOptionId: 'a', basePoints: 1000, explanation: 'Private explanation' };
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.unstubAllEnvs(); });

async function fixture() {
  const directory = mkdtempSync(resolve(tmpdir(), 'localmenti-lobby-'));
  const databasePath = resolve(directory, 'event.sqlite');
  const db = openDatabase(databasePath);
  await setHostPassword(db, 'local-lobby-password'); db.close();
  const addresses = () => [{ address: '127.0.0.1', label: 'Test LAN' }, { address: '127.0.0.2', label: 'Second adapter' }];
  let app = (await createApp({ databasePath, clientPath: resolve('client/dist'), lanAddresses: addresses })).app;
  let origin = '';
  async function listen() {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('No HTTP listener');
    origin = `http://127.0.0.1:${address.port}`;
  }
  await listen();
  const sockets: ClientSocket[] = [];
  cleanups.push(async () => { for (const socket of sockets) socket.disconnect(); await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const headers = () => ({ host: new URL(origin).host, origin });
  async function hostLogin() {
    const response = await app.inject({ method: 'POST', url: '/api/host/login', headers: headers(), payload: { password: 'local-lobby-password' } });
    expect(response.statusCode).toBe(200);
    return (response.headers['set-cookie'] as string[])[0].split(';')[0];
  }
  const cookie = await hostLogin();
  const created = await app.inject({ method: 'POST', url: '/api/host/quizzes', headers: { ...headers(), cookie }, payload: { title: 'Workshop room', description: '', questions: [question] } });
  expect(created.statusCode).toBe(201);
  const quiz = created.json();
  async function createSession(quizId = quiz.id, lanAddress = '127.0.0.1') {
    return app.inject({ method: 'POST', url: '/api/host/sessions', headers: { ...headers(), cookie }, payload: { quizId, lanAddress } });
  }
  async function open() {
    const response = await createSession(); expect(response.statusCode).toBe(201); return response.json<HostLobby>();
  }
  async function join(pin: string, nickname = 'Alex') {
    return app.inject({ method: 'POST', url: '/api/join', headers: headers(), payload: { pin, nickname } });
  }
  function client(namespace: string, auth: Record<string, string> = {}, extraHeaders: Record<string, string> = {}, transport: 'websocket' | 'polling' = 'websocket') {
    const handshakeHeaders = { Origin: origin, ...extraHeaders };
    if (!handshakeHeaders.Origin) delete (handshakeHeaders as { Origin?: string }).Origin;
    const socket: ClientSocket = io(`${origin}${namespace}`, { transports: [transport], autoConnect: false, forceNew: true, reconnection: false, auth, extraHeaders: handshakeHeaders });
    sockets.push(socket); return socket;
  }
  return { get app() { return app; }, get origin() { return origin; }, databasePath, cookie, quiz, client, open, join, createSession, headers,
    async restart() { await app.close(); app = (await createApp({ databasePath, clientPath: resolve('client/dist'), lanAddresses: addresses })).app; await listen(); }
  };
}
function connect(socket: ClientSocket) {
  return new Promise<void>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Connection timeout')), 3000);
    socket.once('connect', () => { clearTimeout(timer); resolveReady(); });
    socket.once('connect_error', error => { clearTimeout(timer); reject(error); }); socket.connect();
  });
}
function participantReady(socket: ClientSocket) {
  return new Promise<ParticipantLobby>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Participant ready timeout')), 3000);
    socket.once('participant:ready', ready => { clearTimeout(timer); resolveReady(ready); });
    socket.once('connect_error', error => { clearTimeout(timer); reject(error); }); socket.connect();
  });
}
async function watch(socket: ClientSocket, sessionId: string) {
  await connect(socket);
  const result = await socket.timeout(3000).emitWithAck('host:watch', { sessionId });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
describe('live lobby', () => {
  it('reserves MUZI and its skull for a private code, restores it, and permits it in later events', async () => {
    const code = 'Invite_9001'; vi.stubEnv('RESERVED_JOIN_CODE_HASH',hashToken(code));
    const f = await fixture(); const lobby = await f.open();
    for (const nickname of ['muzi','MUZI','MuZi','ＭＵＺＩ']) {
      const normal = (await f.join(lobby.pin,nickname)).json();
      expect(normal.participant.nickname).toMatch(/^Player\d+$/); expect(normal.participant.avatarIndex).not.toBe(RESERVED_AVATAR_INDEX);
    }
    const owner = (await f.join(lobby.pin,code)).json();
    expect(owner.participant.nickname).toBe('MUZI'); expect(owner.participant.avatarIndex).toBe(RESERVED_AVATAR_INDEX);
    expect(JSON.stringify(owner)).not.toContain(code);
    expect((await f.join(lobby.pin,code)).statusCode).toBe(409);
    expect((await f.join(lobby.pin,'Invite_9002')).statusCode).toBe(400);
    await f.restart();
    const restored = await participantReady(f.client('/participant',{ pin:lobby.pin,token:owner.token }));
    expect(restored.participant).toMatchObject({ id:owner.participant.id,nickname:'MUZI',avatarIndex:RESERVED_AVATAR_INDEX });
    await expect(connect(f.client('/host'))).rejects.toThrow('Host sign-in required');
    const host = f.client('/host',{}, { Cookie:f.cookie }); await watch(host,lobby.id);
    await host.timeout(3000).emitWithAck('host:end',{ sessionId:lobby.id });
    const next = await f.open(); const nextOwner = (await f.join(next.pin,code)).json();
    expect(nextOwner.participant.nickname).toBe('MUZI'); expect(nextOwner.participant.avatarIndex).toBe(RESERVED_AVATAR_INDEX);
  });
  it('keeps 200 names and avatar assignments unique, with the reserved skull outside the random pool', async () => {
    const code = 'Invite_9001'; vi.stubEnv('RESERVED_JOIN_CODE_HASH',hashToken(code));
    const f = await fixture(); const lobby = await f.open(); const all = [(await f.join(lobby.pin,code)).json().participant];
    for (let index = 0; index < 199; index++) all.push((await f.join(lobby.pin,index < 3 ? ['MUZI','muzi','ＭＵＺＩ'][index] : 'Alex')).json().participant);
    expect(new Set(all.map(player => player.nickname.toLowerCase())).size).toBe(200);
    expect(new Set(all.map(player => player.avatarIndex)).size).toBe(200);
    expect(all.filter(player => player.nickname === 'MUZI')).toHaveLength(1);
    expect(all.filter(player => player.avatarIndex === RESERVED_AVATAR_INDEX)).toHaveLength(1);
    expect(all.slice(1).every(player => player.avatarIndex >= 0 && player.avatarIndex < AVATAR_VARIANTS)).toBe(true);
  });
  it('rate-limits private-code guessing without blocking ordinary names', async () => {
    const f = await fixture(); const lobby = await f.open();
    for (let index = 0; index < 5; index++) expect((await f.join(lobby.pin,'Wrong_9000')).statusCode).toBe(400);
    expect((await f.join(lobby.pin,'Wrong_9000')).statusCode).toBe(429);
    expect((await f.join(lobby.pin,'NormalPlayer')).statusCode).toBe(201);
  });
  it('allows only the authenticated same-origin host to stop a room through the library', async () => {
    const f = await fixture(); const lobby = await f.open(); const url = `/api/host/sessions/${lobby.id}/end`;
    expect((await f.app.inject({ method:'POST',url,headers:f.headers(),payload:{} })).statusCode).toBe(401);
    const headers = { ...f.headers(),cookie:f.cookie };
    expect((await f.app.inject({ method:'POST',url,headers:{ ...headers,origin:'http://evil.test' },payload:{} })).statusCode).toBe(403);
    expect((await f.app.inject({ method:'POST',url,headers,payload:{ score:999 } })).statusCode).toBe(400);
    expect((await f.app.inject({ method:'POST',url,headers,payload:{} })).json().state).toBe('FINISHED');
    expect((await f.app.inject({ method:'POST',url,headers,payload:{} })).json().state).toBe('FINISHED');
    expect((await f.app.inject({ url:'/api/host/sessions/active',headers })).json()).toBeNull();
    expect((await f.createSession()).statusCode).toBe(201);
  });
  it('opens real host controls with the cookie and WebSocket Origin when polling metadata is absent', async () => {
    const f = await fixture(); const lobby = await f.open();
    const headers = { host:new URL(f.origin).host,cookie:f.cookie };
    expect((await f.app.inject({ url:'/api/host/auth',headers })).json().authenticated).toBe(true);
    await expect(connect(f.client('/host',{}, { Cookie:f.cookie,Origin:'' },'polling'))).rejects.toThrow('local address');
    // A polling origin rejection must not invalidate the actual host login.
    expect((await f.app.inject({ url:'/api/host/auth',headers })).json().authenticated).toBe(true);
    const socket = f.client('/host',{}, { Cookie:f.cookie },'websocket');
    const ready = await watch(socket,lobby.id);
    expect(ready.pin).toBe(lobby.pin); expect(ready.state).toBe('LOBBY');
    const started = await socket.timeout(3000).emitWithAck('host:transition',{ sessionId:lobby.id,expectedRevision:ready.revision,action:'start' });
    expect(started.ok).toBe(true); if (started.ok) expect(started.data.question?.phase).toBe('PREVIEW');
  });
  it('creates one snapshotted session, validates adapters, and serves a secret-free QR/lobby', async () => {
    const f = await fixture();
    for (const path of ['/api/host/network', '/api/host/sessions/active', '/api/host/sessions/example']) expect((await f.app.inject({ url: path, headers: f.headers() })).statusCode).toBe(401);
    expect((await f.app.inject({ method: 'POST', url: '/api/host/sessions', headers: f.headers(), payload: { quizId: f.quiz.id, lanAddress: '127.0.0.1' } })).statusCode).toBe(401);
    expect((await f.app.inject({ url: '/api/host/network', headers: { ...f.headers(), cookie: f.cookie } })).json().addresses).toHaveLength(2);
    expect((await f.createSession(f.quiz.id, '203.0.113.9')).statusCode).toBe(400);
    const lobby = await f.open(); expect(lobby.pin).toMatch(/^\d{6}$/);
    expect(lobby.joinUrl).toBe(`${f.origin}/s/${lobby.pin}`);
    expect((await f.createSession()).statusCode).toBe(409);
    const db = openDatabase(f.databasePath);
    try {
      expect(() => db.prepare("INSERT INTO sessions (id, quiz_id, six_digit_pin, state, created_at, quiz_title, lan_address, port) VALUES ('rogue', 'quiz', '000000', 'LOBBY', 0, 'rogue', '127.0.0.1', 3000)").run()).toThrow();
      expect(db.prepare('SELECT text, correct_option_id FROM session_questions WHERE session_id = ?').get(lobby.id)).toEqual({ text: question.text, correct_option_id: 'a' });
    } finally { db.close(); }
    // Authoring and even deleting the source quiz cannot change its session snapshot.
    expect((await f.app.inject({ method: 'DELETE', url: `/api/host/quizzes/${f.quiz.id}`, headers: { ...f.headers(), cookie: f.cookie } })).statusCode).toBe(204);
    const publicResponse = await f.app.inject(`/api/sessions/${lobby.pin}`);
    expect(publicResponse.statusCode).toBe(200);
    for (const secret of ['correctOptionId', 'correct_option_id', 'Private question', 'Private option', 'Private explanation', 'token', 'participants']) expect(publicResponse.body).not.toContain(secret);
    const qr = await f.app.inject(`/api/sessions/${lobby.pin}/qr`);
    expect(qr.statusCode).toBe(200); expect(qr.headers['content-type']).toContain('image/png');
    expect(qr.rawPayload.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect((await f.app.inject('/api/sessions/invalid')).statusCode).toBe(404);
  });
  it('normalizes unique nicknames, hashes tokens and counts identities rather than tabs', async () => {
    const f = await fixture(); const lobby = await f.open();
    const host = f.client('/host', {}, { Cookie: f.cookie }); await watch(host, lobby.id);
    const updates: HostLobby[] = []; host.on('host:lobby', data => updates.push(data));
    const joined = (await f.join(lobby.pin, 'Ａlex')).json(); expect(joined.participant.nickname).toBe('Alex');
    const other = (await f.join(lobby.pin, 'alex')).json(); expect(other.participant.nickname).toBe('alex2');
    const first = f.client('/participant', { pin: lobby.pin, token: joined.token });
    const ready = await participantReady(first);
    expect(ready.participant).toEqual({ ...joined.participant, score: 0, rank: null, previousScore: 0, previousRank: null });
    expect(JSON.stringify(ready)).not.toMatch(/correctOptionId|Private question|reconnect_token_hash/);
    const secondTab = f.client('/participant', { pin: lobby.pin, token: joined.token }); await participantReady(secondTab);
    await expect.poll(() => updates.at(-1)?.connectedCount).toBe(1);
    expect(updates.at(-1)?.joinedCount).toBe(2);
    first.disconnect();
    const hostAfterOne = await host.timeout(3000).emitWithAck('host:watch', { sessionId: lobby.id });
    expect(hostAfterOne.ok && hostAfterOne.data.connectedCount).toBe(1);
    secondTab.disconnect();
    await expect.poll(() => updates.at(-1)?.connectedCount).toBe(0);
    const reconnect = await participantReady(f.client('/participant', { pin: lobby.pin, token: joined.token }));
    expect(reconnect.participant.id).toBe(joined.participant.id);
    const db = openDatabase(f.databasePath);
    try { expect(db.prepare('SELECT reconnect_token_hash FROM participants WHERE id = ?').get(joined.participant.id)).toEqual({ reconnect_token_hash: hashToken(joined.token) }); } finally { db.close(); }
  });
  it('denies missing/forged/cross-origin host access and rechecks authorization on every command', async () => {
    const f = await fixture(); const lobby = await f.open();
    await expect(connect(f.client('/host'))).rejects.toThrow('Host sign-in required');
    await expect(connect(f.client('/host', {}, { Cookie: 'localmenti_host=invalid' }))).rejects.toThrow('Host sign-in required');
    await expect(connect(f.client('/host', {}, { Cookie: f.cookie, Origin: 'http://evil.test' }))).rejects.toThrow();
    const joined = (await f.join(lobby.pin)).json();
    const participant = f.client('/participant', { pin: lobby.pin, token: joined.token }); await participantReady(participant);
    const projector = f.client('/present', { pin: lobby.pin }); await connect(projector);
    const root = f.client('/'); await connect(root);
    for (const socket of [participant, projector, root]) await expect(socket.timeout(150).emitWithAck('host:end', { sessionId: lobby.id })).rejects.toThrow();
    const host = f.client('/host', {}, { Cookie: f.cookie }); await watch(host, lobby.id);
    expect((await f.app.inject(`/api/sessions/${lobby.pin}`)).json().state).toBe('LOBBY');
    expect((await f.app.inject({ method: 'POST', url: '/api/host/logout', headers: { ...f.headers(), cookie: f.cookie }, payload: {} })).statusCode).toBe(200);
    const result = await host.timeout(3000).emitWithAck('host:end', { sessionId: lobby.id });
    expect(result).toEqual({ ok: false, error: 'Host sign-in required.', code: 'UNAUTHORIZED' });
    expect((await f.app.inject(`/api/sessions/${lobby.pin}`)).json().state).toBe('LOBBY');
  });
  it('supports polling host connections with matching origin and rejects invalid command payloads', async () => {
    const f = await fixture(); const lobby = await f.open();
    const host = f.client('/host', {}, { Cookie: f.cookie }, 'polling'); await watch(host, lobby.id);
    const wrongAddress = await host.timeout(3000).emitWithAck('host:address', { sessionId: lobby.id, lanAddress: '203.0.113.1' });
    expect(wrongAddress.ok).toBe(false);
    const invalid = await host.timeout(3000).emitWithAck('host:watch', { sessionId: 'bad-id' });
    expect(invalid.ok).toBe(false);
    const address = await host.timeout(3000).emitWithAck('host:address', { sessionId: lobby.id, lanAddress: '127.0.0.2' });
    expect(address.ok && address.data.joinUrl).toBe(f.origin.replace('127.0.0.1', '127.0.0.2') + `/s/${lobby.pin}`);
  });
  it('accepts same-origin fetch metadata for polling and rejects unproven/cross-site requests', async () => {
    const f = await fixture(); const lobby = await f.open();
    const browserPolling = f.client('/host', {}, { Cookie: f.cookie, Origin: '', 'Sec-Fetch-Site': 'same-origin' }, 'polling');
    expect((await watch(browserPolling, lobby.id)).id).toBe(lobby.id);
    await expect(connect(f.client('/host', {}, { Cookie: f.cookie, Origin: '' }, 'polling'))).rejects.toThrow('local address');
    await expect(connect(f.client('/host', {}, { Cookie: f.cookie, Origin: '', 'Sec-Fetch-Site': 'cross-site' }, 'polling'))).rejects.toThrow('local address');
  });
  it('removes all tabs, rejects removed/forged tokens and isolates session identities', async () => {
    const f = await fixture(); const lobby = await f.open();
    const host = f.client('/host', {}, { Cookie: f.cookie }); await watch(host, lobby.id);
    const joined = (await f.join(lobby.pin)).json();
    const participant = f.client('/participant', { pin: lobby.pin, token: joined.token }); await participantReady(participant);
    const another = f.client('/participant', { pin: lobby.pin, token: joined.token }); await participantReady(another);
    let removed = false; participant.on('participant:removed', () => { removed = true; });
    const result = await host.timeout(3000).emitWithAck('host:kick', { sessionId: lobby.id, participantId: joined.participant.id });
    expect(result.ok && result.data.connectedCount).toBe(0); expect(result.ok && result.data.removedCount).toBe(1);
    await expect.poll(() => removed && !participant.connected && !another.connected).toBe(true);
    await expect(participantReady(f.client('/participant', { pin: lobby.pin, token: joined.token }))).rejects.toThrow('invalid or was removed');
    await expect(participantReady(f.client('/participant', { pin: lobby.pin, token: randomBytes(32).toString('hex') }))).rejects.toThrow();
    await expect(participantReady(f.client('/participant', { pin: lobby.pin, nickname: 'Alex' }))).rejects.toThrow();
    expect((await f.join(lobby.pin, 'Alex')).json().participant.nickname).toBe('Alex2');
    await host.timeout(3000).emitWithAck('host:end', { sessionId: lobby.id });
    const next = await f.open(); expect(next.pin).not.toBe(lobby.pin);
    await expect(participantReady(f.client('/participant', { pin: next.pin, token: joined.token }))).rejects.toThrow();
  });
  it('restores a persisted lobby and identities after restart; live connections start at zero', async () => {
    const f = await fixture(); const lobby = await f.open(); const joined = (await f.join(lobby.pin)).json();
    const participant = f.client('/participant', { pin: lobby.pin, token: joined.token }); await participantReady(participant);
    // Close with an active WebSocket; shutdown must not hang or access a closed DB.
    await f.restart();
    const restored = (await f.app.inject({ url: '/api/host/sessions/active', headers: { ...f.headers(), cookie: f.cookie } })).json<HostLobby>();
    expect(restored.id).toBe(lobby.id); expect(restored.pin).toBe(lobby.pin); expect(restored.joinedCount).toBe(1); expect(restored.connectedCount).toBe(0);
    expect(restored.joinUrl).toBe(`${f.origin}/s/${lobby.pin}`);
    const ready = await participantReady(f.client('/participant', { pin: lobby.pin, token: joined.token }));
    expect(ready.participant.id).toBe(joined.participant.id); expect(ready.session.state).toBe('LOBBY');
  });
  it('ends idempotently, broadcasts to the projector and refuses new joins', async () => {
    const f = await fixture(); const lobby = await f.open();
    const host = f.client('/host', {}, { Cookie: f.cookie }); await watch(host, lobby.id);
    const projector = f.client('/present', { pin: lobby.pin }); const states: PublicLobby[] = [];
    projector.on('lobby:update', data => states.push(data)); await connect(projector);
    const one = await host.timeout(3000).emitWithAck('host:end', { sessionId: lobby.id }); expect(one.ok && one.data.state).toBe('FINISHED');
    const two = await host.timeout(3000).emitWithAck('host:end', { sessionId: lobby.id });
    expect(two.ok && two.data).toEqual(one.ok ? { ...one.data, serverTime: expect.any(Number) } : one);
    await expect.poll(() => states.at(-1)?.state).toBe('FINISHED');
    expect((await f.join(lobby.pin)).statusCode).toBe(404);
    const next = await f.open(); expect(next.id).not.toBe(lobby.id);
  });
  it('bounds joins, sanitizes input and enforces origin/body limits', async () => {
    const f = await fixture(); const lobby = await f.open();
    expect((await f.join(lobby.pin, '💥💥')).statusCode).toBe(400);
    expect((await f.join(lobby.pin, 'x'.repeat(49))).statusCode).toBe(400);
    expect((await f.app.inject({ method: 'POST', url: '/api/join', payload: { pin: lobby.pin, nickname: 'No origin' } })).statusCode).toBe(403);
    expect((await f.app.inject({ method: 'POST', url: '/api/join', headers: { ...f.headers(), origin: 'http://evil.test' }, payload: { pin: lobby.pin, nickname: 'Remote' } })).statusCode).toBe(403);
    expect((await f.join(lobby.pin, 'x'.repeat(3000))).statusCode).toBe(413);
    for (let index = 0; index < 200; index++) expect((await f.join(lobby.pin, `Person${index}`)).statusCode).toBe(201);
    const full = await f.join(lobby.pin, 'Extra'); expect(full.statusCode).toBe(409); expect(full.json().code).toBe('SESSION_FULL');
    // This exercises the admission cap, not 200 connected clients or capacity.
  });
  it('rate-limits join attempts including invalid PINs', async () => {
    const f = await fixture();
    for (let index = 0; index < 240; index++) expect((await f.join('000000', 'Guess')).statusCode).toBe(404);
    const limited = await f.join('000000', 'Guess'); expect(limited.statusCode).toBe(429); expect(limited.headers['retry-after']).toBe('60');
  });
});

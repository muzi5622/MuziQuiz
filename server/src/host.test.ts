import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { createApp } from './app.js';
import { openDatabase } from './database.js';
import { hashToken, setHostPassword } from './auth.js';
import { MAX_IMPORT_BYTES, type Quiz } from '@localmenti/shared';

const password = 'local-test-password-123';
const headers = { host: 'localmenti.test:3000', origin: 'http://localmenti.test:3000' };
const question = { type: 'quiz_mcq', text: 'First?', options: [{ id: 'a', text: 'One' }, { id: 'b', text: 'Two' }], correctOptionId: 'b', basePoints: 1000, explanation: 'Because.' };
const draft = { title: 'Workshop', description: 'Offline quiz', durationSeconds: 20, questions: [question, { ...question, text: 'Second?', basePoints: 500 }] };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(withPassword = true) {
  const dir = mkdtempSync(resolve(tmpdir(), 'localmenti-host-'));
  const databasePath = resolve(dir, 'quiz.sqlite');
  const db = openDatabase(databasePath);
  try { if (withPassword) await setHostPassword(db, password); } finally { db.close(); }
  let app = (await createApp({ databasePath, clientPath: resolve('client/dist') })).app;
  cleanups.push(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  return {
    get app() { return app; }, databasePath,
    async restart() { await app.close(); app = (await createApp({ databasePath, clientPath: resolve('client/dist') })).app; }
  };
}
function request(app: FastifyInstance, method: HTTPMethods, path: string, cookie = '', payload?: unknown) {
  return app.inject({ method, url: `/api/host${path}`, headers: { ...headers, cookie }, payload });
}
async function login(app: FastifyInstance) {
  const response = await request(app, 'POST', '/login', '', { password });
  expect(response.statusCode).toBe(200);
  return (response.headers['set-cookie'] as string[])[0].split(';')[0];
}
it('clears only finished event data behind host authorization and backs it up first',async () => {
  const f=await fixture(); const cookie=await login(f.app);
  const db=openDatabase(f.databasePath);
  try {
    for (const [id,state,pin] of [['done','FINISHED','123456'],['live','LOBBY','234567']]) {
      db.prepare('INSERT INTO sessions (id,quiz_id,six_digit_pin,state,created_at,quiz_title,lan_address,port) VALUES (?,?,?,?,0,?,\'127.0.0.1\',3000)').run(id,'saved',pin,state,id);
      db.prepare('INSERT INTO participants (id,session_id,nickname,nickname_key,reconnect_token_hash,joined_at,last_seen_at,avatar_index) VALUES (?,?,?,?,?,0,0,0)').run(id,id,'Player','player',id);
      db.prepare('INSERT INTO session_questions (id,session_id,order_index,type,text,options_json,correct_option_id,duration_seconds,base_points) VALUES (?,?,0,\'quiz_mcq\',\'Q\',\'[]\',\'a\',20,1000)').run(id,id);
      db.prepare('INSERT INTO submissions (id,session_id,participant_id,question_id,option_id,received_at,response_ms,awarded_points,is_correct) VALUES (?,?,?,?,\'a\',0,0,1000,1)').run(id,id,id,id);
    }
    expect((await request(f.app,'DELETE','/sessions/history')).statusCode).toBe(401);
    expect((await request(f.app,'DELETE','/sessions/history',cookie,{ live:true })).statusCode).toBe(400);
    expect(() => db.prepare("DELETE FROM submissions WHERE session_id = 'live'").run()).toThrow('immutable');
    const result=await request(f.app,'DELETE','/sessions/history',cookie);
    expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ deleted:1 });
    for (const table of ['sessions','participants','session_questions','submissions']) expect(db.prepare(`SELECT id FROM ${table}`).all()).toEqual([{ id:'live' }]);
    expect(readdirSync(resolve(f.databasePath,'..','backups')).some(name => name.startsWith('before-history-reset-'))).toBe(true);
  } finally { db.close(); }
});
describe('host authoring API', () => {
  it('has no remote password setup and gates every quiz operation', async () => {
    const { app } = await fixture(false);
    expect((await request(app, 'GET', '/auth')).json()).toEqual({ configured: false, authenticated: false });
    expect((await request(app, 'POST', '/login', '', { password })).statusCode).toBe(401);
    for (const [method, path] of [['GET', '/quizzes'], ['POST', '/quizzes'], ['GET', '/quizzes/id'], ['PUT', '/quizzes/id'], ['DELETE', '/quizzes/id'], ['GET', '/quizzes/id/export'], ['POST', '/quizzes/import'], ['POST', '/quizzes/id/duplicate']] as const) {
      expect((await request(app, method, path, '', draft)).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'POST', url: '/api/host/login', payload: { password } })).statusCode).toBe(403);
  });
  it('hashes credentials and tokens, checks origins, expires sessions and logs out', async () => {
    const { app, databasePath } = await fixture();
    const response = await request(app, 'POST', '/login', '', { password });
    const setCookie = (response.headers['set-cookie'] as string[])[0];
    expect(setCookie).toContain('HttpOnly'); expect(setCookie).toContain('SameSite=Strict'); expect(setCookie).toContain('Path=/;');
    const cookie = setCookie.split(';')[0];
    expect((await request(app, 'GET', '/auth', cookie)).json().authenticated).toBe(true);
    const db = openDatabase(databasePath);
    try {
      const record = db.prepare('SELECT salt, password_hash FROM host_credentials').get() as { salt: string; password_hash: string };
      expect(record.password_hash).not.toBe(password); expect(record.salt).toHaveLength(64);
      const session = db.prepare('SELECT token_hash FROM host_sessions').get() as { token_hash: string };
      expect(session.token_hash).toBe(hashToken(cookie.split('=')[1])); expect(session.token_hash).not.toBe(cookie.split('=')[1]);
      expect((await app.inject({ method: 'POST', url: '/api/host/quizzes', headers: { ...headers, origin: 'http://evil.test', cookie }, payload: draft })).statusCode).toBe(403);
      expect((await app.inject({ url: '/api/host/quizzes', headers: { ...headers, origin: 'http://evil.test', cookie } })).statusCode).toBe(403);
      expect((await app.inject({ url: '/api/host/quizzes', headers: { ...headers, 'sec-fetch-site': 'cross-site', cookie } })).statusCode).toBe(403);
      expect((await request(app, 'POST', '/logout', cookie, {})).statusCode).toBe(200);
      expect((await request(app, 'GET', '/quizzes', cookie)).statusCode).toBe(401);
      const another = await login(app);
      db.prepare('UPDATE host_sessions SET expires_at = 0').run();
      expect((await request(app, 'GET', '/quizzes', another)).statusCode).toBe(401);
      const third = await login(app);
      await setHostPassword(db, 'replacement-password-123');
      expect((await request(app, 'GET', '/quizzes', third)).statusCode).toBe(401);
    } finally { db.close(); }
  });
  it('persists authoring across restart, reorders, round-trips JSON and rejects stale saves', async () => {
    const fixtureData = await fixture();
    let app = fixtureData.app;
    const cookie = await login(app);
    const created = await request(app, 'POST', '/quizzes', cookie, draft);
    expect(created.statusCode).toBe(201);
    const quiz = created.json<Quiz>();
    await fixtureData.restart(); app = fixtureData.app;
    const restored = (await request(app, 'GET', `/quizzes/${quiz.id}`, cookie)).json<Quiz>();
    expect(restored).toEqual(quiz);
    const update = { ...draft, durationSeconds: 45, title: 'Renamed', questions: [...draft.questions].reverse(), expectedUpdatedAt: quiz.updatedAt };
    const changed = await request(app, 'PUT', `/quizzes/${quiz.id}`, cookie, update);
    expect(changed.statusCode).toBe(200);
    expect(changed.json().questions[0].text).toBe('Second?');
    expect(changed.json().durationSeconds).toBe(45);
    expect(changed.json().updatedAt).toBeGreaterThan(quiz.updatedAt);
    expect((await request(app, 'PUT', `/quizzes/${quiz.id}`, cookie, update)).statusCode).toBe(409);
    const exported = await request(app, 'GET', `/quizzes/${quiz.id}/export`, cookie);
    expect(exported.headers['content-disposition']).toContain('attachment');
    expect(exported.json()).toEqual({ version: 2, quiz: { title: 'Renamed', description: draft.description, durationSeconds: 45, questions: update.questions } });
    expect(exported.body).not.toMatch(/password|token_hash|salt/);
    const imported = await request(app, 'POST', '/quizzes/import', cookie, exported.json());
    expect(imported.statusCode).toBe(201); expect(imported.json().id).not.toBe(quiz.id);
    const duplicate = await request(app, 'POST', `/quizzes/${quiz.id}/duplicate`, cookie, {});
    expect(duplicate.statusCode).toBe(201); expect(duplicate.json().title).toBe('Renamed (copy)');
    expect(duplicate.json().questions).toEqual(update.questions);
    expect((await request(app, 'GET', '/quizzes', cookie)).json()).toHaveLength(3);
    expect((await request(app, 'DELETE', `/quizzes/${quiz.id}`, cookie)).statusCode).toBe(204);
    expect((await request(app, 'GET', `/quizzes/${quiz.id}`, cookie)).statusCode).toBe(404);
    const db = openDatabase(fixtureData.databasePath);
    try { expect(db.prepare('SELECT COUNT(*) AS count FROM questions WHERE quiz_id = ?').get(quiz.id)).toEqual({ count: 0 }); } finally { db.close(); }
  });
  it('rejects invalid/oversized imports and preserves the existing quiz on invalid save', async () => {
    const { app } = await fixture();
    const cookie = await login(app);
    const quiz = (await request(app, 'POST', '/quizzes', cookie, draft)).json<Quiz>();
    expect((await request(app, 'PUT', `/quizzes/${quiz.id}`, cookie, { ...draft, questions: [{ ...question, correctOptionId: 'absent' }], expectedUpdatedAt: quiz.updatedAt })).statusCode).toBe(400);
    expect((await request(app, 'GET', `/quizzes/${quiz.id}`, cookie)).json()).toEqual(quiz);
    expect((await request(app, 'POST', '/quizzes/import', cookie, { version: 3, quiz: draft })).statusCode).toBe(400);
    expect((await request(app, 'POST', '/quizzes/import', cookie, { version: 1, quiz: { ...draft, scoringMode: 'fixed' } })).statusCode).toBe(400);
    const oversized = JSON.stringify({ version: 1, quiz: { ...draft, description: 'x'.repeat(MAX_IMPORT_BYTES) } });
    expect((await app.inject({ method: 'POST', url: '/api/host/quizzes/import', headers: { ...headers, cookie, 'content-type': 'application/json' }, payload: oversized })).statusCode).toBe(413);
    expect((await app.inject({ method: 'POST', url: '/api/host/quizzes/import', headers: { ...headers, cookie, 'content-type': 'application/json' }, payload: '{broken' })).statusCode).toBe(400);
  });
  it('rate-limits repeated password guessing', async () => {
    const { app } = await fixture();
    for (let attempt = 0; attempt < 8; attempt++) expect((await request(app, 'POST', '/login', '', { password: 'wrong-password-123' })).statusCode).toBe(401);
    expect((await request(app, 'POST', '/login', '', { password })).statusCode).toBe(429);
  });
  it('creates the first host password only from the host laptop, and only once', async () => {
    const f = await fixture(false);
    const setup = (remoteAddress: string, body: unknown) => f.app.inject({ method:'POST', url:'/api/host/setup', remoteAddress, headers, payload:body as object });
    expect((await f.app.inject({ url:'/api/host/auth', headers })).json()).toEqual({ configured:false, authenticated:false });
    const fromWifi = await setup('192.168.1.50', { password:'wifi-takeover-pass' });
    expect(fromWifi.statusCode).toBe(403);
    expect((await setup('127.0.0.1', { password:'short' })).statusCode).toBe(400);
    const created = await setup('127.0.0.1', { password:'my-new-host-password' });
    expect(created.statusCode).toBe(200);
    const cookie = (created.headers['set-cookie'] as string[])[0].split(';')[0];
    expect((await f.app.inject({ url:'/api/host/auth', headers:{ ...headers, cookie } })).json()).toEqual({ configured:true, authenticated:true });
    expect((await setup('127.0.0.1', { password:'another-password-1' })).statusCode).toBe(409);
    expect((await f.app.inject({ method:'POST', url:'/api/host/login', remoteAddress:'192.168.1.50', headers, payload:{ password:'my-new-host-password' } })).statusCode).toBe(200);
  });
});


import type { FastifyInstance } from 'fastify';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import QRCode from 'qrcode';
import { EmptyBodySchema, JoinSchema, MIXED_ALPHABET_ERROR, mixesAlphabets, PinSchema, SessionCreateSchema } from '@localmenti/shared';
import { LobbyError, type LobbyService } from './lobby.js';
import { WindowLimit } from './limits.js';
import type Database from 'better-sqlite3';
import { questionStatsCsv, resultsCsv } from './results.js';

export function registerHostLobbyRoutes(host: FastifyInstance, lobby: LobbyService, db: Database.Database) {
  host.delete('/sessions/history', async (request, reply) => {
    if (!EmptyBodySchema.safeParse(request.body ?? {}).success) return reply.code(400).send({ error:'Reset does not accept any fields.' });
    if (db.name !== ':memory:') {
      const directory = resolve(dirname(db.name),'backups'); mkdirSync(directory,{ recursive:true });
      await db.backup(resolve(directory,`before-history-reset-${Date.now()}.sqlite`));
    }
    const deleted = db.transaction(() => {
      for (const table of ['submissions','participants','session_questions']) db.prepare(`DELETE FROM ${table} WHERE session_id IN (SELECT id FROM sessions WHERE state = 'FINISHED')`).run();
      return db.prepare("DELETE FROM sessions WHERE state = 'FINISHED'").run().changes;
    })();
    return { deleted };
  });
  host.get('/network', () => ({ addresses: lobby.addresses() }));
  host.get('/sessions/active', () => lobby.active());
  host.get('/sessions/history', () => db.prepare("SELECT id, quiz_title AS title, six_digit_pin AS pin, ended_at AS endedAt FROM sessions WHERE state = 'FINISHED' ORDER BY ended_at DESC, id LIMIT 20").all());
  host.post<{ Params:{ id:string } }>('/sessions/:id/end',(request,reply) => {
    if (!EmptyBodySchema.safeParse(request.body ?? {}).success) return reply.code(400).send({ error:'Stop session does not accept any fields.' });
    try { return lobby.end(request.params.id); }
    catch (error) { if (error instanceof LobbyError) return reply.code(error.status).send({ error:error.message }); throw error; }
  });
  host.post('/sessions', (request, reply) => {
    const parsed = SessionCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      const eventIssue = parsed.error.issues.find(issue => issue.path[0] === 'eventName');
      return reply.code(400).send({ error: eventIssue ? `Event name: ${eventIssue.code === 'too_big' ? 'use 80 characters or fewer.' : eventIssue.message}` : 'Choose a saved quiz and a current laptop IPv4 address.' });
    }
    try { return reply.code(201).send(lobby.create(parsed.data.quizId, parsed.data.lanAddress, parsed.data.previewSeconds, parsed.data.eventName)); }
    catch (error) { if (error instanceof LobbyError) return reply.code(error.status).send({ error: error.message, code: error.code }); throw error; }
  });
  host.get<{ Params: { id: string } }>('/sessions/:id', (request, reply) => {
    try { return lobby.hostLobby(request.params.id); }
    catch (error) { if (error instanceof LobbyError) return reply.code(error.status).send({ error: error.message }); throw error; }
  });
  for (const [suffix, build] of [['export', resultsCsv], ['questions.csv', questionStatsCsv]] as const) {
    host.get<{ Params: { id: string } }>(`/sessions/:id/${suffix}`, (request, reply) => {
      const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(request.params.id) as { id: string } | undefined;
      if (!session) return reply.code(404).send({ error: 'Session not found.' });
      return reply.type('text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="localmenti-${suffix === 'export' ? 'results' : 'questions'}-${session.id}.csv"`).header('X-Content-Type-Options', 'nosniff').send(build(db, session.id));
    });
  }
}
export async function registerPublicLobbyRoutes(app: FastifyInstance, lobby: LobbyService) {
  await app.register(async publicApi => {
    const joinLimit = new WindowLimit(240, 600);
    const privateCodeLimit = new WindowLimit(5,100,15*60_000);
    const readLimit = new WindowLimit(600, 2400);
    publicApi.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const origin = request.headers.origin;
      if ((origin && origin !== `http://${request.headers.host}`) || request.headers['sec-fetch-site'] === 'cross-site' || (request.method === 'POST' && !origin)) {
        return reply.code(403).send({ error: 'Open the app from its own local address.' });
      }
      const allowed = request.method === 'POST' ? joinLimit.take(request.ip) : readLimit.take(request.ip);
      if (!allowed) return reply.code(429).header('Retry-After', '60').send({ error: 'Too many requests. Wait a minute.' });
    });
    publicApi.post('/join', { bodyLimit: 2048 }, (request, reply) => {
      const parsed = JoinSchema.safeParse(request.body);
      if (!parsed.success) {
        const nickname = (request.body as { nickname?: unknown } | null)?.nickname;
        if (typeof nickname === 'string' && mixesAlphabets(nickname.normalize('NFKC'))) return reply.code(400).send({ error: MIXED_ALPHABET_ERROR });
        return reply.code(400).send({ error: 'Use a six-digit PIN and 1–24 letters or numbers only. Spaces and symbols are not allowed.' });
      }
      if (parsed.data.nickname.includes('_') && !privateCodeLimit.take(request.ip)) return reply.code(429).header('Retry-After','900').send({ error:'Too many private-code attempts. Wait 15 minutes.' });
      try { return reply.code(201).send(lobby.join(parsed.data.pin, parsed.data.nickname, request.ip)); }
      catch (error) { if (error instanceof LobbyError) return reply.code(error.status).send({ error: error.message, code: error.code }); throw error; }
    });
    publicApi.get<{ Params: { pin: string } }>('/sessions/:pin', (request, reply) => {
      const pin = PinSchema.safeParse(request.params.pin);
      const row = pin.success ? lobby.byPin(pin.data) : undefined;
      if (!row) return reply.code(404).send({ error: 'Session not found.' });
      return lobby.publicLobby(row.id);
    });
    publicApi.get<{ Params: { pin: string } }>('/sessions/:pin/qr', async (request, reply) => {
      const pin = PinSchema.safeParse(request.params.pin);
      const row = pin.success ? lobby.byPin(pin.data) : undefined;
      if (!row) return reply.code(404).send({ error: 'Session not found.' });
      const image = await QRCode.toBuffer(lobby.publicLobby(row.id).joinUrl, { width: 360, margin: 2, errorCorrectionLevel: 'M' });
      return reply.type('image/png').header('X-Content-Type-Options', 'nosniff').send(image);
    });
  }, { prefix: '/api' });
}

import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { EmptyBodySchema, LoginSchema, MAX_IMPORT_BYTES, QuizDraftSchema, QuizFileSchema, QuizUpdateSchema } from '@localmenti/shared';
import { authenticated, configured, cookieToken, hashToken, sessionCookie, SESSION_MS, verifyPassword } from './auth.js';
import { createQuiz, getQuiz, listQuizzes, updateQuiz } from './quizzes.js';
import type { LobbyService } from './lobby.js';
import { registerHostLobbyRoutes } from './lobby-routes.js';

export async function registerHostRoutes(app: FastifyInstance, db: Database.Database, lobby: LobbyService) {
  await app.register(async host => {
    const attempts = new Map<string, { count: number; until: number }>();
    let globalAttempts = { count: 0, until: 0 };
    host.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const origin = request.headers.origin;
      const sameOrigin = origin === `http://${request.headers.host}`;
      if ((origin && !sameOrigin) || request.headers['sec-fetch-site'] === 'cross-site' || (request.method !== 'GET' && !sameOrigin)) {
        return reply.code(403).send({ error: 'Use this app from its own local address.' });
      }
      const path = request.url.split('?')[0];
      if (path !== '/api/host/auth' && path !== '/api/host/login' && !authenticated(db, request.headers.cookie)) {
        return reply.code(401).send({ error: 'Host sign-in required.' });
      }
    });
    host.get('/auth', request => ({ configured: configured(db), authenticated: authenticated(db, request.headers.cookie) }));
    host.post('/login', async (request, reply) => {
      const now = Date.now();
      for (const [ip, value] of attempts) if (value.until <= now) attempts.delete(ip);
      if (globalAttempts.until <= now) globalAttempts = { count: 0, until: now + 15 * 60_000 };
      const entry = attempts.get(request.ip) ?? { count: 0, until: now + 15 * 60_000 };
      if (entry.count >= 8 || globalAttempts.count >= 200) return reply.code(429).header('Retry-After', '900').send({ error: 'Too many sign-in attempts. Wait 15 minutes.' });
      entry.count++; globalAttempts.count++; attempts.set(request.ip, entry);
      const parsed = LoginSchema.safeParse(request.body);
      if (!parsed.success || !await verifyPassword(db, parsed.data.password)) return reply.code(401).send({ error: 'Password not accepted.' });
      const token = randomBytes(32).toString('hex');
      db.prepare('DELETE FROM host_sessions WHERE expires_at <= ?').run(now);
      db.prepare('INSERT INTO host_sessions (token_hash, expires_at) VALUES (?, ?)').run(hashToken(token), Date.now() + SESSION_MS);
      return reply.header('Set-Cookie', [sessionCookie(token), sessionCookie('', 0).replace('Path=/', 'Path=/api/host')]).send({ authenticated: true });
    });
    host.post('/logout', (request, reply) => {
      if (!EmptyBodySchema.safeParse(request.body ?? {}).success) return reply.code(400).send({ error: 'Logout does not accept any fields.' });
      const token = cookieToken(request.headers.cookie);
      if (token) db.prepare('DELETE FROM host_sessions WHERE token_hash = ?').run(hashToken(token));
      return reply.header('Set-Cookie', [sessionCookie('', 0), sessionCookie('', 0).replace('Path=/', 'Path=/api/host')]).send({ authenticated: false });
    });
    host.get('/quizzes', () => listQuizzes(db));
    registerHostLobbyRoutes(host, lobby, db);
    host.post('/quizzes', (request, reply) => {
      const draft = QuizDraftSchema.safeParse(request.body);
      if (!draft.success) return reply.code(400).send({ error: 'Invalid quiz.', issues: draft.error.issues });
      return reply.code(201).send(createQuiz(db, draft.data));
    });
    host.post('/quizzes/import', { bodyLimit: MAX_IMPORT_BYTES }, (request, reply) => {
      const file = QuizFileSchema.safeParse(request.body);
      if (!file.success) return reply.code(400).send({ error: 'Invalid quiz JSON. Use version 2 with a quiz-wide time limit.', issues: file.error.issues });
      return reply.code(201).send(createQuiz(db, file.data.quiz));
    });
    host.get<{ Params: { id: string } }>('/quizzes/:id', (request, reply) => {
      const quiz = getQuiz(db, request.params.id);
      return quiz ?? reply.code(404).send({ error: 'Quiz not found.' });
    });
    host.put<{ Params: { id: string } }>('/quizzes/:id', (request, reply) => {
      const parsed = QuizUpdateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid quiz.', issues: parsed.error.issues });
      const { expectedUpdatedAt, ...draft } = parsed.data;
      const result = updateQuiz(db, request.params.id, draft, expectedUpdatedAt);
      if (result === 'missing') return reply.code(404).send({ error: 'Quiz not found.' });
      if (result === 'conflict') return reply.code(409).send({ error: 'This quiz changed in another tab. Copy unsaved text, then reload.' });
      return result;
    });
    host.delete<{ Params: { id: string } }>('/quizzes/:id', (request, reply) => {
      if (!EmptyBodySchema.safeParse(request.body ?? {}).success) return reply.code(400).send({ error: 'Delete does not accept any fields.' });
      if (!lobby.deleteQuiz(request.params.id)) return reply.code(404).send({ error: 'Quiz not found.' });
      return reply.code(204).send();
    });
    host.post<{ Params: { id: string } }>('/quizzes/:id/duplicate', (request, reply) => {
      if (!EmptyBodySchema.safeParse(request.body ?? {}).success) return reply.code(400).send({ error: 'Duplicate does not accept any fields.' });
      const quiz = getQuiz(db, request.params.id);
      if (!quiz) return reply.code(404).send({ error: 'Quiz not found.' });
      return reply.code(201).send(createQuiz(db, { title: `${quiz.title.slice(0, 113)} (copy)`, description: quiz.description, durationSeconds: quiz.durationSeconds, questions: quiz.questions }));
    });
    host.get<{ Params: { id: string } }>('/quizzes/:id/export', (request, reply) => {
      const quiz = getQuiz(db, request.params.id);
      if (!quiz) return reply.code(404).send({ error: 'Quiz not found.' });
      return reply.header('Content-Disposition', `attachment; filename="localmenti-${quiz.id}.json"`).send({ version: 2, quiz: { title: quiz.title, description: quiz.description, durationSeconds: quiz.durationSeconds, questions: quiz.questions } });
    });
  }, { prefix: '/api/host' });
}

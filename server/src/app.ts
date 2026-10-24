import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { Server } from 'socket.io';
import { existsSync } from 'node:fs';
import { openDatabase } from './database.js';
import { EmptyBodySchema, MAX_IMPORT_BYTES, type ClientToServerEvents, type NetworkAddress, type ServerToClientEvents } from '@localmenti/shared';
import { registerHostRoutes } from './host-routes.js';
import { LobbyService } from './lobby.js';
import { lanAddresses } from './network.js';
import { registerPublicLobbyRoutes } from './lobby-routes.js';
import { WindowLimit } from './limits.js';

export async function createApp(options: { databasePath: string; clientPath: string; logger?: boolean; lanAddresses?: () => NetworkAddress[]; clock?: () => number }) {
  if (!existsSync(`${options.clientPath}/index.html`)) throw new Error('Client build missing. Run npm run build before starting.');
  const db = openDatabase(options.databasePath);
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: MAX_IMPORT_BYTES, onProtoPoisoning: 'error', onConstructorPoisoning: 'error' });
  const handshakeLimit = new WindowLimit(600, 2400);
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { sessionId?: string; participantId?: string }>(app.server, {
    maxHttpBufferSize: 16_384,
    // Namespace middleware also authenticates hosts and participant identities.
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, (!origin || origin === `http://${request.headers.host}`) && handshakeLimit.take(request.socket.remoteAddress ?? 'unknown'));
    }
  });
  const lobby = new LobbyService(db, io, options.lanAddresses ?? lanAddresses, () => {
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Listen on HTTP before creating a session.');
    return address.port;
  }, options.clock ?? Date.now);
  const clockLimit = new WindowLimit(120, 2400);
  io.on('connection', socket => {
    socket.emit('server:ready', { serverTime: (options.clock ?? Date.now)() });
    socket.on('clock:sync', (payload, ack) => {
      if (typeof ack !== 'function') return;
      if (!clockLimit.take(socket.handshake.address) || !EmptyBodySchema.safeParse(payload).success) { ack({ ok: false, code: 'INVALID_REQUEST', error: 'Invalid clock request or rate limit exceeded.' }); return; }
      ack({ ok: true, data: { serverTime: (options.clock ?? Date.now)() } });
    });
  });
  app.get('/health', () => { db.prepare('SELECT 1').get(); return { status: 'ok', version: '0.1.0' }; });
  await registerHostRoutes(app, db, lobby);
  await registerPublicLobbyRoutes(app, lobby);
  await app.register(staticFiles, { root: options.clientPath, index: false });
  // Serve the entry point explicitly: the static handler rejects directory
  // requests with 403 when automatic index serving is disabled.
  app.get('/', (_request, reply) => reply.type('text/html').header('Cache-Control', 'no-cache').sendFile('index.html'));
  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0];
    if (request.method === 'GET' && (pathname === '/' || pathname === '/join' || /^\/s\/[^/]+$/.test(pathname) || /^\/present\/[^/]+$/.test(pathname) || /^\/host(?:\/login|\/quizzes\/[^/]+|\/session\/[^/]+)?$/.test(pathname))) {
      return reply.type('text/html').header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found' });
  });
  app.addHook('preClose', async () => {
    lobby.close();
    for (const namespace of ['/', '/host', '/participant', '/present']) io.of(namespace).disconnectSockets(true);
    io.engine.close();
  });
  app.addHook('onClose', async () => { db.close(); });
  return { app, io };
}

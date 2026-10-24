import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Server, Socket } from 'socket.io';
import {
  AddressSchema, AnswerSchema, AVATAR_VARIANTS, RESERVED_AVATAR_INDEX, EmptyBodySchema, KickSchema, MAX_PARTICIPANTS, nicknameWithSuffix, ParticipantAuthSchema, PresenterAuthSchema, PreviewSchema, SessionCommandSchema, TransitionSchema,
  type ActionResult, type ClientToServerEvents, type HostLobby, type NetworkAddress,
  type ParticipantLobby, type PublicLobby, type RankEntry, type ServerToClientEvents, type SessionState
} from '@localmenti/shared';
import { authenticated, hashToken } from './auth.js';
import { getQuiz } from './quizzes.js';
import { WindowLimit } from './limits.js';
import { QuizEngine } from './quiz-engine.js';
import { LobbyError } from './errors.js';
import { rankings } from './results.js';
import { resolveJoinName } from './reserved-identity.js';
import { privateCodeHash } from './settings.js';

// One device may hold a few identities (a rejoin after clearing the browser),
// not an army of alts answering every option. Override with MAX_PLAYERS_PER_DEVICE.
export function playersPerDevice(value = process.env.MAX_PLAYERS_PER_DEVICE) {
  const parsed = Number(value ?? 2);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_PARTICIPANTS ? parsed : 2;
}
const plainIp = (ip: string) => ip.replace(/^::ffff:/, '');
export { LobbyError } from './errors.js';

type SocketData = { sessionId?: string; participantId?: string };
export type LobbyIO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type LobbySocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type SessionRow = { id: string; six_digit_pin: string; state: SessionState; quiz_title: string; lan_address: string; port: number; revision: number; preview_seconds: number; standings_revision: number; event_name: string };
type ParticipantRow = { id: string; session_id: string; nickname: string; avatar_index: number; joined_at: number; last_seen_at: number; removed_at: number | null };
export class LobbyService {
  private presence = new Map<string, Set<string>>();
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  private closing = false;
  private commandLimit = new WindowLimit(120, 1200);
  private socketLimit = new WindowLimit(600, 2400);
  private sweep: ReturnType<typeof setInterval>;
  private engine: QuizEngine;
  private answerLimit = new WindowLimit(30, 6000);
  private answerIpLimit = new WindowLimit(1200, 6000);

  constructor(private db: Database.Database, private io: LobbyIO, public addresses: () => NetworkAddress[], private port: () => number, private now: () => number = Date.now) {
    this.engine = new QuizEngine(db, now, id => this.schedule(id));
    const host = io.of('/host');
    host.use((socket, next) => {
      const { origin, host: hostname } = socket.handshake.headers;
      const ownOrigin = origin ? origin === `http://${hostname}` : socket.handshake.headers['sec-fetch-site'] === 'same-origin';
      if (!ownOrigin) return next(new Error('Host connection must come from this app’s local address.'));
      if (!authenticated(db, socket.handshake.headers.cookie)) return next(new Error('Host sign-in required.'));
      if (!EmptyBodySchema.safeParse(socket.handshake.auth).success) return next(new Error('Invalid host authentication payload.'));
      next();
    });
    host.on('connection', socket => {
      socket.on('host:watch', (payload, ack) => this.control(socket, ack, () => {
        const { sessionId } = SessionCommandSchema.parse(payload);
        const lobby = this.hostLobby(sessionId);
        if (socket.data.sessionId) void socket.leave(socket.data.sessionId);
        socket.data.sessionId = sessionId; void socket.join(sessionId);
        return lobby;
      }));
      socket.on('host:end', (payload, ack) => this.control(socket, ack, () => this.end(SessionCommandSchema.parse(payload).sessionId)));
      socket.on('host:transition', (payload, ack) => this.control(socket, ack, () => {
        const command = TransitionSchema.parse(payload); this.engine.transition(command); return this.hostLobby(command.sessionId);
      }));
      socket.on('host:kick', (payload, ack) => this.control(socket, ack, () => {
        const data = KickSchema.parse(payload); return this.kick(data.sessionId, data.participantId);
      }));
      socket.on('host:address', (payload, ack) => this.control(socket, ack, () => {
        const data = AddressSchema.parse(payload); return this.changeAddress(data.sessionId, data.lanAddress);
      }));
      socket.on('host:preview', (payload, ack) => this.control(socket, ack, () => {
        const data = PreviewSchema.parse(payload); const row = this.session(data.sessionId);
        if (row.state !== 'LOBBY') throw new LobbyError('Set preview length before starting the quiz.', 409);
        db.prepare('UPDATE sessions SET preview_seconds = ? WHERE id = ?').run(data.previewSeconds, data.sessionId);
        this.schedule(data.sessionId); return this.hostLobby(data.sessionId);
      }));
    });
    const participant = io.of('/participant');
    participant.use((socket, next) => {
      if (!this.socketLimit.take(socket.handshake.address)) return next(new Error('Too many reconnect attempts. Wait a minute.'));
      const auth = ParticipantAuthSchema.safeParse(socket.handshake.auth);
      if (!auth.success) return next(new Error('Participant identity is missing. Join the session first.'));
      const row = db.prepare(`SELECT p.* FROM participants p JOIN sessions s ON s.id = p.session_id WHERE s.six_digit_pin = ? AND p.reconnect_token_hash = ?`).get(auth.data.pin, hashToken(auth.data.token)) as ParticipantRow | undefined;
      if (!row || row.removed_at !== null) return next(new Error('Participant identity is invalid or was removed.'));
      socket.data.sessionId = row.session_id; socket.data.participantId = row.id; next();
    });
    participant.on('connection', socket => {
      const id = socket.data.participantId!; const sessionId = socket.data.sessionId!;
      const row = this.participant(id);
      // Recheck after asynchronous namespace middleware: the host may have kicked it.
      if (!row || row.removed_at !== null) { socket.emit('participant:removed'); socket.disconnect(); return; }
      const sockets = this.presence.get(id) ?? new Set<string>(); sockets.add(socket.id); this.presence.set(id, sockets);
      db.prepare('UPDATE participants SET last_seen_at = ? WHERE id = ?').run(Date.now(), id);
      void socket.join(sessionId);
      const ready = this.participantState(sessionId, id);
      socket.emit('participant:ready', ready); this.schedule(sessionId);
      socket.on('answer:submit', (payload, ack) => {
        // Capture receipt before validation, throttling or any asynchronous work.
        const receivedAt = this.now();
        if (typeof ack !== 'function') return;
        if (!this.answerLimit.take(id) || !this.answerIpLimit.take(socket.handshake.address)) { ack({ ok: false, error: 'Too many answer attempts. Wait a minute.', code: 'RATE_LIMITED' }); return; }
        const parsed = AnswerSchema.safeParse(payload);
        if (!parsed.success) { ack({ ok: false, error: 'Send only a valid questionId and optionId.', code: 'INVALID_REQUEST' }); return; }
        try { ack({ ok: true, data: this.engine.submit(sessionId, id, parsed.data.questionId, parsed.data.optionId, receivedAt) }); }
        catch (error) { ack({ ok: false, error: error instanceof LobbyError ? error.message : 'Answer could not be accepted.', code: error instanceof LobbyError ? error.code : 'INVALID_REQUEST' }); }
      });
      socket.on('disconnect', reason => {
        const current = this.presence.get(id); current?.delete(socket.id);
        if (current?.size === 0) this.presence.delete(id);
        db.prepare('UPDATE participants SET last_seen_at = ? WHERE id = ?').run(Date.now(), id);
        if (!this.presence.has(id)) db.prepare('UPDATE participants SET last_disconnect_at = ?, last_disconnect_reason = ? WHERE id = ?').run(Date.now(), this.closing ? 'server_shutdown' : reason, id);
        this.schedule(sessionId);
      });
    });
    const present = io.of('/present');
    present.use((socket, next) => {
      if (!this.socketLimit.take(socket.handshake.address)) return next(new Error('Too many connection attempts. Wait a minute.'));
      const auth = PresenterAuthSchema.safeParse(socket.handshake.auth);
      if (!auth.success) return next(new Error('Send only a six-digit session PIN.'));
      const row = this.byPin(auth.data.pin);
      if (!row) return next(new Error('Session not found.'));
      socket.data.sessionId = row.id; next();
    });
    present.on('connection', socket => {
      void socket.join(socket.data.sessionId!); socket.emit('lobby:update', this.publicLobby(socket.data.sessionId!));
    });
    // Quiet authenticated sockets are also retired after expiry/logout/reset.
    this.sweep = setInterval(() => {
      for (const socket of host.sockets.values()) if (!authenticated(db, socket.handshake.headers.cookie)) { socket.emit('host:unauthorized'); socket.disconnect(); }
    }, 10_000);
    this.sweep.unref();
  }
  private control<T>(socket: LobbySocket, ack: ((result: ActionResult<T>) => void) | undefined, action: () => T) {
    if (typeof ack !== 'function') return;
    if (!authenticated(this.db, socket.handshake.headers.cookie)) {
      ack({ ok: false, error: 'Host sign-in required.', code: 'UNAUTHORIZED' }); socket.emit('host:unauthorized'); socket.disconnect(); return;
    }
    if (!this.commandLimit.take(socket.handshake.address)) { ack({ ok: false, error: 'Too many host commands. Wait a minute.', code: 'RATE_LIMITED' }); return; }
    try { ack({ ok: true, data: action() }); }
    catch (error) { ack({ ok: false, error: error instanceof LobbyError ? error.message : 'Invalid host command.', code: error instanceof LobbyError ? error.code : 'INVALID_REQUEST' }); }
  }
  private session(id: string) {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
    if (!row) throw new LobbyError('Session not found.', 404, 'NOT_FOUND'); return row;
  }
  private participant(id: string) { return this.db.prepare('SELECT * FROM participants WHERE id = ?').get(id) as ParticipantRow | undefined; }
  byPin(pin: string) { return this.db.prepare('SELECT * FROM sessions WHERE six_digit_pin = ?').get(pin) as SessionRow | undefined; }
  active() {
    const row = this.db.prepare("SELECT id, EXISTS(SELECT 1 FROM quizzes q WHERE q.id = sessions.quiz_id) AS quiz_exists FROM sessions WHERE state <> 'FINISHED'").get() as { id: string; quiz_exists: number } | undefined;
    // Repair rooms left behind by older versions that deleted authoring data only.
    if (row && !row.quiz_exists) { this.engine.end(row.id); return null; }
    return row ? this.hostLobby(row.id) : null;
  }
  deleteQuiz(quizId: string) {
    return this.db.transaction(() => {
      if (!this.db.prepare('SELECT id FROM quizzes WHERE id = ?').get(quizId)) return false;
      const active = this.db.prepare("SELECT id FROM sessions WHERE quiz_id = ? AND state <> 'FINISHED'").get(quizId) as { id: string } | undefined;
      // Preserve immutable submissions and session snapshots, but release the room.
      if (active) this.engine.end(active.id);
      this.db.prepare('DELETE FROM quizzes WHERE id = ?').run(quizId);
      return true;
    })();
  }
  publicLobby(id: string): PublicLobby {
    const row = this.session(id);
    const question = this.engine.current(id);
    const participants = this.db.prepare('SELECT id, nickname, avatar_index FROM participants WHERE session_id = ? AND removed_at IS NULL ORDER BY joined_at, id').all(id) as { id: string; nickname: string; avatar_index: number }[];
    const ranked = row.state === 'LEADERBOARD' || row.state === 'FINISHED' ? rankings(this.db, id) : [];
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM session_questions WHERE session_id = ?').get(id) as { count: number };
    return { id, pin: row.six_digit_pin, state: row.state, title: row.quiz_title, questionCount: count.count,
      joinedCount: participants.length, connectedCount: participants.filter(value => this.presence.has(value.id)).length,
      joinUrl: `http://${row.lan_address}:${this.port()}/s/${row.six_digit_pin}`, lanAddress: row.lan_address,
      revision: row.revision, serverTime: this.now(), question, answeredCount: this.engine.answered(id, question?.id).size,
      players: row.state === 'LOBBY' ? participants.map(player => ({ id: player.id, nickname: player.nickname, avatarIndex: player.avatar_index, connected: this.presence.has(player.id) })) : [],
      // Full ranking for the projector's paged leaderboard; phones get it stripped below.
      leaderboard: ranked, podium: row.state === 'FINISHED' ? ranked.slice(0, 3) : [], previewSeconds: row.preview_seconds, standingsRevision: row.standings_revision, eventName: row.event_name };
  }
  hostLobby(id: string): HostLobby {
    const lobby = this.publicLobby(id);
    const rows = this.db.prepare('SELECT * FROM participants WHERE session_id = ? ORDER BY joined_at, id').all(id) as ParticipantRow[];
    const answered = this.engine.answered(id, lobby.question?.id);
    return { ...lobby, leaderboard:rankings(this.db,id), removedCount: rows.filter(row => row.removed_at !== null).length,
      participants: rows.filter(row => row.removed_at === null).map(row => ({ id: row.id, nickname: row.nickname, avatarIndex: row.avatar_index, joinedAt: row.joined_at, lastSeenAt: row.last_seen_at, connected: this.presence.has(row.id), answered: answered.has(row.id) })) };
  }
  participantState(sessionId: string, participantId: string, snapshot?: PublicLobby, rankMap?: Map<string, RankEntry>): ParticipantLobby {
    const session = snapshot ?? this.publicLobby(sessionId); const row = this.participant(participantId);
    if (!row || row.session_id !== sessionId || row.removed_at !== null) throw new LobbyError('Participant identity is no longer valid.', 401);
    const own = this.engine.privateState(sessionId, participantId, session.question);
    const ranked = rankMap ?? new Map(rankings(this.db, sessionId).map(entry => [entry.id, entry]));
    const personalSession: PublicLobby = { ...session,players:[],leaderboard:[],podium:[],
      question:session.question ? { ...session.question,reveal:session.question.reveal ? { ...session.question.reveal,counts:[],totalAnswers:0 } : null } : null };
    return { session:personalSession, participant: { id: participantId, nickname: row.nickname, avatarIndex: row.avatar_index, score: own.score, rank: ranked.get(participantId)?.rank ?? null, previousScore: ranked.get(participantId)?.previousScore ?? 0, previousRank: ranked.get(participantId)?.previousRank ?? null }, submission: own.submission, history: own.history };
  }
  private checkAddress(address: string) {
    if (!this.addresses().some(value => value.address === address)) throw new LobbyError('Choose a current IPv4 address from this laptop’s network adapters.');
  }
  create(quizId: string, address: string, previewSeconds = 3, eventName = '') {
    this.checkAddress(address);
    const result = this.db.transaction(() => {
      if (this.active()) throw new LobbyError('End the current session before opening another.', 409, 'ACTIVE_SESSION');
      const quiz = getQuiz(this.db, quizId);
      if (!quiz) throw new LobbyError('Quiz not found.', 404, 'NOT_FOUND');
      if (quiz.questions.length === 0) throw new LobbyError('Add at least one saved question before opening a lobby.');
      let pin = '';
      for (let tries = 0; tries < 32; tries++) { const candidate = String(randomInt(100000, 1000000)); if (!this.byPin(candidate)) { pin = candidate; break; } }
      if (!pin) throw new LobbyError('Unable to allocate a PIN. Try again.', 503, 'PIN_UNAVAILABLE');
      const id = randomUUID();
      this.db.prepare("INSERT INTO sessions (id, quiz_id, six_digit_pin, state, created_at, quiz_title, lan_address, port, preview_seconds, event_name) VALUES (?, ?, ?, 'LOBBY', ?, ?, ?, ?, ?, ?)").run(id, quizId, pin, Date.now(), quiz.title, address, this.port(), previewSeconds, eventName);
      const insert = this.db.prepare('INSERT INTO session_questions (id, session_id, order_index, type, text, options_json, correct_option_id, duration_seconds, base_points, explanation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      quiz.questions.forEach((question, index) => insert.run(randomUUID(), id, index, question.type, question.text, JSON.stringify(question.options), question.correctOptionId, quiz.durationSeconds, question.basePoints, question.explanation));
      return this.hostLobby(id);
    })();
    return result;
  }
  join(pin: string, nickname: string, ip = '127.0.0.1') {
    const result = this.db.transaction(() => {
      const row = this.byPin(pin);
      if (!row || row.state !== 'LOBBY') throw new LobbyError('This lobby is not open for joining.', 404, 'LOBBY_CLOSED');
      // Kicked identities free their place in the room.
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM participants WHERE session_id = ? AND removed_at IS NULL').get(row.id) as { count: number };
      if (count.count >= MAX_PARTICIPANTS) throw new LobbyError('This session has reached its participant identity limit.', 409, 'SESSION_FULL');
      // The host laptop itself is trusted (local testing); every other device is capped.
      // Kicked identities still count, so a removed device cannot keep rejoining.
      const address = plainIp(ip);
      const device = hashToken(`device:${address}`);
      const trusted = address === '127.0.0.1' || address === '::1' || this.addresses().some(value => value.address === address);
      const limit = playersPerDevice();
      const fromDevice = this.db.prepare('SELECT COUNT(*) AS count FROM participants WHERE session_id = ? AND join_device = ?').get(row.id, device) as { count: number };
      if (!trusted && fromDevice.count >= limit) throw new LobbyError(`This device already joined ${limit === 1 ? 'once' : `${limit} times`}. Resume your player in the browser that joined, or ask the host.`, 429, 'DEVICE_LIMIT');
      const used = this.db.prepare('SELECT 1 FROM participants WHERE session_id = ? AND nickname_key = ?');
      const identity = resolveJoinName(nickname, privateCodeHash(this.db));
      if (identity.reserved && used.get(row.id,'muzi')) throw new LobbyError('The reserved identity is already used in this session. Resume in the browser that joined it.',409,'RESERVED_ALREADY_JOINED');
      let display = identity.nickname; let suffix = 2;
      while (used.get(row.id, display.toLowerCase())) display = nicknameWithSuffix(identity.nickname, String(suffix++));
      const token = randomBytes(32).toString('hex'); const id = randomUUID(); const now = Date.now();
      const usedAvatars = new Set((this.db.prepare('SELECT avatar_index FROM participants WHERE session_id = ?').all(row.id) as { avatar_index:number }[]).map(participant => participant.avatar_index));
      const availableAvatars = Array.from({ length:AVATAR_VARIANTS },(_,index) => index).filter(index => !usedAvatars.has(index));
      if (!identity.reserved && availableAvatars.length === 0) throw new LobbyError('This session has reached its participant identity limit.', 409, 'SESSION_FULL');
      const avatarIndex = identity.reserved ? RESERVED_AVATAR_INDEX : availableAvatars[randomInt(availableAvatars.length)];
      this.db.prepare('INSERT INTO participants (id, session_id, nickname, nickname_key, reconnect_token_hash, joined_at, last_seen_at, avatar_index, join_device) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, row.id, display, display.toLowerCase(), hashToken(token), now, now, avatarIndex, device);
      return { token, pin, participant: { id, nickname: display, avatarIndex }, sessionId: row.id };
    })();
    this.schedule(result.sessionId);
    return { token: result.token, pin: result.pin, participant: result.participant };
  }
  end(id: string) {
    this.engine.end(id); return this.publicLobby(id);
  }
  kick(sessionId: string, participantId: string) {
    this.session(sessionId);
    const row = this.participant(participantId);
    if (!row || row.session_id !== sessionId) throw new LobbyError('Participant not found in this session.', 404, 'NOT_FOUND');
    this.db.prepare('UPDATE participants SET removed_at = COALESCE(removed_at, ?) WHERE id = ?').run(Date.now(), participantId);
    for (const socketId of this.presence.get(participantId) ?? []) {
      const socket = this.io.of('/participant').sockets.get(socketId); socket?.emit('participant:removed'); socket?.disconnect();
    }
    this.presence.delete(participantId); this.schedule(sessionId); return this.hostLobby(sessionId);
  }
  changeAddress(sessionId: string, address: string) {
    const row = this.session(sessionId);
    if (row.state !== 'LOBBY') throw new LobbyError('Only an open lobby can change its join address.', 409);
    this.checkAddress(address); this.db.prepare('UPDATE sessions SET lan_address = ? WHERE id = ?').run(address, sessionId);
    this.schedule(sessionId); return this.hostLobby(sessionId);
  }
  private schedule(id: string) {
    if (this.closing || this.pending.has(id)) return;
    this.pending.set(id, setTimeout(() => {
      this.pending.delete(id);
      if (!this.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id)) return;
      const lobby = this.publicLobby(id);
      // Private receipts/scores go only to sockets for that authenticated identity.
      const participant = this.io.of('/participant');
      const snapshots = new Map<string, ParticipantLobby>();
      const ranked = new Map(rankings(this.db, id).map(entry => [entry.id, entry]));
      for (const socketId of participant.adapter.rooms.get(id) ?? []) {
        const socket = participant.sockets.get(socketId); const participantId = socket?.data.participantId;
        if (!socket || !participantId) continue;
        let snapshot = snapshots.get(participantId);
        if (!snapshot) { snapshot = this.participantState(id, participantId, lobby, ranked); snapshots.set(participantId, snapshot); }
        socket.emit('participant:state', snapshot);
      }
      this.io.of('/present').to(id).emit('lobby:update', lobby);
      const host = this.io.of('/host');
      let hostSnapshot: HostLobby | undefined;
      for (const socketId of host.adapter.rooms.get(id) ?? []) {
        const socket = host.sockets.get(socketId);
        if (!socket) continue;
        if (!authenticated(this.db, socket.handshake.headers.cookie)) { socket.emit('host:unauthorized'); socket.disconnect(); }
        else { hostSnapshot ??= this.hostLobby(id); socket.emit('host:lobby', hostSnapshot); }
      }
    }, 75));
  }
  close() {
    this.closing = true; this.engine.close(); clearInterval(this.sweep);
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }
}

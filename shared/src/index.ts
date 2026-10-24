import { z } from 'zod';
export const HealthSchema = z.object({ status: z.literal('ok'), version: z.string() });
export const ConnectionSchema = z.object({ serverTime: z.number().int().nonnegative() });
export type Health = z.infer<typeof HealthSchema>;
export interface ServerToClientEvents {
  'server:ready': (payload: z.infer<typeof ConnectionSchema>) => void;
  'lobby:update': (payload: PublicLobby) => void;
  'host:lobby': (payload: HostLobby) => void;
  'participant:ready': (payload: ParticipantLobby) => void;
  'participant:state': (payload: ParticipantLobby) => void;
  'participant:removed': () => void;
  'host:unauthorized': () => void;
}

export const MAX_IMPORT_BYTES = 512 * 1024;
const OptionSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  text: z.string().trim().min(1).max(300)
});
export const QuestionSchema = z.strictObject({
  type: z.enum(['quiz_mcq', 'poll_mcq']),
  text: z.string().trim().min(1).max(2000),
  options: z.array(OptionSchema).min(2).max(6),
  correctOptionId: z.string().nullable(),
  basePoints: z.number().int().min(0).max(10000).default(1000),
  explanation: z.string().trim().max(2000).default('')
}).superRefine((question, context) => {
  if (new Set(question.options.map(option => option.id)).size !== question.options.length) {
    context.addIssue({ code: 'custom', path: ['options'], message: 'Option IDs must be unique.' });
  }
  if (question.type === 'quiz_mcq' && !question.options.some(option => option.id === question.correctOptionId)) {
    context.addIssue({ code: 'custom', path: ['correctOptionId'], message: 'Choose one of the answer options as correct.' });
  }
  if (question.type === 'quiz_mcq' && question.basePoints < 1) context.addIssue({ code: 'custom', path: ['basePoints'], message: 'Scored questions need 1–10,000 maximum points.' });
  if (question.type === 'poll_mcq' && (question.correctOptionId !== null || question.basePoints !== 0)) {
    context.addIssue({ code: 'custom', message: 'Polls must have no correct option and zero points.' });
  }
});
/** Shortest allowed answer window for a quiz, in seconds. */
export const MIN_ANSWER_SECONDS = 5;
export const QuizDraftSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  durationSeconds: z.number().int().min(MIN_ANSWER_SECONDS).max(120).default(20),
  description: z.string().trim().max(2000).default(''),
  questions: z.array(QuestionSchema).max(100)
}).superRefine((quiz, context) => {
  const content = { title: quiz.title, description: quiz.description, durationSeconds: quiz.durationSeconds, questions: quiz.questions };
  if (new TextEncoder().encode(JSON.stringify({ version: 2, quiz: content })).byteLength > MAX_IMPORT_BYTES) {
    context.addIssue({ code: 'custom', message: 'Quiz must fit in a 512 KiB JSON export. Shorten the quiz text.' });
  }
});
export const QuizUpdateSchema = QuizDraftSchema.safeExtend({ expectedUpdatedAt: z.number().int().nonnegative() });
export const QuizFileV2Schema = z.strictObject({ version: z.literal(2), quiz: QuizDraftSchema.safeExtend({ durationSeconds: z.number().int().min(MIN_ANSWER_SECONDS).max(120) }) });
export const QuizFileSchema = QuizFileV2Schema;
export const LoginSchema = z.strictObject({ password: z.string().min(12).max(128) });
export type Question = z.infer<typeof QuestionSchema>;
export type QuizDraft = z.infer<typeof QuizDraftSchema>;
export type Quiz = QuizDraft & { id: string; createdAt: number; updatedAt: number };
export type QuizSummary = Omit<Quiz, 'questions'> & { questionCount: number };

export const MAX_PARTICIPANTS = 200;
export const PinSchema = z.string().regex(/^\d{6}$/);
/** Shown when a name mixes look-alike alphabets, e.g. a Cyrillic М inside "MUZI". */
export const MIXED_ALPHABET_ERROR = 'Use letters from one alphabet only. Mixed alphabets can imitate other names.';
const LOOKALIKE_SCRIPTS = [/\p{Script=Latin}/u, /\p{Script=Greek}/u, /\p{Script=Cyrillic}/u];
export const mixesAlphabets = (value: string) => LOOKALIKE_SCRIPTS.filter(script => script.test(value)).length > 1;
export const NicknameSchema = z.string().min(1).max(24).regex(/^[\p{L}\p{N}]+$/u, 'Use letters and numbers only; no spaces or symbols.')
  .transform(value => value.normalize('NFKC')).pipe(z.string().min(1).max(24).regex(/^[\p{L}\p{N}]+$/u).refine(value => !mixesAlphabets(value), MIXED_ALPHABET_ERROR));
export function nicknameWithSuffix(base: string, suffix = '') {
  const characters = Array.from(base);
  while (characters.join('').length + suffix.length > 24) characters.pop();
  return characters.join('') + suffix;
}
// The browser can recognize invite-code syntax, but only the server verifies it.
/** Private creator code: letters/numbers, an underscore, then 4–16 letters/numbers (e.g. NAME_1234). */
export const PrivateCodeSchema = z.string().min(6).max(24).regex(/^[A-Za-z0-9]{1,16}_[A-Za-z0-9]{4,16}$/, 'Use letters or numbers, one underscore, then 4–16 letters or numbers, e.g. NAME_1234.');
export const NicknameInputSchema = z.union([NicknameSchema,PrivateCodeSchema]);
export const PrivateCodeBodySchema = z.strictObject({ code: PrivateCodeSchema });
export const JoinSchema = z.strictObject({ pin: PinSchema, nickname: NicknameInputSchema });
export const ParticipantAuthSchema = z.strictObject({ pin: PinSchema, token: z.string().regex(/^[a-f0-9]{64}$/) });
/** Optional event name shown on the waiting screens and result cards. No control or bidi characters. */
export const EventNameSchema = z.string().trim().max(80).regex(/^[^\p{Cc}\p{Cf}]*$/u, 'Use plain text for the event name.');
export const SessionCreateSchema = z.strictObject({ quizId: z.string().uuid(), lanAddress: z.string().ipv4(), previewSeconds: z.number().int().min(3).max(5).default(3), eventName: EventNameSchema.default('') });
export const SessionCommandSchema = z.strictObject({ sessionId: z.string().uuid() });
export const KickSchema = SessionCommandSchema.extend({ participantId: z.string().uuid() });
export const AddressSchema = SessionCommandSchema.extend({ lanAddress: z.string().ipv4() });
export const PreviewSchema = SessionCommandSchema.extend({ previewSeconds: z.number().int().min(3).max(5) });
export const EmptyBodySchema = z.strictObject({});
export const PresenterAuthSchema = z.strictObject({ pin: PinSchema });
export const TransitionSchema = SessionCommandSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  action: z.enum(['start', 'close', 'reveal', 'between', 'next'])
});
export const AnswerSchema = z.strictObject({ questionId: z.string().uuid(), optionId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/) });
export type SessionState = 'LOBBY' | 'QUESTION_OPEN' | 'QUESTION_REVEAL' | 'LEADERBOARD' | 'FINISHED';
export type LiveQuestion = {
  id: string; index: number; type: 'quiz_mcq' | 'poll_mcq'; text: string; options: { id: string; text: string }[];
  durationSeconds: number; basePoints: number; startedAt: number; endsAt: number; closed: boolean;
  previewStartedAt: number; phase: 'PREVIEW' | 'ANSWERING' | 'CLOSED';
  reveal: null | { correctOptionId: string | null; explanation: string; counts: { optionId: string; count: number }[]; totalAnswers: number };
};
export type SubmissionReceipt = {
  questionId: string; optionId: string; receivedAt: number; responseMs: number;
  awardedPoints?: number; correct?: boolean;
};
export type NetworkAddress = { address: string; label: string };
export type PublicLobby = {
  id: string; pin: string; state: SessionState; title: string; questionCount: number;
  joinedCount: number; connectedCount: number; joinUrl: string; lanAddress: string;
  revision: number; serverTime: number; question: LiveQuestion | null; answeredCount: number;
  players: LobbyPlayer[]; leaderboard: RankEntry[]; podium: RankEntry[];
  previewSeconds: number; standingsRevision: number; eventName: string;
};
export type LobbyPlayer = { id: string; nickname: string; avatarIndex: number; connected: boolean };
export type RankEntry = { id: string; nickname: string; avatarIndex: number; rank: number; score: number; correctAnswers: number; responseMs: number; fastestResponseMs?: number; previousScore?: number; previousPosition?: number; previousRank?: number | null };
export type LobbyParticipant = LobbyPlayer & { joinedAt: number; lastSeenAt: number; answered: boolean };
export type HostLobby = PublicLobby & { participants: LobbyParticipant[]; removedCount: number };
export type ScoreHistoryEntry = { questionIndex: number; points: number; total: number; responseMs: number | null; answered: boolean };
export type ParticipantLobby = { session: PublicLobby; participant: { id: string; nickname: string; avatarIndex: number; score: number; rank: number | null; previousScore?: number; previousRank?: number | null }; submission: SubmissionReceipt | null; history: ScoreHistoryEntry[] };
export const AVATAR_ICONS = ['🦊','🐼','🐸','🐯','🐧','🐨','🦁','🐰','🐙','🦋','🐢','🐝','🦉','🐳','🦕','🐿️','🐬','🦜','🦩','🐵','🐹','🦦','🦔','🐺'] as const;
// Jewel tones for round avatar tokens; each keeps white-ish emoji readable on light and dark screens.
export const AVATAR_COLORS = ['#5b45b0','#2f6fc0','#14877b','#2e8b57','#b86a35','#b9466e','#8a3f96','#33799c','#a07d22','#6c5a95'] as const;
export const EXTRA_AVATAR_ICONS = ['🍩','🐱','👽','🦄','🎩'] as const;
export const AVATAR_VARIANTS = (AVATAR_ICONS.length + EXTRA_AVATAR_ICONS.length) * AVATAR_COLORS.length;
export const RESERVED_AVATAR_INDEX = 10000;
export function avatarFor(index: number) {
  const safe = Math.max(0, Math.floor(Number.isFinite(index) ? index : 0));
  if (safe === RESERVED_AVATAR_INDEX) return { icon:'☠️',color:'#1d1429' };
  const originalVariants = AVATAR_ICONS.length * AVATAR_COLORS.length;
  if (safe >= originalVariants) {
    const extra = safe - originalVariants;
    return { icon:EXTRA_AVATAR_ICONS[extra % EXTRA_AVATAR_ICONS.length],color:AVATAR_COLORS[Math.floor(extra / EXTRA_AVATAR_ICONS.length) % AVATAR_COLORS.length] };
  }
  return { icon: AVATAR_ICONS[safe % AVATAR_ICONS.length], color: AVATAR_COLORS[Math.floor(safe / AVATAR_ICONS.length) % AVATAR_COLORS.length] };
}
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; code: string };
export interface ClientToServerEvents {
  'clock:sync': (payload: z.infer<typeof EmptyBodySchema>, ack: (result: ActionResult<{ serverTime: number }>) => void) => void;
  'answer:submit': (payload: z.infer<typeof AnswerSchema>, ack: (result: ActionResult<SubmissionReceipt>) => void) => void;
  'host:transition': (payload: z.infer<typeof TransitionSchema>, ack: (result: ActionResult<HostLobby>) => void) => void;
  'host:watch': (payload: z.infer<typeof SessionCommandSchema>, ack: (result: ActionResult<HostLobby>) => void) => void;
  'host:end': (payload: z.infer<typeof SessionCommandSchema>, ack: (result: ActionResult<PublicLobby>) => void) => void;
  'host:kick': (payload: z.infer<typeof KickSchema>, ack: (result: ActionResult<HostLobby>) => void) => void;
  'host:address': (payload: z.infer<typeof AddressSchema>, ack: (result: ActionResult<HostLobby>) => void) => void;
  'host:preview': (payload: z.infer<typeof PreviewSchema>, ack: (result: ActionResult<HostLobby>) => void) => void;
}

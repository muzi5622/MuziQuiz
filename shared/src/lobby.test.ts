import { describe, expect, it } from 'vitest';
import { JoinSchema, NicknameSchema, nicknameWithSuffix, ParticipantAuthSchema, SessionCreateSchema } from './index.js';
describe('lobby contracts', () => {
  it('normalizes display names and rejects empty/oversized names', () => {
    expect(NicknameSchema.parse('Ａlex')).toBe('Alex');
    for (const invalid of ['A\u202elex', 'Ali Khan', 'Alex!', 'Alex_', 'Alex-1', 'a@b', '<script>', 'ⓐ', '  Alex  ']) expect(NicknameSchema.safeParse(invalid).success).toBe(false);
    expect(NicknameSchema.parse('علی')).toBe('علی');
    expect(NicknameSchema.parse('Alex123')).toBe('Alex123');
    expect(NicknameSchema.safeParse('💥').success).toBe(false);
    expect(NicknameSchema.safeParse('x'.repeat(25)).success).toBe(false);
    const suffixed = nicknameWithSuffix('𐐀'.repeat(12), '2');
    expect(NicknameSchema.safeParse(suffixed).success).toBe(true);
  });
  it('requires a strict PIN/token contract and numeric IPv4', () => {
    expect(JoinSchema.safeParse({ pin: '123456', nickname: 'Alex' }).success).toBe(true);
    expect(JoinSchema.safeParse({ pin: '12345', nickname: 'Alex' }).success).toBe(false);
    expect(JoinSchema.safeParse({ pin: '123456', nickname: 'Alex', score: 1000 }).success).toBe(false);
    expect(JoinSchema.safeParse({ pin: '123456', nickname: 'Alex', avatarIndex: 1 }).success).toBe(false);
    expect(ParticipantAuthSchema.safeParse({ pin: '123456', nickname: 'Alex' }).success).toBe(false);
    expect(SessionCreateSchema.safeParse({ quizId: 'fe193db8-1fcb-4cb3-bc05-d99f29adbe01', lanAddress: 'http://evil.test' }).success).toBe(false);
  });
});

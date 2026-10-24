import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { NicknameSchema } from '@localmenti/shared';
import { LobbyError } from './errors.js';

// "MUZl", "MUZ1" and full-width forms read as the reserved name too.
const looksReserved = (name:string) => name.normalize('NFKC').toLowerCase().replace(/[l1|ı]/g,'i') === 'muzi';

export function resolveJoinName(input:string, expected = process.env.RESERVED_JOIN_CODE_HASH ?? ''): { nickname:string;reserved:boolean } {
  if (input.includes('_')) {
    const received = createHash('sha256').update(input).digest();
    if (!/^[a-f0-9]{64}$/.test(expected) || !timingSafeEqual(received,Buffer.from(expected,'hex'))) throw new LobbyError('Private join code not accepted.',400,'INVALID_PRIVATE_CODE');
    return { nickname:'MUZI',reserved:true };
  }
  const result = NicknameSchema.safeParse(input);
  if (!result.success) throw new LobbyError('Use letters and numbers, or a valid private join code.',400,'INVALID_NICKNAME');
  return { nickname:looksReserved(result.data) ? `Player${randomInt(100000,100000000)}` : result.data,reserved:false };
}

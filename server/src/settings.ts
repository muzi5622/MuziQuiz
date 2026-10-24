// Built-in creator code for the reserved MUZI identity. Only its SHA-256 hash is in the source.
// RESERVED_JOIN_CODE_HASH in .env can override it; nothing about it is shown in the app.
const BUILT_IN_PRIVATE_CODE_HASH = 'b0a08af84212c221b0de58aad34b35e4face0b691783363e3fc764b3c4d50ab0';
const isHash = (value: string | undefined): value is string => Boolean(value && /^[a-f0-9]{64}$/.test(value));

/** The SHA-256 hash private join codes are checked against. */
export function privateCodeHash() {
  return isHash(process.env.RESERVED_JOIN_CODE_HASH) ? process.env.RESERVED_JOIN_CODE_HASH : BUILT_IN_PRIVATE_CODE_HASH;
}

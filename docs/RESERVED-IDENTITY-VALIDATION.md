# Reserved identity validation

Validated 2026-10-24. MUZI is reserved case-insensitively after Unicode normalization. Only a server-verified private code assigns its exclusive skull avatar and gold callout. Plain reserved-name entries receive generated Player names. Existing browser reconnect tokens restore the reserved identity; duplicate claims in one event are rejected. The identity grants no host permissions or scoring benefit.

- Typecheck and lint passed.
- All 134 tests in 18 files passed, including 200 simultaneous session identities with unique normalized names and avatar/color combinations, owner reuse across events, reconnect, private-code rate limiting, unauthorized host access, and legacy migration preserving points and tokens.
- Production build and offline asset audit passed.
- Health, routes, local assets, clock sync, Socket.IO and host authorization smoke checks passed on localhost, 192.168.1.4 and 192.168.56.1, port 3000.
- Browser production assets contain neither the private code nor its configured hash. Only the hash is stored in ignored local .env under RESERVED_JOIN_CODE_HASH.
- An online SQLite backup was created in data/backups before migration 9. Legacy unverified MUZI entries receive generated names; identities, answers and points remain intact.

The private code is bearer proof: anyone who knows it can claim the identity before its owner joins. Keep it private. The 200-identity test establishes collision handling, not capacity of 200 physical Wi-Fi devices. Physical screen rendering remains unverified.

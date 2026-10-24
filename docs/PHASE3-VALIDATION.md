# Phase 3 validation

Environment: Windows with Node v24.20.0 / npm 11.19.0. Added server-only `qrcode` and its development typings; installation reported 0 vulnerabilities. No browser/CDN dependency was added.

| Command | Result |
| --- | --- |
| `npm run typecheck` | All workspaces passed |
| `npm run lint` | Passed |
| `npm run build` | Passed |
| `npm test` | 6 files / 33 tests passed |
| `npm run smoke` | Passed: pages/assets/health, socket connection and host socket denial |
| `npm run smoke -- http://192.168.1.5:3000` | Passed from the same laptop on its LAN interface |

The production app was restarted on port 3000 after migration/build. Source audit found no remote font/CDN URLs, CSS imports or user-controlled HTML rendering in client sources. The host library/editor styling continues the original paper/ink/lime direction in responsive join, roster and projector layouts; no external visual reference was used.

## Automated coverage

Real HTTP listeners and Socket.IO clients exercise:

- One active session enforced by both API and SQLite; six-digit PIN and selected-adapter validation.
- A complete fixed question snapshot that survives deleting its source quiz.
- Secret-free public lobby/participant snapshots; locally generated PNG QR endpoint.
- Unicode nickname normalization, case-insensitive duplicate suffixes, SHA-256 reconnect-token storage.
- Two tabs counting as one participant, disconnect/reconnect identity restoration, host presence updates.
- Missing, forged and cross-origin host authentication rejected; root/participant/projector sockets cannot invoke host actions.
- Host authorization revoked between connection and command; matching-origin polling plus same-origin Fetch Metadata fallback.
- Strict command validation, address selection updates, removal of every tab, removed/forged/cross-session tokens rejected.
- An app restart with an active WebSocket closes cleanly, restores the session/identity, resets presence, and advertises the actual new listener port.
- Idempotent lobby end, projector update and new-join rejection after finish.
- Nickname/body/origin limits, 200-identity admission bound, and HTTP 429 after repeated invalid-PIN attempts.

The 200-identity test creates database identities through HTTP; it does **not** establish 200 concurrent socket or Wi-Fi capacity. The 50/100/200 connected load tests remain Phase 6.

## Physical acceptance gate — pending

On the actual event network, with WAN unplugged and the host's reviewed Private firewall rule:

1. Sign in, save a quiz, select the audience-facing adapter and open a lobby.
2. Open `/present/:pin`; scan the QR on at least three real phones.
3. Verify duplicate nickname suffixes, one count per identity, live host/projector counts, and individual waiting screens.
4. Refresh a phone; disable/re-enable Wi-Fi on another. Verify the same identities return.
5. Open a second tab for one identity; remove that participant and verify all its tabs lose reconnect access.
6. Restart the server and verify the persisted lobby and reconnect restoration.
7. End the session and verify new joins stop and the projector/participants show it ended.
8. Check mobile/desktop rendering, keyboard access, QR scanning and error/reconnect notices.

These physical phone/WAN/browser checks have not been executed here. Automated localhost sockets do not satisfy the several-phone gate. Prior execution review blocked browser screenshot launch; no bypass was attempted.

Only lobby creation, presence, reconnect, removal, address selection and end-lobby controls are implemented. Timed questions, answers, scoring, leaderboard, polls and results export remain later phases. Implementation stops before Phase 4.

# Phase 1 validation

Validated on Windows with Node v24.20.0 and npm 11.19.0.

| Check | Result |
| --- | --- |
| `npm install` | 238 packages installed; npm reported 0 vulnerabilities |
| `npm run typecheck` | Passed across all workspaces |
| `npm run lint` | Passed |
| `npm run build` | Passed; production client and server compiled |
| `npm test` | 2 files, 3 tests passed |
| `npm run smoke` | Passed on loopback port 3000 |
| `npm run smoke -- http://192.168.1.5:3000` | Passed on this machine's LAN interface; not a remote-device test |

Tests cover Zod foundation contracts, WAL/migration persistence across reopening SQLite, health, production deep links, unknown API/asset 404s, Socket.IO ready messages and cross-origin socket rejection.

Follow-up correction: the initial smoke test missed `/`, where disabled static directory indexes caused HTTP 403. An explicit root HTML route fixes this. Integration and smoke tests now include `/`; build, lint, typecheck, tests and loopback/LAN-interface smoke checks passed again after restarting the server.

The running server uses one HTTP port for built assets, API and Socket.IO and binds to `0.0.0.0`. Client output is approximately 389 kB JS (120 kB gzip) and 3.6 kB CSS (1.3 kB gzip). Source assets use local bundles and installed system fonts.

## Remaining acceptance checks

- Another physical LAN device loading the app is **not verified**. Complete the README phone and WAN-disconnected checklist to establish the Phase 1 physical gate.
- Browser screenshots were attempted, but automatic execution review blocked the Chrome launch. Mobile/desktop layouts were reviewed in code; rendered visual and keyboard checks remain unverified.
- Firewall configuration was not changed. The operator must review and apply the documented Private-profile rule if needed.
- No quiz/login/session/scoring features are claimed. No 200-client load test was run and no physical wireless capacity is claimed.

Implementation stops before Phase 2, as required by `PHASES.md`.

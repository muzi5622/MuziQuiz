# Phase 2 validation

Environment: Windows, Node v24.20.0, npm 11.19.0. No new runtime dependencies were needed.

| Command/check | Result |
| --- | --- |
| `npm run typecheck` | Passed across all workspaces |
| `npm run lint` | Passed |
| `npm run build` | Passed; built React client and production server |
| `npm test` | 4 test files, 21 tests passed |
| `npm run smoke` | Passed on loopback port 3000 |
| `npm run smoke -- http://192.168.1.5:3000` | Passed on this machine's LAN interface |
| Local asset/source audit | No remote font, CDN, or user HTML rendering dependencies in client sources |

## Automated acceptance gate

The host integration test sets a test-only password in a temporary SQLite database, signs in, creates a complete two-question quiz, closes the app/database, recreates them from the same file, and reads back identical content using the persisted host session. It then renames/reorders the quiz, checks stale-update rejection, exports/imports/duplicates it, and verifies cascading deletion. Temporary test credentials never enter the application data directory.

Additional coverage: unset-password behavior; every quiz endpoint denied without authentication; missing/cross-origin mutations and cross-origin reads rejected; HttpOnly/SameSite cookie attributes; salted credential and hashed-session storage; logout, expiry and password-reset revocation; login rate limits; malformed, oversized and unsupported-version JSON; strict validation of options, correctness, time/point limits and question counts; UTF-8 export size limits; invalid updates leave existing content intact.

Smoke tests now cover `/`, participant and host/deep-link pages, compiled assets, the private library's 401 response, auth status and a real Socket.IO ready message on one port.

## Manual operator check

1. Run `npm run setup:host` locally and enter/confirm a password. This is required before host use; no production password was chosen automatically.
2. Open `/host`, sign in, create a quiz and add/edit/reorder questions. Wait for “All changes saved.”
3. Reload, restart the server, and verify the quiz. Export it, import the file, duplicate and delete the duplicate.
4. Verify invalid fields stay unsaved, another tab causes stale-save rejection, and sign-out prevents API access.
5. Check desktop/mobile layout, keyboard navigation and unsaved-edit warnings in a real browser. Repeat authoring with WAN disconnected while retaining LAN.

Rendered browser automation, interactive password entry, physical phone access and a WAN-disconnected rehearsal were not executed in this phase. Prior automatic execution review blocked browser screenshot launch; no attempt was made to bypass that restriction. Same-machine LAN-address smoke tests do not establish another-device reachability.

## Scope limits

Live sessions, PIN/QR, participant joining, gameplay, scoring, polls and CSV results are not implemented. Phase 2 provides password-protected local authoring only. Invalid or unacknowledged edits remain in browser memory and can be lost if the tab is closed; saved edits are durable in SQLite. Login rate-limit counters reset on process restart. No performance/capacity claim is made. Implementation stops before Phase 3.

# Phase 6 validation

Implemented tap-to-answer, host-configurable 3–5 second question reading time, response-time receipts, published score history, an original host control desk, and animated leaderboard release. Answer reveal and score publication are separate. Skipping standings keeps pending scores sealed until a later leaderboard reveal or finish. Previous published totals/ranks persist across restart. No animation library or remote asset was added.

## Automated checks

- Typecheck, lint, unit/integration tests and production build pass: 13 test files / 80 tests.
- Tests cover preview withholding/early rejection, zero response time at option release, original deadline restoration, immutable retries, wrong/late answers, unauthorized controls, strict payloads, polls/ties, hidden pending scores across skipped rounds, final publication, rank reversal and persisted previous standings.
- Rendered-markup tests check preview/receipt states and host choices. They do not validate browser animation frames.
- `npm run audit:offline` passes: entry HTML/CSS assets resolve locally; source scan finds no remote runtime fetch/socket, service worker or beacon. This is a static audit.
- `npm audit --omit=dev`: zero known runtime vulnerabilities at the time checked.
- Windows launcher checks Node version and both production builds; startup never downloads dependencies or changes firewall settings.
- Production smoke checks pass on `http://127.0.0.1:3000` and `http://192.168.1.5:3000`: health, deep links, local assets, strict clock sync, host HTTP protection and rejection of unauthenticated host sockets. Both were tested from the server laptop, not a remote phone.

## Measured simulated load

Run `npm run test:load` after building. Each profile uses a fresh temporary database and separate production server process. Actual HTTP login/session/join, authenticated Socket.IO, reading time, concurrent answer bursts, immutable retry and manual controls run with normal rate limits. Accepted rows, response times and every awarded score are checked. Event data/password remain untouched; temporary paths are checked before cleanup.

Measured 2026-10-24, Windows, Node v24.20.0, Intel i7-9750H, 12 logical CPUs, 31.7 GiB RAM. Clients/server share this laptop over loopback WebSocket; development checks ran concurrently. Raw environment, latency, memory and event-loop measurements: [LOAD-RESULTS.json](LOAD-RESULTS.json).

| Connected clients | Accepted | Failures | Answer ack p50 | Answer ack p95 | Peak server RSS |
| --- | --- | --- | --- | --- | --- |
| 50 | 50 | 0 | 35.8 ms | 48.6 ms | 99.3 MiB |
| 100 | 100 | 0 | 82.2 ms | 103.7 ms | 122.5 MiB |
| 200 | 200 | 0 | 122.4 ms | 231.2 ms | 135.2 MiB |

The 200-client simulation passes the software load gate. It does not certify 200 physical Wi-Fi devices or Windows Mobile Hotspot capacity. Client rendering/animation cost and AP radio latency are outside this measurement.

## Operator rehearsal still required

1. Use a trusted isolated Private LAN with a dedicated capable AP, peer traffic enabled, client isolation disabled and sufficient DHCP addresses. Prefer laptop Ethernet.
2. Start the built app, select the audience-facing numeric IPv4 address, project its QR/PIN, and join from at least three real phones. Check portrait/landscape, long text, touch targets and projector readability.
3. Unplug WAN while keeping LAN running. Reload all screens, answer and reveal standings without internet. Keep the same origin to preserve browser identity.
4. Test 3/4/5 second reading periods: no options before release, then a full answer countdown. Tap once, confirm the response-time receipt, refresh and disconnect/reconnect Wi-Fi to restore the locked answer.
5. Reveal an answer, skip standings, then reveal a later leaderboard. Confirm accumulated gains, upward/downward rank movement, equal ranks, reduced-motion behavior and final podium.
6. Restart during reading, answering and after timeout. Original timestamps must remain; expired questions stay closed. Check automatic reconnect and rejection of removed/expired identities.
7. Rehearse venue Wi-Fi with the expected crowd and measure drops/latency. Review the explicit Private-profile TCP rule; never disable the firewall globally.
8. Back up the stopped complete data directory or use SQLite's online backup API. The development migration backup is `data/backups/before-phase6-1792825927091.sqlite`.

Physical phones, WAN-unplugged operation and browser animation/screenshot verification remain unverified here. No cloud hosting or next-phase work was added.

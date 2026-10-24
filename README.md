# MuziQuiz

MuziQuiz is an open-source, offline-first interactive quiz platform for classrooms, workshops, and events. Host real-time quizzes over a local network without internet access, featuring speed-based scoring, live leaderboards, and instant results.

One Windows laptop serves the participant website, host controls, QR presentation, API and WebSocket from one Node.js process. Participants use their own browser on the same LAN. No registration, online account, CDN, cloud database, analytics or event-day internet connection is required.

## What it includes

- Saved quizzes, MCQs, unscored polls, quiz duplication and versioned JSON import/export.
- Host password protection, one live event at a time, six-digit PINs and locally generated QR codes.
- Animated avatar arrivals, live connection counts and automatic unique nickname suffixes.
- Question-only reading period, one-tap answers and server-authoritative speed scoring.
- Manual question/reveal/leaderboard controls, animated score graphs and rank movement.
- Competition-wide Fastest recognition, private personal standings, final results and all-player CSV exports.
- Refresh/reconnect recovery, persisted sessions, finished-event history and backed-up history reset.

## 1. Requirements

- Windows laptop with Node.js **22.13 or newer** and npm. Check using `node --version` and `npm --version`.
- Initial internet access to install Node.js and npm dependencies. Download/extract or clone this project onto the laptop first.
- A trusted router/access point connecting the laptop and participant devices. Internet service on that network is optional.
- A current browser with JavaScript, cookies and local storage enabled. Projector/display is optional.

For larger events, use a dedicated capable Wi-Fi access point, sufficient DHCP capacity and preferably Ethernet between laptop and router. The application has a 200-identity session limit and tested simulated load; this is **not a guarantee of 200 physical Wi-Fi devices**. Windows Mobile Hotspot is not a 200-device solution.

## 2. First installation

Open PowerShell in the extracted project directory:

```powershell
cd C:\path\to\MuziQuiz
npm install
npm run build
npm run setup:host
npm run start
```

The password setup command asks for and confirms a **12-128 character host password**. Input is hidden. There is no default password. Passwords are stored only as salted hashes in SQLite.

Open **http://localhost:3000/host** and sign in. Participants use the laptop's LAN address instead of localhost. Keep the server terminal open; stop cleanly with **Ctrl+C**.

If installation fails while building better-sqlite3, use a supported Node.js version and retry installation. Environments without a compatible prebuilt binary may require the Windows C++ build toolchain/Python used by node-gyp. Preserve the complete installation on the event laptop; do not depend on downloading packages during an event.

## 3. Optional configuration

Defaults work without a configuration file. If you need changes, create `.env` from `.env.example` **only if .env does not already exist**:

```powershell
if (!(Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
```

| Setting | Default | Purpose |
| --- | --- | --- |
| PORT | 3000 | HTTP and Socket.IO share this TCP port. |
| DATA_DIR | ./data | Persistent SQLite directory; relative to the project root. |
| RESERVED_JOIN_CODE_HASH | unset | Optional SHA-256 hash of a private reserved-identity claim code. |

Restart after configuration changes. Run commands from the project root. Never publish `.env`, live databases or backups. Do not put host passwords or the private claim code into frontend files or exported quizzes.

MUZI is reserved case-insensitively. An ordinary entry of that name receives a generated Player name. A server-verified private code assigns MUZI's exclusive skull/Creator identity; it grants no host permission or score advantage. Only one such identity may join each event, and its browser token restores it. Keep the configured code private: anyone who knows it can claim that identity. The actual code is intentionally omitted here.

## 4. Set up the LAN

1. Connect laptop and audience devices to the same trusted Wi-Fi/LAN. Avoid guest networks with client isolation.
2. Run `ipconfig` on the laptop. Identify the active Wi-Fi/Ethernet **IPv4 address**. Ignore VPN/virtual adapters unless those are intentionally your audience network.
3. Start MuziQuiz. The terminal lists candidate addresses; verify the correct adapter. `0.0.0.0` means the server listens on all interfaces and is not a browser destination.
4. Test from a phone: `http://<HOST_LAN_IP>:3000/join`. Example only: `http://192.168.50.10:3000/join`.
5. Allow local peer communication on the router. Disable AP/client isolation for this network, avoid captive portal redirects and ensure enough DHCP addresses.

### Windows Firewall

Set the trusted event network to the **Private** profile in Windows settings. Allow inbound TCP on the configured port, Private profile only, preferably restricted to LocalSubnet. After reviewing it, an administrator can create this rule in elevated PowerShell:

```powershell
New-NetFirewallRule -DisplayName "MuziQuiz LAN TCP 3000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Profile Private -RemoteAddress LocalSubnet
```

Change the rule and URLs if you change PORT. Do not disable the firewall globally. The app does not change network/firewall settings automatically. Use a trusted isolated LAN; do not configure public tunnels, router port forwarding or UPnP.

## 5. Create or import a quiz

Visit `/host`. Create a quiz, set its title and the **global answer time** (10-120 seconds for every question), then add/reorder questions. A quiz supports up to 100 questions, each with 2-6 choices. Scored MCQs have one correct choice and 1-10,000 maximum points; the default is 1,000. Polls have no correct choice and award zero points.

Valid edits autosave after a short pause. Check the save status; use **Save quiz & return** to save and return to the library. Invalid fields or failed requests remain visible for correction/retry. A stale edit from another tab is rejected to prevent overwriting newer changes. Unsaved browser drafts are not durable after closing the tab.

**Import JSON** opens instructions with the required structure collapsed by default. Choose a file or **Paste JSON**. **Copy AI prompt** copies the quiz-writing/conversion prompt only; replace its topic/audience/count placeholders and check the generated facts. MuziQuiz does not send AI requests. On LAN HTTP, clipboard permissions may require the provided copy fallback or selecting the prompt and pressing Ctrl+C.

### Supported JSON format

Only **version 2** is accepted. Limit: **512 KiB UTF-8**. Import creates a new saved quiz. Unknown fields, invalid correct-option IDs, obsolete versions and oversized input are rejected.

```json
{
  "version": 2,
  "quiz": {
    "title": "Space basics",
    "description": "A short warm-up",
    "durationSeconds": 20,
    "questions": [
      {
        "type": "quiz_mcq",
        "text": "Which planet is called the Red Planet?",
        "options": [
          { "id": "a", "text": "Venus" },
          { "id": "b", "text": "Earth" },
          { "id": "c", "text": "Mars" },
          { "id": "d", "text": "Jupiter" }
        ],
        "correctOptionId": "c",
        "basePoints": 1000,
        "explanation": "Iron oxide gives Mars its red appearance."
      }
    ]
  }
}
```

For a poll, use `type: "poll_mcq"`, `correctOptionId: null` and `basePoints: 0`. Put durationSeconds on the quiz only. Titles: up to 120 characters; descriptions/question text/explanations: up to 2,000; choice text: up to 300. Use plain text, JSON numbers and double quotes, without comments or trailing commas.

## 6. Run an event

1. Save a quiz containing at least one question.
2. In the library's session launcher, choose the quiz, reachable LAN adapter and **3-5 second** question reading period. Start the session.
3. Click **Open session / Return to lobby** to open `/present/:pin`. The signed-in host controls the event on this same full-screen presentation page. Anonymous viewers of that URL are read-only.
4. Display the QR code, large IP address and PIN. Participants open the join page, enter the PIN and a nickname, or scan the QR. Nicknames accept 1-24 Unicode letters/numbers, without spaces/symbols; duplicates receive numeric suffixes. Avatars/colors are server-selected and unique as combinations within the session limit. Emoji shapes may repeat in different colors.
5. Start the first question. Both host and phones see the question alone during reading time. Options are withheld by the server, then appear together; the full answer timer starts at release.
6. A participant taps once to submit and lock an answer. Their receipt shows server-measured response time. Reloading cannot change an accepted answer.
7. When answering closes, reveal the answer. The host sees room response distributions; participants see their own outcome. Scores stay hidden until standings are published.
8. Choose **Show leaderboard** or move directly to the next question. Skipping standings holds pending scores until a later publication. A reveal briefly holds prior scores, counts totals and growing graph bars, then moves ranks. **Replay reveal** repeats the published animation; reduced-motion settings show final values immediately.
9. **Stop session / Finish** publishes final totals. Download all player ranks/points as CSV from the host's final screen. Finished-session history retains results after restart and original-quiz deletion.

The host advances manually; deadlines do not auto-advance questions. Only one session is active at once. A session snapshots its quiz, so later authoring changes do not change an event already started. The old `/host/session/:id` address redirects to the presentation page. Keep the host signed in using the same browser/origin used to open host controls.

### Scoring and recognition

Every scored question uses correctness **and** speed. For a correct answer received by the server deadline:

```text
points = round(basePoints * (0.5 + 0.5 * max(0, 1 - responseMs / durationMs)))
```

Time is measured by the server from options release. For a 20-second/1,000-point question: 0s = 1,000; 5s = 875; 10s = 750; 15s = 625; exactly 20s = 500 if received by the deadline. Late, incorrect, missing and poll answers earn zero. Local wireless latency can affect scores.

Sort by score descending, correct answers descending, then cumulative valid scored-answer time ascending. Exact ties share competition rank; stable joined-at/id ordering determines display position within the tie. Polls never affect scoring/tie breaks.

**Fastest** recognizes the lowest average correct-answer response time across all published scored questions, with exact ties sharing the tag. Wrong answers, polls and unpublished rounds are excluded. This badge does not alter points or ranks. Projectors show top-ten standings; participants see only their own rank/points. Final results include all participants in the CSV.

### Reconnect and restart

Use the **same browser and exact IP/port** to resume. The reconnect secret is stored in that browser's localStorage, with only its hash stored server-side. Entering a saved PIN offers Resume current question. A returning player restores the current stage/deadline, accepted answers and published score; missed rounds earn zero.

New identities join only during the lobby. Clearing browser storage, switching browser/device or changing origins loses access to the saved identity; a nickname alone cannot reclaim it. Multiple tabs sharing one token represent one player. Removed players cannot reuse their revoked token.

A server restart restores persisted sessions. Expired questions stay closed; timers never restart. A silent network failure can take several seconds to detect. Keep laptop clock, network, power and sleep settings stable during play.

## 7. Finished history and reset

In the library, expand **Recent finished sessions** to view saved standings or export CSVs. It stays collapsed initially and the list is bounded.

**Reset finished-session data** asks for confirmation, creates a local SQLite backup, then clears all finished events and their players, answers and results. It keeps saved quizzes, host credentials and the active event. Finished-data reset cannot be undone from the interface; restore its backup if needed. Do not reset history until required exports are saved.

## 8. Event-day checklist: internet disconnected

1. Complete installation/build/password setup before event day.
2. Connect the prepared laptop and phones to the event LAN; unplug WAN/internet while keeping the LAN active.
3. Run `npm run start` or double-click **start-muziquiz.cmd**. No rebuild or npm install is needed.
4. Verify the current LAN IP, firewall profile/rule and selected session adapter.
5. Open host controls, create a trial lobby and test QR/PIN, one answer, reveal and reconnect on at least three real phones.
6. Keep the terminal open, prevent laptop sleep and use reliable power. Use full-screen browser mode for projection if desired.

The legacy start-localmenti.cmd launcher remains compatible. Do not use the Vite development server for an event; production serves everything from the single configured port.

## 9. Data backup, restore and updates

Default database: **data/localmenti.sqlite**, using SQLite WAL. Historical database filenames, npm workspace scopes and browser storage keys retain their internal localmenti names for compatibility; the displayed application is MuziQuiz.

For a manual backup, stop the server with Ctrl+C, then copy the **entire data directory**, including any WAL/SHM files, to private backup storage. Keep a separate private copy of .env. Never copy only the main database file while the server is running. History reset creates a consistent online SQLite snapshot under data/backups.

To restore: stop the app, preserve the current data directory separately, restore the desired stopped-directory backup, then restart. For a reset-generated snapshot, while stopped, restore that snapshot as localmenti.sqlite in a clean data directory; do not combine it with unrelated WAL/SHM files. Restoring an older snapshot replaces data created since it was taken. Run `npm run setup:host` after restore to rotate the password and invalidate restored host sessions.

Before updating source/dependencies: stop, back up, preserve .env/data, install dependencies if changed, rebuild and restart. Migrations run automatically. Do not delete data to solve an installation issue.

## 10. Troubleshooting

| Symptom | Check |
| --- | --- |
| Phone cannot connect | Same LAN, correct IPv4/port, server running, Private firewall rule, no AP isolation/VPN/captive portal. localhost on a phone means that phone. |
| QR opens the wrong address | Select the actual audience-network adapter; a listed virtual IP may be unreachable. Recheck after DHCP/IP changes. |
| Host controls go to login | Sign in at the same origin as the presentation, allow cookies and reopen the session. Host sessions expire after 12 hours. |
| 403 response | Use matching app origin for API/socket requests; do not mix localhost and different IPs/ports or send cross-origin requests. |
| Save/import fails | Read the error, check required fields/option IDs, version 2, global duration and 512 KiB limit. Resolve stale edits before saving. |
| Clipboard unavailable | On HTTP LAN, use the selected prompt's Ctrl+C/device Copy fallback. |
| Animation is static | Use Replay reveal for already watched standings. Check the device's reduced-motion setting. Scores/bars only grow when newly published points increase. |
| Room already active | Open or stop the current session in the library before starting another. Deleting its quiz ends that room while retaining results. |
| Forgotten host password | Stop the server, run npm run setup:host in an interactive terminal, restart and sign in again. |
| Port already in use | Stop the previous MuziQuiz process or choose a free PORT and update firewall/URLs. |
| Reconnect lost identity | Return using the original browser and exact origin; avoid clearing its storage. A nickname cannot substitute for the token. |

## 11. Development and validation

TypeScript npm workspaces: client/ (Vite + React), server/ (Fastify + Socket.IO + better-sqlite3), shared/ (Zod contracts). No runtime cloud service is required.

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run smoke
npm run audit:offline
node scripts/lan-smoke.mjs http://<HOST_LAN_IP>:3000
npm run test:load
```

Start the production server before smoke checks. Load tests use isolated temporary databases/server processes with 50, 100 and 200 simulated clients, report p50/p95 acknowledgment latency, failures and memory, and leave event data untouched. See docs/LOAD-RESULTS.json and the validation reports in docs/. Loopback simulation does not certify physical Wi-Fi capacity. Physical venue testing, three-phone acceptance and WAN-unplugged checks remain necessary; automated DOM checks do not establish projector animation smoothness.

Routes: /join, /s/:pin, /host/login, /host, /host/quizzes/:id, /present/:pin and /health. Health does not expose credentials. Server validation enforces deadlines, answer uniqueness, strict request fields and host authorization; clients do not choose scores, timings, roles or avatars. CSV output escapes spreadsheet formula prefixes. Keep data/backups private: they contain participant names, results and credential/token hashes.

## Licensing

A distribution license has not yet been selected in this repository. Add an appropriate LICENSE before publishing an open-source release; dependency licenses apply separately. The interface and assets are original and do not use Mentimeter branding or proprietary artwork.

---

Made by **MUZI**

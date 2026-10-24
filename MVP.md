# MuziQuiz — Minimum Viable Product (MVP)

**Status:** Build specification | **Version:** 1.0 | **Target:** Offline LAN workshop quizzes | **Only scoring mode:** Fast Mode

## 1. Product vision
MuziQuiz is a self-hosted, browser-based interactive quiz and polling system for workshops, university classes, and CTF events. A single Windows laptop hosts the app; participants join over the same local Wi-Fi/LAN using a browser, join URL/QR code and six-digit PIN. An internet connection is **not** required to run events after setup. Use an original design inspired by the workflow of live audience quiz tools, not a copy of third-party proprietary UI or branding.

**Promise:** Organizers can create quizzes offline, enroll an audience without accounts, conduct synchronized timed questions, calculate server-authoritative speed-based scores, display a live leaderboard, and export results locally.

**Out of scope:** Cloud accounts, paid subscriptions, AI question generation, complex slide editors, word clouds, open-ended Q&A, concurrent rooms, native mobile apps and automatic hotspot provisioning.

## 2. Who uses it
- **Host/organizer:** Builds the quiz, starts/controls a session, monitors participants and exports results.
- **Participant:** Joins with nickname + PIN; submits one answer per question, sees their status/score/rank; no login.
- **Audience/projector:** Read-only large-screen view of join details, question progress, results, top 10 and podium.

## 3. Core workflow
1. Host connects Windows laptop to a private venue LAN; runs the server with `npm run start` after an initial install/build.
2. Host visits `/host`, signs in with locally configured password, creates/edits or chooses a saved quiz.
3. Host starts **one** active session; app generates a six-digit PIN and displays the network-ready URL and QR code.
4. Guests join the same network and open `http://<HOST_LAN_IP>:3000`, scan the QR, or visit `/join`; they enter a nickname and PIN.
5. Host sees participant count and starts a round. The projector displays the question and countdown; phones display touch-friendly answer choices.
6. Phones submit a single answer; backend timestamps receipt, rejects duplicate/late attempts, and computes points based on response speed.
7. Host reveals the correct answer and aggregates, then shows standings and advances the round.
8. Final podium displays the winners; host exports results CSV for offline use.

## 4. Screens and routes
| Route | Audience | Minimum content |
|---|---|---|
| `/` | Guest | Welcome and join action (or redirect to `/join`) |
| `/join` | Participant | Session PIN and nickname entry; errors and connectivity state |
| `/s/:pin` | Participant | Waiting room, current question choices, timer, submit receipt, personal points/rank, reconnect notice |
| `/host/login` | Host | Password authentication |
| `/host` | Host | Quiz library, create/duplicate/edit/delete, start session |
| `/host/quizzes/:id` | Host | Question editor; ordering, options, right answer, time and maximum points; JSON import/export |
| `/host/session/:id` | Host | Redirect to the session projector page |
| `/present/:pin` | Host/projector | QR/PIN, questions, results and leaderboard; signed-in hosts have Next/reveal controls and a final all-player CSV download |
| `/health` | Operations | Minimal service health JSON, no secrets |

## 5. In-scope features
### 5.1 Quiz authoring
- Create, rename, duplicate, delete and list quizzes.
- Each quiz contains ordered multiple-choice questions (MCQ); 2–6 answer choices; exactly one correct option for scored quizzes.
- Question text, optional explanation, time limit (10–120 seconds), and base/max points (default 1,000).
- Edit/reorder questions before starting; active session uses a fixed/snapshotted question set to avoid mid-game changes.
- Save automatically to local SQLite. Import/export a versioned JSON quiz format with validation and size caps.

### 5.2 Sessions and joining
- Exactly one active session for MVP. Saved quizzes and completed sessions may be many.
- Unique session PIN (six digits); prevent collision with an active session; rotate on new session.
- QR links to an actual reachable LAN IP and application port; host can choose the correct adapter IP if multiple exist.
- Guest joins without signup using a validated nickname of 1–24 letters/numbers only, with no spaces or symbols; enforce this in both browser and server. Normalize compatible Unicode and append numeric suffixes for duplicates.
- Server assigns a persistent emoji/color avatar per identity; the projector lobby shows new arrivals' names/icons. Use original presentation styling, without copying third-party branding or artwork.
- Lobby participant count, per-device reconnect token, refresh/reconnect restoration; kick participant from the host UI.
- Prevent participant access to host controls; private token never appears in URLs/projector/export.

### 5.3 Timed live questions
- Server state transitions: `LOBBY → QUESTION_OPEN → QUESTION_REVEAL → LEADERBOARD → ... → FINISHED`.
- Server chooses question start/end time and judges submissions. Client timer is for display only.
- One answer per participant per question; server enforces uniqueness and returns existing accepted result to retries.
- Display submission acknowledgement, closed question state, correct-answer reveal and aggregate chart.
- Host can start, close question early, reveal, show rankings, advance, and finish.
- On backend restart, restore session from persisted data; do not reopen an already expired question.

### 5.4 Fast Mode — the ONLY scoring method
There is **no fair/fixed-point option, score-mode selector or alternate scoring rule**.

If answer is incorrect, missing or late: **0 points**. If correct and received by the question deadline:

```
durationMs = durationSeconds * 1000
responseMs = clamp(serverReceivedAt - serverQuestionStartedAt, 0, durationMs)
points = round(basePoints * (0.5 + 0.5 * max(0, 1 - responseMs / durationMs)))
```

For a default **1,000-point, 20-second** question, correct answers receive:

| Server receipt after start | Points |
|---|---:|
| 0 seconds | 1000 |
| 5 seconds | 875 |
| 10 seconds | 750 |
| 15 seconds | 625 |
| Exactly 20 seconds | 500 if accepted at deadline |
| After deadline | 0 (rejected) |

- Timestamp immediately at receipt **on the server**; never accept participant-reported times, points or correct-answer flags.
- Never disclose the correct choice in participant payload before reveal.
- Rank by total score descending, then number of correct answers descending, then lower cumulative valid server response time on scored questions (`response_ms`, excluding polls). Exact ties share competition rank; joined-at/id provides stable display ordering within a tie.
- Clearly explain scoring before play. Wireless congestion may impact timing and fairness; test venue networking.

### 5.5 Live leaderboard and results
- Show a top-10 leaderboard between rounds, personal rank on participant phones and top-three podium at finish.
- Host gets per-question counts and aggregate answers; participants do not see other users' unrevealed selections.
- Export CSV with participant nickname, total points, rank, correct answers and optional question statistics. Escape CSV formulas to reduce spreadsheet injection risk.

### 5.6 Optional unscored polls included in MVP
- Question type `poll_mcq`, 2–6 options, no correct answer, no speed points and no effect on quiz ranking.
- Poll display gives answer counts/percentages when host reveals results.
- Polls are a separate **question type**, not another scoring mode. Fast Mode remains the only scoring mechanism for scored quiz questions.

## 6. Offline network and capacity requirements
**Topology:** `Windows laptop server ←Ethernet/LAN→ router/AP(s) ←Wi-Fi→ participant phones`.

- Development/small pilot: a laptop hotspot can be tested with a small number of devices, but **do not promise 200 Wi-Fi devices on Windows Mobile Hotspot**.
- Event target: **up to 200 concurrent connected Socket.IO clients** with a dedicated capable access-point setup and measured results. 200 simulated clients is a performance target, **not a guarantee** of support for 200 physical handsets.
- For 100–200 real devices, use purpose-built Wi-Fi access points with enough actual association capacity; generally multiple APs on the same reachable LAN. Ensure DHCP address capacity, avoid client isolation and captive portal, validate local firewall rules.
- Server listens at `0.0.0.0:3000`; browser opens `http://<HOST_LAN_IP>:3000`. The IP shown here is an example; actual address comes from the network adapter.
- Compile all scripts, styles, fonts and libraries into local build assets. App functionality may not depend on Google Fonts, cloud CDNs or internet APIs.
- Windows Defender Firewall: allow inbound TCP 3000 on the **Private** network only. Never disable the firewall globally; do not expose the server to the public internet.
- The host should test the exact venue Wi-Fi before events. To reduce wireless overhead, broadcast only necessary state changes (not per-second timer messages).

## 7. Technology choices
- **Frontend:** React + TypeScript + Vite; mobile-first responsive design; locally bundled assets.
- **Backend:** Node.js + Fastify + Socket.IO; backend owns authoritative timing and scoring.
- **Storage:** SQLite via `better-sqlite3`, migrations, unique submission indexes, transactions and WAL.
- **Shared contracts:** Zod runtime validation and shared TS types.
- **Testing:** Vitest unit/integration; a Socket.IO load-test script; Playwright browser tests where practical.
- **Deployment:** One production Node.js process serving built frontend, API and sockets on one LAN port; `start-localmenti.cmd` helper for Windows.
- No Docker/Kubernetes/Redis requirement for MVP.

## 8. Security and integrity
- Host login backed by salted password hash, secure HTTP-only session cookie, and authenticated host WebSocket events.
- Validate lengths, allowed values and permissions on all HTTP and socket messages; rate-limit joins and submissions; sanitize rendered user text.
- Reconnect bearer token randomly generated, stored as hash on server, never sent in query params; prevent identity hijacking by nickname alone.
- Deadline/submission uniqueness enforced in backend and database, not frontend.
- Reject quiz import with invalid/oversized JSON; protect exports from CSV injection and exclude credentials/reconnect secrets.
- No public port-forwarding, tunnels, external telemetry or mandatory online auth.

## 9. MVP acceptance criteria (definition of done)
1. With WAN disconnected, participants on same LAN can load pages, join, answer questions, view rankings and final podium.
2. Host can manage saved quizzes and edit options, correct answer, time and base points without internet.
3. Every scored quiz question uses **Fast Mode only**; deterministic automated scoring tests cover 0/5/10/15/20 second receipt and incorrect/late/duplicate cases.
4. A correct answer is hidden until reveal; participants cannot issue host controls.
5. Browser refresh or temporary disconnect restores participant identity, accepted submissions, score and session stage.
6. Results, session state and quiz library are durable across a normal server restart; expired questions never reactivate.
7. Three or more physical phones pass an offline rehearsal, including QR join, timer, leaderboard and export.
8. Load test simulates 50, 100 and 200 simultaneous clients with a timed answer burst; record p50/p95 acknowledgments, failures, throughput and server memory. **Do not claim 200 capacity if testing fails.**
9. Windows instructions cover `npm install`, `npm run build`, `npm run start`, finding IP, firewall settings, venue networking and local backup.
10. Quiz and results exports work without relying on third-party cloud services.

## 10. Build phases
| Phase | Scope | Gate |
|---|---|---|
| 1. Foundation | React/Vite shell, Fastify, Socket.IO, SQLite, one-port offline serving | Another LAN device can load app |
| 2. Quiz builder | Host auth, saved quizzes, MCQ settings, JSON import/export | Quiz survives restart |
| 3. Lobby | PIN, join flow, QR, reconnect, presence, projector lobby | Several phones can join securely |
| 4. Fast Mode engine | State machine, timed submissions, server scoring, reveal | End-to-end scored quiz works |
| 5. Leaderboard + polls | Personal/top-10/podium, unscored polls, CSV export | Full organizer workflow works |
| 6. Hardening | Performance, restart tests, 200-client simulation, Windows docs | Measured readiness, honest limitations |

The actionable prompts, tests and stop conditions are in `PHASES.md`; coding rules and data contracts are in `AGENTS.md`. The files should be kept aligned if scope changes.

## 11. Non-goals for first release
- Pixel-perfect reproduction of Mentimeter; copyrighted branding or UI assets.
- Word clouds, Q&A voting, surveys beyond MCQ poll, rich slide designer.
- Automatic configuration of APs/hotspots, custom DNS names or captive portal.
- Multiple simultaneous live sessions, team-based brackets, accounts or cloud sync.
- Claims of fairness independent of LAN latency or physical wireless capacity.

## 12. Suggested project repository layout
```
localmenti/
├── MVP.md
├── AGENTS.md
├── PHASES.md
├── README.md
├── package.json
├── client/             # React/Vite app
├── server/             # Fastify/Socket.IO/SQLite
├── shared/             # Types and Zod schemas
├── scripts/            # Offline smoke and load tests
└── docs/               # Technical decisions
```

## 13. Implementation priority
**Do not start with animations.** Build a reliably joinable offline service; then quiz authoring and real-time state transitions; then Fast Mode scoring and rank; then extras. Every phase must be demonstrable before the next phase begins.

## Phase 6 interaction refinements (explicit event-host requests)

- A single option tap submits and locks the answer; show the server-measured response time immediately, without awarding points in the answer UI.
- Before every question's answer window, show only the question for a host-configured 3-5 seconds. Withhold options on the server and reject guessed early answers. The answer/scoring start timestamp is the options-release timestamp; the reading period never consumes answer time.
- After answer reveal the host may show the leaderboard or advance directly. Skipping standings keeps unpublished points, totals, ranks and score-history entries sealed in participant payloads. Publishing standings releases all pending revealed rounds; finishing closes/reveals the current answering round and publishes the final totals.
- Persist the last published leaderboard as the animation baseline. Animate score gains and rank movement only after host publication, respect reduced motion, and preserve published state across refresh/restart. No animation library, CDN or timer-driven database writes.

## Authoring refinements and room lifecycle repair

- Import JSON first opens local format instructions with a schema-valid downloadable example and a copyable prompt for an external AI tool. The prompt asks for concise, similarly sized plausible choices, shuffled correct-answer positions, fact checking, then exact version-1 JSON conversion. No in-app AI generation, API connection or cloud dependency is added.
- The MCQ editor exposes automatic saving, explicit Save quiz & return, saved-question counts, question navigation and a clearly marked correct option. All question settings remain part of the saved quiz.
- Deleting a saved quiz also finishes its matching active room, releases the one-active-session slot and preserves session snapshots/immutable submissions/results. The delete confirmation explains this behavior. Deleting another quiz does not affect the active room. The library refreshes active-room state after quiz changes and when the window regains focus.

- JSON import also accepts pasted text in the import guide. Upload and paste share strict version-1 schema and 512 KiB UTF-8 size validation, then use the same host-only import endpoint.

- The library no longer shows the Duplicate quiz action. Recent finished sessions provide expandable saved final top-10 standings and results CSV, using persisted session data even after the original quiz is deleted or the server restarts.

- Quiz screens use large original answer cards and a distinct question-reading stage before options/answer timing. Host/projector and participant reveal charts show per-option counts/percentages and the correct marker only after host reveal. Participants receive a dismissible correctness popup (or neutral unanswered notice); polls have no correctness popup. No points appear before leaderboard publication.

## Quiz-wide answer time (latest host refinement)

The answer time limit is a single quiz.durationSeconds value (integer 10-120, default 20), shared by every MCQ and poll. The editor has one global timing control and no per-question time control. Version-2 quiz JSON requires durationSeconds at quiz level and rejects per-question overrides. Only version-2 JSON is imported; the retired version-1 importer has been removed. Existing saved quizzes migrate with that same policy; existing active/finished session snapshots retain their original durations and deadlines. New sessions snapshot the global value into each runtime question for authoritative scoring. The separate 3-5 second reading period does not consume answer time.

## Explicit save and session navigation

Imported/pasted quizzes are saved immediately. Save quiz & return remains available for a valid already-saved quiz, saves pending edits if needed, and returns to the library only after a successful save. Start session creates a waiting lobby without navigating or starting a question. Open session / Return to lobby opens its host QR/PIN screen. Next: first question starts reading time; options release automatically afterward. Next: close & reveal performs acknowledged close then reveal with the updated revision. Next question advances without publishing scores; Reveal leaderboard remains optional. Database migrations and saved quizzes/results are retained; obsolete build assets and the version-1 importer are removed.

- Host controls use a fresh credentialed WebSocket connection with the browser Origin header; insecure-LAN polling metadata is not relied on. HTTP loads the QR/PIN/control screen independently. Socket failures do not redirect to login unless the HTTP auth endpoint confirms expiry. Genuine sign-in returns to the requested host session using a single post-login redirect. Host cookie and origin authorization remain mandatory.

## Participant focus and host split view

Participant phones show a compact viewport-oriented question/choice screen, a dark high-contrast own-answer popup, and only personal rank/points at publication or finish. Global navigation, room answer charts, other-player standings, score history and repeated help are removed from that screen. Participant socket projections omit option counts, player lists and room leaderboards/podium; correct answer reveal and personal receipts remain. Host/projector retain room charts and animated horizontal-bar standings. The host presentation uses a single full-viewport canvas: questions and published standings replace each other, with controls below. Unpublished new points remain sealed. Layout targets ordinary mobile question lengths; unusually long content remains accessible by overflow rather than clipping choices.

## Unified projector controls

The signed-in host runs the quiz at /present/:pin with QR/PIN lobby, question/result panel, Next/reveal controls and animated leaderboard. The old /host/session/:id UI is removed and that URL redirects to its projector page. Library open-session and finished-session links point to the projector. Unauthenticated projector viewers remain read-only; every host HTTP/socket action still requires the host cookie and origin checks. The live projector omits roster/network management, extra statistics and downloads. After FINISHED, the host sees one CSV download containing all player ranks and points, not only the displayed top ten. Login expiry returns to the projector after sign-in.

## Viewport layout and live waiting lobby

Live participant and host/projector layouts use dynamic viewport sizing and bounded content panels, with questions and published standings shown on the same canvas. Headings use normal letter spacing and readable line heights. Recent finished sessions is collapsed by default and its expanded history list has a bounded height. The waiting lobby shows the local LAN QR/PIN, responsive recent-avatar arrivals with zoom-in animation, and a bottom-right connected-player counter plus joined count. New identities receive a persistent server-randomized unused emoji/color combination, including donut/cat/alien/unicorn/hat variants; existing avatar indices retain their appearance. Motion honors reduced-motion settings and no external join website/assets are required. Stop session is available from the active library banner and host projector; only same-origin authenticated hosts can stop, and final results remain saved.

## Single-canvas presentation and rejoin

The projector uses one full-viewport presentation canvas, without the old green host wrapper or nested light question/ranking cards. Question/answer results and the published leaderboard replace each other on that same canvas, with a compact control bar. The LAN IP/port is prominently displayed in the waiting lobby for manual joining. Typography and participant/PC content receive safe gutters; exceptionally long content stays accessible inside the presentation surface. Existing token holders reconnect directly to the current question with original deadlines, retain accepted points, and receive zero for missed rounds. Entering a saved PIN on the join page offers Resume current question without another nickname. Tokens remain browser/origin scoped and new identities still cannot join mid-quiz.


## Reserved participant identity

MUZI (case-insensitive, including compatible Unicode forms) is reserved across events. Ordinary entries of that name receive a generated Player name. A private join code is the sole exception to the letters/numbers-only join input rule; the server verifies its SHA-256 hash from RESERVED_JOIN_CODE_HASH. The accepted identity displays MUZI with an exclusive skull avatar and gold callout. The code is never a host credential and grants no scoring advantage. Only one reserved identity can join each session; its reconnect token restores it. Ordinary names and avatar/color combinations remain unique within the 200-player limit. Migration renames legacy unverified MUZI entries while retaining IDs, reconnect hashes, answers and points.


## Leaderboard graph and recognition

Host/projector standings hold the prior published points briefly, animate score totals, gains and proportional graph bars together, pause, then move rows into their new rank order. Refresh does not replay an already seen revision, and reduced motion displays final values immediately. The Fastest badge recognizes the lowest average server-measured correct-answer time across all published scored questions; exact ties share it. Polls, wrong answers and pending rounds are excluded. Players with no correct answers cannot receive it. The reserved MUZI identity carries a short Creator badge on the leaderboard with no score or rank advantage. Participant screens continue to show only their own rank and published points.


Leaderboard follow-up: score growth uses a distinct bright graph track and a slower 2600 ms count-up before rank movement. A reveal is remembered only after completion, so interrupted mounting cannot suppress the animation. Replay reveal replays the published score change without publishing new information; reduced-motion settings still apply. Fastest is now a competition-wide correct-answer average, displayed with an avg label, rather than a single-question award.


## Import copying, finished-data reset and presentation motion

The JSON structure disclosure starts collapsed. Copy AI prompt copies only the quiz-writing/conversion prompt; insecure LAN HTTP uses a selected-text copy fallback, with explicit manual-copy feedback if the browser refuses. Host-only Reset finished-session data confirms the action and first backs up SQLite locally, then transactionally removes only FINISHED sessions and their participants, snapshots and submissions. Saved quizzes, credentials and active sessions remain. Migration 10 permits submission deletion only for finished events to support this explicit reset; live answers remain immutable and all answer updates remain blocked. Presentation row spacing inherits its viewport size rather than a fixed 85px override. Full-height colored score graph bars grow with point counting after a short delay, then rows move with native Web Animations (CSS fallback), without external assets. Reduced motion and published-score privacy remain in effect.


## Public product name and attribution

The public product name is MuziQuiz. Existing @localmenti workspace scopes, database filenames and browser storage keys are retained for backwards compatibility. Made by MUZI appears on the PIN/nickname join page, QR waiting lobby and final-result footer only; it is absent from live question and intermediate leaderboard screens. The new Windows launcher is start-muziquiz.cmd, with the legacy launcher retained. README.md is the consolidated installation, configuration and event operations guide.

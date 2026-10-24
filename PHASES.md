# MuziQuiz — Codex phased prompts

Give Codex the project folder containing `MVP.md`, `AGENTS.md`, and `PHASES.md`, then send **one** prompt at a time.

## Phase 1 prompt
Read `MVP.md`, `AGENTS.md`, and `PHASES.md`. Implement Phase 1 only: TypeScript npm-workspaces monorepo; Fastify+Socket.IO+SQLite server; Vite/React frontend; single-port production serving at `0.0.0.0:3000`, health endpoint, minimal participant/host placeholder routes, offline CSS/font assets. Include `README.md`, `.env.example`, `start-localmenti.cmd`, and a LAN smoke-test. Run lint/typecheck/tests/build and document exactly what works. Stop before Phase 2.

## Phase 2 prompt
Read `MVP.md`, `AGENTS.md`, `PHASES.md`, and current code. Implement Phase 2 only: password-protected host area, persistent CRUD for quizzes and MCQ questions, quiz-wide time and per-question maximum-point settings (speed scoring is mandatory; no mode toggle), quiz JSON import/export, schema validation and tests. No live session functionality yet. Run all checks and report.

## Phase 3 prompt
Read `MVP.md`, `AGENTS.md`, `PHASES.md`, and current code. Implement Phase 3 only: one active session, six-digit code, QR with configurable LAN IP, mobile join page, reconnect token, lobby/presence, secure host controls, and large-screen projector lobby. Add tests for join limits and unauthorized socket actions. Run checks and report.

## Phase 4 prompt
Read `MVP.md`, `AGENTS.md`, `PHASES.md`, and current code. Implement Phase 4 only: server-authoritative question state machine, timed MCQ, one immutable submission per user per question, mandatory server-authoritative speed-based scoring (`round(basePoints * (0.5 + 0.5 * max(0, 1 - responseMs / durationMs)))` for correct answers, 0 for incorrect), with no other scoring mode, correct answer reveal only at appropriate time, reconnect restoration, and tests for concurrency/deadlines. Run checks and report.

## Phase 5 prompt
Read `MVP.md`, `AGENTS.md`, `PHASES.md`, and current code. Implement Phase 5 only: top-10 and personal leaderboard, podium, non-scored multiple-choice polls with live bar chart on reveal, CSV session export with formula injection protection and responsive UI polish. Enforce letters/numbers-only nickname input on client and server; automatically assign persistent emoji/color avatars and show name/icon arrivals on an original projector lobby. Run checks and report. Stop before Phase 6.

## Phase 6 prompt
Read `MVP.md`, `AGENTS.md`, `PHASES.md`, and current code. Implement Phase 6 only: 50/100/200 Socket.IO simulated participant performance tests, event restart/reconnect resilience, end-to-end offline LAN rehearsal checklist, basic profiling, Windows startup scripts, dependency/offline audit, documentation and needed reliability fixes. Publish measurable results; do not assert success without evidence. Run checks and report.

## Completion rule for every phase
Do not proceed to another phase automatically. Demonstrate its MVP acceptance gate, execute available lint/typecheck/tests/build commands, summarize failures and limits, and wait for the user to request the next phase. Never report a 200-participant capacity guarantee without actual performance evidence and venue Wi-Fi testing.

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

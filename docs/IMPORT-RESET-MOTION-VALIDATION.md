# Import, reset and motion follow-up

2026-10-24: Typecheck, lint, 140 tests across 20 files and production build pass.

- Import JSON structure defaults collapsed. On insecure LAN HTTP, the copy fallback focuses/selects only the quiz-writing prompt and invokes the browser copy command; refusal leaves that exact prompt selected with manual-copy instructions. DOM regression test checks selected content and collapsed state.
- Reset finished-session data requires authenticated same-origin host access and empty request fields, prompts before use, backs up the database, then removes finished sessions and dependent event data transactionally. Live sessions, their immutable submissions, saved quizzes and host credentials remain. API test covers authorization, body rejection, backup and active-data preservation. No production history was reset during implementation.
- Removed a fixed 85px list spacing override that defeated viewport presentation spacing. Graphs fill each row, grow with score totals after the reading delay, then native Web Animations move rows; CSS remains a fallback. Reduced motion remains supported. Animation cancellation is handled on navigation/replay. Sequence, interruption and replay DOM tests pass.
- An additional online backup was created before deploying migration 10, which permits deletion only of finished-event submissions for the explicit reset operation. Submission updates remain forbidden.

Browser DOM checks do not verify physical projector/phone animation smoothness. That remains an event-device check.

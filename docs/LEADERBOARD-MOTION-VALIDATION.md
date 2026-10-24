# Leaderboard motion and recognition

Follow-up correction: Fastest now uses the lowest average correct-answer server time across all published scored rounds, excluding polls, wrong answers and unpublished rounds. This supersedes the single-round policy below. A bright dedicated graph track counts up over 2600 ms, then positions change at 3600 ms. Completion is remembered only after the animation finishes, preventing interrupted mounts from skipping it. Replay reveal repeats the published animation and respects reduced motion. All 138 tests pass, including interrupted mounts and replay; typecheck, lint, build and offline audit pass. Physical animation rendering remains unverified.

Validated 2026-10-24. Existing Vite/React leaderboard extended with local CSS and requestAnimationFrame; no external assets or animation dependencies.

The slate-and-gold presentation now holds the previous published scores for 600 ms, counts totals and gains while graph bars grow over 1800 ms, pauses, then reorders rows at 2800 ms. Bar widths and score numbers share the same easing. Avatar-based colors persist through rank changes. Visible previous ordering is compacted to avoid overlapping new top-ten entrants. Reduced motion skips animation; seen revisions do not replay after refresh.

Fastest recognizes the minimum server response time among correct, non-removed participants on the latest published scored question. Exact ties share the badge; no correct answers means no badge. Polls and unpublished rounds cannot change it. MUZI's server-reserved avatar identifies its Creator badge, without changing points or sorting rules. Participant screens retain personal standings only.

Typecheck, lint, all 137 tests across 19 files, production build and offline asset audit passed. New DOM tests verify graph growth and point counting before position changes, refresh behavior, reduced motion and withheld standings. Server tests verify fastest ties, wrong answers, pending rounds and no-correct-answer cases. Physical projector/phone rendering and visual animation smoothness remain unverified.

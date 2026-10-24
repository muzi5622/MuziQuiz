# Phase 4 validation

Phase scope: real-time scored MCQs, manual host progression, strict request schemas and reconnect/restart recovery. No new dependencies were needed.

| Check | Result |
| --- | --- |
| `npm run typecheck` | All workspaces passed |
| `npm run lint` | Passed |
| `npm run build` | Passed |
| `npm test` | 8 files / 52 tests passed |
| `npm run smoke` | Passed, including strict clock sync and unauthorized host socket rejection |
| `npm run smoke -- http://192.168.1.5:3000` | Passed from the same laptop on its LAN interface |

A consistent SQLite online backup was saved under `data/backups/` before the production migration/restart. The production server was restarted on port 3000 with Phase 4. Physical acceptance remains pending below. The user's subsequent instruction authorizes Phase 5 as a separate increment.

## Automated coverage

- Correct answers at 0/5/10/15/20 seconds receive 1,000/875/750/625/500 points on a 20-second question. Incorrect answers receive zero. Receipt after the exact end timestamp is rejected.
- A deadline timer closes only after the inclusive end millisecond. It does not reveal, advance or finish, even after additional elapsed time.
- Twenty concurrent retries across two tabs produce one immutable submission; changing a choice on retry cannot replace it. A retry after reveal or advancing still recovers the original receipt.
- Refresh/reconnect restores identity, current question/stage, original deadline, accepted answer and revealed score. Tests cover open, reveal, next-question and finished states.
- Server restart retains unexpired deadlines, closes expired ones, preserves accepted answers, and cannot reopen a persisted closure even if its clock subsequently moves backward.
- Before reveal, public/other-participant payloads and accepted receipts do not disclose correctness, explanation, current points, future questions or another identity's private receipt. Reveal publishes the aggregate chart and own score.
- Forged score, awardedPoints, responseMs, receivedAt, participantId, sessionId, correctness, state, privilege and prototype/constructor fields are rejected. Existing HTTP quiz/session/join/no-field routes are also checked for mass assignment and JSON prototype poisoning.
- Root, participant and projector sockets cannot invoke host transitions; logout revokes a connected host's control access. Stale/duplicate transition revisions cannot skip questions. Invalid/future/cross-session question and option IDs are rejected.
- Early-close scoring retains the original duration; invalid-request rate limits do not mutate accepted data. Database triggers reject accepted-record updates/deletions.

Tests use temporary SQLite databases and actual local HTTP/Socket.IO listeners, with a server-constructor clock for deterministic boundaries. They never use production host credentials or modify saved production quizzes. The tests are not a 200-client load test.

## Operator/browser gate — pending

1. On at least three physical phones, join an offline LAN session and start a question manually.
2. Refresh before answering; verify the original countdown continues. Submit once, refresh again, and verify the locked answer returns.
3. Temporarily disconnect/reconnect a phone; verify identity, stage and saved answer restore without duplicate points.
4. Let time expire: verify answering closes but question/reveal/next remain under host control.
5. Reveal, continue between rounds and start the next question. Verify all screens update; refresh host and projector too.
6. Restart the server during an open question and after expiry. Verify deadlines are retained/closed appropriately and the host manually continues.
7. Finish the session and verify a reconnect shows finished state and the retained revealed score.
8. Inspect mobile/desktop rendering, keyboard controls and actual venue Wi-Fi timing. Do not equate simulated/local tests with physical network capacity.

Physical phone/WAN rehearsal and rendered browser automation were not run here. Prior execution review blocked browser screenshot launch; no bypass was attempted. Clearing browser storage or changing origin/device cannot recover identity by nickname alone.

Top-10/personal ranks, podium, polls and CSV export remain Phase 5. The between-round stage is present but rankings are not claimed. Implementation stops before Phase 5.

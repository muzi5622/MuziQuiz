# Quiz-wide answer time

One quiz-level `durationSeconds` setting (10–120 seconds, default 20) now controls every scored MCQ and unscored poll. Per-question timing controls/authoring fields are removed. The separate host-configured 3–5 second reading period remains; answer/scoring time starts on options release.

JSON export/example/prompt now use version 2, requiring `quiz.durationSeconds`. Per-question overrides are rejected. File and paste imports share validation. Only version-2 JSON is now imported/exported. The version-1 conversion path was removed in the subsequent save/session-flow repair. Already-migrated quizzes remain saved.

Migration 8 adds the quiz-wide value, selects the first saved question's duration and normalizes authoring rows. Existing active/finished runtime snapshots and their original deadlines remain unchanged. New sessions use the quiz-wide time throughout. Database backup before deployment: `data/backups/before-global-timing-1792828034959.sqlite`.

Validation: typecheck, lint, build, offline audit and 97 tests in 15 files pass. Tests verify global-time validation, per-question override rejection, legacy JSON conversion, a shared 15-second MCQ/poll session, speed scoring at half that window, and migration preserving a live 60-second snapshot. Authoring tests check saving a 45-second global value and JSON round trip. Production smoke checks pass on localhost and the laptop's LAN address. Browser visual and physical-phone rehearsal remain pending.

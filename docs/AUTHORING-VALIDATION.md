# Authoring follow-up validation

Import JSON now opens an accessible native dialog before file selection. It explains the exact version-1 format and limits, includes a schema-valid downloadable example, and provides a copyable prompt for an external AI tool. The prompt requests fact-checked questions first, JSON conversion afterward, shuffled correct-answer positions and short, similarly sized plausible choices. Clipboard fallback selects the prompt for manual copying on HTTP LAN origins. No AI API or new dependency was added.

The original React/CSS question workshop now includes a sticky save bar, explicit Save quiz now, saved-question count, MCQ/poll totals, question navigation and highlighted correct choices. Explicit save shares the autosave operation and an in-flight guard. Pending/invalid edits are not represented as saved or exported. New MCQs start with four choices; 2–6 remain supported.

The stale-room bug had two causes: saved quiz deletion left its independent session snapshot active, and the library queried active rooms only on mount. Deletion now finishes only the matching room transactionally, preserving session snapshots and immutable answers, and frees the one-active-session slot. Existing orphan rooms are repaired when active-room state is checked. Library changes/window focus refresh room state; stale quiz selections are cleared. The delete confirmation explains that its room will end while results remain saved.

Validation: typecheck, lint, production build and 84 tests in 14 files pass. Regression tests cover active versus unrelated quiz deletion, authentication, forged delete fields, retained answers/results, replacement room creation, restart and old orphan-room recovery. Import tests validate the sample against the real schema and verify instructions precede file selection. Production localhost/LAN smoke and offline asset audit pass. Browser dialog interactions, clipboard/file picker, responsive layout and physical phones still require visual/manual verification.

Existing event data was backed up before restarting the updated local server: `data/backups/before-authoring-fix-1792826557802.sqlite`.

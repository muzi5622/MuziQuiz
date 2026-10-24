# Phase 5 validation

Scope: rankings/podium, unscored polls, safe CSV exports, and the user's alphanumeric-nickname/automatic-character lobby additions. No new dependencies were needed.

| Check | Result |
| --- | --- |
| `npm run typecheck` | All workspaces passed |
| `npm run lint` | Passed |
| `npm run build` | Passed |
| `npm test` | 11 files / 71 tests passed |
| `npm run smoke` | Passed |
| `npm run smoke -- http://192.168.1.5:3000` | Passed on the same laptop's LAN interface |

A consistent SQLite backup was saved under `data/backups/` before the Phase 5 production migration/restart. The app was restarted on port 3000; physical-device acceptance remains pending.

Automated coverage includes browser-rendered nickname-pattern equivalence to server validation, rejection of symbols/whitespace/hidden controls, Unicode-safe numeric suffixes, 200 distinct stable emoji/color combinations, reconnect avatar persistence, and migration of legacy names without changing identity/token hashes.

Ranking tests cover correct-count/time tie breaks, shared visible ranks, stable order, top-ten limits, personal rank and podium after finish/restart. Mixed quiz/poll tests prove polls cannot change points, correctness counts, cumulative ranking response time or ranks. CSV tests cover quoted commas/newlines/Unicode, formula prefixes/control bytes, host-only downloads and credential/token exclusion. Existing timing, duplicate, restart and forged-request tests remain in the suite.

The browser-pattern check uses React server rendering; it is not a rendered interactive browser/phone rehearsal. Physical phone/WAN checks and screenshot/keyboard/mobile visual review remain pending. Prior execution review blocked a browser screenshot launch; no bypass was attempted.

Manual gate: join several phones with valid/invalid names, verify arrival icons on the projector and persistence after refresh, complete a scored round and a poll, compare personal/top-ten ranks, finish to inspect the podium, and download/open both CSVs offline. Confirm a poll does not change ranks and that duplicate nicknames remain alphanumeric. This phase makes no 200-connected-client or physical Wi-Fi capacity claim.

Phase 5 is followed by the user's separately authorized Phase 6 instruction, including automatic tap submission, response-time receipts and an admin-set question-only preview.

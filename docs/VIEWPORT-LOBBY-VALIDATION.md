# Viewport and waiting-lobby refinement

Live participant, host and read-only projector views now use dynamic viewport bounds. Desktop headings use normal tracking and readable line heights. Host panels resize score rows with the viewport; small host screens switch Question/Leaderboard panels while keeping actions visible. Long text/history may scroll inside bounded panels so content and touch targets are not clipped. Recent finished sessions uses collapsed native details with a height-bounded expanded list.

The welcome lobby is shared by host and read-only projector views. It shows the local LAN join URL, QR and PIN, responsive recent-player avatars, zoom-in entry animation and a bottom-right live connected counter. Joined and connected totals remain distinct; existing multi-tab/disconnect tests verify identity-based presence. Galleries show the latest 6/12/24 arrivals according to viewport size instead of expanding the page indefinitely. Motion respects reduced-motion preferences.

New participants receive a server-randomized unused avatar/color combination, persisted for reconnects. Donut, cat, alien, unicorn and hat characters add 50 combinations after the original 240, preserving all existing avatar mappings. Removed identities keep their reserved indices. This palette size is not a physical-device capacity claim.

Stop session appears on the host projector and active library banner. Library stopping uses a same-origin authenticated POST with a strict empty body and the existing idempotent engine; final results remain saved and the active-session slot is released. The recent-history list refreshes after a stop.

Validation: typecheck, lint, 125 tests across 18 files, production build, offline audit and localhost/LAN smoke checks pass. New tests exercise the collapsed history toggle, arrival/counter update, stopping from both host locations, host/origin/body checks on the HTTP stop route, and distinct/stable avatar variants. No animation library, runtime dependency or remote asset was added. Physical browser geometry, animation appearance and real-phone/projector rehearsal remain unverified here.

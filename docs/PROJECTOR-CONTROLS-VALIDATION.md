# Unified projector controls

The signed-in host now runs the quiz at `/present/:pin`. It includes the QR/PIN lobby, question/result panel, Next/close/reveal actions and animated leaderboard. The old `/host/session/:id` screen is redirect-only, and library open-session/results links point directly to the projector.

The live host projector omits participant-management details, network settings, scoring help and intermediate CSV/statistics downloads. After `FINISHED`, a single link downloads all players' ranks and points. It uses the existing formula-escaped, authenticated CSV export, which includes participants beyond the displayed top ten.

The projector checks existing HTTP cookie authentication before mounting host controls; anonymous viewers retain a read-only presentation and a Host controls sign-in link. Host actions still require the authenticated socket cookie, same-origin validation and server revisions. Login expiry preserves the projector return route. No credentials are exposed through projector URLs, and no database reset/schema change was needed.

Validation: typecheck, lint, 119 tests in 18 files, production build, offline audit and localhost/LAN smoke checks pass. React DOM tests verify opening the projector from the library, old-route redirection, waiting for Next before question one, signed-in controls, read-only anonymous viewing and a download link only at finish. A real API test verifies all 12 participants appear in the CSV while the leaderboard displays ten. Physical projector/phone rendering remains unverified.

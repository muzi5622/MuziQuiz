# Single-canvas presentation and rejoin

The host presentation now uses a new presentation-screen structure instead of the old green host wrapper, split panels and light cards. A single full-viewport slate/gold canvas contains either the question/answer reveal or published leaderboard. Next, reveal and Show leaderboard remain in a compact fixed layout row. There is no parallel ranking box or separate metadata panel. Read-only projectors use the same palette; host authorization remains mandatory for actions.

The waiting lobby prominently displays the numeric LAN IP/port, with the HTTP instruction, QR and PIN. Presentation and participant text receives larger safe gutters. Compact mobile ranking labels ellipsize with their full nickname retained in the title; answer choices are not silently clipped. Long allowed content can scroll inside the bounded surface while controls remain available. Actual browser geometry/appearance still requires visual verification.

Existing saved-token reconnect already restores the server's current question. A join-form issue still required nickname input before that shortcut could run; recognized saved PINs now hide that field and offer Resume current question. New identities remain lobby-only, tokens remain browser/origin scoped, and removed identities cannot resume.

Two real-socket tests disconnect a participant before question one or after answering it, complete three rounds, then restore question four. They verify unchanged identity and deadline, retained accepted points, zero for missed rounds, and server-timed scoring on the current question (875 at five seconds into a twenty-second window). A DOM test verifies resuming from the join page without a nickname or creating a new identity. Another verifies that Show leaderboard replaces the question on the same canvas and that the old host wrapper/sidebar is absent.

Validation: typecheck, lint, 129 tests across 18 files, production build, offline audit and localhost/LAN smoke checks pass. Real-phone layout and native popup/animation appearance remain unverified. No schema migration, data reset or new dependency was added.

During validation the Wi-Fi adapter changed from `192.168.1.5` to `192.168.1.4`. The old-address smoke test timed out; current-address checks use `192.168.1.4` and the laptop's `192.168.56.1` address. Existing saved session join URLs are snapshots; select the current reachable adapter for a new lobby. A stable host address/DHCP reservation is needed during an event because reconnect tokens belong to the browser's original host origin.

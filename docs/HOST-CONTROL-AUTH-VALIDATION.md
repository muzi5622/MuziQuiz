# Host controls redirect repair

Default Socket.IO polling can reach the host namespace without Origin or Fetch Metadata on plain LAN HTTP. The strict host-origin gate rejected that handshake, but the UI treated its generic error as an expired login and navigated away from the controls.

The host console now uses a fresh WebSocket-only, credentialed transport; browser WebSocket handshakes include Origin. The server still requires both valid HttpOnly host credentials and same-origin proof. Origin failures and expired credentials have different messages. No anonymous or cross-origin access was added.

The QR/PIN/control screen also loads through the existing authenticated HTTP endpoint. Socket failure leaves that page visible, with controls disabled until its live connection is ready. A socket sign-in error is checked against HTTP auth before redirecting. Unreachable servers do not falsely sign out the host.

If the login truly expired, the original host session route is retained through sign-in. A single authenticated login-route redirect owns this navigation; it avoids the previous race with an unconditional library redirect.

Validation: typecheck, lint, 110 tests in 17 files, production build and offline audit pass. React DOM tests verify WebSocket options, QR/PIN before question one, valid-login socket rejection without redirect, and expired-login renewal returning to the same session. Real Socket.IO tests reproduce polling rejection without metadata while the cookie remains valid, then connect with cookie plus WebSocket Origin and start the question. Missing/forged credentials and cross-origin attempts remain rejected. Localhost and LAN smoke checks pass after restart. Physical browser/Wi-Fi verification remains pending.

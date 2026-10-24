import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
const origin = process.argv[2] ?? 'http://127.0.0.1:3000';
const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(5000) });
assert.equal(response.status, 200);
assert.equal((await response.json()).status, 'ok');
for (const path of ['/', '/join', '/host', '/host/login', '/host/quizzes/example', '/present/123456']) {
  const page = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(5000) });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('<div id="root">'));
  for (const asset of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
    const file = await fetch(`${origin}${asset[1]}`, { signal: AbortSignal.timeout(5000) });
    assert.equal(file.status, 200);
    assert.ok(!file.headers.get('content-type')?.includes('text/html'));
  }
}
const privateLibrary = await fetch(`${origin}/api/host/quizzes`, { signal: AbortSignal.timeout(5000) });
assert.equal(privateLibrary.status, 401, 'Quiz library must require host authentication');
const auth = await fetch(`${origin}/api/host/auth`, { signal: AbortSignal.timeout(5000) });
assert.equal(auth.status, 200);
assert.equal(typeof (await auth.json()).configured, 'boolean');
const socket = io(origin, { autoConnect: false, reconnection: false, timeout: 5000 });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No server:ready received')), 7000);
    socket.once('server:ready', payload => { clearTimeout(timer); assert.ok(payload.serverTime > 0); resolve(); });
    socket.once('connect_error', error => { clearTimeout(timer); reject(error); });
    socket.connect();
  });
  const clock = await socket.timeout(5000).emitWithAck('clock:sync', {});
  assert.equal(clock.ok, true); assert.ok(clock.data.serverTime > 0);
  const invalidClock = await socket.timeout(5000).emitWithAck('clock:sync', { serverTime: 0 });
  assert.equal(invalidClock.ok, false);
  console.log(`PASS: health, pages, local assets, host access gate, strict clock sync and Socket.IO on ${origin}`);
} finally { socket.disconnect(); }
const hostSocket = io(`${origin}/host`, { autoConnect: false, forceNew: true, reconnection: false, timeout: 5000, extraHeaders: { Origin: origin } });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Host gate timeout')), 7000);
    hostSocket.once('connect_error', error => { clearTimeout(timer); if (error.message === 'Host sign-in required.') resolve(); else reject(error); });
    hostSocket.once('connect', () => { clearTimeout(timer); reject(new Error('Unauthenticated host socket accepted')); });
    hostSocket.connect();
  });
  console.log('PASS: unauthenticated host socket rejected');
} finally { hostSocket.disconnect(); }

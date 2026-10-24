import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, totalmem } from 'node:os';
import { resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { io } from 'socket.io-client';
import { openDatabase } from '../server/dist/database.js';
import { setHostPassword } from '../server/dist/auth.js';
import { createQuiz } from '../server/dist/quizzes.js';

const percentile = (values, fraction) => [...values].sort((a,b) => a-b)[Math.max(0,Math.ceil(values.length*fraction)-1)] ?? 0;
const latency = values => ({ p50Ms: percentile(values,.5), p95Ms: percentile(values,.95), maxMs: Math.max(0,...values) });
function message(child, predicate) {
  return new Promise((done,reject) => {
    const timer = setTimeout(() => finish(new Error('Child server timed out')),30000);
    function finish(error,value) { clearTimeout(timer); child.off('message',receive); child.off('exit',exited); if(error) reject(error); else done(value); }
    function receive(value) { if(predicate(value)) finish(null,value); }
    function exited(code) { finish(new Error(`Child exited early: ${code}`)); }
    child.on('message',receive); child.once('exit',exited);
  });
}
async function run(count) {
  console.log(`Testing ${count} simultaneous participants with production validation and rate limits...`);
  const directory = mkdtempSync(resolve(tmpdir(),'localmenti-load-'));
  const databasePath = resolve(directory,'load.sqlite');
  const sockets = []; let child;
  try {
    const db = openDatabase(databasePath); const password = randomBytes(24).toString('hex');
    await setHostPassword(db,password);
    const quiz = createQuiz(db,{ title: 'Isolated load test', description: '', durationSeconds: 20, questions: [{ type: 'quiz_mcq', text: 'Which option is correct?', options: [{ id: 'a', text: 'Correct' },{ id: 'b', text: 'Incorrect' }], correctOptionId: 'a', basePoints: 1000, explanation: '' }] }); db.close();
    child = fork(resolve('scripts/load-server.mjs'),[databasePath],{ stdio: ['ignore','inherit','inherit','ipc'] });
    const { port } = await message(child,value => value.ready);
    const origin = `http://127.0.0.1:${port}`;
    let cookie = '';
    async function post(path,body) {
      const response = await fetch(`${origin}${path}`,{ method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      assert.ok(response.ok,`${path}: HTTP ${response.status}`);
      return response;
    }
    const login = await post('/api/host/login',{ password }); cookie = login.headers.getSetCookie()[0].split(';')[0];
    const lobby = await (await post('/api/host/sessions',{ quizId: quiz.id, lanAddress: '127.0.0.1', previewSeconds: 3 })).json();
    function connect(namespace,auth,event = 'connect') {
      const socket = io(`${origin}${namespace}`,{ autoConnect: false, forceNew: true, reconnection: false, transports: ['websocket'], auth, extraHeaders: { Origin: origin, ...(namespace === '/host' ? { Cookie: cookie } : {}) } }); sockets.push(socket);
      return new Promise((done,reject) => {
        const timer = setTimeout(() => reject(new Error(`${namespace} connection timed out`)),15000);
        socket.once(event,data => { clearTimeout(timer); done({ socket, data }); }); socket.once('connect_error',error => { clearTimeout(timer); reject(error); }); socket.connect();
      });
    }
    const { socket: host } = await connect('/host',{});
    const ack = async (socket,event,payload) => { const result = await socket.timeout(15000).emitWithAck(event,payload); assert.equal(result.ok,true, result.error); return result.data; };
    await ack(host,'host:watch',{ sessionId: lobby.id });
    const joinTimes = [];
    const players = await Promise.all(Array.from({ length: count },async (_,index) => {
      const begin = performance.now();
      const joined = await (await post('/api/join',{ pin: lobby.pin, nickname: `Player${index}` })).json();
      const player = await connect('/participant',{ pin: lobby.pin, token: joined.token },'participant:ready');
      joinTimes.push(performance.now()-begin); return player.socket;
    }));
    assert.equal(players.filter(socket => socket.connected).length,count);
    const released = new Promise((done,reject) => {
      const timer = setTimeout(() => reject(new Error('Options never released')),10000);
      const listen = data => { if(data.session.question?.phase === 'ANSWERING') { clearTimeout(timer); players[0].off('participant:state',listen); done(data.session); } };
      players[0].on('participant:state',listen);
    });
    let current = await ack(host,'host:transition',{ sessionId: lobby.id, expectedRevision: lobby.revision, action: 'start' });
    assert.equal(current.question.phase,'PREVIEW'); assert.deepEqual(current.question.options,[]);
    current = await released; const question = current.question;
    const times = []; const burstStart = performance.now();
    await Promise.all(players.map(async socket => { const begin = performance.now(); const receipt = await ack(socket,'answer:submit',{ questionId: question.id, optionId: 'a' }); times.push(performance.now()-begin); assert.equal(receipt.optionId,'a'); assert.equal(receipt.awardedPoints,undefined); }));
    const burstMs = performance.now()-burstStart;
    const retry = await ack(players[0],'answer:submit',{ questionId: question.id, optionId: 'b' }); assert.equal(retry.optionId,'a');
    const verify = openDatabase(databasePath);
    const rows = verify.prepare('SELECT response_ms, received_at, awarded_points FROM submissions').all();
    assert.equal(rows.length,count);
    for(const row of rows) { assert.equal(row.response_ms,row.received_at-question.startedAt); assert.ok(row.received_at <= question.endsAt); assert.equal(row.awarded_points,Math.round(1000*(.5+.5*Math.max(0,1-row.response_ms/20000)))); }
    verify.close();
    for(const action of ['close','reveal','between']) current = await ack(host,'host:transition',{ sessionId: lobby.id, expectedRevision: current.revision, action });
    await ack(host,'host:end',{ sessionId: lobby.id });
    const statsReady = message(child,value => value.stats); child.send('finish'); const { stats } = await statsReady;
    const result = { participants: count, connected: count, accepted: rows.length, failures: 0, joinAndConnect: latency(joinTimes), answerAcknowledgment: latency(times), burstMs, ...stats };
    console.log(JSON.stringify(result)); return result;
  } finally {
    sockets.forEach(socket => socket.disconnect());
    if(child && child.exitCode === null) { await new Promise(done => { const timer = setTimeout(() => { child.kill(); done(); },3000); child.once('exit',() => { clearTimeout(timer); done(); }); }); }
    const target = resolve(directory); const boundary = resolve(tmpdir())+sep;
    assert.ok(target.startsWith(boundary) && target.includes('localmenti-load-'));
    rmSync(target,{ recursive: true, force: true });
  }
}
const report = { timestamp: new Date().toISOString(), node: process.version, platform: process.platform, cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryGiB: totalmem()/1073741824, transport: 'WebSocket loopback; separate server process, same laptop as clients', limitation: 'Simulation does not certify physical Wi-Fi capacity. Three-device LAN and WAN-unplugged rehearsal remain required.', results: [] };
for(const count of [50,100,200]) report.results.push(await run(count));
writeFileSync(resolve('docs/LOAD-RESULTS.json'),JSON.stringify(report,null,2)+'\n');
console.log('Saved docs/LOAD-RESULTS.json');

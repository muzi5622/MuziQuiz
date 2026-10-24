import { resumeAfterRestart } from './reconnect.js';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import { ConnectionSchema, HealthSchema, type ActionResult, type ClientToServerEvents, type ServerToClientEvents } from '@localmenti/shared';
import './style.css';
import { HostArea } from './host.js';
import { JoinPage, ParticipantPage, PresenterPage } from './lobby.js';
import { ClockOffset } from './game.js';
import { OpenInBrowser } from './desktop.js';
import './theme.css';

function App() {
  const [connected, setConnected] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const [health, setHealth] = useState('Checking local server…');
  const location = useLocation();
  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({ autoConnect: false });
    const stopRestart = resumeAfterRestart(socket);
    const sync = () => {
      if (!socket.connected) return;
      const started = Date.now();
      socket.timeout(3000).emit('clock:sync', {}, (error: Error | null, result: ActionResult<{ serverTime: number }>) => {
        if (!error && result.ok) setClockOffset(result.data.serverTime - (started + Date.now()) / 2);
      });
    };
    socket.on('server:ready', data => { const valid = ConnectionSchema.safeParse(data); setConnected(valid.success); if (valid.success) { setClockOffset(valid.data.serverTime - Date.now()); sync(); } });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.connect();
    const clockTimer = window.setInterval(sync, 30_000);
    const controller = new AbortController();
    fetch('/health', { signal: controller.signal }).then(r => r.json()).then(data => {
      setHealth(HealthSchema.parse(data).status === 'ok' ? 'Local server healthy' : 'Server unavailable');
    }).catch(() => { if (!controller.signal.aborted) setHealth('Cannot reach local server'); });
    return () => { controller.abort(); clearInterval(clockTimer); stopRestart(); socket.disconnect(); };
  }, []);
  return <ClockOffset.Provider value={clockOffset}><div className={`shell ${location.pathname.startsWith('/present/') ? 'presenter-shell' : location.pathname.startsWith('/s/') ? 'participant-shell' : ''}`}>
    <header><Link className="brand" to="/join" aria-label="MuziQuiz home"><span className="brand-mark">mq<span>•</span></span>MuziQuiz</Link><nav aria-label="Main navigation"><Link aria-current={location.pathname === '/join' ? 'page' : undefined} to="/join">Participate</Link><Link aria-current={location.pathname.startsWith('/host') ? 'page' : undefined} to="/host">Host space <span aria-hidden="true">↗</span></Link><OpenInBrowser/></nav></header>
    <main><Routes>
      <Route path="/" element={<JoinPage/>}/><Route path="/join" element={<JoinPage/>}/>
      <Route path="/host/*" element={<HostArea/>}/>
      <Route path="/s/:pin" element={<ParticipantPage/>}/>
      <Route path="/present/:pin" element={<PresenterPage/>}/>
      <Route path="*" element={<Placeholder title="This page isn’t here." label="404" detail="Head back to the participant page to find your way."/>}/>
    </Routes></main>
    <footer><span className="connection" role="status"><span className={`dot ${connected ? '' : 'pending'}`}/>{connected ? 'Live connection ready' : 'Connecting to local server…'}</span><span>{health} <span aria-hidden="true">/</span> Local event server · LAN only</span></footer>
  </div></ClockOffset.Provider>;
}
function Placeholder({ title, label, detail }: { title: string; label: string; detail: string }) { return <section className="placeholder"><p className="kicker">{label}</p><h1>{title}</h1><p className="intro">{detail}</p><Link className="button" to="/join">Back to the room <span aria-hidden="true">↗</span></Link></section>; }
createRoot(document.getElementById('root')!).render(<BrowserRouter><App/></BrowserRouter>);

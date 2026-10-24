import { resumeAfterRestart } from './reconnect.js';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import type { ActionResult, ClientToServerEvents, HostLobby, PublicLobby, ServerToClientEvents, TransitionSchema } from '@localmenti/shared';
import type { z } from 'zod';
import { LobbyConnection } from './lobby.js';
import { HostQuestionControls } from './game.js';
import { WelcomeLobby } from './players.js';
import { advanceHost } from './host-transition.js';

export function HostSession({ sessionId }: { sessionId:string }) {
  const id = sessionId;
  const [lobby, setLobby] = useState<HostLobby>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents>>();
  useEffect(() => {
    let active = true;
    const checkLogin = async () => {
      try {
        const response = await fetch('/api/host/auth',{ credentials:'same-origin' });
        const auth = await response.json();
        if (!active) return;
        if (!response.ok) throw new Error('Unable to verify host login.');
        if (auth.authenticated === false) window.dispatchEvent(new Event('host:unauthorized'));
        else if (auth.authenticated === true) setError('Your host login is active, but the live connection failed. Use Reconnect to reopen the controls.');
        else throw new Error('Unable to verify host login.');
      } catch { if (active) setError('Cannot reach the local server. Your session has not been signed out. Use Reconnect.'); }
    };
    // Render the authenticated QR/PIN and controls independently of socket setup.
    fetch(`/api/host/sessions/${id}`,{ credentials:'same-origin' }).then(async response => {
      if (response.status === 401) { await checkLogin(); return; }
      if (!response.ok) throw new Error('Unable to load this host session.');
      const data = await response.json();
      if (active) { setLobby(current => current ?? data); }
    }).catch(error => { if (active) setError(error.message); });
    // A public status socket may predate login. A fresh transport sends the
    // current HttpOnly cookie instead of reusing that socket's old handshake.
    // LAN HTTP may omit Fetch Metadata on polling GETs. Browser WebSocket
    // handshakes carry an explicit Origin, keeping the host origin gate strict.
    const next: Socket<ServerToClientEvents, ClientToServerEvents> = io('/host', { autoConnect: false, forceNew: true, transports:['websocket'], withCredentials:true });
    const stopRestart = resumeAfterRestart(next);
    setSocket(next); setError(''); setLobby(undefined);
    next.on('connect', () => {
      next.timeout(5000).emit('host:watch', { sessionId: id }, (timeout: Error | null, result: ActionResult<HostLobby>) => {
        if (!active) return;
        if (timeout) { setError('The server did not acknowledge the lobby request. Reconnect to retry.'); return; }
        if (!result.ok) { setError(result.error); return; }
        setLobby(result.data); setConnected(true); setError('');
      });
    });
    next.on('host:lobby', data => setLobby(data));
    next.on('host:unauthorized', () => { stopRestart(); void checkLogin(); });
    next.on('disconnect', () => setConnected(false));
    next.on('connect_error', error => {
      setConnected(false); setError(error.message);
      if (error.message === 'Host sign-in required.') void checkLogin();
    });
    next.connect(); return () => { active = false; stopRestart(); next.disconnect(); };
  }, [id, retry]);
  function finish<T extends HostLobby | PublicLobby>(timeout: Error | null, result: ActionResult<T>) {
    setBusy(false);
    if (timeout) { setError('No acknowledgment received. Reconnect to check the current session state.'); return; }
    if (!result.ok) { setError(result.error); return; }
    setLobby(current => current && { ...current, ...result.data }); setError('');
  }
  async function transition(action: z.infer<typeof TransitionSchema>['action']) {
    if (!socket || !lobby || !connected || busy) return;
    setBusy(true); setError('');
    try {
      const result = await advanceHost(lobby,action,command => socket.volatile.timeout(5000).emitWithAck('host:transition',command));
      finish(null,result);
    } catch { setBusy(false); setError('No acknowledgment received. Reconnect to check the current stage before continuing.'); }
  }
  function end() {
    if (!socket || !connected || busy || !window.confirm('End this session now? The host will not be able to reopen it. Final scores will be published.')) return;
    setBusy(true); socket.volatile.timeout(5000).emit('host:end', { sessionId: id }, finish);
  }
  return <section className="presentation-screen"><header className="presentation-toolbar"><Link to="/host">Library</Link>{lobby && <><strong className="presentation-title">{lobby.title}</strong><span className="presentation-pin">PIN {lobby.pin}</span></>}<LobbyConnection connected={connected}/>{lobby && lobby.state !== 'FINISHED' && <button disabled={busy || !connected} onClick={end}>Stop session</button>}{lobby?.state === 'FINISHED' && <a className="presentation-download" href={`/api/host/sessions/${id}/export`}>Download all player ranks and points CSV</a>}</header>{error && <div className="error" role="alert">{error} <button onClick={() => setRetry(value => value+1)}>Reconnect</button></div>}{!lobby && !error && <p role="status">Opening presentation...</p>}{lobby && <>{lobby.state === 'LOBBY' && <WelcomeLobby session={lobby}/>}<HostQuestionControls session={lobby} connected={connected} busy={busy} onAction={transition} onEnd={end}/></>}</section>;
}

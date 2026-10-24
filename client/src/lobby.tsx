import { resumeAfterRestart } from './reconnect.js';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import { JoinSchema, NicknameInputSchema, type ClientToServerEvents, type ParticipantLobby, type PublicLobby, type ServerToClientEvents } from '@localmenti/shared';
import { ParticipantQuestion, QuestionView } from './game.js';
import { Avatar, MadeBy, Standings, WelcomeLobby } from './players.js';
import { PodiumMedal } from './winners.js';
import { ResultCardButton } from './result-card.js';
import './lobby.css';
import './focus.css';
import './presentation.css';
import './menti-board.css';
import { HostSession } from './session-host.js';
import { OpenInBrowser } from './desktop.js';

const tokenKey = (pin: string) => `localmenti:participant:${pin}`;
function readToken(pin: string) { try { const token = localStorage.getItem(tokenKey(pin)); return token && /^[a-f0-9]{64}$/.test(token) ? token : null; } catch { return null; } }
export function ScoringRules() {
  return <aside className="scoring-note"><strong>Correctness + speed. Every time.</strong><p>Correct answers earn 50–100% of the maximum points according to when the server receives your answer. Incorrect, missing and late answers earn 0. For a 1,000-point, 20-second question: 1,000 at the start, 750 at 10 seconds, 500 exactly at the deadline if accepted. Wireless congestion can affect timing.</p></aside>;
}
export function LobbyConnection({ connected }: { connected: boolean }) { return <span className="lobby-connection" role="status"><span className={`dot ${connected ? '' : 'pending'}`}/>{connected ? 'Connected to the room' : 'Connecting / reconnecting…'}</span>; }
export function JoinPage() { return <JoinForm/>; }
function JoinForm({ presetPin = '', onJoin }: { presetPin?: string; onJoin?: (token: string) => void }) {
  const [pin, setPin] = useState(presetPin);
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resuming = /^\d{6}$/.test(pin) && Boolean(readToken(pin));
  const nicknameInvalid = !resuming && nickname.length > 0 && !NicknameInputSchema.safeParse(nickname).success;
  const [recent] = useState(() => { try { const pin = localStorage.getItem('localmenti:last-pin'); return pin && /^\d{6}$/.test(pin) && readToken(pin) ? pin : null; } catch { return null; } });
  const navigate = useNavigate();
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    // A QR link pre-fills its PIN; if the player typed another one, go to that room's page.
    const sameRoom = Boolean(onJoin) && pin === presetPin;
    const enter = (token: string) => { if (sameRoom) onJoin!(token); else navigate(`/s/${pin}`); };
    const existing = readToken(pin);
    if (existing) { enter(existing); return; }
    const parsed = JoinSchema.safeParse({ pin, nickname });
    if (!parsed.success) { setError('Use a six-digit PIN and 1–24 letters or numbers only. No spaces or symbols.'); return; }
    setBusy(true);
    try {
      // Check storage before allocating an identity that could not be recovered.
      localStorage.setItem('localmenti:storage-check', '1'); localStorage.removeItem('localmenti:storage-check');
      const response = await fetch('/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.data) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Unable to join.');
      localStorage.setItem(tokenKey(pin), result.token); localStorage.setItem('localmenti:last-pin', pin);
      enter(result.token);
    } catch (error) { setError(error instanceof DOMException ? 'Enable browser storage to join and keep your identity after reconnecting.' : error instanceof Error ? error.message : 'Unable to reach the server. Try again.'); }
    finally { setBusy(false); }
  }
  return <section className="join-layout"><div><p className="kicker">A LITTLE FRIENDLY COMPETITION</p><h1>In the room.<br/>In the <em>moment.</em></h1><p className="intro">Same Wi-Fi. One shared room. Enter the PIN on the big screen and make yourself at home.</p><p className="local-note">No accounts. Your nickname and icon appear in the lobby.</p></div>
    <form className="join-card" onSubmit={submit}><p className="kicker">TAKE YOUR PLACE</p><h2>Join a quiz</h2>
      <label htmlFor="join-pin">Six-digit session PIN</label><input id="join-pin" className="pin-input" inputMode="numeric" pattern="[0-9]{6}" autoComplete="off" maxLength={6} required value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, ''))} placeholder="123456"/>
      {resuming ? <p className="resume-notice">Your saved player was found. Resume the current question; missed answers earn 0 points.</p> : <>      <label htmlFor="join-nickname">Your nickname</label><input id="join-nickname" type={nickname.includes('_') ? 'password' : 'text'} autoComplete={nickname.includes('_') ? 'off' : 'nickname'} maxLength={24} pattern={String.raw`(?:[\p{L}\p{N}]+|[A-Za-z0-9]{1,16}_[A-Za-z0-9]{4,16})`} aria-invalid={nicknameInvalid} aria-describedby="nickname-help" required value={nickname} onChange={event => setNickname(event.target.value)} placeholder="Letters and numbers only"/>
      <p id="nickname-help" className="hint">No spaces or symbols. Private join codes are also accepted. Duplicate names get a number. Your character is assigned automatically.</p>{nicknameInvalid && <p className="nickname-error" role="alert">Use letters and numbers, or your private join code.</p>}
</>}
      <button className="button" disabled={busy || nicknameInvalid}>{busy ? 'Joining...' : resuming ? 'Resume current question' : 'Join the room'}</button>{error && <p role="alert" className="error">{error}</p>}{recent && <Link className="resume-link" to={`/s/${recent}`}>Return to your session ({recent})</Link>}
    </form><div className="join-rules"><ScoringRules/></div><MadeBy/></section>;
}
export function ParticipantPage() {
  const { pin = '' } = useParams();
  return <Participant key={pin} pin={pin}/>;
}
function Participant({ pin }: { pin: string }) {
  const [token, setToken] = useState(() => readToken(pin));
  const [lobby, setLobby] = useState<ParticipantLobby>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [removed, setRemoved] = useState(false);
  const [retry, setRetry] = useState(0);
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents>>();
  useEffect(() => {
    if (!token) return;
    setError(''); setRemoved(false);
    const next: Socket<ServerToClientEvents, ClientToServerEvents> = io('/participant', { autoConnect: false, auth: { pin, token } });
    const stopRestart = resumeAfterRestart(next);
    setSocket(next);
    next.on('participant:ready', data => { setLobby(data); setConnected(true); setError(''); });
    next.on('participant:state', data => setLobby(data));
    next.on('participant:removed', () => { stopRestart(); setRemoved(true); setLobby(undefined); setConnected(false); setError('The host removed this identity from the session.'); });
    next.on('disconnect', () => setConnected(false));
    next.on('connect_error', error => { setConnected(false); setError(error.message); });
    next.connect(); return () => { stopRestart(); next.disconnect(); };
  }, [pin, token, retry]);
  if (!/^\d{6}$/.test(pin)) return <section className="participant-lobby"><h1 className="host-title">That PIN isn’t valid.</h1><Link to="/join">Enter a six-digit PIN</Link></section>;
  if (!token) return <JoinForm presetPin={pin} onJoin={setToken}/>;
  const standings = lobby?.session.state === 'LEADERBOARD' || lobby?.session.state === 'FINISHED';
  return <section className="participant-lobby participant-focus">
    <div className="participant-topbar">{lobby && <><Avatar index={lobby.participant.avatarIndex} small/><strong>{lobby.participant.nickname}</strong><span className="participant-pin">{pin}</span></>}<span className="lobby-connection" role="status"><span className={`dot ${connected ? '' : 'pending'}`}/>{connected ? 'Online' : 'Reconnecting'}</span></div>
    {!connected && lobby && <p className="participant-offline" role="status">Reconnecting to the current question. Missed answers earn 0 points.</p>}
    {error && <div className="error" role="alert">{error}{!removed && <button onClick={() => setRetry(value => value + 1)}>Reconnect</button>}<button onClick={() => { if (!window.confirm('Forget this saved identity?')) return; try { localStorage.removeItem(tokenKey(pin)); } catch { /* Storage may be disabled. */ } setToken(null); setLobby(undefined); }}>Forget identity</button></div>}
    {lobby ? standings ? <PersonalStanding participant={lobby.participant} players={lobby.session.joinedCount} finished={lobby.session.state === 'FINISHED'} lobby={lobby}/> : lobby.session.question ? <ParticipantQuestion key={lobby.session.question.id} session={lobby.session} submission={lobby.submission} socket={socket} connected={connected} onAccepted={receipt => setLobby(current => current && current.session.question?.id === receipt.questionId ? { ...current, submission:receipt } : current)}/> : <div className="participant-wait"><p className="kicker">You're in</p>{lobby.session.eventName && <p className="wait-event">{lobby.session.eventName}</p>}<h1>{lobby.session.title}</h1><p>Watch the host screen. The first question starts when the host is ready.</p></div> : !error && <p role="status">Restoring your place...</p>}
  </section>;
}
export function PersonalStanding({ participant, players, finished, lobby }: { participant:ParticipantLobby['participant']; players?:number; finished:boolean; lobby?:ParticipantLobby }) {
  return <section className="personal-result" aria-label="Your own standings"><p className="kicker">{finished ? 'Your final result' : 'Your result'}</p>{finished && <PodiumMedal rank={participant.rank}/>}<h1>{finished ? 'Thanks for playing.' : 'Every second counted.'}</h1><div className="personal-result-grid"><div><span>Your rank</span><strong>{participant.rank === null ? '-' : '#'+participant.rank}</strong>{participant.rank !== null && players ? <small>of {players} players</small> : null}</div><div><span>Your points</span><strong>{participant.score.toLocaleString()}</strong></div></div>{!finished && <p>Waiting for the next question...</p>}{finished && lobby && <ResultCardButton lobby={lobby}/>}{finished && <MadeBy/>}</section>;
}

export function PresenterPage() {
  const { pin = '' } = useParams();
  const navigate = useNavigate();
  const [role,setRole] = useState<'host' | 'public'>();
  const [sessionId,setSessionId] = useState('');
  const [error,setError] = useState('');
  const [retry,setRetry] = useState(0);
  useEffect(() => {
    let active = true; setError(''); setRole(undefined);
    const expired = () => navigate('/host/login',{ replace:true,state:{ returnTo:`/present/${pin}` } });
    window.addEventListener('host:unauthorized',expired);
    fetch('/api/host/auth',{ credentials:'same-origin' }).then(async response => {
      if (!response.ok) throw new Error('Unable to check projector access.');
      const auth = await response.json();
      if (!auth.authenticated) { if (active) setRole('public'); return; }
      const sessionResponse = await fetch(`/api/sessions/${pin}`,{ credentials:'same-origin' });
      if (!sessionResponse.ok) throw new Error('Session not found.');
      const session = await sessionResponse.json();
      if (active) { setSessionId(session.id); setRole('host'); }
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; window.removeEventListener('host:unauthorized',expired); };
  },[pin,retry,navigate]);
  if (error) return <p className="error" role="alert">{error} <button onClick={() => setRetry(value => value+1)}>Retry</button></p>;
  if (!role) return <p role="status">Opening projector...</p>;
  return role === 'host' ? <HostSession key={sessionId} sessionId={sessionId}/> : <PresenterDisplay/>;
}
function PresenterDisplay() {

  const { pin = '' } = useParams();
  const [lobby, setLobby] = useState<PublicLobby>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setLobby(undefined); setError('');
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io('/present', { auth: { pin }, autoConnect: false });
    const stopRestart = resumeAfterRestart(socket);
    socket.on('lobby:update', data => { setLobby(data); setConnected(true); setError(''); });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', error => { setConnected(false); setError(error.message); });
    socket.connect(); return () => { stopRestart(); socket.disconnect(); };
  }, [pin, retry]);
  return <section className="presenter-lobby presentation-screen"><div className="presenter-top presentation-toolbar"><OpenInBrowser className="open-in-browser presentation-open-in-browser"/><span className="kicker">{lobby?.state === 'LOBBY' ? 'THE ROOM IS COMING TOGETHER' : `SESSION ${pin}`}</span><LobbyConnection connected={connected}/><Link className="presenter-host-login" to="/host/login" state={{ returnTo:`/present/${pin}` }}>Host controls</Link></div>{error && <p className="error" role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>Reconnect</button></p>}{!lobby && !error && <p role="status">Opening the projector…</p>}{lobby && <><h1 className="presenter-title">{lobby.state === 'FINISHED' ? 'Thanks for joining.' : lobby.title}</h1>{lobby.state === 'LOBBY' ? <WelcomeLobby session={lobby}/> : lobby.state === 'FINISHED' ? <Standings session={lobby}/> : lobby.state === 'LEADERBOARD' ? <Standings session={lobby}/> : <QuestionView key={lobby.question?.id} session={lobby}/>}<p className="presenter-rules">Correct + faster = more points. Correct answers earn 50–100% of maximum points; incorrect, missing and late answers earn 0. Wireless congestion can affect timing.</p></>}</section>;
}

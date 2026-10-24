import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { MAX_IMPORT_BYTES, MIN_ANSWER_SECONDS, QuizDraftSchema, type HostLobby, type NetworkAddress, type Question, type Quiz, type QuizDraft, type QuizSummary } from '@localmenti/shared';
import './host.css';
import { ImportGuide } from './import-guide.js';
import { PodiumCardButton } from './result-card.js';
import { parseQuizImport } from './import-json.js';
import { Avatar } from './players.js';

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/host${path}`, {
    method, credentials: 'same-origin', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/login') window.dispatchEvent(new Event('host:unauthorized'));
    const issue = data.issues?.[0];
    throw new Error(issue ? `${data.error} ${issue.path?.join('.') || 'quiz'}: ${issue.message}` : data.error ?? 'Request failed. Try again.');
  }
  return data as T;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong.';
const draftOf = (quiz: Quiz): QuizDraft => ({ title: quiz.title, description: quiz.description, durationSeconds: quiz.durationSeconds, questions: quiz.questions });

export function HostArea() {
  const [auth, setAuth] = useState<{ configured: boolean; authenticated: boolean }>();
  const [error, setError] = useState('');
  const location = useLocation();
  const returnTo = location.state?.returnTo;
  const hostDestination = typeof returnTo === 'string' && (/^(?:\/host\/(?:session|quizzes)\/[^/?#]+|\/present\/\d{6})$/.test(returnTo)) ? returnTo : '/host';
  useEffect(() => {
    let active = true;
    api<{ configured: boolean; authenticated: boolean }>('/auth').then(data => { if (active) setAuth(data); }).catch(error => { if (active) setError(message(error)); });
    const expired = () => setAuth(current => current && { ...current, authenticated: false });
    window.addEventListener('host:unauthorized', expired);
    return () => { active = false; window.removeEventListener('host:unauthorized', expired); };
  }, []);
  if (error) return <div className="host-page"><p role="alert" className="error">{error}</p><button onClick={() => window.location.reload()}>Try again</button></div>;
  if (!auth) return <p className="host-page" role="status">Opening host space…</p>;
  if (!auth.authenticated) return location.pathname === '/host/login'
    ? <Login configured={auth.configured} onLogin={() => setAuth({ configured: true, authenticated: true })}/>
    : <Navigate to="/host/login" state={{ returnTo:location.pathname }} replace/>;
  return <div className="host-page"><div className="host-top"><span className="kicker">YOUR HOST SPACE</span><button className="text-button" onClick={async () => {
    if (!window.confirm('Sign out? Make sure your quiz says “All changes saved” first.')) return;
    try { await api('/logout', 'POST', {}); setAuth({ configured: true, authenticated: false }); } catch (error) { setError(message(error)); }
  }}>Sign out</button></div><Routes>
    <Route index element={<Library/>}/><Route path="login" element={<Navigate to={hostDestination} replace/>}/>
    <Route path="quizzes/:id" element={<EditorRoute/>}/>
    <Route path="session/:id" element={<SessionRedirect/>}/>
    <Route path="*" element={<><h1 className="host-title">This page isn’t here.</h1><Link to="/host">Back to your quizzes</Link></>}/>
  </Routes></div>;
}
function Login({ configured, onLogin }: { configured: boolean; onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (!configured && password !== confirm) throw new Error('The two passwords do not match.');
      await api(configured ? '/login' : '/setup', 'POST', { password }); onLogin();
    }
    catch (error) { setError(message(error)); }
    finally { setBusy(false); setPassword(''); setConfirm(''); }
  }
  return <section className="login-layout"><div><p className="kicker">FOR THE PERSON BRINGING EVERYONE TOGETHER</p><h1>Your room.<br/>Your questions.</h1><p className="intro">A little preparation. A lot of participation. Keep your quiz library here, on this laptop.</p></div><form className="login-card" onSubmit={submit}><span className="kicker">HOST SIGN-IN</span><h2>{configured ? 'Welcome back.' : 'Create your host password'}</h2>{configured ? <>
    <label htmlFor="host-password">Host password</label><input autoComplete="current-password" id="host-password" type="password" minLength={12} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)}/>
    <p className="hint">Use the password configured on this laptop.</p><button className="button" disabled={busy}>{busy ? 'Signing in…' : 'Open host space ↗'}</button>
  </> : <>
    <p className="hint">First time on this laptop. Choose a password of at least 12 characters; you will use it to open the host space.</p>
    <label htmlFor="host-password">New host password</label><input autoComplete="new-password" id="host-password" type="password" minLength={12} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)}/>
    <label htmlFor="host-password-confirm">Type it again</label><input autoComplete="new-password" id="host-password-confirm" type="password" minLength={12} maxLength={128} required value={confirm} onChange={event => setConfirm(event.target.value)}/>
    <button className="button" disabled={busy}>{busy ? 'Saving…' : 'Create password and open host space'}</button>
    <p className="hint">This works only on the host laptop itself. Players on Wi-Fi cannot set it.</p>
  </>}
  {error && <p role="alert" className="error">{error}</p>}<p className="hint">Local access. No online account.</p></form></section>;
}
function Library() {
  const [quizzes, setQuizzes] = useState<QuizSummary[]>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [showImport,setShowImport] = useState(false);
  const importing = useRef(false);
  useEffect(() => { let active = true; api<QuizSummary[]>('/quizzes').then(data => { if (active) setQuizzes(data); }).catch(error => { if (active) setError(message(error)); }); return () => { active = false; }; }, []);
  async function create() {
    setBusy(true); setError('');
    try { const quiz = await api<Quiz>('/quizzes', 'POST', { title: 'Untitled quiz', description: '', questions: [] }); navigate(`/host/quizzes/${quiz.id}`); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  async function importQuiz(source?: File | string) {
    if (source === undefined || importing.current) return;
    importing.current = true;
    setBusy(true); setError('');
    try {
      if (typeof source !== 'string' && source.size > MAX_IMPORT_BYTES) throw new Error('Quiz files must be 512 KiB or smaller.');
      const parsed = parseQuizImport(typeof source === 'string' ? source : await source.text());
      const quiz = await api<Quiz>('/quizzes/import', 'POST', parsed);
      navigate(`/host/quizzes/${quiz.id}`,{ state:{ imported:true } });
    } catch (error) { setError(error instanceof SyntaxError ? 'This file is not valid JSON.' : message(error)); }
    finally { importing.current = false; setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function remove(quiz: QuizSummary) {
    if (!window.confirm(`Delete “${quiz.title}” and its questions? This cannot be undone. Any open room for this quiz will end; saved session results are kept.`)) return;
    setBusy(true); setError('');
    try { await api(`/quizzes/${quiz.id}`, 'DELETE'); setQuizzes(current => current?.filter(item => item.id !== quiz.id)); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <><div className="library-heading"><div><h1 className="host-title">Good questions<br/>start <em>here.</em></h1><p className="muted">Your quiz library. Saved on this laptop.</p></div><div className="toolbar"><input ref={fileInput} className="visually-hidden" type="file" accept=".json,application/json" aria-label="Import quiz JSON file" onChange={event => void importQuiz(event.target.files?.[0])}/><button disabled={busy} onClick={() => { setError(''); setShowImport(true); }}>Import JSON</button><button className="button" disabled={busy} onClick={() => void create()}>＋ Create quiz</button></div></div>
    {error && <p role="alert" className="error">{error}</p>}
    <SessionLaunch quizzes={quizzes ?? []}/>
    <CompletedSessions key={quizzes?.map(quiz => quiz.id).join(',')}/>
    {showImport && <ImportGuide busy={busy} error={error} onClose={() => setShowImport(false)} onChoose={() => fileInput.current?.click()} onPaste={text => void importQuiz(text)}/>}
    {!quizzes && !error && <p role="status">Loading your library…</p>}
    {quizzes?.length === 0 && <div className="empty-library"><span className="empty-symbol" aria-hidden="true">?</span><h2>Every great round starts with a question.</h2><p>Create your first quiz, or import a MuziQuiz JSON file.</p><button disabled={busy} onClick={() => void create()}>Create your first quiz ↗</button></div>}
    <div className="quiz-grid">{quizzes?.map((quiz, index) => <article className="quiz-card" key={quiz.id}><div className="card-number">{String(index + 1).padStart(2, '0')} <span>{quiz.questionCount} {quiz.questionCount === 1 ? 'question' : 'questions'}</span></div><h2><Link to={`/host/quizzes/${quiz.id}`}>{quiz.title}</Link></h2><p>{quiz.description || 'A fresh set of possibilities.'}</p><div className="card-actions"><Link className="edit-link" to={`/host/quizzes/${quiz.id}`}>Edit quiz ↗</Link><button disabled={busy} className="text-button danger" onClick={() => void remove(quiz)} aria-label={`Delete ${quiz.title}`}>Delete</button></div></article>)}</div>
    <p className="phase-note">Live questions and server-controlled speed scoring are ready. Top-10 standings, unscored polls and local CSV exports are ready.</p></>;
}
function CompletedSessions() {
  const [resetting,setResetting] = useState(false);
  async function reset() {
    if (!window.confirm("Clear all finished-session history, player data, answers and results? Saved quizzes and the active session stay. A local backup is created first.")) return;
    setResetting(true);
    try { await api("/sessions/history","DELETE"); setSessions([]); setError(""); } catch (error) { setError(message(error)); } finally { setResetting(false); }
  }
  const [sessions, setSessions] = useState<{ id: string; title: string; pin: string; endedAt: number }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () => { api<typeof sessions>('/sessions/history').then(data => { if (active) { setSessions(data); setError(''); } }).catch(error => { if (active) setError(message(error)); }); };
    refresh(); window.addEventListener('focus',refresh); window.addEventListener('localmenti:sessions-changed',refresh);
    return () => { active = false; window.removeEventListener('focus',refresh); window.removeEventListener('localmenti:sessions-changed',refresh); };
  },[]);
  if (error) return <p className="error" role="alert">Recent sessions: {error}</p>;
  if (!sessions.length) return null;
  return <details className="completed-sessions" aria-label="Recent finished sessions"><summary>Recent finished sessions <span className="muted">({sessions.length})</span></summary><p className="hint">Saved final standings stay available after a restart or deletion of the original quiz.</p><button className="danger" disabled={resetting} onClick={() => void reset()}>{resetting ? "Clearing history..." : "Reset finished-session data"}</button><div className="finished-session-list">{sessions.map(session => <SavedSession key={session.id} session={session}/>)}</div></details>;
}
function SavedSession({ session }: { session: { id: string; title: string; pin: string; endedAt: number } }) {
  const [saved,setSaved] = useState<HostLobby>();
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const pending = useRef(false);
  async function load() {
    if (saved || pending.current) return;
    pending.current = true; setLoading(true); setError('');
    try { setSaved(await api<HostLobby>(`/sessions/${session.id}`)); }
    catch (error) { setError(message(error)); }
    finally { pending.current = false; setLoading(false); }
  }
  return <article className="saved-session"><div className="saved-session-heading"><div><h3>{session.title}</h3><p className="hint">PIN {session.pin} / {new Date(session.endedAt).toLocaleString()}</p></div><Link to={`/present/${session.pin}`}>Open session results</Link></div><details onToggle={event => { if (event.currentTarget.open) void load(); }}><summary>View saved leaderboard</summary>{loading && <p role="status">Loading saved standings...</p>}{error && <p className="error" role="alert">{error} <button onClick={() => void load()}>Retry</button></p>}{saved && <><p className="hint">Final standings / {saved.joinedCount} participants</p>{saved.leaderboard.length ? <ol className="saved-leaderboard" aria-label={`Saved final leaderboard for ${session.title}`}>{saved.leaderboard.map(player => <li key={player.id}><strong className="visible-rank">{player.rank}</strong><Avatar index={player.avatarIndex} small/><span>{player.nickname}</span><strong>{player.score.toLocaleString()} <small>pts</small></strong></li>)}</ol> : <p className="hint">No scored standings in this session. Poll-only sessions do not have ranked winners.</p>}<div className="saved-session-actions"><PodiumCardButton session={saved} className="button"/><a className="saved-results-export" href={`/api/host/sessions/${session.id}/export`}>Download saved results CSV</a></div></>}</details></article>;
}

function SessionLaunch({ quizzes }: { quizzes: QuizSummary[] }) {
  const [addresses, setAddresses] = useState<NetworkAddress[]>([]);
  const [active, setActive] = useState<HostLobby | null>();
  const [quizId, setQuizId] = useState('');
  const [address, setAddress] = useState('');
  const [previewSeconds, setPreviewSeconds] = useState(3);
  const [eventName, setEventName] = useState(() => { try { return localStorage.getItem('localmenti:event-name') ?? ''; } catch { return ''; } });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    let request = 0;
    const refresh = () => {
      const current = ++request;
      Promise.all([api<{ addresses: NetworkAddress[] }>('/network'), api<HostLobby | null>('/sessions/active')]).then(([network, room]) => {
        if (!mounted || current !== request) return;
        setAddresses(network.addresses); setActive(room); setError('');
        if (network.addresses.length === 1) setAddress(network.addresses[0].address);
      }).catch(error => { if (mounted && current === request) setError(message(error)); });
    };
    refresh(); window.addEventListener('focus',refresh);
    return () => { mounted = false; window.removeEventListener('focus',refresh); };
  }, [quizzes]);
  useEffect(() => { if (quizId && !quizzes.some(quiz => quiz.id === quizId)) setQuizId(''); },[quizzes,quizId]);
  async function open() {
    setBusy(true); setError('');
    try { const lobby = await api<HostLobby>('/sessions', 'POST', { quizId, lanAddress: address, previewSeconds, eventName: eventName.trim() }); setActive(lobby); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  async function stop() {
    if (!active || busy || !window.confirm('Stop this session? Final results will be saved and the session cannot be reopened.')) return;
    setBusy(true); setError('');
    try { await api(`/sessions/${active.id}/end`,'POST',{}); setActive(null); window.dispatchEvent(new Event('localmenti:sessions-changed')); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  if (active) return <><div className="active-lobby"><div><strong>Your session is ready.</strong><p>{active.title} / PIN {active.pin}</p></div><div className="toolbar"><Link className="button" to={`/present/${active.pin}`}>Open session / Return to lobby</Link><button className="danger" disabled={busy} onClick={() => void stop()}>Stop session</button></div></div>{error && <p className="error" role="alert">{error}</p>}</>;

  return <section className="session-launch" aria-label="Open a live lobby"><h2>Bring the room together.</h2><p className="hint">Start session creates the QR/PIN lobby here without changing pages. Open session when ready. Choose a saved quiz and the IPv4 adapter on the audience’s LAN. The session uses a fixed copy of the saved questions.</p>{error && <p role="alert" className="error">{error}</p>}<label className="event-name-field"><span>Event name <span className="muted">(optional)</span></span><input maxLength={80} value={eventName} placeholder="e.g. Friday Science Night – Room 4" onChange={event => { setEventName(event.target.value); try { localStorage.setItem('localmenti:event-name', event.target.value); } catch { /* Remembering is optional. */ } }}/><span className="hint">Shown on the waiting screen and on every player’s result card.</span></label><div className="toolbar"><label>Quiz<select value={quizId} onChange={event => setQuizId(event.target.value)}><option value="">Choose a quiz</option>{quizzes.filter(quiz => quiz.questionCount > 0).map(quiz => <option key={quiz.id} value={quiz.id}>{quiz.title}</option>)}</select></label><label>Participant LAN address<select value={address} onChange={event => setAddress(event.target.value)}><option value="">Choose the audience’s adapter</option>{addresses.map(value => <option key={value.address} value={value.address}>{value.label} · {value.address}</option>)}</select></label><label>Read question first<select value={previewSeconds} onChange={event => setPreviewSeconds(Number(event.target.value))}>{[3,4,5].map(seconds => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label><button className="button" disabled={busy || !quizId || !address || active === undefined} onClick={() => void open()}>{busy ? 'Opening…' : 'Start session ↗'}</button></div>{active !== undefined && addresses.length === 0 && <p className="hint">Connect this laptop to a LAN, then reload to find its IPv4 address.</p>}</section>;
}
function EditorRoute() {
  const { id } = useParams();
  return <Editor key={id} id={id!}/>;
}
function SessionRedirect() {
  const { id = '' } = useParams(); const navigate = useNavigate();
  const [error,setError] = useState('');
  useEffect(() => {
    let active = true;
    api<HostLobby>(`/sessions/${id}`).then(session => { if (active) navigate(`/present/${session.pin}`,{ replace:true }); }).catch(error => { if (active) setError(message(error)); });
    return () => { active = false; };
  },[id,navigate]);
  return error ? <p className="error" role="alert">{error} <Link to="/host">Quiz library</Link></p> : <p role="status">Opening projector controls...</p>;
}
function newQuestion(type: Question['type'] = 'quiz_mcq'): Question {
  return { type, text: type === 'poll_mcq' ? 'New poll' : 'New question', options: [{ id: 'a', text: 'Option 1' }, { id: 'b', text: 'Option 2' }, { id: 'c', text: 'Option 3' }, { id: 'd', text: 'Option 4' }], correctOptionId: type === 'poll_mcq' ? null : 'a', basePoints: type === 'poll_mcq' ? 0 : 1000, explanation: '' };
}
function Editor({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const latestFingerprint = useRef('');
  const [draft, setDraft] = useState<QuizDraft>();
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const saveInFlight = useRef(false);
  const fingerprint = draft ? JSON.stringify(draft) : '';
  latestFingerprint.current = fingerprint;
  const dirty = Boolean(draft && fingerprint !== saved);
  const parsed = draft ? QuizDraftSchema.safeParse(draft) : undefined;
  const validation = parsed && !parsed.success ? parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(' · ') : '';
  useEffect(() => {
    let active = true;
    api<Quiz>(`/quizzes/${id}`).then(quiz => {
      if (!active) return;
      setDraft(draftOf(quiz)); setRevision(quiz.updatedAt); setSaved(JSON.stringify(draftOf(quiz)));
    }).catch(error => { if (active) setLoadError(message(error)); });
    return () => { active = false; };
  }, [id]);
  async function saveNow(returnToLibrary = false) {
    if (!draft || validation || saveInFlight.current) return;
    if (!dirty && !returnToLibrary) return;
    saveInFlight.current = true; setSaving(true); setError('');
    try {
      const quiz = await api<Quiz>(`/quizzes/${id}`, 'PUT', { ...draft, expectedUpdatedAt: revision });
      setRevision(quiz.updatedAt); setSaved(fingerprint);
      if (returnToLibrary && latestFingerprint.current === fingerprint) navigate('/host');
    } catch (error) { setError(message(error)); }
    finally { saveInFlight.current = false; setSaving(false); }
  }
  useEffect(() => {
    if (!draft || !dirty || validation || saving || error) return;
    const timer = window.setTimeout(() => { void saveNow(); },800);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, validation, saving, error, id, revision, fingerprint, retry]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const linkClick = (event: MouseEvent) => {
      const link = (event.target as Element).closest('a');
      if (link && !(link.pathname === window.location.pathname && link.search === window.location.search && link.hash) && link.href !== window.location.href && !window.confirm('Some edits are not saved yet. Leave this page?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', linkClick, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', linkClick, true); };
  }, [dirty]);
  function changeQuestion(index: number, question: Question) { setDraft(current => current && { ...current, questions: current.questions.map((item, i) => i === index ? question : item) }); }
  function move(index: number, direction: number) {
    setDraft(current => {
      if (!current) return current;
      const questions = [...current.questions];
      [questions[index], questions[index + direction]] = [questions[index + direction], questions[index]];
      return { ...current, questions };
    });
  }
  async function exportQuiz() {
    try {
      const file = await api(`/quizzes/${id}/export`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `localmenti-${id}.json`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setError(message(error)); }
  }
  if (loadError) return <p className="error" role="alert">{loadError} <Link to="/host">Return to library</Link></p>;
  if (!draft) return <p role="status">Opening your quiz…</p>;
  return <div className="quiz-workbench"><div className="editor-heading editor-savebar"><Link className="back-link" to="/host">← Your quizzes</Link><div className="toolbar"><span className={`save-state ${dirty ? 'unsaved' : ''}`} role="status">{saving ? 'Saving…' : error ? 'Not saved' : dirty ? validation ? 'Fix fields to save' : 'Changes pending…' : `All ${draft.questions.length} questions saved`}</span><button className="button" disabled={saving || Boolean(validation)} onClick={() => void saveNow(true)}>{saving ? 'Saving...' : 'Save quiz & return'}</button><button disabled={dirty || saving} onClick={() => void exportQuiz()}>Export JSON</button></div></div>
    {location.state?.imported && <p className="save-explainer" role="status">Import complete. Your quiz and all its questions are saved. Use Save quiz &amp; return to choose it in the library.</p>}<header className="workbench-header"><div><p className="kicker">THE QUESTION WORKSHOP</p><h1 className="host-title small-title">Make it <em>memorable.</em></h1><p className="muted">Write a clear question. Add believable choices. Mark the correct answer.</p></div><div className="workbench-tally"><strong>{draft.questions.filter(question => question.type === 'quiz_mcq').length}</strong><span>scored MCQs</span><small>{draft.questions.filter(question => question.type === 'poll_mcq').length} opinion polls</small></div></header><p className="save-explainer">Imported quizzes are saved immediately. Edits save automatically; Save quiz & return confirms your saved quiz and opens the library. Every question, choice, correct answer and timing setting is included.{!dirty && revision > 0 ? ` Last saved at ${new Date(revision).toLocaleTimeString()}.` : ''}</p>
    {error && <div className="error" role="alert">{error} <button onClick={() => { setError(''); setRetry(value => value + 1); }}>Retry save</button></div>}
    {validation && <p className="error" role="alert">Not saved yet. {validation}</p>}
    <section className="quiz-details"><label>Quiz title<input maxLength={120} required value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })}/></label><label>Answer time for every question (seconds)<input type="number" min={MIN_ANSWER_SECONDS} max={120} step={1} required value={Number.isNaN(draft.durationSeconds) ? '' : draft.durationSeconds} onChange={event => setDraft({ ...draft, durationSeconds: event.target.valueAsNumber })}/><span className="hint">One shared answer window of {MIN_ANSWER_SECONDS}–120 seconds for all MCQs and polls. Reading time is separate.</span></label><label>Description <span className="muted">(optional)</span><textarea maxLength={2000} rows={2} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })}/></label></section>
    <div className="section-heading"><h2>Questions <span className="muted">/ {draft.questions.length}</span></h2><span className="hint">2–6 choices · scored quizzes or unscored polls</span></div>
    {draft.questions.length === 0 && <div className="empty-library compact"><h2>Your first question is waiting.</h2><p>Add a multiple-choice question to get started.</p></div>}
    {draft.questions.length > 0 && <nav className="question-index" aria-label="Jump to a question">{draft.questions.map((question,index) => <a key={index} href={`#question-${index + 1}`}><strong>{String(index + 1).padStart(2,'0')}</strong><span>{question.text || 'Untitled question'}</span></a>)}</nav>}
    {draft.questions.map((question, index) => <QuestionEditor key={index} question={question} index={index} count={draft.questions.length} change={question => changeQuestion(index, question)} move={direction => move(index, direction)} remove={() => {
      if (window.confirm(`Remove question ${index + 1}?`)) setDraft({ ...draft, questions: draft.questions.filter((_, i) => i !== index) });
    }}/>) }
    <div className="add-question-actions"><button className="add-question" disabled={draft.questions.length >= 100} onClick={() => setDraft({ ...draft, questions: [...draft.questions, newQuestion()] })}>＋ Add scored question</button><button className="add-question" disabled={draft.questions.length >= 100} onClick={() => setDraft({ ...draft, questions: [...draft.questions, newQuestion('poll_mcq')] })}>＋ Add opinion poll</button></div>
    <aside className="scoring-note"><strong>Correctness + speed. Every time.</strong><p>Correct answers earn 50–100% of maximum points based on server receipt time. Incorrect, missing and late answers earn 0. For 1,000 points over 20 seconds: 1,000 at the start, 750 at 10 seconds, 500 exactly at the deadline if accepted. Wireless congestion can affect timing.</p></aside></div>;
}
function QuestionEditor({ question, index, count, change, move, remove }: { question: Question; index: number; count: number; change: (question: Question) => void; move: (direction: number) => void; remove: () => void }) {
  return <section id={`question-${index + 1}`} className="question-card" aria-label={`Question ${index + 1}`}><div className="question-heading"><span className="question-number">QUESTION {String(index + 1).padStart(2, '0')}</span><div className="question-controls"><button disabled={index === 0} aria-label={`Move question ${index + 1} up`} onClick={() => move(-1)}>↑</button><button disabled={index === count - 1} aria-label={`Move question ${index + 1} down`} onClick={() => move(1)}>↓</button><button className="text-button danger" onClick={remove}>Remove</button></div></div>
    <label className="question-kind">Question type<select value={question.type} onChange={event => { const type = event.target.value as Question['type']; change({ ...question, type, correctOptionId: type === 'poll_mcq' ? null : question.options[0].id, basePoints: type === 'poll_mcq' ? 0 : 1000 }); }}><option value="quiz_mcq">Scored multiple-choice quiz</option><option value="poll_mcq">Opinion poll · no score</option></select></label>
    <label>Question text <span className="hint">Keep it clear and concise</span><textarea required maxLength={2000} rows={2} value={question.text} onChange={event => change({ ...question, text: event.target.value })}/></label>
    <fieldset><legend>Answer choices <span className="hint">{question.type === 'poll_mcq' ? 'Everyone chooses an opinion; no correct answer' : 'Select the correct answer'}</span></legend>{question.options.map((option, optionIndex) => <div className={`option-row ${option.id === question.correctOptionId ? 'correct-option' : ''}`} key={option.id}>{question.type === 'quiz_mcq' ? <label className="correct-radio"><input type="radio" name={`correct-${index}`} checked={option.id === question.correctOptionId} onChange={() => change({ ...question, correctOptionId: option.id })} aria-label={`Question ${index + 1}, option ${optionIndex + 1} is correct`}/><span aria-hidden="true">{String.fromCharCode(65 + optionIndex)}</span></label> : <span className="poll-letter">{String.fromCharCode(65 + optionIndex)}</span>}<input aria-label={`Question ${index + 1}, option ${optionIndex + 1} text`} required maxLength={300} value={option.text} onChange={event => change({ ...question, options: question.options.map(item => item.id === option.id ? { ...item, text: event.target.value } : item) })}/>{question.type === 'quiz_mcq' && option.id === question.correctOptionId && <span className="correct-choice-badge">Correct</span>}<button className="remove-option" aria-label={`Remove option ${optionIndex + 1}`} disabled={question.options.length <= 2} onClick={() => {
      const options = question.options.filter(item => item.id !== option.id);
      change({ ...question, options, correctOptionId: question.type === 'poll_mcq' ? null : question.correctOptionId === option.id ? options[0].id : question.correctOptionId });
    }}>×</button></div>)}</fieldset>
    <button className="text-button" disabled={question.options.length >= 6} onClick={() => {
      const id = ['a','b','c','d','e','f'].find(id => !question.options.some(option => option.id === id))!;
      change({ ...question, options: [...question.options, { id, text: `Option ${question.options.length + 1}` }] });
    }}>＋ Add answer choice</button>
    <div className="question-settings"><label>{question.type === 'poll_mcq' ? 'Unscored poll' : 'Maximum points'}<input disabled={question.type === 'poll_mcq'} type="number" required min={question.type === 'poll_mcq' ? 0 : 1} max={10000} step={1} value={Number.isNaN(question.basePoints) ? '' : question.basePoints} onChange={event => change({ ...question, basePoints: event.target.valueAsNumber })}/></label></div>
    <label>Explanation <span className="muted">(optional, shown after reveal)</span><textarea rows={2} maxLength={2000} value={question.explanation} onChange={event => change({ ...question, explanation: event.target.value })}/></label>
  </section>;
}

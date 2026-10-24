import { useEffect, useRef, useState } from 'react';
import { avatarFor, RESERVED_AVATAR_INDEX, type LobbyPlayer, type PublicLobby, type RankEntry } from '@localmenti/shared';
import './players.css';
import { WinnersReveal } from './winners.js';
import { PodiumCardButton } from './result-card.js';

const CREATOR_URL = 'https://www.linkedin.com/in/m-muzammal-muzi5622/';
export function MadeBy() { return <p className="made-by">Made by <a href={CREATOR_URL} target="_blank" rel="noopener noreferrer" aria-label="MUZI on LinkedIn (opens in a new tab)"><strong>MUZI</strong></a></p>; }
export function Avatar({ index, small = false }: { index: number; small?: boolean }) {
  const avatar = avatarFor(index);
  return <span className={`player-avatar ${small ? 'avatar-small' : ''} ${index === RESERVED_AVATAR_INDEX ? 'avatar-reserved' : ''}`} style={{ ['--avatar' as string]: avatar.color }} aria-hidden="true"><span className="avatar-glyph">{avatar.icon}</span></span>;
}
export function ArrivalWall({ players, compact = false, limit }: { players: LobbyPlayer[]; compact?: boolean; limit?:number }) {
  const visible = players.slice(-(limit ?? (compact ? 12 : 48)));
  return <section className={`arrival-wall ${compact ? 'arrival-compact' : ''}`} aria-label="Players in the lobby"><div className="arrival-heading"><h2>The room is filling up.</h2><span className="hint" role="status">{players.length} joined{players.length > visible.length ? ` · latest ${visible.length} shown` : ''}</span></div>{visible.length === 0 ? <p className="arrival-empty">Your first players will appear here, each with their own character.</p> : <div className="arrival-grid">{visible.map(player => <div className={`arrival-player ${player.connected ? '' : 'player-offline'} ${player.avatarIndex === RESERVED_AVATAR_INDEX ? 'arrival-reserved' : ''}`} key={player.id}><Avatar index={player.avatarIndex}/><strong>{player.nickname}{player.avatarIndex === RESERVED_AVATAR_INDEX && <small className="reserved-tag">RESERVED</small>}</strong><span>{player.connected ? 'Here!' : 'Connecting / away'}</span></div>)}</div>}</section>;
}
export function WelcomeLobby({ session }: { session:PublicLobby }) {
  const [limit,setLimit] = useState(24);
  useEffect(() => {
    const resize = () => setLimit(window.innerWidth < 700 ? 6 : window.innerHeight < 700 ? 12 : 24);
    resize(); window.addEventListener('resize',resize);
    return () => window.removeEventListener('resize',resize);
  },[]);
  return <section className="welcome-lobby" aria-label="Live waiting lobby"><div className="welcome-address">{session.eventName && <span className="welcome-event">{session.eventName}</span>}<span>On the same Wi-Fi, open http://</span><strong>{new URL(session.joinUrl, 'http://localhost').host}</strong></div><div className="welcome-join"><p className="welcome-brand"><span className="brand-mark" aria-hidden="true">mq<span>•</span></span>MuziQuiz</p><h2>Join the room.</h2><p className="hint">Same Wi-Fi. Scan the QR or enter the PIN:</p><div className="host-pin">{session.pin}</div><img className="host-qr" width={190} height={190} src={`/api/sessions/${session.pin}/qr?v=${encodeURIComponent(session.joinUrl)}`} alt={`Join quiz with PIN ${session.pin}`}/></div><div className="welcome-players"><ArrivalWall players={session.players} limit={limit}/></div><div className="welcome-counter" role="status" aria-live="polite" aria-atomic="true"><strong key={session.connectedCount}>{session.connectedCount}</strong><span>connected now<small>{session.joinedCount} joined</small></span></div><MadeBy/></section>;
}
export function Standings({ session }: { session: PublicLobby }) {
  if (session.state !== 'LEADERBOARD' && session.state !== 'FINISHED') return null;
  return <StandingsReveal key={`${session.id}:${session.standingsRevision}`} session={session}/>;
}
function StandingsReveal({ session }: { session: PublicLobby }) {
  const surface = useRef<HTMLElement>(null);
  const animateRanks = useRef(false);
  const [progress,setProgress] = useState(0);
  const [ordered,setOrdered] = useState(false);
  const [replay,setReplay] = useState(0);
  const [page,setPage] = useState(0);
  const [winnersReplay,setWinnersReplay] = useState(0);
  const pageCount = Math.max(1,Math.ceil(session.leaderboard.length/PAGE_SIZE));
  const current = Math.min(page,pageCount-1);
  // Arrow keys (or a presentation clicker) flip through the ranking pages.
  useEffect(() => {
    if (pageCount < 2) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable]')) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') setPage(value => Math.min(pageCount-1,value+1));
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') setPage(value => Math.max(0,value-1));
    };
    window.addEventListener('keydown',onKey);
    return () => window.removeEventListener('keydown',onKey);
  },[pageCount]);
  useEffect(() => {
    // The reveal is the presentation itself, so it plays even when the OS
    // reports reduced motion (Windows does whenever Animation effects is off).
    if (!ordered || !animateRanks.current) return;
    const animations = Array.from(surface.current?.querySelectorAll<HTMLElement>('.ranking-row') ?? []).map(row => {
      if (!row.animate || row.dataset.from === row.style.transform) return null;
      const animation = row.animate([{ transform:row.dataset.from },{ transform:row.style.transform }],{ duration:1100,easing:'cubic-bezier(.22,.7,.2,1)' });
      void animation.finished.catch(() => { /* Normal cancellation on replay/navigation. */ });
      return animation;
    });
    return () => animations.forEach(animation => animation?.cancel());
  },[ordered]);
  useEffect(() => {
    animateRanks.current = false;
    const key = `localmenti:standings:${session.id}`;
    let seen = false;
    const remember = () => { try { sessionStorage.setItem(key,String(session.standingsRevision)); } catch { /* Storage is optional. */ } };
    try { seen = sessionStorage.getItem(key) === String(session.standingsRevision); } catch { /* Animation works without storage. */ }
    if (seen && replay === 0) { setProgress(1); setOrdered(true); remember(); return; }
    setProgress(0); setOrdered(false);
    let frame = 0; const begin = performance.now();
    const animate = (now: number) => {
      const elapsed = now-begin;
      setProgress(Math.min(1,Math.max(0,(elapsed-600)/2600)));
      if (elapsed >= 3600) { animateRanks.current = true; setOrdered(true); remember(); }
      else frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  },[session.id,session.standingsRevision,replay]);
  const eased = progress*progress*(3-2*progress);
  const number = (total: number, previous = 0) => Math.round(previous+(total-previous)*eased).toLocaleString();
  // Ten ranks per page. Compact the previous order of the visible page so
  // players arriving from another page never overlap a row.
  const visible = session.leaderboard.slice(current*PAGE_SIZE,(current+1)*PAGE_SIZE);
  const previousOrder = [...visible].sort((a,b) => (a.previousPosition !== undefined && a.previousPosition >= 0 ? a.previousPosition : 1000)-(b.previousPosition !== undefined && b.previousPosition >= 0 ? b.previousPosition : 1000));
  const maxScore = Math.max(1,...session.leaderboard.map(entry => entry.score));
  // Reserve room for the widest "12,345 pts +1,234" label so long scores
  // shrink the bars instead of pushing past the edge of the screen.
  const scoreChars = Math.max(0,...visible.map(entry => entry.score.toLocaleString().length+2.4+(entry.score > (entry.previousScore ?? 0) ? 0.7*((entry.score-(entry.previousScore ?? 0)).toLocaleString().length+1) : 0)));
  return <section ref={surface} className={`standings standings-reveal ${ordered ? 'standings-settled' : 'standings-counting'} ${pageCount > 1 ? 'standings-paged' : ''}`}>
    <div className="standings-heading"><div><p className="kicker">{session.state === 'FINISHED' ? 'THE FINAL STANDINGS' : 'THE HOST HAS OPENED THE STANDINGS'}</p><h2>{session.state === 'FINISHED' ? 'What a room.' : 'Every second counted.'}</h2></div><span className="reveal-status" role="status">{ordered ? 'Standings revealed' : progress === 0 ? 'Last published points' : progress < 1 ? 'Adding points…' : 'New positions next…'}</span><div className="standings-actions">{session.state === 'FINISHED' && <PodiumCardButton session={session}/>}{session.state === 'FINISHED' && session.podium.length > 0 && <button type="button" className="replay-standings" onClick={() => setWinnersReplay(value => value+1)}>Replay winners</button>}<button type="button" className="replay-standings" onClick={() => setReplay(value => value+1)}>Replay reveal</button></div></div>
    {session.state === 'FINISHED' && <WinnersReveal sessionId={session.id} podium={session.podium} replay={winnersReplay}/>}
    {visible.length ? <ol className="ranking-list animated-rankings menti-board" style={{ height: `calc(${visible.length} * var(--rank-step, 56px))`, ['--score-chars' as string]: scoreChars, ['--rows' as string]: Math.max(visible.length,current > 0 ? PAGE_SIZE : 0) }} aria-label={`Leaderboard, places ${current*PAGE_SIZE+1} to ${current*PAGE_SIZE+visible.length}`}>{visible.map((player,index) => {
      const previousPosition = previousOrder.findIndex(entry => entry.id === player.id);
      const barScore = (player.previousScore ?? 0)+(player.score-(player.previousScore ?? 0))*eased;
      const delta = player.score-(player.previousScore ?? 0);
      return <li data-from={previousPosition === 0 ? "translateY(0)" : `translateY(calc(${previousPosition} * var(--rank-step, 56px)))`} className={`ranking-row menti-row ${index === 0 && current === 0 && ordered ? 'menti-leader' : ''} ${player.avatarIndex === RESERVED_AVATAR_INDEX ? 'ranking-reserved' : ''}`} style={{ transform: (ordered ? index : previousPosition) === 0 ? 'translateY(0)' : `translateY(calc(${ordered ? index : previousPosition} * var(--rank-step, 56px)))` }} key={player.id}><strong className="visible-rank">{ordered ? player.rank : player.previousRank ?? '—'}</strong><Avatar index={player.avatarIndex} small/><div className="rank-name"><div className="rank-identity"><strong title={player.nickname}>{player.nickname}</strong><LeaderboardTags player={player}/></div><RankMovement rank={player.rank} previous={player.previousRank} visible={ordered}/></div><div className="menti-track"><div className={`rank-score-fill rank-color-${player.avatarIndex%6}`} style={{ width:`${barScore/maxScore*100}%` }}><span className="menti-score"><strong className="rank-points">{number(player.score,player.previousScore)} <small>pts</small></strong>{delta > 0 && <span className="points-gained">+{number(delta)}</span>}</span></div></div></li>;
    })}</ol> : <p className="stage-message">No scored results to publish yet. Polls do not change points or positions.</p>}
    {pageCount > 1 && <RankPager page={current} pageCount={pageCount} total={session.leaderboard.length} onPage={setPage}/>}
    <p className="hint">Highest points first, then most correct answers, then lowest total answer time (wrong or missing answers count as the full timer). Exact ties share a rank. Polls do not count.</p>{session.state === 'FINISHED' && <MadeBy/>}
  </section>;
}
const PAGE_SIZE = 10;
// First, last and the pages around the current one; gaps become an ellipsis.
function pagerItems(page: number, count: number): (number | null)[] {
  const keep = [...new Set([0,count-1,page-1,page,page+1])].filter(value => value >= 0 && value < count).sort((a,b) => a-b);
  return keep.flatMap((value,index) => index > 0 && value-keep[index-1] > 1 ? [null,value] : [value]);
}
function RankPager({ page, pageCount, total, onPage }: { page:number; pageCount:number; total:number; onPage:(page:number) => void }) {
  const first = page*PAGE_SIZE+1; const last = Math.min(total,(page+1)*PAGE_SIZE);
  return <nav className="rank-pager" aria-label="Leaderboard pages">
    <span className="rank-pager-range">Places {first}–{last} of {total}</span>
    <div className="rank-pager-buttons">
      <button type="button" className="rank-pager-step" disabled={page === 0} onClick={() => onPage(page-1)} aria-label="Previous ten places">←</button>
      {pagerItems(page,pageCount).map((item,index) => item === null ? <span className="rank-pager-gap" key={`gap-${index}`}>…</span> : <button type="button" key={item} className="rank-pager-page" aria-current={item === page ? 'page' : undefined} aria-label={`Places ${item*PAGE_SIZE+1} to ${Math.min(total,(item+1)*PAGE_SIZE)}`} onClick={() => onPage(item)}>{item+1}</button>)}
      <button type="button" className="rank-pager-step" disabled={page === pageCount-1} onClick={() => onPage(page+1)} aria-label="Next ten places">→</button>
    </div>
  </nav>;
}
function LeaderboardTags({ player }: { player:RankEntry }) {
  return <span className="leaderboard-tags">{player.avatarIndex === RESERVED_AVATAR_INDEX && <span className="leaderboard-tag creator-tag">Creator</span>}{player.fastestResponseMs !== undefined && <span className="leaderboard-tag fastest-tag" title="Lowest average answer time across all scored questions. Wrong or missing answers count as the full timer.">Fastest · {(player.fastestResponseMs/1000).toFixed(2)}s avg</span>}</span>;
}
function RankMovement({ rank, previous, visible }: { rank: number; previous?: number | null; visible: boolean }) {
  const change = previous === null || previous === undefined ? null : previous-rank;
  return <span className={`rank-movement ${visible && change && change > 0 ? 'rank-up' : visible && change && change < 0 ? 'rank-down' : ''}`}>{!visible ? 'Position reveal next' : change === null ? 'First published rank' : change > 0 ? `↑ Up ${change}` : change < 0 ? `↓ Down ${-change}` : 'Position held'}</span>;
}

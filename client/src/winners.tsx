import { useEffect, useRef, useState } from 'react';
import { type RankEntry } from '@localmenti/shared';
import { Avatar } from './players.js';
import './winners.css';

// Third, then second, a pause for suspense, then the winner.
const STEPS = [900, 2600, 3700, 4900, 6200];
const PLACE_NAMES = ['1st', '2nd', '3rd'];
const CONFETTI = Array.from({ length: 64 }, (_, index) => index);

export function ordinal(rank: number) {
  const tens = rank % 100;
  if (tens >= 11 && tens <= 13) return `${rank}th`;
  return `${rank}${['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th'}`;
}

/** Full-screen podium shown once when the quiz finishes. */
export function WinnersReveal({ sessionId, podium, replay }: { sessionId: string; podium: RankEntry[]; replay: number }) {
  const key = `localmenti:winners:${sessionId}`;
  const [open, setOpen] = useState(() => {
    try { return sessionStorage.getItem(key) === null; } catch { return true; }
  });
  const [step, setStep] = useState(0);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (replay > 0) setOpen(true); }, [replay]);
  useEffect(() => {
    if (!open) return;
    setStep(0);
    const timers = STEPS.map((delay, index) => window.setTimeout(() => {
      setStep(index + 1);
      if (index === STEPS.length - 1) { try { sessionStorage.setItem(key, 'seen'); } catch { /* Storage is optional. */ } }
    }, delay));
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { timers.forEach(clearTimeout); window.removeEventListener('keydown', onKey); };
  }, [open, replay, key]);
  useEffect(() => { if (step === STEPS.length) closeButton.current?.focus(); }, [step]);
  if (!open || podium.length === 0) return null;
  const winner = podium[0];
  // step 1: third, 2: second, 3: suspense, 4: winner, 5: actions.
  const shown = (place: number) => place === 2 ? step >= 1 : place === 1 ? step >= 2 : step >= 4;
  const heading = step >= 4 ? `${winner.nickname} wins!` : step === 3 ? 'And the winner is…' : 'The top three';
  return <div className={`winners-stage ${step >= 4 ? 'winners-crowned' : ''}`} role="dialog" aria-modal="true" aria-labelledby="winners-heading">
    <h2 id="winners-heading" className="winners-heading" key={heading} aria-live="polite">{heading}</h2>
    <div className="winners-podium">
      {[1, 0, 2].map(place => {
        const player = podium[place];
        if (!player) return <div className={`winners-column winners-place-${place}`} key={place} aria-hidden="true"/>;
        return <div className={`winners-column winners-place-${place} ${shown(place) ? 'winners-shown' : ''}`} key={player.id} aria-hidden={!shown(place)}>
          <div className="winners-person">
            <Avatar index={player.avatarIndex}/>
            <strong className="winners-name" title={player.nickname}>{player.nickname}</strong>
            <span className="winners-points">{player.score.toLocaleString()} pts</span>
          </div>
          <div className="winners-pedestal"><span>{player.rank <= 3 ? PLACE_NAMES[player.rank - 1] : ordinal(player.rank)}</span></div>
        </div>;
      })}
    </div>
    {step >= 4 && <div className="winners-confetti" aria-hidden="true">{CONFETTI.map(index => <i key={index} style={{
      ['--x' as string]: `${(index * 37) % 100}%`, ['--delay' as string]: `${(index % 16) * 0.07}s`,
      ['--spin' as string]: `${(index * 53) % 360}deg`, ['--drift' as string]: `${((index * 29) % 120) - 60}px`,
      ['--fall' as string]: `${2.6 + (index % 7) * 0.25}s`, ['--hue' as string]: `var(--confetti-${index % 6})` }}/>)}</div>}
    <div className="winners-actions">
      {step >= STEPS.length ? <button ref={closeButton} type="button" className="button" onClick={() => setOpen(false)}>See full leaderboard</button>
        : <button type="button" className="winners-skip" onClick={() => setOpen(false)}>Skip</button>}
    </div>
  </div>;
}

/** Medal line for a phone that finished in the top three. */
export function PodiumMedal({ rank }: { rank: number | null }) {
  if (rank === null || rank > 3) return null;
  return <p className={`podium-medal medal-${rank}`}><span aria-hidden="true">{['🥇', '🥈', '🥉'][rank - 1]}</span>You finished {PLACE_NAMES[rank - 1]}!</p>;
}

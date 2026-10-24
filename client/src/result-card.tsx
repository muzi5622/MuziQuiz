import { useEffect, useRef, useState } from 'react';
import { avatarFor, RESERVED_AVATAR_INDEX, type ParticipantLobby, type PublicLobby } from '@localmenti/shared';
import './result-card.css';

const WIDTH = 1080;
const HEIGHT = 1350;
const DISPLAY = '"Segoe UI Variable Display","Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif';
const EMOJI = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
// Vertical layout: the avatar centre sits here and everything below flows from it.
const AVATAR_Y = 535;
const MEDALS = [
  { place: '1st place', accent: '#e9c77f', ring: ['#fff1c9', '#e3c27e', '#a8823c'], glow: '#e3c27e' },
  { place: '2nd place', accent: '#dcd6e8', ring: ['#ffffff', '#cfc8de', '#8f86a3'], glow: '#c9c1dc' },
  { place: '3rd place', accent: '#e4ab82', ring: ['#ffd9bd', '#d39466', '#8f5530'], glow: '#d8956a' }
];

export type ResultCardModel = {
  eventName: string; quizTitle: string; nickname: string; avatarIndex: number;
  rank: number; players: number; points: number; correct: number; questions: number;
  medal: (typeof MEDALS)[number] | null; tagline: string; date: string;
};

/** Everything the card shows, derived from the phone's own final state. */
export function resultCardModel(lobby: ParticipantLobby, now = new Date()): ResultCardModel | null {
  const { participant, session, history } = lobby;
  if (participant.rank === null) return null;
  const players = Math.max(session.joinedCount, participant.rank);
  const share = participant.rank / players;
  const medal = participant.rank <= 3 ? MEDALS[participant.rank - 1] : null;
  return {
    eventName: session.eventName, quizTitle: session.title, nickname: participant.nickname, avatarIndex: participant.avatarIndex,
    rank: participant.rank, players, points: participant.score,
    correct: history.filter(entry => entry.points > 0).length, questions: history.length, medal,
    tagline: participant.rank === 1 ? 'Champion of the room' : medal ? 'On the podium' : share <= 0.1 ? 'Top 10% of the room' : share <= 0.25 ? 'Top 25% of the room' : 'Thanks for playing',
    date: now.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  };
}

// Deterministic sparkle/confetti layout so the same result always looks the same.
function seeded(seed: string) {
  let value = [...seed].reduce((hash, char) => Math.imul(hash ^ char.codePointAt(0)!, 16777619), 2166136261) >>> 0;
  return () => { value = Math.imul(value ^ (value >>> 15), 2246822507) >>> 0; value = Math.imul(value ^ (value >>> 13), 3266489909) >>> 0; return ((value ^= value >>> 16) >>> 0) / 4294967296; };
}
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, start: number, min: number, maxWidth: number) {
  let size = start;
  do { ctx.font = `${weight} ${size}px ${DISPLAY}`; size -= 2; } while (ctx.measureText(text).width > maxWidth && size >= min);
  if (ctx.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) clipped = clipped.slice(0, -1);
  return `${clipped}…`;
}
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean); const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next; else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s*\S*$/, '')}…`; }
  return lines;
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = color; ctx.beginPath();
  for (let i = 0; i < 8; i++) { const r = i % 2 === 0 ? size : size * 0.22; const a = (Math.PI / 4) * i - Math.PI / 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  ctx.closePath(); ctx.fill(); ctx.restore();
}

/** Draws the 1080×1350 share card. Pure canvas, no network. */
export function drawResultCard(canvas: HTMLCanvasElement, model: ResultCardModel) {
  canvas.width = WIDTH; canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const accent = model.medal?.accent ?? '#b9a6e6';
  const random = seeded(`${model.nickname}:${model.rank}:${model.points}`);
  // Background and glow.
  const background = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  background.addColorStop(0, '#2a1d40'); background.addColorStop(1, '#110b1b');
  ctx.fillStyle = background; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const glow = ctx.createRadialGradient(WIDTH / 2, AVATAR_Y, 40, WIDTH / 2, AVATAR_Y, 620);
  glow.addColorStop(0, `${model.medal?.glow ?? '#6c4fa8'}66`); glow.addColorStop(1, '#00000000');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  if (model.medal) {
    // Light rays behind the avatar.
    ctx.save(); ctx.translate(WIDTH / 2, AVATAR_Y); ctx.globalAlpha = 0.09; ctx.fillStyle = model.medal.glow;
    for (let i = 0; i < 18; i++) { ctx.rotate((Math.PI * 2) / 18); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-38, -760); ctx.lineTo(38, -760); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    // Confetti.
    const colors = ['#e5484d', '#3e63dd', '#f5b13d', '#12a594', '#8e4ec6', model.medal.accent];
    for (let i = 0; i < 70; i++) {
      const x = random() * WIDTH; const y = random() * HEIGHT;
      if (Math.hypot(x - WIDTH / 2, y - AVATAR_Y - 40) < 400 || y > HEIGHT - 260) continue;
      ctx.save(); ctx.translate(x, y); ctx.rotate(random() * Math.PI); ctx.globalAlpha = 0.55 + random() * 0.4;
      ctx.fillStyle = colors[i % colors.length];
      if (i % 3 === 0) { ctx.beginPath(); ctx.arc(0, 0, 6 + random() * 5, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-6, -11, 12, 22);
      ctx.restore();
    }
  }
  // Header: brand and date.
  ctx.textBaseline = 'middle';
  roundRect(ctx, 64, 60, 92, 56, 14); ctx.fillStyle = '#f3eef8'; ctx.fill();
  ctx.fillStyle = '#1a1226'; ctx.font = `800 30px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.fillText('mq', 104, 89);
  ctx.fillStyle = '#e3c27e'; ctx.beginPath(); ctx.arc(138, 82, 6, 0, Math.PI * 2); ctx.fill();
  ctx.textAlign = 'left'; ctx.fillStyle = '#f3eef8'; ctx.font = `700 34px ${DISPLAY}`; ctx.fillText('MuziQuiz', 172, 89);
  ctx.textAlign = 'right'; ctx.fillStyle = '#b8adca'; ctx.font = `500 28px ${DISPLAY}`; ctx.fillText(model.date, WIDTH - 64, 89);
  // Event and quiz title.
  ctx.textAlign = 'center';
  let y = 196;
  const headline = model.eventName || model.quizTitle;
  ctx.font = `700 58px ${DISPLAY}`; ctx.fillStyle = model.eventName ? '#e3c27e' : '#f3eef8';
  for (const line of wrap(ctx, headline, WIDTH - 160, 2)) { ctx.fillText(line, WIDTH / 2, y); y += 68; }
  if (model.eventName) { ctx.fillStyle = '#b8adca'; ctx.fillText(fitFont(ctx, model.quizTitle, 500, 34, 24, WIDTH - 200), WIDTH / 2, y + 2); }
  // Avatar token with medal ring.
  const cx = WIDTH / 2; const cy = AVATAR_Y; const radius = 132;
  if (model.medal) {
    const ring = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    model.medal.ring.forEach((color, index) => ring.addColorStop(index / 2, color));
    ctx.shadowColor = model.medal.glow; ctx.shadowBlur = 60;
    ctx.beginPath(); ctx.arc(cx, cy, radius + 22, 0, Math.PI * 2); ctx.fillStyle = ring; ctx.fill();
    ctx.shadowBlur = 0;
  }
  const avatar = avatarFor(model.avatarIndex);
  const tone = model.avatarIndex === RESERVED_AVATAR_INDEX ? '#1d1429' : avatar.color;
  const face = ctx.createRadialGradient(cx - 50, cy - 60, 10, cx, cy, radius);
  face.addColorStop(0, '#ffffff55'); face.addColorStop(0.45, tone); face.addColorStop(1, tone);
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fillStyle = tone; ctx.fill(); ctx.fillStyle = face; ctx.fill();
  ctx.font = `150px ${EMOJI}`; ctx.fillText(avatar.icon, cx, cy + 7);
  if (model.medal) for (let i = 0; i < 9; i++) {
    const angle = random() * Math.PI * 2; const distance = radius + 60 + random() * 120;
    sparkle(ctx, cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.8, 10 + random() * 16, i % 3 ? '#fff6dd' : model.medal.accent);
  }
  // Place ribbon.
  y = cy + radius + 58;
  const ribbon = model.medal ? `${['🥇', '🥈', '🥉'][model.rank - 1]}  ${model.medal.place}` : model.tagline;
  ctx.font = `700 34px ${DISPLAY}`;
  const ribbonWidth = ctx.measureText(ribbon).width + 70;
  roundRect(ctx, cx - ribbonWidth / 2, y - 32, ribbonWidth, 64, 32);
  ctx.fillStyle = model.medal ? `${model.medal.accent}2e` : '#ffffff14'; ctx.fill();
  ctx.strokeStyle = model.medal ? `${model.medal.accent}aa` : '#ffffff33'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = accent; ctx.font = `700 34px ${DISPLAY}, ${EMOJI}`; ctx.fillText(ribbon, cx, y + 1);
  // Name.
  y += 94;
  ctx.fillStyle = '#ffffff'; ctx.fillText(fitFont(ctx, model.nickname, 800, 76, 44, WIDTH - 160), cx, y);
  // Rank.
  y += 126;
  ctx.fillStyle = accent; ctx.font = `800 150px ${DISPLAY}`; ctx.fillText(`#${model.rank}`, cx, y);
  y += 94;
  ctx.fillStyle = '#b8adca'; ctx.font = `500 38px ${DISPLAY}`; ctx.fillText(`out of ${model.players.toLocaleString()} ${model.players === 1 ? 'player' : 'players'}`, cx, y);
  // Stats.
  y += 52;
  const stats = [[model.points.toLocaleString(), 'points'], [`${model.correct}/${model.questions}`, 'correct']];
  stats.forEach(([value, label], index) => {
    const x = 120 + index * 440; roundRect(ctx, x, y, 400, 124, 26); ctx.fillStyle = '#ffffff12'; ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = `800 58px ${DISPLAY}`; ctx.fillText(value, x + 200, y + 50);
    ctx.fillStyle = '#b8adca'; ctx.font = `500 28px ${DISPLAY}`; ctx.fillText(label, x + 200, y + 96);
  });
  // Footer.
  ctx.fillStyle = '#8a7fa0'; ctx.font = `500 26px ${DISPLAY}`; ctx.fillText('Played live with MuziQuiz · Made by MUZI', cx, HEIGHT - 44);
  return true;
}

export type PodiumCardModel = {
  eventName: string; quizTitle: string; players: number; date: string;
  winners: { nickname: string; avatarIndex: number; rank: number; points: number }[];
};
/** The final top three for the host's podium image. */
export function podiumCardModel(session: Pick<PublicLobby, 'eventName' | 'title' | 'joinedCount' | 'podium'>, now = new Date()): PodiumCardModel | null {
  if (session.podium.length === 0) return null;
  return { eventName: session.eventName, quizTitle: session.title, players: Math.max(session.joinedCount, session.podium.length),
    date: now.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
    winners: session.podium.slice(0, 3).map(entry => ({ nickname: entry.nickname, avatarIndex: entry.avatarIndex, rank: entry.rank, points: entry.score })) };
}

function drawHeader(ctx: CanvasRenderingContext2D, date: string) {
  ctx.textBaseline = 'middle';
  roundRect(ctx, 64, 60, 92, 56, 14); ctx.fillStyle = '#f3eef8'; ctx.fill();
  ctx.fillStyle = '#1a1226'; ctx.font = `800 30px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.fillText('mq', 104, 89);
  ctx.fillStyle = '#e3c27e'; ctx.beginPath(); ctx.arc(138, 82, 6, 0, Math.PI * 2); ctx.fill();
  ctx.textAlign = 'left'; ctx.fillStyle = '#f3eef8'; ctx.font = `700 34px ${DISPLAY}`; ctx.fillText('MuziQuiz', 172, 89);
  ctx.textAlign = 'right'; ctx.fillStyle = '#b8adca'; ctx.font = `500 28px ${DISPLAY}`; ctx.fillText(date, WIDTH - 64, 89);
  ctx.textAlign = 'center';
}
function drawToken(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, avatarIndex: number, medal: (typeof MEDALS)[number] | null) {
  if (medal) {
    const ring = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    medal.ring.forEach((color, index) => ring.addColorStop(index / 2, color));
    ctx.shadowColor = medal.glow; ctx.shadowBlur = radius * 0.4;
    ctx.beginPath(); ctx.arc(cx, cy, radius + radius * 0.15, 0, Math.PI * 2); ctx.fillStyle = ring; ctx.fill();
    ctx.shadowBlur = 0;
  }
  const avatar = avatarFor(avatarIndex);
  const tone = avatarIndex === RESERVED_AVATAR_INDEX ? '#1d1429' : avatar.color;
  const face = ctx.createRadialGradient(cx - radius * 0.38, cy - radius * 0.45, radius * 0.08, cx, cy, radius);
  face.addColorStop(0, '#ffffff55'); face.addColorStop(0.45, tone); face.addColorStop(1, tone);
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fillStyle = tone; ctx.fill(); ctx.fillStyle = face; ctx.fill();
  ctx.font = `${Math.round(radius * 1.12)}px ${EMOJI}`; ctx.textBaseline = 'middle'; ctx.fillText(avatar.icon, cx, cy + radius * 0.05);
}

/** Draws the host's 1080×1350 top-three podium image. */
export function drawPodiumCard(canvas: HTMLCanvasElement, model: PodiumCardModel) {
  canvas.width = WIDTH; canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const random = seeded(`${model.quizTitle}:${model.winners.map(winner => winner.nickname).join(',')}`);
  const background = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  background.addColorStop(0, '#2a1d40'); background.addColorStop(1, '#110b1b');
  ctx.fillStyle = background; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const winnerY = 640;
  const glow = ctx.createRadialGradient(WIDTH / 2, winnerY, 40, WIDTH / 2, winnerY, 640);
  glow.addColorStop(0, '#e3c27e55'); glow.addColorStop(1, '#00000000');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.save(); ctx.translate(WIDTH / 2, winnerY); ctx.globalAlpha = 0.08; ctx.fillStyle = '#e3c27e';
  for (let i = 0; i < 18; i++) { ctx.rotate((Math.PI * 2) / 18); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-40, -820); ctx.lineTo(40, -820); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  const colors = ['#e5484d', '#3e63dd', '#f5b13d', '#12a594', '#8e4ec6', '#e3c27e'];
  for (let i = 0; i < 80; i++) {
    const x = random() * WIDTH; const y = 150 + random() * (HEIGHT - 420);
    ctx.save(); ctx.translate(x, y); ctx.rotate(random() * Math.PI); ctx.globalAlpha = 0.5 + random() * 0.4; ctx.fillStyle = colors[i % colors.length];
    if (i % 3 === 0) { ctx.beginPath(); ctx.arc(0, 0, 6 + random() * 5, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-6, -11, 12, 22);
    ctx.restore();
  }
  drawHeader(ctx, model.date);
  let y = 196;
  ctx.font = `700 58px ${DISPLAY}`; ctx.fillStyle = model.eventName ? '#e3c27e' : '#f3eef8';
  for (const line of wrap(ctx, model.eventName || model.quizTitle, WIDTH - 160, 2)) { ctx.fillText(line, WIDTH / 2, y); y += 68; }
  if (model.eventName) { ctx.fillStyle = '#b8adca'; ctx.fillText(fitFont(ctx, model.quizTitle, 500, 34, 24, WIDTH - 200), WIDTH / 2, y + 2); y += 60; }
  ctx.fillStyle = '#f3eef8'; ctx.font = `700 40px ${DISPLAY}`; ctx.fillText('Top of the room', WIDTH / 2, y + 22);
  // Podium: 2nd | 1st | 3rd, pedestals rising from the base line.
  const base = HEIGHT - 150; const columnWidth = 300; const gap = 24;
  const columns = [{ slot: 1, x: WIDTH / 2 - columnWidth - gap, height: 230 }, { slot: 0, x: WIDTH / 2, height: 320 }, { slot: 2, x: WIDTH / 2 + columnWidth + gap, height: 170 }];
  const pedestals = [['#f2dca6', '#c9a25a'], ['#e6e1ee', '#a49cb4'], ['#e7b48c', '#a8683f']];
  for (const column of columns) {
    const winner = model.winners[column.slot];
    if (!winner) continue;
    const medal = winner.rank <= 3 ? MEDALS[winner.rank - 1] : null;
    const top = base - column.height;
    const fill = ctx.createLinearGradient(0, top, 0, base);
    fill.addColorStop(0, pedestals[column.slot][0]); fill.addColorStop(1, pedestals[column.slot][1]);
    roundRect(ctx, column.x - columnWidth / 2, top, columnWidth, column.height + 40, 22); ctx.fillStyle = fill; ctx.fill();
    ctx.fillStyle = column.slot === 0 ? '#2a1d0c' : column.slot === 1 ? '#231b31' : '#2b1608';
    ctx.font = `800 ${column.slot === 0 ? 76 : 62}px ${DISPLAY}`; ctx.fillText(medal ? medal.place.replace(' place', '') : `#${winner.rank}`, column.x, top + (column.slot === 0 ? 70 : 60));
    ctx.font = `600 30px ${DISPLAY}`; ctx.fillText(`${winner.points.toLocaleString()} pts`, column.x, top + (column.slot === 0 ? 140 : 118));
    const radius = column.slot === 0 ? 108 : 84;
    const cy = top - 120 - radius;
    drawToken(ctx, column.x, cy, radius, winner.avatarIndex, medal);
    ctx.fillStyle = column.slot === 0 ? '#e3c27e' : '#ffffff';
    ctx.fillText(fitFont(ctx, winner.nickname, 800, column.slot === 0 ? 50 : 42, 26, columnWidth + 10), column.x, top - 64);
    if (column.slot === 0) for (let i = 0; i < 8; i++) {
      const angle = random() * Math.PI * 2; const distance = radius + 40 + random() * 70;
      sparkle(ctx, column.x + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * 0.85, 10 + random() * 14, i % 2 ? '#fff6dd' : '#e3c27e');
    }
  }
  ctx.fillStyle = '#8a7fa0'; ctx.font = `500 26px ${DISPLAY}`; ctx.textBaseline = 'middle';
  ctx.fillText(`${model.players.toLocaleString()} ${model.players === 1 ? 'player' : 'players'} · Played live with MuziQuiz · Made by MUZI`, WIDTH / 2, HEIGHT - 44);
  return true;
}

const slug = (text: string) => text.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'result';

/** Preview dialog for a drawn image: save always, share where the browser allows. */
function ShareImageDialog({ title, alt, fileName, shareTitle, shareText, draw, onClose }: {
  title: string; alt: string; fileName: string; shareTitle: string; shareText: string;
  draw: (canvas: HTMLCanvasElement) => boolean; onClose: () => void;
}) {
  const [image, setImage] = useState<{ url: string; file: File } | null>(null);
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal?.(); }, []);
  useEffect(() => {
    const canvas = document.createElement('canvas');
    if (!draw(canvas)) { setNotice('This browser cannot draw the image.'); return; }
    let url = ''; let cancelled = false;
    canvas.toBlob(blob => {
      if (cancelled) return;
      if (!blob) { setNotice('This browser cannot create the image.'); return; }
      url = URL.createObjectURL(blob);
      setImage({ url, file: new File([blob], fileName, { type: 'image/png' }) });
    }, 'image/png');
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  // Drawn once per opening; the dialog is remounted for a new image.
  }, []);
  const canShare = image !== null && typeof navigator.canShare === 'function' && navigator.canShare({ files: [image.file] });
  async function share() {
    if (!image) return;
    try { await navigator.share({ files: [image.file], title: shareTitle, text: shareText }); setNotice('Shared.'); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setNotice('Sharing is not available here. Save the image instead.'); }
  }
  const close = () => { dialog.current?.close?.(); onClose(); };
  return <dialog ref={dialog} className="result-card-dialog" aria-labelledby="share-image-title" onCancel={close}>
    <h2 id="share-image-title">{title}</h2>
    {image ? <img className="result-card-image" src={image.url} alt={alt}/> : <p className="result-card-loading" role="status">{notice || 'Drawing the image…'}</p>}
    <p className="hint">On a phone you can also press and hold the picture to save it.</p>
    <div className="result-card-actions">
      {canShare && <button type="button" className="button" onClick={() => void share()}>Share</button>}
      {image && <a className="button result-card-save" href={image.url} download={image.file.name} onClick={() => setNotice('Saved. Check your downloads or photos.')}>Save image</a>}
      <button type="button" className="result-card-close" onClick={close}>Close</button>
    </div>
    {notice && image && <p className="hint" role="status">{notice}</p>}
  </dialog>;
}

/** "Share my result" on a finished phone. */
export function ResultCardButton({ lobby }: { lobby: ParticipantLobby }) {
  const [open, setOpen] = useState(false);
  const model = resultCardModel(lobby);
  if (!model) return null;
  const where = model.eventName || model.quizTitle;
  return <>
    <button type="button" className={`button result-card-open ${model.medal ? `result-card-medal-${model.rank}` : ''}`} onClick={() => setOpen(true)}>Share my result</button>
    {open && <ShareImageDialog title="Your result card" onClose={() => setOpen(false)} draw={canvas => drawResultCard(canvas, model)}
      fileName={`muziquiz-${slug(where)}-${slug(model.nickname)}.png`} shareTitle={where} shareText={`I finished #${model.rank} of ${model.players} at ${where}!`}
      alt={`Result card: ${model.nickname}, rank ${model.rank} of ${model.players}, ${model.points} points${model.eventName ? `, ${model.eventName}` : ''}`}/>}
  </>;
}

/** Host: export the final top three as one image. */
export function PodiumCardButton({ session, className = 'replay-standings' }: { session: Pick<PublicLobby, 'eventName' | 'title' | 'joinedCount' | 'podium'>; className?: string }) {
  const [open, setOpen] = useState(false);
  const model = podiumCardModel(session);
  if (!model) return null;
  const where = model.eventName || model.quizTitle;
  return <>
    <button type="button" className={className} onClick={() => setOpen(true)}>Share top 3</button>
    {open && <ShareImageDialog title="Top 3 image" onClose={() => setOpen(false)} draw={canvas => drawPodiumCard(canvas, model)}
      fileName={`muziquiz-${slug(where)}-top-3.png`} shareTitle={where}
      shareText={`Top 3 at ${where}: ${model.winners.map(winner => `${winner.rank}. ${winner.nickname}`).join(', ')}`}
      alt={`Top 3 at ${where}: ${model.winners.map(winner => `${winner.nickname} rank ${winner.rank} with ${winner.points} points`).join('; ')}`}/>}
  </>;
}

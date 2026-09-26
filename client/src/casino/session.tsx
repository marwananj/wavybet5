import { useEffect, useState } from 'react';
import { LuChartColumn, LuRotateCcw, LuX } from 'react-icons/lu';
import { usd } from '../lib/format';
import type { Round } from './api';

/**
 * Live session stats: every finished casino round is recorded here (in memory, per game) so the
 * player can see wagered / profit / wins / losses and a profit sparkline for the current session.
 * Results are recorded after a short delay so the panel never spoils an animation.
 */
interface Entry {
  stake: number;
  payout: number;
  at: number;
}
const store = new Map<string, Entry[]>();
const seen = new Set<string>();
const subs = new Set<() => void>();
const REVEAL_DELAY = 2600;

export function recordRound(r: Round | undefined) {
  if (!r || r.status === 'ACTIVE' || seen.has(r.id)) return;
  seen.add(r.id);
  const e = { stake: Number(r.stake), payout: Number(r.payout), at: Date.now() };
  setTimeout(() => {
    const list = store.get(r.game) ?? [];
    list.push(e);
    if (list.length > 2000) list.shift();
    store.set(r.game, list);
    subs.forEach((f) => f());
  }, REVEAL_DELAY);
}

function useSession(game: string) {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((x) => x + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  return store.get(game) ?? [];
}

function Spark({ list }: { list: Entry[] }) {
  if (list.length < 2) return <div className="ss-spark empty">Play a few rounds to see your curve</div>;
  let c = 0;
  const pts = [0, ...list.map((e) => (c += e.payout - e.stake))];
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const W = 240;
  const H = 64;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => 4 + (1 - (v - min) / span) * (H - 8);
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const up = pts[pts.length - 1] >= 0;
  return (
    <svg className="ss-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Session profit">
      <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,.2)" strokeDasharray="3 3" />
      <path d={`${d} L${W} ${y(0)} L0 ${y(0)}Z`} fill={up ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)'} />
      <path d={d} fill="none" stroke={up ? '#22c55e' : '#ef4444'} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** floating "Live stats" panel for a game */
export function SessionStats({ game }: { game: string }) {
  const list = useSession(game);
  const [open, setOpen] = useState(false);
  const wagered = list.reduce((a, e) => a + e.stake, 0);
  const profit = list.reduce((a, e) => a + e.payout - e.stake, 0);
  const wins = list.filter((e) => e.payout > e.stake).length;
  const losses = list.filter((e) => e.payout < e.stake).length;
  const best = list.reduce((a, e) => Math.max(a, e.stake > 0 ? e.payout / e.stake : 0), 0);
  return (
    <>
      <button type="button" className={`ss-toggle ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-label="Live session stats">
        <LuChartColumn size={16} />
        <span className="hide-sm">Live stats</span>
        {list.length > 0 && <em className={profit >= 0 ? 'win' : 'loss'}>{profit >= 0 ? '+' : '−'}{usd(Math.abs(profit))}</em>}
      </button>
      {open && (
        <div className="ss-panel" role="dialog" aria-label="Session stats">
          <header>
            <b>Live stats · this session</b>
            <button
              type="button"
              onClick={() => {
                store.set(game, []);
                subs.forEach((f) => f());
              }}
              title="Reset"
              aria-label="Reset stats"
            >
              <LuRotateCcw size={15} />
            </button>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close">
              <LuX size={16} />
            </button>
          </header>
          <div className="ss-grid">
            <div>
              <small>Profit</small>
              <b className={profit >= 0 ? 'win' : 'loss'}>
                {profit >= 0 ? '+' : '−'}
                {usd(Math.abs(profit))}
              </b>
            </div>
            <div>
              <small>Wagered</small>
              <b>{usd(wagered)}</b>
            </div>
            <div>
              <small>Wins</small>
              <b className="win">{wins}</b>
            </div>
            <div>
              <small>Losses</small>
              <b className="loss">{losses}</b>
            </div>
          </div>
          <Spark list={list} />
          <footer>
            <span>{list.length} rounds</span>
            <span>Best {best ? `${best.toFixed(2)}×` : '—'}</span>
          </footer>
        </div>
      )}
    </>
  );
}
